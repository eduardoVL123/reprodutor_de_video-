import { describe, it, expect, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

async function mountHome(states) {
  vi.doMock('@/services/platform', () => ({
    exitApp: vi.fn(),
    onAppBackground: vi.fn(() => vi.fn()),
    onAppForeground: vi.fn(() => vi.fn()),
    onPictureInPictureChange: vi.fn(() => vi.fn()),
    setPictureInPictureEnabled: vi.fn(async () => {}),
  }))
  const { createPinia, setActivePinia } = await import('pinia')
  const { routerKey } = await import('vue-router')
  const pinia = createPinia()
  setActivePinia(pinia)
  const { useCatalogStore } = await import('@/stores/catalogStore')
  const catalog = useCatalogStore()
  const refreshSection = vi.spyOn(catalog, 'refreshSection').mockResolvedValue()
  Object.keys(states).forEach((s) => Object.assign(catalog.status[s], states[s]))
  const { default: Dashboard } = await import('@/views/Dashboard.vue')
  const wrapper = mount(Dashboard, {
    global: { plugins: [pinia], provide: { [routerKey]: { replace: vi.fn() } } },
    attachTo: document.body,
  })
  await flushPromises()
  return { wrapper, refreshSection }
}

const ERROR = { state: 'error', error: 'Falha de conexão com o servidor.' }

describe('Dashboard — início com a lista que não carregou', () => {
  it('mostra o aviso e o botão Tentar novamente (antes ficava vazio, sem explicação)', async () => {
    const { wrapper } = await mountHome({ vod: ERROR, series: ERROR, live: ERROR })

    expect(wrapper.find('#home-retry').exists()).toBe(true)
    expect(wrapper.text()).toContain('Não foi possível carregar sua lista')
    expect(wrapper.text()).toContain('Falha de conexão com o servidor.')
    wrapper.unmount()
  })

  it('Tentar novamente recarrega só as seções que falharam', async () => {
    const { wrapper, refreshSection } = await mountHome({
      vod: ERROR,
      series: { state: 'ready' },
      live: ERROR,
    })

    await wrapper.find('#home-retry').trigger('click')

    expect(refreshSection.mock.calls.map(([s]) => s).sort()).toEqual(['live', 'vod'])
    wrapper.unmount()
  })

  it('sem falhas, não mostra o aviso', async () => {
    const { wrapper } = await mountHome({
      vod: { state: 'ready' },
      series: { state: 'ready' },
      live: { state: 'ready' },
    })

    expect(wrapper.find('#home-retry').exists()).toBe(false)
    wrapper.unmount()
  })
})
