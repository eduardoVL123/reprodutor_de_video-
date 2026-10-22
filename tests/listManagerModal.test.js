import { describe, it, expect, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

const SERVER = 'http://srv.test:8080'

async function setup({ loginFails = false } = {}) {
  const authenticate = vi.fn(async () => {
    if (loginFails) {
      const { XtreamError } = await vi.importActual('@/services/xtreamApi')
      throw new XtreamError('AUTH_INVALID_CREDENTIALS', 'recusado')
    }
    return { baseUrl: SERVER, resolvedUrl: null, userInfo: { auth: 1, status: 'Active' }, serverInfo: {} }
  })
  const resolveShortInput = vi.fn(async ({ username, password }) => ({
    mode: 'xtream',
    resolvedUrl: SERVER,
    baseUrl: SERVER,
    username,
    password,
  }))
  vi.doMock('@/services/xtreamApi', async (importOriginal) => ({
    ...(await importOriginal()),
    authenticate,
    resolveShortInput,
  }))
  vi.doMock('@/services/platform', () => ({ exitApp: vi.fn() }))

  const { createPinia, setActivePinia } = await import('pinia')
  const pinia = createPinia()
  setActivePinia(pinia)
  const nav = await import('@/utils/spatialNavigation')
  nav.initSpatialNavigation()
  const { default: ListManagerModal } = await import('@/components/ListManagerModal.vue')
  const { useAuthStore } = await import('@/stores/authStore')
  const wrapper = mount(ListManagerModal, { global: { plugins: [pinia] }, attachTo: document.body })
  return { wrapper, auth: useAuthStore(), authenticate }
}

const pressBack = () =>
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true, cancelable: true }))

describe('ListManagerModal', () => {
  it('fica fechado até o pai chamar open()', async () => {
    const { wrapper } = await setup()

    expect(wrapper.find('#modal-lists').exists()).toBe(false)
    wrapper.vm.open()
    await flushPromises()
    expect(wrapper.find('#modal-lists').exists()).toBe(true)
    wrapper.unmount()
  })

  it('exige o endereço antes de tentar conectar', async () => {
    const { wrapper, authenticate } = await setup()
    wrapper.vm.open()
    await flushPromises()

    await wrapper.find('form').trigger('submit')

    expect(wrapper.text()).toContain('Informe o endereço')
    expect(authenticate).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('adicionar uma lista conecta, fecha o modal e avisa o pai', async () => {
    const { wrapper, auth } = await setup()
    wrapper.vm.open()
    await flushPromises()

    await wrapper.find('#new-list-dns').setValue(SERVER)
    await wrapper.find('#new-list-user').setValue('user1')
    await wrapper.find('#new-list-pass').setValue('senha-secreta')
    await wrapper.find('form').trigger('submit')

    await vi.waitFor(() => expect(wrapper.emitted('changed')).toHaveLength(1))
    expect(auth.savedLists).toHaveLength(1)
    await flushPromises()
    expect(wrapper.find('#modal-lists').exists()).toBe(false)
    wrapper.unmount()
  })

  it('mostra o erro do servidor e continua aberto quando o login falha', async () => {
    const { wrapper } = await setup({ loginFails: true })
    wrapper.vm.open()
    await flushPromises()

    await wrapper.find('#new-list-dns').setValue(SERVER)
    await wrapper.find('#new-list-user').setValue('user1')
    await wrapper.find('#new-list-pass').setValue('errada')
    await wrapper.find('form').trigger('submit')

    await vi.waitFor(() => expect(wrapper.find('[role="alert"]').exists()).toBe(true))
    expect(wrapper.find('[role="alert"]').text()).toContain('Usuário ou senha incorretos')
    expect(wrapper.emitted('changed')).toBeUndefined()
    expect(wrapper.find('#modal-lists').exists()).toBe(true)
    wrapper.unmount()
  })

  it('excluir uma lista remove o card', async () => {
    const { wrapper, auth } = await setup()
    await auth.login({ dns: SERVER, username: 'user1', password: 'x' })
    wrapper.vm.open()
    await flushPromises()
    expect(wrapper.findAll('[id^="saved-list-card-"]')).toHaveLength(1)

    await wrapper.find('[id^="btn-remove-"]').trigger('click')
    await flushPromises()

    expect(wrapper.findAll('[id^="saved-list-card-"]')).toHaveLength(0)
    wrapper.unmount()
  })

  it('sair da conta encerra a sessão e avisa o pai', async () => {
    const { wrapper, auth } = await setup()
    await auth.login({ dns: SERVER, username: 'user1', password: 'x' })
    wrapper.vm.open()
    await flushPromises()

    await wrapper.find('#btn-modal-logout').trigger('click')

    await vi.waitFor(() => expect(wrapper.emitted('logged-out')).toHaveLength(1))
    expect(auth.isAuthenticated).toBe(false)
    wrapper.unmount()
  })

  it('a tecla Voltar fecha o modal', async () => {
    const { wrapper } = await setup()
    wrapper.vm.open()
    await flushPromises()

    pressBack()
    await flushPromises()

    expect(wrapper.find('#modal-lists').exists()).toBe(false)
    wrapper.unmount()
  })
})
