import { describe, it, expect, vi, afterEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

/** Código do aparelho no Gerenciador de Listas (RFC-018 §3): o usuário passa esse código para pagar ou no suporte. */

let wrapper
afterEach(() => {
  if (wrapper) wrapper.unmount()
  wrapper = null
  document.body.innerHTML = ''
  vi.resetModules()
})

async function setup(code) {
  vi.doMock('@/services/platform', () => ({ exitApp: vi.fn() }))
  const { createPinia, setActivePinia } = await import('pinia')
  const pinia = createPinia()
  setActivePinia(pinia)
  const { useLicenseStore } = await import('@/stores/licenseStore')
  useLicenseStore().code = code
  const { default: ListManagerModal } = await import('@/components/ListManagerModal.vue')
  wrapper = mount(ListManagerModal, { global: { plugins: [pinia] }, attachTo: document.body })
  wrapper.vm.open()
  await flushPromises()
}

describe('Gerenciador de Listas — código do aparelho', () => {
  it('mostra o código quando o serviço de licença já respondeu', async () => {
    await setup('QDU5NXY7')
    expect(wrapper.find('#device-code').text()).toContain('QDU5NXY7')
  })

  it('sem código (licença desligada ou ainda sem resposta) não mostra nada', async () => {
    await setup('')
    expect(wrapper.find('#device-code').exists()).toBe(false)
  })
})
