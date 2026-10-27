import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { flushPromises, mount } from '@vue/test-utils'

/**
 * Textos legais do pareamento (RFC-016, fase 4). O app prometia "não enviamos seus dados"; com o pareamento
 * a lista passa cifrada por um serviço do desenvolvedor, então o aviso, a política e o guia das lojas têm que dizer isso.
 */

let wrapper
afterEach(() => {
  if (wrapper) wrapper.unmount()
  wrapper = null
  vi.unstubAllEnvs()
  document.body.innerHTML = ''
})

async function mountFtue({ pairing }) {
  vi.stubEnv('VITE_PAIR_BASE_URL', pairing ? 'https://pulse.test' : '')
  vi.doMock('@/router', () => ({ markFtueAccepted: vi.fn() }))
  const { routerKey } = await import('vue-router')
  const { default: FTUE } = await import('@/views/FTUE.vue')
  wrapper = mount(FTUE, { global: { provide: { [routerKey]: { replace: vi.fn() } } }, attachTo: document.body })
  await flushPromises()
  return wrapper
}

const privacyCard = (w) => w.findAll('li').find((li) => li.find('h2').text() === 'Privacidade').text()

describe('aviso legal (FTUE)', () => {
  it('sem o serviço de pareamento no build, a promessa continua a mesma de antes', async () => {
    const w = await mountFtue({ pairing: false })

    expect(privacyCard(w)).toContain('Não coletamos nem enviamos seus dados')
    expect(privacyCard(w)).not.toMatch(/pareamento/i)
  })

  it('com o serviço, avisa que a lista passa cifrada por ele e que ele não a lê nem a guarda', async () => {
    const w = await mountFtue({ pairing: true })
    const text = privacyCard(w)

    expect(text).toContain('Não coletamos seus dados')
    expect(text).toMatch(/pareamento/i)
    expect(text).toMatch(/cifrada/)
    expect(text).toMatch(/não consegue ler/)
    expect(text).not.toContain('nem enviamos')
  })

  it.each([false, true])('o aviso legal obrigatório das lojas fica literal (pareamento: %s)', async (pairing) => {
    const w = await mountFtue({ pairing })

    expect(w.find('#ftue-notice').text()).toBe(
      'Este é um reprodutor de mídia genérico. Nenhum conteúdo é fornecido, endossado ou vendido neste aplicativo. O usuário é o único responsável pelos links inseridos.',
    )
  })

  it.each([false, true])('avisa que transmitir manda o endereço do vídeo para a TV escolhida (pareamento: %s)', async (pairing) => {
    const w = await mountFtue({ pairing })

    expect(privacyCard(w)).toMatch(/transmitir para uma TV \(Chromecast\), o endereço do vídeo/)
  })

  it('o texto mudou, então quem aceitou a versão 3 vê o aviso de novo', async () => {
    const { FTUE_VERSION, storage, STORAGE_KEYS, hasAcceptedFtue } = await import('@/services/storage')
    expect(FTUE_VERSION).toBe(4)

    await storage.set(STORAGE_KEYS.FTUE_ACCEPTED, { accepted: true, acceptedAt: '2026-10-26T00:00:00.000Z', version: 3 })
    expect(await hasAcceptedFtue()).toBe(false)

    await storage.set(STORAGE_KEYS.FTUE_ACCEPTED, { accepted: true, acceptedAt: '2026-10-27T00:00:00.000Z', version: 4 })
    expect(await hasAcceptedFtue()).toBe(true)
  })
})

describe('documentos', () => {
  const read = (file) => readFileSync(file, 'utf8')

  it('a política de privacidade descreve o pareamento, a cifra, o prazo e o que o serviço vê', () => {
    const privacy = read('PRIVACY.md')

    expect(privacy).toMatch(/pareamento/i)
    expect(privacy).toContain('ponta a ponta')
    expect(privacy).toContain('10 minutos')
    expect(privacy).toMatch(/endereço de rede/i)
  })

  it('a política não afirma mais que nada é enviado ao desenvolvedor', () => {
    expect(read('PRIVACY.md')).not.toContain('Não envia dados pessoais, de uso ou de diagnóstico para o desenvolvedor ou para terceiros.')
  })

  it('o README documenta como ligar o pareamento e o que ele muda na privacidade', () => {
    const readme = read('README.md')

    expect(readme).toContain('VITE_PAIR_BASE_URL')
    expect(readme).toMatch(/PRIVACY\.md/)
  })

  it('o guia das lojas pede declarar o serviço nos formulários e testar o pareamento na TV', () => {
    const guide = read('docs/lojas/PUBLICACAO.md')

    expect(guide).toMatch(/pareamento/i)
    expect(guide).toMatch(/Data safety|Segurança dos dados/)
    expect(guide).toMatch(/QR/)
  })
})
