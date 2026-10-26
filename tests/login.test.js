import { describe, it, expect, vi, afterEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

let wrapper
afterEach(() => {
  if (wrapper) wrapper.unmount()
  wrapper = null
  vi.unstubAllEnvs()
  vi.doUnmock('@/utils/compat') // o teste de celular não pode vazar para os seguintes
  document.body.innerHTML = ''
})

async function setup() {
  vi.doMock('@/services/platform', () => ({ exitApp: vi.fn() }))
  const { createPinia, setActivePinia } = await import('pinia')
  const pinia = createPinia()
  setActivePinia(pinia)
  const { useAuthStore } = await import('@/stores/authStore')
  const auth = useAuthStore()
  auth.login = vi.fn(async () => true)
  const { routerKey } = await import('vue-router')
  const { default: Login } = await import('@/views/Login.vue')
  wrapper = mount(Login, { global: { plugins: [pinia], provide: { [routerKey]: { replace: vi.fn() } } }, attachTo: document.body })
  return { auth }
}

describe('applySnippet — atalhos de digitação do link', () => {
  it('acrescenta no fim e põe o protocolo no começo sem duplicar', async () => {
    const { applySnippet } = await import('@/utils/urlSnippets')

    expect(applySnippet('meuservidor', '.com')).toBe('meuservidor.com')
    expect(applySnippet('meuservidor.com', ':8080')).toBe('meuservidor.com:8080')
    expect(applySnippet('meuservidor.com', 'http://')).toBe('http://meuservidor.com')
    expect(applySnippet('https://meuservidor.com', 'http://')).toBe('http://meuservidor.com')
    expect(applySnippet('', 'www.')).toBe('www.')
  })
})

describe('Login — digitar menos', () => {
  it('os atalhos completam o campo do link sem digitar letra por letra', async () => {
    await setup()
    const dns = wrapper.find('#login-dns')
    await dns.setValue('meuservidor')

    const buttons = wrapper.findAll('[id^="login-snippet-"]')
    await buttons.find((b) => b.text() === '.com').trigger('click')
    await buttons.find((b) => b.text() === 'http://').trigger('click')

    expect(dns.element.value).toBe('http://meuservidor.com')
  })

  it('sem lista de demonstração configurada, não mostra o botão', async () => {
    vi.stubEnv('VITE_DEMO_PLAYLIST_URL', '')
    await setup()

    expect(wrapper.find('#login-demo').exists()).toBe(false)
  })

  it('com a lista configurada, um botão entra direto nela (revisores das lojas)', async () => {
    vi.stubEnv('VITE_DEMO_PLAYLIST_URL', 'https://exemplo.test/pulse-demo.m3u')
    const { auth } = await setup()

    await wrapper.find('#login-demo').trigger('click')
    await flushPromises()

    expect(auth.login).toHaveBeenCalledWith({ dns: 'https://exemplo.test/pulse-demo.m3u', username: '', password: '' })
  })
})

describe('Login no celular', () => {
  it('não mostra as dicas de controle remoto da TV (no celular basta tocar no campo)', async () => {
    vi.doMock('@/utils/compat', () => ({ isPhone: () => true }))
    await setup()

    expect(wrapper.text()).not.toContain('pressione OK')
    expect(wrapper.text()).not.toContain('controle remoto da sua TV')
  })

  it('na TV as dicas continuam', async () => {
    vi.doMock('@/utils/compat', () => ({ isPhone: () => false }))
    await setup()

    expect(wrapper.text()).toContain('pressione OK')
    expect(wrapper.text()).toContain('controle remoto da sua TV')
  })
})
