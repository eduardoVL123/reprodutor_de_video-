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
  // Sem carga real em segundo plano: ela lia o cache do banco de teste e mudava estados no meio do teste (instável).
  vi.spyOn(catalog, 'loadSection').mockResolvedValue()
  Object.keys(states).forEach((s) => Object.assign(catalog.status[s], states[s]))
  const { default: Dashboard } = await import('@/views/Dashboard.vue')
  const wrapper = mount(Dashboard, {
    global: { plugins: [pinia], provide: { [routerKey]: { replace: vi.fn() } } },
    attachTo: document.body,
  })
  await flushPromises()
  return { wrapper, refreshSection, pinia }
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

describe('Dashboard — uma seção baixando por vez', () => {
  it('lista nova: Filmes, Séries e Canais nunca baixam juntos, mesmo com o Início pedido duas vezes', async () => {
    vi.resetModules()
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
    let running = 0
    let peak = 0
    const order = []
    const pending = []
    vi.spyOn(catalog, 'loadSection').mockImplementation((s) => {
      if (catalog.status[s].state !== 'idle') return Promise.resolve()
      catalog.status[s].state = 'loading'
      order.push(s)
      peak = Math.max(peak, ++running)
      return new Promise((resolve) => pending.push(() => { running--; catalog.status[s].state = 'ready'; resolve() }))
    })
    vi.spyOn(catalog, 'getItems').mockImplementation(async (s) => [{ stream_id: 1, name: `Item de ${s}`, section: s }])
    const { default: Dashboard } = await import('@/views/Dashboard.vue')
    const wrapper = mount(Dashboard, { global: { plugins: [pinia], provide: { [routerKey]: { replace: vi.fn() } } }, attachTo: document.body })
    await flushPromises()
    // Segundo pedido do Início no meio da primeira carga (ex.: troca de perfil/controle parental ao entrar).
    wrapper.vm.$.setupState.showcaseAfterListChange?.()
    await flushPromises()
    expect(wrapper.html()).not.toContain('Item de vod') // nada pronto ainda
    pending.shift()() // Filmes pronto; Séries ainda baixando
    await flushPromises()
    expect(wrapper.html()).toContain('Item de vod') // a fileira aparece sem esperar as outras seções
    expect(wrapper.html()).not.toContain('Item de series')
    while (pending.length) {
      pending.shift()()
      await flushPromises()
    }

    expect(peak).toBe(1)
    expect(order).toEqual(['vod', 'series', 'live'])
    wrapper.unmount()
  })
})

describe('Dashboard — controle parental nos atalhos (auditoria RFC-025, item 9)', () => {
  it('"Continuar assistindo" e "Minha lista" não mostram nem tocam item de categoria bloqueada sem PIN', async () => {
    vi.resetModules()
    const { wrapper, pinia } = await mountHome({})
    const { useCatalogStore } = await import('@/stores/catalogStore')
    const { usePlayerStore } = await import('@/stores/playerStore')
    // A Pinia do Dashboard, não a "ativa": sobra assíncrona do teste anterior pode trocar a ativa no meio (instável).
    const catalog = useCatalogStore(pinia)
    const player = usePlayerStore(pinia)
    catalog.categories = { ...catalog.categories, vod: [{ category_id: '1', category_name: 'Ação' }, { category_id: '9', category_name: 'Adultos +18' }] }
    const ok = { stream_id: 10, name: 'Filme Livre', section: 'vod', category_id: '1' }
    const locked = { stream_id: 20, name: 'Filme Bloqueado', section: 'vod', category_id: '9' }
    await player.hydrate() // o histórico salvo carrega sozinho e apagaria o que o teste coloca
    await flushPromises()
    player.watchHistory = [locked, ok]
    player.customQueue = [locked, ok]
    // Filmes ainda sem categorias (carregando): não dá para saber o que está bloqueado, então nada aparece.
    catalog.status.vod.state = 'loading'
    await flushPromises()
    expect(wrapper.html()).not.toContain('Filme Bloqueado')
    expect(wrapper.html()).not.toContain('Filme Livre')
    catalog.status.vod.state = 'ready'
    await flushPromises()
    await vi.waitFor(() => expect(wrapper.html()).toContain('Filme Livre'), { timeout: 4000 }) // 1 s padrão falhava com a suíte cheia
    const html = wrapper.html()
    expect(html).not.toContain('Filme Bloqueado')
    const play = vi.spyOn(player, 'playFromCustomQueue').mockResolvedValue(true)
    wrapper.vm.$.setupState.openFavorite(ok)
    const allow = play.mock.calls[0][1]
    expect(allow(locked)).toBe(false)
    expect(allow(ok)).toBe(true)
    wrapper.unmount()
  })
})
