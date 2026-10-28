import { describe, it, expect, vi, afterEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { duplicateIds } from '@/utils/devTools'

/** Tela "Ative este aparelho" (RFC-018 R7, Task 6). */

// O Dashboard dispara trabalho assíncrono (perfis, catálogo, licença) que loga depois do fim do teste: espera ele acabar.
afterEach(async () => {
  await flushPromises()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
  vi.unstubAllEnvs()
  vi.resetModules()
})

async function mountScreen({ storeBuild = '', suspended = false } = {}) {
  vi.stubEnv('VITE_LICENSE_BASE_URL', 'https://licenca.test')
  vi.stubEnv('VITE_LICENSE_STORE_BUILD', storeBuild)
  const nav = await import('@/utils/spatialNavigation')
  nav.initSpatialNavigation()
  const { default: ActivationRequired } = await import('@/views/ActivationRequired.vue')
  const wrapper = mount(ActivationRequired, { props: { code: 'QDU5NXY7', suspended }, attachTo: document.body })
  await flushPromises()
  return wrapper
}

describe('tela de ativação', () => {
  it('aparelho suspenso: avisa e manda falar com o suporte, sem QR nem planos', async () => {
    const wrapper = await mountScreen({ suspended: true })
    expect(wrapper.text()).toContain('Aparelho suspenso')
    expect(wrapper.text()).toMatch(/suporte/)
    expect(wrapper.find('#activation-qr').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('teste de 7 dias')
    expect(wrapper.find('#activation-code').text()).toBe('QDU5NXY7')
    wrapper.unmount()
  })

  it('mostra o código, o QR da página de planos e o foco começa em "Já paguei, verificar"', async () => {
    const wrapper = await mountScreen()
    expect(wrapper.text()).toContain('Ative este aparelho')
    expect(wrapper.find('#activation-code').text()).toBe('QDU5NXY7')
    expect(wrapper.find('#activation-qr').exists()).toBe(true)
    expect(wrapper.text()).toContain('licenca.test/a/QDU5NXY7')
    expect(document.activeElement.id).toBe('activation-retry')
    expect(wrapper.find('#activation-retry').text()).toBe('Já paguei, verificar')
    expect(duplicateIds(document)).toEqual([])
    wrapper.unmount()
  })

  it('os botões avisam o pai: verificar de novo e usar outra lista', async () => {
    const wrapper = await mountScreen()
    await wrapper.find('#activation-retry').trigger('click')
    await wrapper.find('#activation-lists').trigger('click')
    expect(wrapper.emitted('retry')).toHaveLength(1)
    expect(wrapper.emitted('manage-lists')).toHaveLength(1)
    wrapper.unmount()
  })

  it('versão das lojas (D4): sem QR, sem preço e sem endereço de pagamento', async () => {
    const wrapper = await mountScreen({ storeBuild: '1' })
    expect(wrapper.find('#activation-qr').exists()).toBe(false)
    expect(wrapper.text()).not.toMatch(/R\$|licenca\.test/)
    expect(wrapper.text()).toContain('fornecedor')
    expect(wrapper.find('#activation-code').text()).toBe('QDU5NXY7')
    wrapper.unmount()
  })
})

describe('Dashboard com o aparelho bloqueado', () => {
  async function mountDashboard({ playerOpen, gateOpen = false }) {
    for (const level of ['log', 'info', 'warn', 'error']) vi.spyOn(console, level).mockImplementation(() => {})
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
    const { useLicenseStore } = await import('@/stores/licenseStore')
    const license = useLicenseStore()
    vi.spyOn(license, 'refresh').mockResolvedValue()
    vi.spyOn(license, 'shouldBlock').mockReturnValue(true)
    license.code = 'QDU5NXY7'
    const { usePlayerStore } = await import('@/stores/playerStore')
    const player = usePlayerStore()
    player.isOpen = playerOpen
    const { useProfileStore } = await import('@/stores/profileStore')
    const profiles = useProfileStore()
    vi.spyOn(profiles, 'hydrate').mockImplementation(async () => {
      profiles.isProfileGateOpen = gateOpen
    })
    const { default: Dashboard } = await import('@/views/Dashboard.vue')
    const wrapper = mount(Dashboard, {
      global: { plugins: [pinia], provide: { [routerKey]: { replace: vi.fn() } } },
      attachTo: document.body,
    })
    await flushPromises()
    return { wrapper, player, profiles }
  }

  it('com a escolha de perfil aberta, espera: o foco não pode ir para um botão escondido atrás dela', async () => {
    const { wrapper, profiles } = await mountDashboard({ playerOpen: false, gateOpen: true })
    expect(wrapper.find('#activation-required').exists()).toBe(false)
    profiles.isProfileGateOpen = false
    await flushPromises()
    expect(wrapper.find('#activation-required').exists()).toBe(true)
    wrapper.unmount()
  })

  it('mostra a tela de ativação por cima do app', async () => {
    const { wrapper } = await mountDashboard({ playerOpen: false })
    expect(wrapper.find('#activation-required').exists()).toBe(true)
    wrapper.unmount()
  })

  it('com um vídeo tocando, não interrompe: a tela aparece quando o player fecha', async () => {
    const { wrapper, player } = await mountDashboard({ playerOpen: true })
    expect(wrapper.find('#activation-required').exists()).toBe(false)
    player.isOpen = false
    await flushPromises()
    expect(wrapper.find('#activation-required').exists()).toBe(true)
    wrapper.unmount()
  })
})
