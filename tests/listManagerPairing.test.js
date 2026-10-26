import { describe, it, expect, vi, afterEach } from 'vitest'
import { ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { duplicateIds } from '@/utils/devTools'

/** Gerenciador de Listas com "enviar pelo celular" (RFC-016): o painel troca o formulário na coluna da direita. */

let wrapper
afterEach(() => {
  if (wrapper) wrapper.unmount()
  wrapper = null
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

function fakePairing() {
  const names = ['code', 'pageUrl', 'displayUrl', 'error', 'errorDetail', 'errorKind']
  const pairing = Object.fromEntries(names.map((n) => [n, ref('')]))
  Object.assign(pairing, {
    state: ref('waiting'),
    secondsLeft: ref(500),
    received: ref(null),
    start: vi.fn(async () => {}),
    confirm: vi.fn(async () => true),
    discard: vi.fn(async () => {}),
    stop: vi.fn(),
  })
  pairing.code.value = 'K7M2QP'
  pairing.pageUrl.value = 'https://pulse.test/K7M2QP'
  pairing.displayUrl.value = 'pulse.test/K7M2QP'
  return pairing
}

async function setup({ pairing = true } = {}) {
  vi.stubEnv('VITE_PAIR_BASE_URL', pairing ? 'https://pulse.test' : '')
  const pairingState = fakePairing()
  vi.doMock('@/composables/usePairing', () => ({ usePairing: () => pairingState }))
  vi.doMock('@/services/platform', () => ({ exitApp: vi.fn() }))
  const { createPinia, setActivePinia } = await import('pinia')
  const pinia = createPinia()
  setActivePinia(pinia)
  const nav = await import('@/utils/spatialNavigation')
  nav.initSpatialNavigation()
  const { default: ListManagerModal } = await import('@/components/ListManagerModal.vue')
  wrapper = mount(ListManagerModal, { global: { plugins: [pinia] }, attachTo: document.body })
  wrapper.vm.open()
  await flushPromises()
  return { pairingState }
}

const pressBack = () =>
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true, cancelable: true }))
const hasPanel = () => wrapper.find('[data-focus-group="pair-panel"]').exists()

describe('Gerenciador de Listas sem o serviço de pareamento', () => {
  it('não mostra o botão do celular e o formulário continua igual', async () => {
    await setup({ pairing: false })

    expect(wrapper.find('#btn-pair-phone').exists()).toBe(false)
    expect(wrapper.find('#new-list-dns').exists()).toBe(true)
  })
})

describe('Gerenciador de Listas com pareamento', () => {
  it('oferece "Enviar pelo celular" acima do formulário, que continua disponível', async () => {
    await setup()

    expect(wrapper.find('#btn-pair-phone').text()).toBe('Enviar pelo celular')
    expect(wrapper.find('#new-list-dns').exists()).toBe(true)
    expect(hasPanel()).toBe(false)
  })

  it('o botão troca o formulário pelo painel do celular, com o foco nele', async () => {
    const { pairingState } = await setup()

    await wrapper.find('#btn-pair-phone').trigger('click')
    await flushPromises()

    expect(hasPanel()).toBe(true)
    expect(wrapper.find('#new-list-dns').exists()).toBe(false)
    expect(pairingState.start).toHaveBeenCalledTimes(1)
    expect(document.activeElement.id).toBe('pair-refresh')
  })

  it('"Digitar manualmente" volta ao formulário e devolve o foco ao botão do celular', async () => {
    await setup()
    await wrapper.find('#btn-pair-phone').trigger('click')
    await flushPromises()

    await wrapper.find('#pair-manual').trigger('click')
    await flushPromises()

    expect(hasPanel()).toBe(false)
    expect(wrapper.find('#new-list-dns').exists()).toBe(true)
    expect(document.activeElement.id).toBe('btn-pair-phone')
  })

  it('Voltar com o painel aberto volta ao formulário; só o segundo Voltar fecha o modal', async () => {
    await setup()
    await wrapper.find('#btn-pair-phone').trigger('click')
    await flushPromises()

    pressBack()
    await flushPromises()
    expect(hasPanel()).toBe(false)
    expect(wrapper.find('#modal-lists').exists()).toBe(true)

    pressBack()
    await flushPromises()
    expect(wrapper.find('#modal-lists').exists()).toBe(false)
  })

  it('quando a lista chega e entra, fecha o modal e avisa o pai', async () => {
    const { pairingState } = await setup()
    await wrapper.find('#btn-pair-phone').trigger('click')
    await flushPromises()

    pairingState.state.value = 'done'
    await flushPromises()

    expect(wrapper.emitted('changed')).toHaveLength(1)
    expect(wrapper.find('#modal-lists').exists()).toBe(false)
  })

  it('reabrir o gerenciador sempre começa no formulário', async () => {
    await setup()
    await wrapper.find('#btn-pair-phone').trigger('click')
    await flushPromises()
    wrapper.vm.close()
    await flushPromises()

    wrapper.vm.open()
    await flushPromises()

    expect(hasPanel()).toBe(false)
    expect(wrapper.find('#new-list-dns').exists()).toBe(true)
  })

  it('nenhum id repetido com o painel aberto', async () => {
    await setup()
    await wrapper.find('#btn-pair-phone').trigger('click')
    await flushPromises()

    expect(duplicateIds()).toEqual([])
  })
})
