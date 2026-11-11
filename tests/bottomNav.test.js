import { describe, it, expect, vi, afterEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { duplicateIds } from '@/utils/devTools'

/** Barra de baixo do celular/tablet e a aba Conta (substituta da folha "Mais"). */

afterEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllEnvs()
  vi.doUnmock('@/services/platform')
})

async function mountNav({ activeTab = 'home' } = {}) {
  const { default: BottomNav } = await import('@/components/BottomNav.vue')
  const wrapper = mount(BottomNav, { props: { activeTab }, attachTo: document.body })
  await flushPromises()
  return wrapper
}

const ids = () => [...document.querySelectorAll('nav[data-focus-group="bottom-nav"] button')].map((b) => b.id)

describe('BottomNav', () => {
  it('Início · Filmes · Séries · TV · Conta, com o pulso só na aba ativa', async () => {
    const wrapper = await mountNav({ activeTab: 'vod' })
    expect(ids()).toEqual(['bnav-home', 'bnav-vod', 'bnav-series', 'bnav-live', 'bnav-account'])
    expect(wrapper.text()).toMatch(/Início.*Filmes.*Séries.*TV.*Conta/)
    expect(document.querySelectorAll('.bnav-pulse')).toHaveLength(1)
    expect(document.getElementById('bnav-vod').getAttribute('aria-current')).toBe('page')
    await wrapper.find('#bnav-live').trigger('click')
    expect(wrapper.emitted('navigate')).toEqual([['live']])
    wrapper.unmount()
  })

  it('com Minha lista aberta (vem da Conta), a Conta fica marcada', async () => {
    const wrapper = await mountNav({ activeTab: 'favorites' })
    expect(document.getElementById('bnav-account').querySelector('.bnav-pulse')).not.toBeNull()
    wrapper.unmount()
  })
})

describe('AccountScreen', () => {
  async function mountAccount({ code = '', base = '', storeBuild = '', canExit = true, access = '', activationEndsAt = null, phone = true } = {}) {
    vi.stubEnv('VITE_LICENSE_BASE_URL', base)
    vi.stubEnv('VITE_LICENSE_STORE_BUILD', storeBuild)
    vi.doMock('@/utils/compat', async (importOriginal) => ({ ...(await importOriginal()), isPhone: () => phone }))
    const platform = { canExitApp: () => canExit, exitApp: vi.fn(), openExternal: vi.fn() }
    vi.doMock('@/services/platform', () => platform)
    const { createPinia, setActivePinia } = await import('pinia')
    const pinia = createPinia()
    setActivePinia(pinia)
    const { useLicenseStore } = await import('@/stores/licenseStore')
    Object.assign(useLicenseStore(), { code, access, activationEndsAt })
    const { default: AccountScreen } = await import('@/components/AccountScreen.vue')
    const wrapper = mount(AccountScreen, {
      props: { profile: { name: 'Principal', color: '#B8F000' }, listLabel: 'servidor.test' },
      global: { plugins: [pinia] },
      attachTo: document.body,
    })
    await flushPromises()
    return { wrapper, platform }
  }

  afterEach(() => vi.resetModules())

  it('Minha lista, Minhas listas e Trocar perfil avisam o pai; ids únicos', async () => {
    const { wrapper } = await mountAccount()
    expect(duplicateIds(document)).toEqual([])
    await wrapper.find('#acc-favorites').trigger('click')
    await wrapper.find('#acc-lists').trigger('click')
    await wrapper.find('#acc-profile').trigger('click')
    expect(wrapper.emitted('navigate')).toEqual([['favorites']])
    expect(wrapper.emitted('manage-lists')).toBeTruthy()
    expect(wrapper.emitted('switch-profile')).toBeTruthy()
    expect(wrapper.text()).toContain('servidor.test')
    wrapper.unmount()
  })

  it('mostra até quando está ativado, o código e o link de renovar', async () => {
    const end = new Date(2027, 0, 15).getTime()
    const { wrapper, platform } = await mountAccount({ base: 'https://licenca.test', code: 'QDU5NXY7', access: 'activated', activationEndsAt: end })
    expect(wrapper.text()).toContain('Ativado')
    expect(wrapper.text()).toContain('15/01/2027')
    expect(wrapper.find('#acc-code').text()).toBe('QDU5NXY7')
    await wrapper.find('#acc-renew').trigger('click')
    expect(platform.openExternal).toHaveBeenCalledWith('https://licenca.test/a/QDU5NXY7')
    await wrapper.find('#acc-site').trigger('click')
    expect(platform.openExternal).toHaveBeenCalledWith('https://licenca.test/enviar?codigo=QDU5NXY7')
    await wrapper.find('#acc-privacy').trigger('click') // a Play exige a política acessível dentro do app
    expect(platform.openExternal).toHaveBeenCalledWith('https://licenca.test/privacidade')
    wrapper.unmount()
  })

  it('versão das lojas: sem link de renovar; sem serviço: sem assinatura nem site', async () => {
    let { wrapper } = await mountAccount({ base: 'https://licenca.test', code: 'QDU5NXY7', storeBuild: '1', access: 'trial' })
    expect(wrapper.find('#acc-renew').exists()).toBe(false)
    expect(wrapper.text()).toContain('Teste grátis')
    wrapper.unmount()

    vi.resetModules()
    ;({ wrapper } = await mountAccount({ base: '', code: 'QDU5NXY7' }))
    expect(wrapper.text()).not.toContain('Assinatura')
    expect(wrapper.find('#acc-site').exists()).toBe(false)
    wrapper.unmount()
  })

  it('na TV mostra assinatura, código e as mesmas ações, sem os links que abririam um navegador', async () => {
    const { wrapper } = await mountAccount({ base: 'https://licenca.test', code: 'QDU5NXY7', access: 'trial', phone: false })
    expect(wrapper.text()).toContain('Teste grátis')
    expect(wrapper.find('#acc-code').text()).toBe('QDU5NXY7')
    for (const id of ['acc-profile', 'acc-favorites', 'acc-lists', 'acc-diagnostics', 'acc-exit']) expect(wrapper.find(`#${id}`).exists()).toBe(true)
    for (const id of ['acc-renew', 'acc-site', 'acc-privacy']) expect(wrapper.find(`#${id}`).exists()).toBe(false)
    wrapper.unmount()
  })

  it('Sair do app só onde o app consegue se fechar', async () => {
    let { wrapper, platform } = await mountAccount()
    await wrapper.find('#acc-exit').trigger('click')
    expect(platform.exitApp).toHaveBeenCalled()
    wrapper.unmount()

    vi.resetModules()
    ;({ wrapper } = await mountAccount({ canExit: false }))
    expect(wrapper.find('#acc-exit').exists()).toBe(false)
    wrapper.unmount()
  })
})

