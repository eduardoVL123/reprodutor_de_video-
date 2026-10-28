import { ref, shallowRef, computed, watch, nextTick } from 'vue'
import { defineStore } from 'pinia'
import { storage } from '@/services/storage'
import { useCatalogStore } from '@/stores/catalogStore'
import { useProfileStore } from '@/stores/profileStore'
import { useAuthStore } from '@/stores/authStore'
import { focusFirstIn } from '@/utils/spatialNavigation'

const CUSTOM_QUEUE_MAX = 100
const WATCH_HISTORY_MAX = 16 // filmes e episódios no "Continuar assistindo"
const LIVE_HISTORY_MAX = 4 // canais recentes: limite próprio, para zapping não expulsar filmes/séries
const WINDOW_SIZE = 100 // itens da categoria mantidos em RAM para zapping
const QUEUE_MAX = 200

function activeListId() {
  try {
    const session = useAuthStore().session
    return (session && session.id) || ''
  } catch (_) {
    return ''
  }
}

/** Chave por perfil e por lista: ids de filmes se repetem entre listas, então histórico e fila não podem ser comuns. */
function scopedKey(prefix, withList = true) {
  let key = prefix
  try {
    key = `${prefix}:${useProfileStore().activeProfileId || 'default'}`
  } catch (_) {}
  const list = withList ? activeListId() : ''
  return list ? `${key}:${list}` : key
}

const getQueueKey = (withList) => scopedKey('player:customQueue', withList)
const getHistoryKey = (withList) => scopedKey('player:watchHistory', withList)

/**
 * Normaliza para um objeto 100% plano (clonável pelo IndexedDB, sem Proxies).
 * @returns {{stream_id:any, name:string, stream_icon:string, container_extension:string, category_id:string, section:string}|null}
 */
export function toPlainItem(item, section) {
  if (!item) return null
  const streamId =
    item.stream_id !== undefined && item.stream_id !== null
      ? item.stream_id
      : item.id !== undefined && item.id !== null
        ? item.id
        : item.series_id
  if (streamId === undefined || streamId === null) return null
  return {
    stream_id: streamId,
    name: item.name !== undefined && item.name !== null ? String(item.name) : '',
    stream_icon: item.stream_icon ? String(item.stream_icon) : (item.cover ? String(item.cover) : ''),
    container_extension: item.container_extension ? String(item.container_extension) : '',
    category_id: item.category_id !== undefined && item.category_id !== null ? String(item.category_id) : '',
    section: String(section || item.section || ''),
    directUrl: item.directUrl ? String(item.directUrl) : '',
    // Episódio: id da série a que pertence (um card por série no "Continuar assistindo").
    seriesId: item.seriesId !== undefined && item.seriesId !== null ? String(item.seriesId) : '',
  }
}

/** Entrada do "Continuar assistindo" (item plano + progresso), ou `null` se o item for inválido. */
function toHistoryEntry(item) {
  const plain = item ? toPlainItem(item, item.section) : null
  if (!plain) return null
  return {
    ...plain,
    currentTime: Number(item.currentTime || 0),
    duration: Number(item.duration || 0),
    progressPct: Number(item.progressPct || 0),
    updatedAt: Number(item.updatedAt || Date.now()),
  }
}

/** Mantém no máximo LIVE_HISTORY_MAX canais e WATCH_HISTORY_MAX filmes/episódios, na ordem recebida. */
function capHistory(list) {
  let live = 0
  let other = 0
  return list.filter((it) => (it.section === 'live' ? ++live <= LIVE_HISTORY_MAX : ++other <= WATCH_HISTORY_MAX))
}

const sameSeries = (a, b) => !!a.seriesId && a.seriesId === b.seriesId && a.section === b.section

const sameItem = (a, b) => !!a && !!b && String(a.stream_id) === String(b.stream_id) && a.section === b.section

