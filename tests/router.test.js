import { describe, it, expect, vi } from 'vitest'

async function setup({ ftueAccepted, session = null }) {
  vi.doMock('@/services/storage', () => ({ hasAcceptedFtue: vi.fn(async () => ftueAccepted) }))
  vi.doMock('@/stores/authStore', () => ({
    useAuthStore: () => ({ hydrate: async () => {}, isAuthenticated: session !== null }),
  }))
  const { default: router } = await import('@/router')
  return router
}

describe('router', () => {
  it('só tem as telas alcançáveis pela interface', async () => {
    const router = await setup({ ftueAccepted: true })

    expect(router.getRoutes().map((r) => r.name).filter(Boolean).sort()).toEqual(['dashboard', 'ftue', 'login'])
  })

  it('sem aceite do aviso legal, qualquer rota leva ao FTUE', async () => {
    const router = await setup({ ftueAccepted: false })

    await router.push('/dashboard')

    expect(router.currentRoute.value.name).toBe('ftue')
  })

  it('com aceite e sem sessão, rotas protegidas levam ao login', async () => {
    const router = await setup({ ftueAccepted: true })

    await router.push('/dashboard')

    expect(router.currentRoute.value.name).toBe('login')
  })

  it('com aceite e sessão ativa, o login leva ao dashboard', async () => {
    const router = await setup({ ftueAccepted: true, session: {} })

    await router.push('/login')

    expect(router.currentRoute.value.name).toBe('dashboard')
  })

  it.each([
    ['aceite do aviso', { ftue: () => new Promise(() => {}), hydrate: async () => {} }, 'ftue'], // sem saber: mostra o aviso
    ['sessão salva', { ftue: async () => true, hydrate: () => new Promise(() => {}) }, 'login'],
  ])('armazenamento travado ao ler %s (WebView antigo): a 1ª tela abre em segundos', async (_, stall, expected) => {
    vi.useFakeTimers()
    try {
      vi.doMock('@/services/storage', () => ({ hasAcceptedFtue: vi.fn(stall.ftue) }))
      vi.doMock('@/stores/authStore', () => ({ useAuthStore: () => ({ hydrate: stall.hydrate, isAuthenticated: false }) }))
      const { default: router } = await import('@/router')

      const opened = router.push('/login')
      await vi.advanceTimersByTimeAsync(6000)
      await opened

      expect(router.currentRoute.value.name).toBe(expected)
    } finally {
      vi.useRealTimers()
    }
  })

  it('com aceite, o FTUE nunca mais aparece', async () => {
    const router = await setup({ ftueAccepted: true })

    await router.push('/ftue')

    expect(router.currentRoute.value.name).toBe('login')
  })
})

describe('router — tela que não carrega', () => {
  it('recarrega o app uma vez e não entra em laço', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    sessionStorage.clear()
    const { recoverFromRouteError } = await setup({ ftueAccepted: true }).then(() => import('@/router'))
    const reload = vi.fn()

    recoverFromRouteError(new Error('Failed to fetch dynamically imported module'), reload)
    recoverFromRouteError(new Error('Failed to fetch dynamically imported module'), reload)

    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('sem sessionStorage não recarrega (evita laço infinito)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { recoverFromRouteError } = await setup({ ftueAccepted: true }).then(() => import('@/router'))
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('bloqueado') })
    const reload = vi.fn()

    recoverFromRouteError(new Error('x'), reload)

    expect(reload).not.toHaveBeenCalled()
    vi.restoreAllMocks()
  })
})