describe('Dashboard: barra de baixo no celular/tablet', () => {
  async function mountDashboard({ phone, portrait }) {
    for (const level of ['log', 'info', 'warn', 'error']) vi.spyOn(console, level).mockImplementation(() => {})
    window.matchMedia = () => ({ matches: portrait, addEventListener: () => {}, removeEventListener: () => {} })
    Element.prototype.scrollIntoView ||= () => {} // jsdom não tem; a Busca rola o campo para a vista
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
    ['celular deitado', true, false, true],
    ['TV (mesmo com tela em pé)', false, true, false],
  ])('%s: barra de baixo e busca no topo = %s', async (_name, phone, portrait, handheld) => {
    const wrapper = await mountDashboard({ phone, portrait })
    expect(wrapper.find('[data-focus-group="bottom-nav"]').exists()).toBe(handheld)
    expect(wrapper.find('[data-focus-group="side-menu"]').exists()).toBe(!handheld)
    expect(wrapper.find('#phone-search').exists()).toBe(handheld)
    if (handheld) {
      await wrapper.find('#phone-search').trigger('click')
      expect(wrapper.find('#phone-search').exists()).toBe(false) // na Busca a barra some (a tela tem o próprio campo)
      await wrapper.find('#bnav-vod').trigger('click')
      expect(wrapper.find('#phone-search').exists()).toBe(false) // Filmes/Séries/TV: lupa no cabeçalho, não a barra
      await wrapper.find('#catalog-search').trigger('click')
      expect(wrapper.find('#catalog-search').exists()).toBe(false) // foi para a Busca
      await wrapper.find('#bnav-account').trigger('click')
      expect(wrapper.find('[data-focus-group="account"]').exists()).toBe(true)
      expect(wrapper.findAll('nav').map((n) => n.attributes('data-focus-group'))).toEqual(['bottom-nav']) // sem o menu lateral junto
    }
    wrapper.unmount()
  })
})
