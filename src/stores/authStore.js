import { ref, shallowRef, computed } from 'vue'
import { defineStore } from 'pinia'
import { storage } from '@/services/storage'
import { encryptSecret, decryptSecret } from '@/services/crypto'
import { clearCatalog } from '@/services/catalogDb'
import {
  authenticate,
  resolveShortInput,
  fetchM3uText,
  GENERIC_CONNECTION_ERROR,
  MISSING_CREDENTIALS_ERROR,
} from '@/services/xtreamApi'
import { importM3uCatalog } from '@/services/m3uParser'
import { usePlayerStore } from '@/stores/playerStore'
import { useCatalogStore } from '@/stores/catalogStore'

const SESSION_KEY = 'auth:session'
const SAVED_LISTS_KEY = 'auth:savedLists'

/** Versão persistida: a senha vai cifrada (fallback em texto só se não houver WebCrypto). */
async function toStoredSession(session) {
  if (session.type === 'm3u') return session
  const passwordEnc = await encryptSecret(session.password)
  return { ...session, password: passwordEnc ? null : session.password, passwordEnc }
}

/** Reconstrói a sessão em memória; `null` se a senha não puder ser recuperada. */
async function restoreSession(saved) {
  if (!saved || !saved.baseUrl || !saved.username) return null
  if (saved.type === 'm3u') return { ...saved }
  if (!saved.passwordEnc) return saved.password ? { ...saved } : null

  const password = await decryptSecret(saved.passwordEnc)
  if (password === null) {
    await storage.remove(SESSION_KEY) // chave perdida/dado adulterado: exige novo login
    return null
  }
  return { ...saved, password, passwordEnc: null }
}

/**
 * Sessão do usuário e gerenciamento de múltiplas listas (RFC-003 / RFC-005).
 */
