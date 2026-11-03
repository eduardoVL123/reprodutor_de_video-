import { describe, it, expect, vi, afterEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { duplicateIds } from '@/utils/devTools'

/** Barra de baixo do celular em pé (RFC-023, opção B). */

afterEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllEnvs()
  vi.doUnmock('@/services/platform')
})

async function mountNav({ activeTab = 'home', code = '', base = '', canExit = true } = {}) {
  vi.stubEnv('VITE_LICENSE_BASE_URL', base)
  const platform = { canExitApp: () => canExit, exitApp: vi.fn(), openExternal: vi.fn() }
  vi.doMock('@/services/platform', () => platform)
  const { createPinia, setActivePinia } = await import('pinia')
  const pinia = createPinia()
  setActivePinia(pinia)
  const nav = await import('@/utils/spatialNavigation')
  nav.initSpatialNavigation()
  const { useLicenseStore } = await import('@/stores/licenseStore')
  useLicenseStore().code = code
  const { default: BottomNav } = await import('@/components/BottomNav.vue')
  const wrapper = mount(BottomNav, {
    props: { activeTab, profile: { name: 'Principal', color: '#B8F000' }, listLabel: 'servidor.test' },
    global: { plugins: [pinia] },
    attachTo: document.body,
  })
  await flushPromises()
  return { wrapper, platform, nav }
}

const ids = () => [...document.querySelectorAll('nav[data-focus-group="bottom-nav"] button')].map((b) => b.id)

describe('BottomNav', () => {
  it('Início · Filmes · Séries · Busca · Mais, com o pulso só na aba ativa', async () => {
    const { wrapper } = await mountNav({ activeTab: 'vod' })
    expect(ids()).toEqual(['bnav-home', 'bnav-vod', 'bnav-series', 'bnav-search', 'bnav-more'])
    expect(wrapper.text()).toMatch(/Início.*Filmes.*Séries.*Busca.*Mais/)
    expect(document.querySelectorAll('.bnav-pulse')).toHaveLength(1)
    expect(document.getElementById('bnav-vod').querySelector('.bnav-pulse')).not.toBeNull()
    expect(document.getElementById('bnav-vod').getAttribute('aria-current')).toBe('page')
    await wrapper.find('#bnav-series').trigger('click')
    expect(wrapper.emitted('navigate')).toEqual([['series']])
    wrapper.unmount()
  })

  it('Mais abre a folha: Canais ao vivo e Minha lista navegam, Listas e Perfil avisam o pai, e a folha fecha', async () => {
    const { wrapper } = await mountNav()
    await wrapper.find('#bnav-more').trigger('click')
    expect(document.getElementById('more-sheet')).not.toBeNull()
    expect(document.activeElement.id).not.toBe('more-live') // toque: sem contorno de foco da TV
    expect(duplicateIds(document)).toEqual([])

    await wrapper.find('#more-live').trigger('click')
    expect(wrapper.emitted('navigate')).toEqual([['live']])
    expect(document.getElementById('more-sheet')).toBeNull()

    for (const [id, event] of [['#more-favorites', 'navigate'], ['#more-lists', 'manage-lists'], ['#more-profile', 'switch-profile']]) {
      await wrapper.find('#bnav-more').trigger('click')
      await wrapper.find(id).trigger('click')
      expect(wrapper.emitted(event)).toBeTruthy()
    }
    wrapper.unmount()
  })

  it('com Canais ao vivo ou Minha lista abertos, o Mais fica marcado', async () => {
    const { wrapper } = await mountNav({ activeTab: 'live' })
    expect(document.getElementById('bnav-more').querySelector('.bnav-pulse')).not.toBeNull()
    wrapper.unmount()
  })

  it('Voltar fecha a folha antes de qualquer outra coisa', async () => {
    const { wrapper } = await mountNav()
    await wrapper.find('#bnav-more').trigger('click')
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }))
    await flushPromises()
    expect(document.getElementById('more-sheet')).toBeNull()
    wrapper.unmount()
  })

  it('"Enviar lista pelo site" abre o site com o código do aparelho; some sem serviço ou sem código', async () => {
    let { wrapper, platform } = await mountNav({ base: 'https://licenca.test', code: 'QDU5NXY7' })
    await wrapper.find('#bnav-more').trigger('click')
    await wrapper.find('#more-site').trigger('click')
    expect(platform.openExternal).toHaveBeenCalledWith('https://licenca.test/?codigo=QDU5NXY7')
    wrapper.unmount()

    vi.resetModules()
    ;({ wrapper } = await mountNav({ base: '', code: 'QDU5NXY7' }))
    await wrapper.find('#bnav-more').trigger('click')
    expect(wrapper.find('#more-site').exists()).toBe(false)
    wrapper.unmount()
  })

  it('Sair do app só onde o app consegue se fechar', async () => {
    let { wrapper, platform } = await mountNav()
    await wrapper.find('#bnav-more').trigger('click')
    await wrapper.find('#more-exit').trigger('click')
    expect(platform.exitApp).toHaveBeenCalled()
    wrapper.unmount()

    vi.resetModules()
    ;({ wrapper } = await mountNav({ canExit: false }))
    await wrapper.find('#bnav-more').trigger('click')
    expect(wrapper.find('#more-exit').exists()).toBe(false)
    wrapper.unmount()
  })
})

describe('Dashboard: barra de baixo só em pé', () => {
  async function mountDashboard({ phone, portrait }) {
    for (const level of ['log', 'info', 'warn', 'error']) vi.spyOn(console, level).mockImplementation(() => {})
    window.matchMedia = () => ({ matches: portrait, addEventListener: () => {}, removeEventListener: () => {} })
    vi.doMock('@/utils/compat', async (importOriginal) => ({ ...(await importOriginal()), isPhone: () => phone }))
    vi.doMock('@/services/platform', () => ({
      canExitApp: () => false,
      exitApp: vi.fn(),
      openExternal: vi.fn(),
      onAppBackground: vi.fn(() => vi.fn()),
      onAppForeground: vi.fn(() => vi.fn()),
      onPictureInPictureChange: vi.fn(() => vi.fn()),
      setPictureInPictureEnabled: vi.fn(async () => {}),
      setPlayerOrientation: vi.fn(async () => {}),
    }))
    const { createPinia, setActivePinia } = await import('pinia')
    const { routerKey } = await import('vue-router')
    const pinia = createPinia()
    setActivePinia(pinia)
    const { default: Dashboard } = await import('@/views/Dashboard.vue')
    const wrapper = mount(Dashboard, { global: { plugins: [pinia], provide: { [routerKey]: { replace: vi.fn() } } }, attachTo: document.body })
    await flushPromises()
    return wrapper
  }

  afterEach(() => {
    vi.doUnmock('@/utils/compat')
    vi.restoreAllMocks()
  })

  it.each([
    ['celular em pé', true, true, true],
    ['celular deitado', true, false, false],
    ['TV (mesmo com tela em pé)', false, true, false],
  ])('%s: barra de baixo = %s', async (_name, phone, portrait, bottom) => {
    const wrapper = await mountDashboard({ phone, portrait })
    expect(wrapper.find('[data-focus-group="bottom-nav"]').exists()).toBe(bottom)
    expect(wrapper.find('[data-focus-group="side-menu"]').exists()).toBe(!bottom)
    wrapper.unmount()
  })
})
