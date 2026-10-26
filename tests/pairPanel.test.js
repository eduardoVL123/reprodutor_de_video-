import { describe, it, expect, vi, afterEach } from 'vitest'
import { ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { decodeQrSvg } from './helpers/qrDecode.js'

/** Painel de pareamento da TV (RFC-016, layout A): o `usePairing` é simulado; ele tem testes próprios. */

let wrapper
afterEach(() => {
  if (wrapper) wrapper.unmount()
  wrapper = null
  document.body.innerHTML = ''
})

function fakePairing(initial = {}) {
  const values = {
    state: 'waiting',
    code: 'K7M2QP',
    pageUrl: 'https://pulse.test/K7M2QP',
    displayUrl: 'pulse.test/K7M2QP',
    secondsLeft: 582,
    received: null,
    error: '',
    errorDetail: '',
    errorKind: '',
    ...initial,
  }
  const pairing = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, ref(value)]))
  return Object.assign(pairing, {
    start: vi.fn(async () => {}),
    confirm: vi.fn(async () => true),
    discard: vi.fn(async () => {}),
    stop: vi.fn(),
  })
}

async function mountPanel(initial = {}, props = {}) {
  const pairing = fakePairing(initial)
  vi.doMock('@/composables/usePairing', () => ({ usePairing: () => pairing }))
  const { default: PairPanel } = await import('@/components/PairPanel.vue')
  wrapper = mount(PairPanel, { props, attachTo: document.body })
  await flushPromises()
  return pairing
}

const RECEIVED = { host: 'servidor.exemplo.com', label: 'Casa', insecure: false }

describe('PairPanel — esperando o celular', () => {
  it('pede um código assim que aparece', async () => {
    const pairing = await mountPanel()

    expect(pairing.start).toHaveBeenCalledTimes(1)
  })

  it('mostra o QR, o endereço curto, o código e quanto falta', async () => {
    await mountPanel()

    expect(wrapper.find('#pair-url').text()).toBe('pulse.test/K7M2QP')
    expect(wrapper.find('#pair-code').text()).toBe('K7M2QP')
    expect(wrapper.text()).toContain('Aguardando')
    expect(wrapper.text()).toContain('09:42')
  })

  it('o QR é um QR de verdade e leva ao endereço completo da página do celular', async () => {
    await mountPanel()

    const svg = wrapper.find('#pair-qr').element

    expect(svg.tagName.toLowerCase()).toBe('svg')
    expect(decodeQrSvg(svg)).toBe('https://pulse.test/K7M2QP')
  })

  it('o QR vem sobre fundo branco com a margem de 4 módulos que o padrão exige (preto sobre grafite não lê)', async () => {
    await mountPanel()

    const svg = wrapper.find('#pair-qr').element
    const [x, y, width, height] = svg.getAttribute('viewBox').split(' ').map(Number)
    const background = svg.querySelector('rect')

    expect([x, y]).toEqual([-4, -4])
    expect(width).toBe(height)
    expect(background.getAttribute('fill')).toBe('#fff')
    expect([background.getAttribute('x'), background.getAttribute('y')]).toEqual(['-4', '-4'])
    expect(Number(background.getAttribute('width'))).toBe(width)
    expect(svg.querySelector('path').getAttribute('fill')).toBe('#000')
  })

  it('o QR tem texto alternativo com o endereço e o tamanho vem da propriedade (em rem)', async () => {
    await mountPanel({}, { qrRem: 16 })

    const svg = wrapper.find('#pair-qr')

    expect(svg.attributes('role')).toBe('img')
    expect(svg.attributes('aria-label')).toContain('pulse.test/K7M2QP')
    expect(svg.attributes('style')).toContain('width: 16rem')
  })

  it('no modo compacto (coluna do gerenciador) o código é menor para caber ao lado do QR', async () => {
    await mountPanel()
    expect(wrapper.find('#pair-code').classes()).toContain('text-tv-xl')
    wrapper.unmount()

    await mountPanel({}, { compact: true })

    expect(wrapper.find('#pair-code').classes()).toContain('text-tv-lg')
    expect(wrapper.find('#pair-code').classes()).not.toContain('text-tv-xl')
  })

  it('não usa nenhuma imagem: o QR é desenhado na hora', async () => {
    await mountPanel()

    expect(wrapper.find('img').exists()).toBe(false)
  })

  it('"Novo código" pede outro código', async () => {
    const pairing = await mountPanel()

    await wrapper.find('#pair-refresh').trigger('click')

    expect(pairing.start).toHaveBeenCalledTimes(2)
  })

  it('enquanto o código é gerado mostra o aviso, sem QR, e mantém o botão', async () => {
    await mountPanel({ state: 'starting', code: '', pageUrl: '', displayUrl: '' })

    expect(wrapper.text()).toContain('Gerando')
    expect(wrapper.find('#pair-qr').exists()).toBe(false)
    expect(wrapper.find('#pair-refresh').exists()).toBe(true)
  })

  it('"Digitar manualmente" só aparece quando o pai pede, e avisa o pai', async () => {
    await mountPanel()
    expect(wrapper.find('#pair-manual').exists()).toBe(false)
    wrapper.unmount()

    await mountPanel({}, { showManual: true })
    await wrapper.find('#pair-manual').trigger('click')

    expect(wrapper.emitted('manual')).toHaveLength(1)
  })
})