/** Move os dados de antes dos perfis para a chave do perfil Principal e apaga a antiga (senão voltariam após "limpar"). */
async function takeLegacy(legacyKey, newKey) {
  try {
    const legacy = await storage.get(legacyKey)
    if (!Array.isArray(legacy) || legacy.length === 0) return null
    await storage.set(newKey, legacy)
    await storage.remove(legacyKey)
    return legacy
  } catch (_) {
    return null
  }
}

/**
 * Reprodução, fila de zapping, Minha Fila e Continuar Assistindo (RFC-003).
 */
export const usePlayerStore = defineStore('player', () => {
  const isOpen = ref(false)
  const mode = ref('live') // 'live' | 'vod' | 'queue'
  const currentItem = shallowRef(null)
  const queue = shallowRef([])
  const currentIndex = ref(-1)
  const customQueue = shallowRef([])
  const watchHistory = shallowRef([]) // [{ ...plain, currentTime, duration, progressPct, updatedAt }]
  const autoPlayNext = ref(true)
  /** Incrementa a cada pedido de reprodução (o overlay observa e (re)inicia o motor). */
  const playToken = ref(0)
  /** Origem da janela: { section, categoryId, windowStart, total } | null. */
  const context = shallowRef(null)

  let returnFocusId = ''
  let seq = 0
  let hydrated = false
  let hydrating = null
  let generation = 0

  const currentSection = computed(() => {
    const it = currentItem.value
    if (it && it.section) return it.section
    return mode.value === 'queue' ? 'vod' : mode.value
  })
  const absoluteIndex = computed(() =>
    context.value ? context.value.windowStart + currentIndex.value : currentIndex.value,
  )
  const totalCount = computed(() => (context.value ? context.value.total : queue.value.length))
  const hasNext = computed(() =>
    mode.value === 'live' ? totalCount.value > 1 : absoluteIndex.value + 1 < totalCount.value,
  )
  const hasPrev = computed(() => (mode.value === 'live' ? totalCount.value > 1 : absoluteIndex.value > 0))

  // ---------- Minha Fila e Histórico (persistidos por perfil) ----------
  function hydrate(force = false) {
    if (hydrated && !force) return Promise.resolve()
    if (hydrating && !force) return hydrating
    const gen = ++generation
    const queueKey = getQueueKey()
    const historyKey = getHistoryKey()

    hydrating = Promise.all([
      storage.get(queueKey),
      storage.get(historyKey),
    ])
      .then(async ([savedQueue, savedHistory]) => {
        if (gen !== generation) return
        let finalQueue = savedQueue
        let finalHistory = savedHistory
        const profileId = (() => {
          try {
            return useProfileStore().activeProfileId
          } catch (_) {
            return ''
          }
        })()
        if (activeListId()) {
          // Dados de antes das listas (só por perfil) passam para a primeira lista que abrir.
          if (!finalQueue || !finalQueue.length) finalQueue = (await takeLegacy(getQueueKey(false), queueKey)) || finalQueue
          if (!finalHistory || !finalHistory.length) {
            finalHistory = (await takeLegacy(getHistoryKey(false), historyKey)) || finalHistory
          }
        }
        if (!profileId || profileId === 'p1') {
          if (!finalQueue || !finalQueue.length) finalQueue = (await takeLegacy('player:customQueue', queueKey)) || finalQueue
          if (!finalHistory || !finalHistory.length) {
            finalHistory = (await takeLegacy('player:watchHistory', historyKey)) || finalHistory
          }
        }

        if (Array.isArray(finalQueue)) {
          customQueue.value = finalQueue
            .map((it) => toPlainItem(it, it && it.section))
            .filter(Boolean)
            .slice(0, CUSTOM_QUEUE_MAX)
        } else {
          customQueue.value = []
        }
        if (Array.isArray(finalHistory)) {
          watchHistory.value = capHistory(finalHistory.map((it) => toHistoryEntry(it)).filter(Boolean))
        } else {
          watchHistory.value = []
        }
      })
      .catch((err) => console.warn('[player] Falha ao ler fila ou histórico:', err))
      .then(() => {
        hydrated = true
        hydrating = null
      })
    return hydrating
  }

  function persistQueue() {
    const plain = customQueue.value.map((it) => toPlainItem(it, it.section))
    return storage.set(getQueueKey(), plain).catch((err) => console.warn('[player] Falha ao salvar Minha Fila:', err))
  }

  function persistWatchHistory() {
    const plain = watchHistory.value.map((it) => toHistoryEntry(it)).filter(Boolean)
    return storage
      .set(getHistoryKey(), plain)
      .catch((err) => console.warn('[player] Falha ao salvar histórico:', err))
  }

  function isInCustomQueue(item, section) {
    if (!item) return false
    const probe = { stream_id: item.stream_id, section: section || item.section }
    return customQueue.value.some((q) => sameItem(q, probe))
  }

  /** @returns {boolean} false se inválido, duplicado ou fila cheia. */
  function enqueueItem(item, section) {
    const plain = toPlainItem(item, section)
    if (!plain || !plain.section) return false
    if (customQueue.value.some((q) => sameItem(q, plain))) return false
    if (customQueue.value.length >= CUSTOM_QUEUE_MAX) return false
    customQueue.value = customQueue.value.concat([plain])
    persistQueue()
    return true
  }

  function removeFromCustomQueue(streamId, section) {
    const match = (q) => String(q.stream_id) === String(streamId) && (!section || q.section === section)
    const before = customQueue.value.length
    customQueue.value = customQueue.value.filter((q) => !match(q))
    if (customQueue.value.length === before) return
    persistQueue()

    // Player tocando a Minha Fila: mantém a reprodução atual e ajusta o índice com segurança.
    if (isOpen.value && mode.value === 'queue') {
      const removedAt = queue.value.findIndex(match)
      if (removedAt === -1) return
      queue.value = queue.value.filter((q, i) => i !== removedAt)
      if (queue.value.length === 0) {
        close()
        return
      }
      if (removedAt < currentIndex.value) {
        currentIndex.value -= 1
      } else if (removedAt === currentIndex.value) {
        setCurrent(Math.min(removedAt, queue.value.length - 1))
      }
    }
  }

  function clearCustomQueue() {
    generation++
    hydrated = true
    customQueue.value = []
    return storage.remove(getQueueKey()).catch((err) => console.warn('[player] Falha ao limpar Minha Fila:', err))
  }

  // ---------- Histórico de Progresso (Continuar Assistindo) ----------
  /** Coloca a entrada no topo, sem duplicar o item nem a série (o episódio mais recente substitui o anterior). */
  function addToHistory(entry) {
    const others = watchHistory.value.filter((it) => !sameItem(it, entry) && !sameSeries(it, entry))
    watchHistory.value = capHistory([entry, ...others])
    persistWatchHistory()
  }

  /**
   * Registra o progresso de `item` (padrão: o item em reprodução). O player passa o item explicitamente
   * ao trocar de vídeo, porque nesse momento `currentItem` já é o próximo.
   */
  function saveProgress(curTime, durTime, item = currentItem.value) {
    if (!item) return
    const cur = Math.max(0, Number(curTime || 0))
    const dur = Math.max(0, Number(durTime || 0))
    const plain = toPlainItem(item, item === currentItem.value ? currentSection.value : item.section)
    if (!plain) return

    if (plain.section === 'live') {
      addToHistory({ ...plain, currentTime: 0, duration: 0, progressPct: 0, updatedAt: Date.now() })
      return
    }

    // Modo VOD / Filmes / Séries
    if (dur <= 0 || cur < 15) return

    if (cur / dur >= 0.95) {
      // Usuário assistiu quase todo o vídeo: remove do "Continuar Assistindo"
      const before = watchHistory.value.length
      watchHistory.value = watchHistory.value.filter((it) => !sameItem(it, plain))
      if (watchHistory.value.length !== before) {
        persistWatchHistory()
      }
      return
    }

    addToHistory({
      ...plain,
      currentTime: Math.floor(cur),
      duration: Math.floor(dur),
      progressPct: Math.min(100, Math.max(0, Math.round((cur / dur) * 100))),
      updatedAt: Date.now(),
    })
  }

  function removeFromHistory(streamId, section) {
    watchHistory.value = watchHistory.value.filter(
      (it) => !(String(it.stream_id) === String(streamId) && (!section || it.section === section)),
    )
    persistWatchHistory()
  }

  function clearHistory() {
    watchHistory.value = []
    return storage.remove(getHistoryKey()).catch((err) => console.warn('[player] Falha ao limpar histórico:', err))
  }

  function getSavedTime(streamId, section) {
    if (!streamId) return 0
    const found = watchHistory.value.find(
      (it) => String(it.stream_id) === String(streamId) && (!section || it.section === section),
    )
    return found ? found.currentTime || 0 : 0
  }

  // ---------- Reprodução ----------
  function rememberFocus() {
    const el = document.activeElement
    returnFocusId = el && el.id ? el.id : ''
  }

  function setCurrent(idx) {
    currentIndex.value = idx
    currentItem.value = queue.value[idx] || null
    playToken.value++
  }

  async function loadWindow(section, categoryId, centerIndex, total) {
    const catalog = useCatalogStore()
    const size = Math.min(WINDOW_SIZE, QUEUE_MAX)
    const start = Math.max(0, Math.min(centerIndex - Math.floor(size / 2), total - size))
    const raw = await catalog.getItems(section, categoryId, start, size)
    return { start, items: raw.map((it) => toPlainItem(it, section)).filter(Boolean) }
  }

  async function playFromCatalog({ section, categoryId, item, indexInCategory }) {
    const plain = toPlainItem(item, section)
    if (!plain) return
    const my = ++seq
    if (!isOpen.value) rememberFocus()

    const catalog = useCatalogStore()
    const total = Math.max(1, catalog.countFor(section, categoryId))
    const index = Math.max(0, indexInCategory || 0)

    mode.value = section
    context.value = { section, categoryId, windowStart: index, total }
    queue.value = [plain]
    isOpen.value = true
    setCurrent(0)

    try {
      const w = await loadWindow(section, categoryId, index, total)
      if (my !== seq) return
      const local = index - w.start
      if (local >= 0 && local < w.items.length && sameItem(w.items[local], plain)) {
        // Mesmo item: troca só a janela, sem reiniciar o player.
        queue.value = w.items
        currentIndex.value = local
        context.value = { section, categoryId, windowStart: w.start, total }
      }
    } catch (err) {
      console.warn('[player] Falha ao montar a fila da categoria:', err)
    }
  }

  /**
   * Toca a Minha Fila a partir de `startItem` (ou do início). Séries ficam de fora:
   * são contêineres de episódios, não um vídeo reproduzível.
   */
  async function playFromCustomQueue(startItem = null) {
    await hydrate()
    const playable = customQueue.value.filter((it) => it.section !== 'series').slice(0, QUEUE_MAX)
    if (!playable.length) return false
    seq++
    if (!isOpen.value) rememberFocus()
    mode.value = 'queue'
    context.value = null
    queue.value = playable
    isOpen.value = true
    const start = startItem ? playable.findIndex((it) => sameItem(it, startItem)) : 0
    setCurrent(Math.max(0, start))
    return true
  }

  /** Reproduz diretamente um item (histórico, favorito, recomendação). */
  function playItem(item) {
    const plain = toPlainItem(item, item.section || 'vod')
    if (!plain) return
    seq++
    if (!isOpen.value) rememberFocus()
    mode.value = plain.section || 'vod'
    context.value = null
    queue.value = [plain]
    isOpen.value = true
    setCurrent(0)
  }

  /** Reproduz uma lista de itens pré-definida (ex: episódios de uma temporada). */
  function playPlaylist({ items, startIndex = 0, section = 'series' }) {
    if (!Array.isArray(items) || items.length === 0) return
    const plainList = items.map((it) => toPlainItem(it, it.section || section)).filter(Boolean)
    if (!plainList.length) return
    seq++
    if (!isOpen.value) rememberFocus()
    mode.value = section
    context.value = null
    queue.value = plainList.slice(0, QUEUE_MAX)
    isOpen.value = true
    const validIndex = Math.max(0, Math.min(startIndex, queue.value.length - 1))
    setCurrent(validIndex)
  }

  /** Pula para um índice da fila atual (gaveta). */
  function playAt(index) {
    if (index < 0 || index >= queue.value.length) return
    seq++
    setCurrent(index)
  }

  /** Avança/retrocede; desliza a janela da categoria e dá a volta no modo Live. */
  async function step(delta) {
    if (!isOpen.value || !queue.value.length) return false
    const my = ++seq
    const ctx = context.value

    if (!ctx) {
      const idx = currentIndex.value + delta
      if (idx < 0 || idx >= queue.value.length) return false
      setCurrent(idx)
      return true
    }

    let abs = ctx.windowStart + currentIndex.value + delta
    if (abs < 0 || abs >= ctx.total) {
      if (mode.value !== 'live' || ctx.total < 2) return false
      abs = (abs + ctx.total) % ctx.total
    }
    const local = abs - ctx.windowStart
    if (local >= 0 && local < queue.value.length) {
      setCurrent(local)
      return true
    }

    try {
      const w = await loadWindow(ctx.section, ctx.categoryId, abs, ctx.total)
      if (my !== seq) return false
      const idx = abs - w.start
      if (idx < 0 || idx >= w.items.length) return false
      queue.value = w.items
      context.value = { section: ctx.section, categoryId: ctx.categoryId, windowStart: w.start, total: ctx.total }
      setCurrent(idx)
      return true
    } catch (err) {
      console.warn('[player] Falha ao carregar a próxima janela:', err)
      return false
    }
  }

  const next = () => step(1)
  const prev = () => step(-1)

  /** Fecha o player (o overlay desmonta e destrói o motor) e devolve o foco. */
  function close() {
    if (!isOpen.value) return
    seq++
    isOpen.value = false
    currentItem.value = null
    queue.value = []
    currentIndex.value = -1
    context.value = null

    const id = returnFocusId
    returnFocusId = ''
    nextTick(() => {
      const el = id ? document.getElementById(id) : null
      if (el) el.focus()
      else focusFirstIn('[data-focus-group="content"]') || focusFirstIn(document.body)
    })
  }

  /** Troca de lista/servidor: fecha o player e limpa a fila em reprodução. */
  function reset() {
    close()
    queue.value = []
    currentIndex.value = -1
    currentItem.value = null
    context.value = null
  }

  try {
    const profile = useProfileStore()
    watch(
      () => profile.activeProfileId,
      () => {
        hydrate(true)
      },
    )
    const auth = useAuthStore()
    watch(
      () => auth.session && auth.session.id,
      () => {
        watchHistory.value = [] // não mostra o histórico da lista anterior enquanto o da nova carrega
        customQueue.value = []
        hydrate(true)
      },
    )
  } catch (_) {}

  hydrate()

  return {
    isOpen,
    mode,
    currentItem,
    queue,
    currentIndex,
    customQueue,
    watchHistory,
    autoPlayNext,
    playToken,
    context,
    currentSection,
    absoluteIndex,
    totalCount,
    hasNext,
    hasPrev,
    hydrate,
    isInCustomQueue,
    enqueueItem,
    removeFromCustomQueue,
    clearCustomQueue,
    saveProgress,
    removeFromHistory,
    clearHistory,
    getSavedTime,
    playFromCatalog,
    playFromCustomQueue,
    playItem,
    playPlaylist,
    playAt,
    next,
    prev,
    close,
    reset,
  }
})
