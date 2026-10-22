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

  it('com aceite, o FTUE nunca mais aparece', async () => {
    const router = await setup({ ftueAccepted: true })

    await router.push('/ftue')

    expect(router.currentRoute.value.name).toBe('login')
  })
})
