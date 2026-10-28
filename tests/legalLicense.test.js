import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { flushPromises, mount } from '@vue/test-utils'

/**
 * Textos legais da licença (RFC-018, Task 7). Com o serviço de licença ligado, o app envia o código do aparelho e o
 * domínio da lista ao desenvolvedor: o aviso inicial e a política não podem mais dizer "não enviamos seus dados".
 */

let wrapper
afterEach(() => {
  if (wrapper) wrapper.unmount()
  wrapper = null
  vi.unstubAllEnvs()
  vi.resetModules()
  document.body.innerHTML = ''
})

async function mountFtue({ license }) {
  vi.stubEnv('VITE_PAIR_BASE_URL', '')
  vi.stubEnv('VITE_LICENSE_BASE_URL', license ? 'https://licenca.test' : '')
  vi.doMock('@/router', () => ({ markFtueAccepted: vi.fn() }))
  const { routerKey } = await import('vue-router')
  const { default: FTUE } = await import('@/views/FTUE.vue')
  wrapper = mount(FTUE, { global: { provide: { [routerKey]: { replace: vi.fn() } } }, attachTo: document.body })
  await flushPromises()
  return wrapper
}

const privacyCard = (w) => w.findAll('li').find((li) => li.find('h2').text() === 'Privacidade').text()

describe('aviso legal (FTUE) com a licença', () => {
  it('com o serviço ligado, conta o teste de 7 dias e o que vai para o desenvolvedor', async () => {
    const text = privacyCard(await mountFtue({ license: true }))
    expect(text).toContain('teste grátis de 7 dias')
    expect(text).toMatch(/pelo site, ela passa cifrada .* até 7 dias/)
    expect(text).toContain('código do aparelho')
    expect(text).toContain('domínio da lista')
    expect(text).toMatch(/nunca usuário, senha ou o endereço completo/)
    expect(text).not.toMatch(/Não coletamos (nem enviamos )?seus dados/)
  })

  it('sem o serviço no build, a promessa continua a mesma de antes', async () => {
    const text = privacyCard(await mountFtue({ license: false }))
    expect(text).toContain('Não coletamos nem enviamos seus dados.')
    expect(text).not.toContain('código do aparelho')
  })

  it('o texto mudou, então quem aceitou a versão 4 vê o aviso de novo', async () => {
    const { FTUE_VERSION, storage, STORAGE_KEYS, hasAcceptedFtue } = await import('@/services/storage')
    expect(FTUE_VERSION).toBe(6) // 6: lista enviada pelo site (RFC-021)
    await storage.set(STORAGE_KEYS.FTUE_ACCEPTED, { accepted: true, acceptedAt: '2026-10-27T00:00:00.000Z', version: 5 })
    expect(await hasAcceptedFtue()).toBe(false)
  })
})

describe('política de privacidade com a licença', () => {
  const privacy = readFileSync('PRIVACY.md', 'utf8')

  it('descreve o identificador do aparelho, o domínio da lista, a finalidade, a base legal e a guarda', () => {
    expect(privacy).toMatch(/identificador do aparelho/i)
    expect(privacy).toMatch(/domínio/i)
    expect(privacy).toMatch(/teste grátis de 7 dias/i)
    expect(privacy).toContain('LGPD')
    expect(privacy).toContain('24 meses')
  })

  it('descreve a lista enviada pelo site: cifrada, até 7 dias, apagada quando a TV recebe (RFC-021)', () => {
    expect(privacy).toMatch(/enviada pelo site/i)
    expect(privacy).toMatch(/7 dias/)
  })

  it('a lista do que não é enviado inclui a exceção da licença', () => {
    expect(privacy).toMatch(/exceto[\s\S]{0,400}licença/)
  })
})
