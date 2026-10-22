import { describe, it, expect, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

/** Campo de senha visível (pedido do produto): texto puro, sem correção/maiúscula automática do teclado. */
function expectVisiblePassword(input) {
  expect(input.attributes('type')).toBe('text')
  expect(input.attributes('autocapitalize')).toBe('off')
  expect(input.attributes('autocorrect')).toBe('off')
  expect(input.attributes('spellcheck')).toBe('false')
  expect(input.attributes('autocomplete')).toBe('off')
}

async function setupPinia() {
  vi.doMock('@/services/platform', () => ({ exitApp: vi.fn() }))
  const { createPinia, setActivePinia } = await import('pinia')
  const pinia = createPinia()
  setActivePinia(pinia)
  return pinia
}

describe('campos de senha visíveis', () => {
  it('Login mostra a senha digitada', async () => {
    const pinia = await setupPinia()
    const { routerKey } = await import('vue-router')
    const { default: Login } = await import('@/views/Login.vue')

    const wrapper = mount(Login, { global: { plugins: [pinia], provide: { [routerKey]: { replace: vi.fn() } } } })

    expectVisiblePassword(wrapper.find('#login-password'))
    wrapper.unmount()
  })

  it('Gerenciador de Listas mostra a senha digitada', async () => {
    const pinia = await setupPinia()
    const { default: ListManagerModal } = await import('@/components/ListManagerModal.vue')
    const wrapper = mount(ListManagerModal, { global: { plugins: [pinia] }, attachTo: document.body })
    wrapper.vm.open()
    await flushPromises()

    expectVisiblePassword(wrapper.find('#new-list-pass'))
    wrapper.unmount()
  })
})