describe('PairPanel — o que chegou', () => {
  it('mostra o servidor e o apelido, sem endereço completo nem senha, e confirma ou descarta', async () => {
    const pairing = await mountPanel({ state: 'received', received: RECEIVED })

    expect(wrapper.text()).toContain('Adicionar esta lista?')
    expect(wrapper.find('#pair-host').text()).toBe('servidor.exemplo.com')
    expect(wrapper.text()).toContain('Casa')
    expect(wrapper.text()).not.toContain('SEM CRIPTOGRAFIA')

    await wrapper.find('#pair-accept').trigger('click')
    await wrapper.find('#pair-discard').trigger('click')

    expect(pairing.confirm).toHaveBeenCalledTimes(1)
    expect(pairing.discard).toHaveBeenCalledTimes(1)
  })

  it('avisa quando a lista não usa criptografia', async () => {
    await mountPanel({ state: 'received', received: { ...RECEIVED, insecure: true } })

    expect(wrapper.text()).toContain('SEM CRIPTOGRAFIA')
  })

  it('sem apelido não mostra a linha do apelido', async () => {
    await mountPanel({ state: 'received', received: { ...RECEIVED, label: '' } })

    expect(wrapper.text()).not.toContain('Apelido')
  })

  it('conectando: mostra o servidor e um botão ocupado que não faz nada', async () => {
    const pairing = await mountPanel({ state: 'connecting', received: RECEIVED })

    expect(wrapper.text()).toContain('servidor.exemplo.com')
    expect(wrapper.find('#pair-accept').exists()).toBe(false)
    expect(wrapper.find('#pair-busy').attributes('aria-busy')).toBe('true')
    await wrapper.find('#pair-busy').trigger('click')
    expect(pairing.confirm).not.toHaveBeenCalled()
  })

  it('avisa o pai quando entrou na lista (uma vez só)', async () => {
    const pairing = await mountPanel({ state: 'connecting', received: RECEIVED })

    pairing.state.value = 'done'
    await flushPromises()

    expect(wrapper.emitted('done')).toHaveLength(1)
  })
})

