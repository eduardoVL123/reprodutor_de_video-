import { describe, it, expect, vi, afterEach } from 'vitest'
import { ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { duplicateIds } from '@/utils/devTools'

/** Login com "adicionar pelo celular" (RFC-016, layout A: celular à esquerda, formulário atual à direita). */

let wrapper
afterEach(() => {
  if (wrapper) wrapper.unmount()
  wrapper = null
  vi.unstubAllEnvs()
  vi.doUnmock('@/utils/compat') // o teste de celular não pode vazar para os seguintes
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

function fakePairing() {
  const names = ['code', 'pageUrl', 'displayUrl', 'error', 'errorDetail', 'errorKind']
  const pairing = Object.fromEntries(names.map((n) => [n, ref('')]))
  return Object.assign(pairing, {
    state: ref('waiting'),
    secondsLeft: ref(500),
    received: ref(null),
    start: vi.fn(async () => {}),
    confirm: vi.fn(async () => true),
    discard: vi.fn(async () => {}),
    stop: vi.fn(),
  })
}

async function setup({ pairing = true } = {}) {
  vi.stubEnv('VITE_PAIR_BASE_URL', pairing ? 'https://pulse.test' : '')
  const pairingState = fakePairing()
  pairingState.code.value = 'K7M2QP'
  pairingState.pageUrl.value = 'https://pulse.test/K7M2QP'
  pairingState.displayUrl.value = 'pulse.test/K7M2QP'
  vi.doMock('@/composables/usePairing', () => ({ usePairing: () => pairingState }))
  vi.doMock('@/services/platform', () => ({ exitApp: vi.fn() }))
  const { createPinia, setActivePinia } = await import('pinia')
  const pinia = createPinia()
  setActivePinia(pinia)
  const { useAuthStore } = await import('@/stores/authStore')
  const auth = useAuthStore()
  auth.login = vi.fn(async () => true)
  const { routerKey } = await import('vue-router')
  const replace = vi.fn()
  const { default: Login } = await import('@/views/Login.vue')
  wrapper = mount(Login, { global: { plugins: [pinia], provide: { [routerKey]: { replace } } }, attachTo: document.body })
  await flushPromises()
  return { auth, replace, pairingState }
}

describe('Login sem o serviço de pareamento configurado', () => {
  it('fica exatamente como era: sem painel, uma coluna e o foco no campo do endereço', async () => {
    await setup({ pairing: false })

    expect(wrapper.find('[data-focus-group="pair-panel"]').exists()).toBe(false)
    expect(wrapper.find('h1').text()).toBe('Conectar ao servidor')
    expect(document.activeElement.id).toBe('login-dns')
  })

  it('sem WebCrypto no aparelho também não oferece o pareamento', async () => {
    vi.stubGlobal('crypto', {})
    await setup()

    expect(wrapper.find('[data-focus-group="pair-panel"]').exists()).toBe(false)
  })
})

describe('Login com pareamento (layout A)', () => {
  it('no celular o formulário vem primeiro e o pareamento fica embaixo, como opção extra', async () => {
    vi.doMock('@/utils/compat', () => ({ isPhone: () => true }))
    const { pairingState } = await setup()

    const panel = wrapper.find('[data-focus-group="pair-panel"]')
    expect(panel.exists()).toBe(true)
    expect(wrapper.find('form').element.compareDocumentPosition(panel.element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(wrapper.find('h1').text()).toBe('Conectar ao servidor')
    expect(pairingState.start).toHaveBeenCalledTimes(1)
    expect(document.activeElement.id).toBe('login-dns')
  })

  it('mostra o painel do celular e o formulário manual lado a lado', async () => {
    const { pairingState } = await setup()

    expect(wrapper.find('[data-focus-group="pair-panel"]').exists()).toBe(true)
    expect(pairingState.start).toHaveBeenCalledTimes(1)
    for (const id of ['login-dns', 'login-username', 'login-password', 'login-submit']) {
      expect(wrapper.find(`#${id}`).exists()).toBe(true)
    }
    expect(wrapper.text()).toContain('Ou digite aqui')
  })

  it('tem um único título de página e nenhum id repetido', async () => {
    await setup()

    expect(wrapper.findAll('h1')).toHaveLength(1)
    expect(duplicateIds()).toEqual([])
  })

  it('o foco inicial fica no botão do pareamento, não no campo de texto', async () => {
    await setup()

    expect(document.activeElement.id).toBe('pair-refresh')
  })

  it('quando o celular termina de adicionar a lista, vai para o início', async () => {
    const { replace, pairingState } = await setup()

    pairingState.state.value = 'done'
    await flushPromises()

    expect(replace).toHaveBeenCalledWith({ name: 'dashboard' })
  })

  it('o formulário manual continua funcionando', async () => {
    const { auth, replace } = await setup()

    await wrapper.find('#login-dns').setValue('meuservidor.com')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(auth.login).toHaveBeenCalledWith({ dns: 'meuservidor.com', username: '', password: '' })
    expect(replace).toHaveBeenCalledWith({ name: 'dashboard' })
  })

  it('o erro do login manual continua aparecendo no formulário', async () => {
    const { auth } = await setup()
    auth.login = vi.fn(async () => {
      auth.error = 'Usuário ou senha incorretos.'
      return false
    })

    await wrapper.find('#login-dns').setValue('meuservidor.com')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(wrapper.find('#login-error').text()).toContain('Usuário ou senha incorretos.')
  })
})
