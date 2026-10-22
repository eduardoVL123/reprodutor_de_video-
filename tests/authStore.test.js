import { describe, it, expect, vi } from 'vitest'

const SERVER = 'http://srv.test:8080'

async function setup() {
  const authenticate = vi.fn(async () => ({
    baseUrl: SERVER,
    resolvedUrl: null,
    userInfo: { auth: 1, status: 'Active' },
    serverInfo: {},
  }))
  const resolveShortInput = vi.fn(async ({ username, password }) => ({
    mode: 'xtream',
    resolvedUrl: SERVER,
    baseUrl: SERVER,
    username,
    password,
  }))
  vi.doMock('@/services/xtreamApi', async (importOriginal) => ({
    ...(await importOriginal()),
    authenticate,
    resolveShortInput,
  }))

  const { createPinia, setActivePinia } = await import('pinia')
  setActivePinia(createPinia())
  const { useAuthStore } = await import('@/stores/authStore')
  const { storage } = await import('@/services/storage')
  return { auth: useAuthStore(), storage, authenticate }
}

describe('authStore — senha em repouso', () => {
  it('não grava a senha em texto puro na lista de servidores salvos', async () => {
    const { auth, storage } = await setup()

    const ok = await auth.login({ dns: SERVER, username: 'user1', password: 'senha-secreta' })

    expect(ok).toBe(true)
    const lists = await storage.get('auth:savedLists')
    expect(lists).toHaveLength(1)
    expect(JSON.stringify(lists)).not.toContain('senha-secreta')
    expect(lists[0].passwordEnc).toBeTruthy()
  })

  it('mantém a lista em memória sem a senha em texto puro', async () => {
    const { auth } = await setup()

    await auth.login({ dns: SERVER, username: 'user1', password: 'senha-secreta' })

    expect(JSON.stringify(auth.savedLists)).not.toContain('senha-secreta')
  })

  it('reativa uma lista salva decifrando a senha', async () => {
    const { auth, authenticate } = await setup()
    await auth.login({ dns: SERVER, username: 'user1', password: 'senha-secreta' })
    authenticate.mockClear()

    const ok = await auth.switchList(auth.savedLists[0].id)

    expect(ok).toBe(true)
    expect(authenticate).toHaveBeenCalledWith(
      expect.objectContaining({ username: 'user1', password: 'senha-secreta' }),
    )
  })

  it('migra listas legadas que guardavam a senha em texto puro', async () => {
    const { auth, storage, authenticate } = await setup()
    await storage.set('auth:savedLists', [
      { id: 'legado', type: 'xtream', label: 'Legado', baseUrl: SERVER, username: 'u', password: 'segredo-legado', passwordEnc: null },
    ])

    await auth.hydrate()

    const stored = await storage.get('auth:savedLists')
    expect(JSON.stringify(stored)).not.toContain('segredo-legado')
    expect(stored[0].passwordEnc).toBeTruthy()
    expect(JSON.stringify(auth.savedLists)).not.toContain('segredo-legado')

    await auth.switchList('legado')
    expect(authenticate).toHaveBeenCalledWith(expect.objectContaining({ password: 'segredo-legado' }))
  })
})