describe('PairPanel — expirou e erros', () => {
  it('código expirado: explica e oferece gerar outro', async () => {
    const pairing = await mountPanel({ state: 'expired', secondsLeft: 0 })

    expect(wrapper.text()).toContain('O código expirou')
    expect(wrapper.find('#pair-qr').exists()).toBe(false)
    await wrapper.find('#pair-refresh').trigger('click')
    expect(pairing.start).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['unavailable', 'Não consegui gerar o código', 'Tentar de novo'],
    ['badData', 'Não deu para ler o envio', 'Enviar de novo'],
    ['login', 'Não deu para abrir a lista', 'Enviar de novo'],
  ])('erro "%s": título "%s", botão "%s" que pede outro código', async (errorKind, titulo, botao) => {
    const pairing = await mountPanel({ state: 'error', errorKind, error: 'Mensagem do erro.' })

    expect(wrapper.text()).toContain(titulo)
    expect(wrapper.find('[role="alert"]').text()).toContain('Mensagem do erro.')
    expect(wrapper.find('#pair-retry').text()).toBe(botao)
    await wrapper.find('#pair-retry').trigger('click')
    expect(pairing.start).toHaveBeenCalledTimes(2)
  })

  it('erro do login mostra também a causa técnica', async () => {
    await mountPanel({ state: 'error', errorKind: 'login', error: 'Usuário ou senha incorretos.', errorDetail: '[AUTH_INVALID_CREDENTIALS] Host: http://srv.com' })

    expect(wrapper.text()).toContain('Causa técnica: [AUTH_INVALID_CREDENTIALS] Host: http://srv.com')
  })

  it('no erro, "Digitar manualmente" também está disponível quando o pai pede', async () => {
    await mountPanel({ state: 'error', errorKind: 'unavailable', error: 'x' }, { showManual: true })

    expect(wrapper.find('#pair-manual').exists()).toBe(true)
  })
})

describe('PairPanel — controle remoto', () => {
  const FOCUS = [
    ['waiting', {}, 'pair-refresh'],
    ['starting', { code: '', pageUrl: '', displayUrl: '' }, 'pair-refresh'],
    ['received', { received: RECEIVED }, 'pair-accept'],
    ['connecting', { received: RECEIVED }, 'pair-busy'],
    ['expired', {}, 'pair-refresh'],
    ['error', { errorKind: 'login', error: 'x' }, 'pair-retry'],
  ]

  it.each(FOCUS)('no estado "%s" o foco está no botão principal (%s)', async (state, extra, id) => {
    await mountPanel({ state, ...extra })

    expect(document.activeElement.id).toBe(id)
  })

  it('o foco acompanha a troca de estado, sem ficar perdido quando o botão some', async () => {
    const pairing = await mountPanel()
    expect(document.activeElement.id).toBe('pair-refresh')

    pairing.received.value = RECEIVED
    pairing.state.value = 'received'
    await flushPromises()
    expect(document.activeElement.id).toBe('pair-accept')

    pairing.state.value = 'connecting'
    await flushPromises()
    expect(document.activeElement.id).toBe('pair-busy')
  })

  it('não rouba o foco de quem já foi digitar em outro campo da tela', async () => {
    const pairing = await mountPanel({ state: 'starting', code: '', pageUrl: '', displayUrl: '' })
    const outside = document.createElement('input')
    outside.id = 'outside'
    document.body.appendChild(outside)
    outside.focus()

    pairing.state.value = 'waiting'
    await flushPromises()

    expect(document.activeElement.id).toBe('outside')
  })

  it('todo botão tem id único e o painel é um grupo de foco', async () => {
    await mountPanel({ state: 'error', errorKind: 'login', error: 'x' }, { showManual: true })

    const ids = Array.from(wrapper.element.querySelectorAll('[id]')).map((el) => el.id)

    expect(new Set(ids).size).toBe(ids.length)
    expect(wrapper.findAll('button').every((b) => b.attributes('id'))).toBe(true)
    expect(wrapper.attributes('data-focus-group')).toBe('pair-panel')
  })

  it('nenhum texto abaixo do mínimo de TV', async () => {
    const { readFileSync } = await import('node:fs')

    expect(readFileSync('src/components/PairPanel.vue', 'utf8')).not.toMatch(/text-\[0\.\d+rem\]/)
  })
})
