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

describe('authStore — listas M3U', () => {
  const TOKEN_URL = 'http://m3u.test/lista/TOKEN-SECRETO/playlist.m3u'
  const PLAYLIST = '#EXTM3U\n#EXTINF:-1 group-title="Canais",Canal 1\nhttp://m3u.test/live/1.m3u8\n'

  async function setupM3u(m3uText) {
    const fetchM3uText = vi.fn(async () => ({ text: PLAYLIST, finalUrl: TOKEN_URL }))
    vi.doMock('@/services/xtreamApi', async (importOriginal) => ({
      ...(await importOriginal()),
      fetchM3uText,
      resolveShortInput: vi.fn(async () => ({
        mode: 'm3u',
        m3uText,
        resolvedUrl: TOKEN_URL,
        baseUrl: TOKEN_URL,
        username: 'M3U Playlist',
        password: '',
      })),
    }))
    const { createPinia, setActivePinia } = await import('pinia')
    setActivePinia(createPinia())
    const { useAuthStore } = await import('@/stores/authStore')
    const { storage } = await import('@/services/storage')
    return { auth: useAuthStore(), storage, fetchM3uText }
  }

  it('lista M3U sem nenhum canal é recusada e não fica salva', async () => {
    const { auth, storage } = await setupM3u('#EXTM3U\n')

    const ok = await auth.login({ dns: TOKEN_URL })

    expect(ok).toBe(false)
    expect(auth.error).toContain('não contém nenhum canal')
    expect(auth.savedLists).toHaveLength(0)
    expect(await storage.get('auth:savedLists')).toBeFalsy()
    expect(await storage.get('auth:session')).toBeFalsy()
  })

  it('não grava a URL com token em texto puro, nem no id da lista', async () => {
    const { auth, storage } = await setupM3u(PLAYLIST)

    expect(await auth.login({ dns: TOKEN_URL })).toBe(true)

    const everything = JSON.stringify([await storage.get('auth:savedLists'), await storage.get('auth:session')])
    expect(everything).not.toContain('TOKEN-SECRETO')
    expect(JSON.stringify(auth.savedLists)).not.toContain('TOKEN-SECRETO')
    expect(auth.session.resolvedUrl).toBe(TOKEN_URL) // em memória a sessão usa a URL real
  })

  it('reabre a sessão M3U decifrando a URL e reativa a lista salva', async () => {
    const { auth, fetchM3uText } = await setupM3u(PLAYLIST)
    await auth.login({ dns: TOKEN_URL })
    const listId = auth.savedLists[0].id

    const { createPinia, setActivePinia } = await import('pinia')
    setActivePinia(createPinia())
    const { useAuthStore } = await import('@/stores/authStore')
    const reopened = useAuthStore()
    await reopened.hydrate()

    expect(reopened.session.resolvedUrl).toBe(TOKEN_URL)
    expect(reopened.currentListId).toBe(listId)
    expect(await reopened.switchList(listId)).toBe(true)
    expect(fetchM3uText).toHaveBeenCalledWith(TOKEN_URL)
  })

  it('migra lista e sessão M3U legadas (URL em texto puro, id com o token)', async () => {
    const { auth, storage } = await setupM3u(PLAYLIST)
    const legacyId = `list_m3u_${TOKEN_URL}`.replace(/[^a-z0-9_]/gi, '_')
    const legacy = {
      id: legacyId, type: 'm3u', label: 'Antiga', baseUrl: TOKEN_URL, resolvedUrl: TOKEN_URL,
      username: 'M3U Playlist', password: '', passwordEnc: null,
    }
    await storage.set('auth:savedLists', [legacy])
    await storage.set('auth:session', { ...legacy, savedAt: 'x' })

    await auth.hydrate()

    expect(auth.session.resolvedUrl).toBe(TOKEN_URL)
    expect(auth.currentListId).toBe(auth.savedLists[0].id)
    const everything = JSON.stringify([await storage.get('auth:savedLists'), await storage.get('auth:session')])
    expect(everything).not.toContain('TOKEN-SECRETO')
  })
})

describe('authStore — excluir lista', () => {
  async function twoLists() {
    const ctx = await setup()
    await ctx.auth.login({ dns: SERVER, username: 'a', password: 'pa' })
    await ctx.auth.login({ dns: SERVER, username: 'b', password: 'pb' }) // a ativa passa a ser a "b"
    return ctx
  }
  const idOf = (auth, user) => auth.savedLists.find((l) => l.username === user).id

  it('excluir a lista ativa troca para a próxima e só então a remove', async () => {
    const { auth, storage, authenticate } = await twoLists()
    const ativa = idOf(auth, 'b')
    authenticate.mockClear()

    const ok = await auth.removeList(ativa)

    expect(ok).toBe(true)
    expect(authenticate).toHaveBeenCalledWith(expect.objectContaining({ username: 'a', password: 'pa' }))
    expect(auth.savedLists.map((l) => l.username)).toEqual(['a'])
    expect(auth.session.username).toBe('a')
    expect((await storage.get('auth:savedLists')).map((l) => l.username)).toEqual(['a'])
  })

  it('se a troca falhar (sem rede), a lista ativa NÃO é excluída e a sessão continua nela', async () => {
    const { auth, storage, authenticate } = await twoLists()
    const ativa = idOf(auth, 'b')
    authenticate.mockRejectedValueOnce(new Error('sem rede'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    const ok = await auth.removeList(ativa)

    expect(ok).toBe(false)
    expect(auth.savedLists).toHaveLength(2)
    expect((await storage.get('auth:savedLists')).map((l) => l.username)).toEqual(['a', 'b'])
    expect(auth.session.username).toBe('b')
    expect(auth.error).toBeTruthy()
  })

  it('excluir uma lista que não está ativa não mexe na sessão', async () => {
    const { auth, authenticate } = await twoLists()
    authenticate.mockClear()

    expect(await auth.removeList(idOf(auth, 'a'))).toBe(true)

    expect(authenticate).not.toHaveBeenCalled()
    expect(auth.session.username).toBe('b')
    expect(auth.savedLists.map((l) => l.username)).toEqual(['b'])
  })

  it('excluir a única lista ativa encerra a sessão', async () => {
    const { auth } = await setup()
    await auth.login({ dns: SERVER, username: 'a', password: 'pa' })

    expect(await auth.removeList(auth.savedLists[0].id)).toBe(true)

    expect(auth.isAuthenticated).toBe(false)
    expect(auth.savedLists).toHaveLength(0)
  })
})
