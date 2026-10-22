import { describe, it, expect, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'

const setOnline = (online) => Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online })

afterEach(() => setOnline(true))

describe('NetworkStatus — aviso de conexão perdida', () => {
  it('fica oculto com internet', async () => {
    setOnline(true)
    const { default: NetworkStatus } = await import('@/components/NetworkStatus.vue')

    const wrapper = mount(NetworkStatus)

    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('aparece quando a conexão cai e some quando ela volta', async () => {
    setOnline(true)
    const { default: NetworkStatus } = await import('@/components/NetworkStatus.vue')
    const wrapper = mount(NetworkStatus)

    setOnline(false)
    window.dispatchEvent(new Event('offline'))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[role="alert"]').text()).toContain('Sem conexão com a internet')

    setOnline(true)
    window.dispatchEvent(new Event('online'))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('já abre visível se o aparelho iniciar sem internet', async () => {
    setOnline(false)
    const { default: NetworkStatus } = await import('@/components/NetworkStatus.vue')

    const wrapper = mount(NetworkStatus)

    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
    wrapper.unmount()
  })
})