export const useAuthStore = defineStore('auth', () => {
  const session = ref(null) // { id, label, baseUrl, resolvedUrl, username, password, userInfo, serverInfo, savedAt, type }
  const savedLists = shallowRef([]) // [{ id, label, baseUrl, resolvedUrl, username, passwordEnc, password, updatedAt, type }]
  const hydrated = ref(false)
  const loading = ref(false)
  const error = ref('')
  const errorDetail = ref('')

  const isAuthenticated = computed(() => session.value !== null)
  const username = computed(() => session.value?.username ?? '')
  const currentListId = computed(() => session.value?.id ?? '')
  const activeListLabel = computed(() => session.value?.label || session.value?.username || '')
  /** Host a usar nas chamadas: o final (pós-redirect) quando existir. */
  const apiBase = computed(() => session.value?.resolvedUrl || session.value?.baseUrl || '')
  const credentials = computed(() =>
    session.value ? { username: session.value.username, password: session.value.password } : null,
  )

  /** Carrega a sessão salva e a lista de servidores salvos. */
  async function hydrate() {
    if (hydrated.value) return
    try {
      const saved = await storage.get(SESSION_KEY)
      session.value = await restoreSession(saved)

      const lists = await storage.get(SAVED_LISTS_KEY)
      if (Array.isArray(lists) && lists.length > 0) {
        savedLists.value = lists
      } else if (session.value) {
        // Migração da sessão existente para savedLists
        const initial = {
          id: session.value.id || `list_${session.value.username}`,
          label: session.value.label || session.value.username,
          baseUrl: session.value.baseUrl,
          resolvedUrl: session.value.resolvedUrl,
          username: session.value.username,
          passwordEnc: saved?.passwordEnc || null,
          password: session.value.password || saved?.password || null,
          type: session.value.type || 'xtream',
          updatedAt: session.value.savedAt || new Date().toISOString(),
        }
        savedLists.value = [initial]
        await storage.set(SAVED_LISTS_KEY, [initial])
      }
    } catch (err) {
      console.error('[auth] Falha ao ler sessão salva:', err)
      session.value = null
    }
    hydrated.value = true
  }

  /** @returns {Promise<boolean>} true em caso de sucesso. */
  async function login({ dns, username: user, password, label }) {
    if (loading.value) return false
    loading.value = true
    error.value = ''
    errorDetail.value = ''

    try {
      const resolved = await resolveShortInput({ dns, username: user, password })

      if (resolved.mode === 'm3u') {
        let hostLabel = ''
        try {
          hostLabel = new URL(resolved.resolvedUrl).hostname
        } catch (_) {
          hostLabel = 'm3u'
        }
        const finalLabel = (label && String(label).trim()) || `Lista M3U @ ${hostLabel}`
        const listId = `list_m3u_${resolved.resolvedUrl}`.replace(/[^a-z0-9_]/gi, '_')

        const listItem = {
          id: listId,
          type: 'm3u',
          label: finalLabel,
          baseUrl: resolved.baseUrl,
          resolvedUrl: resolved.resolvedUrl,
          username: resolved.username || 'M3U Playlist',
          password: null,
          passwordEnc: null,
          updatedAt: new Date().toISOString(),
        }

        const existingIdx = savedLists.value.findIndex(
          (l) => l.id === listId || l.resolvedUrl === resolved.resolvedUrl,
        )
        const nextSaved = [...savedLists.value]
        if (existingIdx !== -1) {
          nextSaved[existingIdx] = listItem
        } else {
          nextSaved.push(listItem)
        }
        savedLists.value = nextSaved
        try {
          await storage.set(SAVED_LISTS_KEY, nextSaved)
        } catch (err) {
          console.warn('[auth] Falha ao persistir savedLists:', err)
        }

        const next = {
          id: listId,
          type: 'm3u',
          label: finalLabel,
          baseUrl: resolved.baseUrl,
          resolvedUrl: resolved.resolvedUrl,
          username: resolved.username || 'M3U Playlist',
          password: '',
          userInfo: { auth: 1, status: 'Active', exp_date: null },
          serverInfo: { url: resolved.resolvedUrl, port: '', server_protocol: 'http' },
          savedAt: new Date().toISOString(),
        }

        try {
          await storage.set(SESSION_KEY, next)
        } catch (err) {
          console.warn('[auth] Não foi possível persistir a sessão:', err)
        }

        // Descarta catálogo anterior e importa a lista M3U diretamente
        try {
          const catalogStore = useCatalogStore()
          await catalogStore.resetCatalogState()
        } catch (_) {
          await clearCatalog()
        }
        try {
          const player = usePlayerStore()
          await player.reset()
        } catch (_) {}

        await importM3uCatalog(resolved.m3uText)

        session.value = next
        hydrated.value = true
        return true
      }

      // Modo Xtream Codes
      const result = await authenticate({
        dns: resolved.resolvedUrl,
        username: resolved.username,
        password: resolved.password,
      })

      let hostLabel = ''
      try {
        hostLabel = new URL(result.baseUrl).hostname
      } catch (_) {
        hostLabel = result.baseUrl
      }
      const finalLabel = (label && String(label).trim()) || `${String(resolved.username).trim()} @ ${hostLabel}`
      const listId = `list_${result.baseUrl}_${String(resolved.username).trim()}`.replace(/[^a-z0-9_]/gi, '_')

      const passwordEnc = await encryptSecret(resolved.password)

      const listItem = {
        id: listId,
        type: 'xtream',
        label: finalLabel,
        baseUrl: result.baseUrl,
        resolvedUrl: result.resolvedUrl,
        username: String(resolved.username).trim(),
        password: String(resolved.password),
        passwordEnc: passwordEnc || null,
        updatedAt: new Date().toISOString(),
      }

      // Atualiza a lista de servidores salvos (savedLists)
      const existingIdx = savedLists.value.findIndex(
        (l) => l.id === listId || (l.baseUrl === result.baseUrl && l.username === listItem.username),
      )
      const nextSaved = [...savedLists.value]
      if (existingIdx !== -1) {
        nextSaved[existingIdx] = listItem
      } else {
        nextSaved.push(listItem)
      }
      savedLists.value = nextSaved
      try {
        await storage.set(SAVED_LISTS_KEY, nextSaved)
      } catch (err) {
        console.warn('[auth] Falha ao persistir savedLists:', err)
      }

      // Objeto 100% plano: Proxies reativos não podem ser clonados pelo IndexedDB.
      const next = {
        id: listId,
        type: 'xtream',
        label: finalLabel,
        baseUrl: result.baseUrl,
        resolvedUrl: result.resolvedUrl,
        username: String(resolved.username).trim(),
        password: String(resolved.password),
        userInfo: result.userInfo,
        serverInfo: result.serverInfo,
        savedAt: new Date().toISOString(),
      }

      try {
        await storage.set(SESSION_KEY, await toStoredSession(next))
      } catch (err) {
        console.warn('[auth] Não foi possível persistir a sessão:', err)
      }

      // Conta/servidor possivelmente diferente: descarta o catálogo anterior.
      try {
        const catalogStore = useCatalogStore()
        await catalogStore.resetCatalogState()
      } catch (_) {
        await clearCatalog()
      }
      try {
        const player = usePlayerStore()
        await player.reset()
      } catch (_) {}

      session.value = next
      hydrated.value = true
      return true
    } catch (err) {
      console.warn('[auth] Falha no login:', err && (err.code || err.message), err && (err.technicalDetail || err.detail))
      if (err && (err.code === 'missing_credentials' || err.code === 'MISSING_CREDENTIALS')) {
        error.value = MISSING_CREDENTIALS_ERROR
      } else {
        error.value = err?.userMessage || err?.message || GENERIC_CONNECTION_ERROR
      }
      errorDetail.value = err?.technicalDetail || err?.detail || String(err?.message || err || '')
      return false
    } finally {
      loading.value = false
    }
  }

  /** Alterna entre listas salvas sem precisar digitar novamente. */
  async function switchList(listId) {
    if (loading.value) return false
    const item = savedLists.value.find((l) => l.id === listId)
    if (!item) {
      error.value = 'Lista não encontrada.'
      return false
    }

    loading.value = true
    error.value = ''
    errorDetail.value = ''
    try {
      if (item.type === 'm3u') {
        const next = {
          id: item.id,
          type: 'm3u',
          label: item.label,
          baseUrl: item.baseUrl,
          resolvedUrl: item.resolvedUrl,
          username: item.username || 'M3U Playlist',
          password: '',
          userInfo: { auth: 1, status: 'Active', exp_date: null },
          serverInfo: { url: item.resolvedUrl, port: '', server_protocol: 'http' },
          savedAt: new Date().toISOString(),
        }

        await storage.set(SESSION_KEY, next)
        try {
          const catalogStore = useCatalogStore()
          await catalogStore.resetCatalogState()
        } catch (_) {
          await clearCatalog()
        }
        try {
          const player = usePlayerStore()
          await player.reset()
        } catch (_) {}

        try {
          const { text } = await fetchM3uText(item.resolvedUrl || item.baseUrl)
          await importM3uCatalog(text)
        } catch (fetchErr) {
          console.warn('[auth] Falha ao recarregar M3U:', fetchErr)
        }

        session.value = next
        return true
      }

      let password = item.password
      if (!password && item.passwordEnc) {
        password = await decryptSecret(item.passwordEnc)
      }
      if (!password) {
        throw new Error('Senha não recuperável')
      }

      const result = await authenticate({ dns: item.baseUrl, username: item.username, password })

      const next = {
        id: item.id,
        type: 'xtream',
        label: item.label,
        baseUrl: result.baseUrl,
        resolvedUrl: result.resolvedUrl,
        username: item.username,
        password: String(password),
        userInfo: result.userInfo,
        serverInfo: result.serverInfo,
        savedAt: new Date().toISOString(),
      }

      await storage.set(SESSION_KEY, await toStoredSession(next))
      try {
        const catalogStore = useCatalogStore()
        await catalogStore.resetCatalogState()
      } catch (_) {
        await clearCatalog()
      }
      try {
        const player = usePlayerStore()
        await player.reset()
      } catch (_) {}

      session.value = next
      return true
    } catch (err) {
      console.warn('[auth] Falha ao alternar lista:', err)
      error.value = err?.userMessage || err?.message || GENERIC_CONNECTION_ERROR
      errorDetail.value = err?.technicalDetail || err?.detail || String(err?.message || err || '')
      return false
    } finally {
      loading.value = false
    }
  }

  /** Remove uma lista salva. */
  async function removeList(listId) {
    const remaining = savedLists.value.filter((l) => l.id !== listId)
    savedLists.value = remaining
    try {
      await storage.set(SAVED_LISTS_KEY, remaining)
    } catch (err) {
      console.warn('[auth] Falha ao atualizar savedLists após remoção:', err)
    }

    if (session.value && session.value.id === listId) {
      if (remaining.length > 0) {
        await switchList(remaining[0].id)
      } else {
        await logout()
      }
    }
  }

  async function logout() {
    session.value = null
    error.value = ''
    errorDetail.value = ''
    try {
      const catalogStore = useCatalogStore()
      await catalogStore.resetCatalogState()
    } catch (_) {
      await clearCatalog()
    }
    try {
      const player = usePlayerStore()
      await player.reset()
    } catch (_) {}
    try {
      await storage.remove(SESSION_KEY)
    } catch (err) {
      console.warn('[auth] Falha ao remover sessão:', err)
    }
  }

  function clearError() {
    error.value = ''
    errorDetail.value = ''
  }

  return {
    session,
    savedLists,
    hydrated,
    loading,
    error,
    errorDetail,
    isAuthenticated,
    username,
    currentListId,
    activeListLabel,
    apiBase,
    credentials,
    hydrate,
    login,
    switchList,
    removeList,
    logout,
    clearError,
  }
})
