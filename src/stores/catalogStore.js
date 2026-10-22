import { reactive, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import { useAuthStore } from '@/stores/authStore'
import { apiRequest, XtreamError, fetchM3uText } from '@/services/xtreamApi'
import { importM3uCatalog } from '@/services/m3uParser'
import {
  ALL_CATEGORIES,
  getMeta,
  getCategories,
  saveSection,
  getItems as dbGetItems,
  clearCatalog,
} from '@/services/catalogDb'

// Listas grandes (50.000+ itens) podem demorar bem mais que um login.
const CATALOG_TIMEOUT_MS = 120000

const ACTIONS = {
  live: { categories: 'get_live_categories', streams: 'get_live_streams' },
  vod: { categories: 'get_vod_categories', streams: 'get_vod_streams' },
  series: { categories: 'get_series_categories', streams: 'get_series' },
}

const initialStatus = () => ({ state: 'idle', step: '', progress: 0, error: '', errorDetail: '' })

/**
 * REGRA DE MEMÓRIA: este store NUNCA guarda os itens (canais/filmes) no estado
 * reativo. Ele guarda só estado pequeno (status, categorias, contadores). Os itens
 * vivem no IndexedDB (services/catalogDb) e são lidos em janelas via `getItems`.
 */
export const useCatalogStore = defineStore('catalog', () => {
  const auth = useAuthStore()

  const status = reactive({ live: initialStatus(), vod: initialStatus(), series: initialStatus() })
  // shallowRef: listas pequenas (categorias) sem proxies profundos.
  const categories = shallowRef({ live: [], vod: [], series: [] }) // já inclui a entrada "Todos"
  const totals = shallowRef({ live: 0, vod: 0, series: 0 })
  const counts = shallowRef({ live: {}, vod: {}, series: {} })

  const inflight = {}
  let m3uImport = null // download + importação da playlist, compartilhado pelas 3 seções

  /** Uma playlist M3U serve às três seções: baixa e importa uma única vez, mesmo com cargas simultâneas. */
  function importM3uOnce() {
    if (!m3uImport) {
      const running = (async () => {
        const { text } = await fetchM3uText(auth.apiBase || auth.session?.baseUrl)
        await importM3uCatalog(text, {
          onProgress: (p) => {
            status[p.section].progress = p.progress
          },
        })
      })()
      m3uImport = running.then(
        () => {
          m3uImport = null
        },
        (err) => {
          m3uImport = null
          throw err
        },
      )
    }
    return m3uImport
  }

  // ---------- Chamadas à API (JSON bruto, sem transformar) ----------
  async function requestList(action) {
    if (!auth.isAuthenticated) throw new XtreamError('unauthorized', 'Sem sessão ativa')
    const { data } = await apiRequest(auth.apiBase, auth.credentials, {
      action,
      timeoutMs: CATALOG_TIMEOUT_MS,
    })
    if (data === false || data === null) return [] // alguns painéis devolvem false para lista vazia
    if (!Array.isArray(data)) throw new XtreamError('bad_response', `${action} não retornou uma lista`)
    return data
  }

  const fetchLiveCategories = () => requestList(ACTIONS.live.categories)
  const fetchLiveStreams = () => requestList(ACTIONS.live.streams)
  const fetchVodCategories = () => requestList(ACTIONS.vod.categories)
  const fetchVodStreams = () => requestList(ACTIONS.vod.streams)
  const fetchSeriesCategories = () => requestList(ACTIONS.series.categories)
  const fetchSeriesStreams = async () => {
    const list = await requestList(ACTIONS.series.streams)
    return list.map((it) => {
      if (!it) return it
      const sId = it.series_id !== undefined && it.series_id !== null ? it.series_id : it.stream_id
      return {
        ...it,
        stream_id: sId,
        series_id: sId,
        stream_icon: it.cover || it.stream_icon || '',
        name: it.name || it.title || '',
        container_extension: 'mp4',
        section: 'series',
      }
    })
  }

  const fetchers = {
    live: { categories: fetchLiveCategories, streams: fetchLiveStreams },
    vod: { categories: fetchVodCategories, streams: fetchVodStreams },
    series: { categories: fetchSeriesCategories, streams: fetchSeriesStreams },
  }

  // ---------- Carregamento (cache-first) ----------
  async function publish(section, meta) {
    const raw = await getCategories(section)
    const list = [{ category_id: ALL_CATEGORIES, category_name: 'Todos', count: meta.count }]
    raw.forEach((c) => {
      const count = meta.counts[String(c.category_id)] || 0
      if (count > 0) list.push({ category_id: String(c.category_id), category_name: c.category_name, count })
    })
    categories.value = { ...categories.value, [section]: list }
    totals.value = { ...totals.value, [section]: meta.count }
    counts.value = { ...counts.value, [section]: meta.counts }
  }

  async function doLoad(section, force) {
    const st = status[section]
    st.state = 'loading'
    st.error = ''
    st.errorDetail = ''
    st.progress = 0
    try {
      let meta = force ? null : await getMeta(section)

      if (!meta) {
        if (auth.session?.type === 'm3u') {
          st.step = 'Baixando e processando a playlist M3U...'
          await importM3uOnce()
          meta = await getMeta(section)
        } else {
          st.step = 'Baixando categorias...'
          let cats = await fetchers[section].categories()
          st.step = 'Baixando a lista (pode levar alguns segundos)...'
          let streams = await fetchers[section].streams()
          st.step = 'Salvando no dispositivo...'
          await saveSection(section, {
            categories: cats,
            streams,
            onProgress: (p) => {
              st.progress = p
            },
          })
          // Solta as referências para o GC liberar o array gigante.
          cats = null
          streams = null
          meta = await getMeta(section)
        }
      }

      st.step = 'Preparando...'
      await publish(section, meta)
      st.state = 'ready'
    } catch (err) {
      console.warn(`[catalog] Falha ao carregar "${section}":`, err && err.code, err && (err.technicalDetail || err.detail || err.message))
      st.state = 'error'
      st.error = err?.userMessage || err?.message || 'Erro ao carregar catálogo'
      st.errorDetail = err?.technicalDetail || (err?.stack ? String(err.stack) : String(err))
    }
  }

  /** Carrega do IndexedDB se já houver cache; senão baixa da API e persiste. */
  function loadSection(section, { force = false } = {}) {
    if (inflight[section]) return inflight[section]
    inflight[section] = (async () => {
      try {
        await doLoad(section, force)
      } finally {
        delete inflight[section]
      }
    })()
    return inflight[section]
  }

  const refreshSection = (section) => loadSection(section, { force: true })

  // ---------- Leitura em janelas (nunca reativa) ----------
  function countFor(section, categoryId = ALL_CATEGORIES) {
    return categoryId === ALL_CATEGORIES ? totals.value[section] : counts.value[section][String(categoryId)] || 0
  }

  const getItems = (section, categoryId, start, count) => dbGetItems(section, categoryId, start, count)

  async function resetCatalogState() {
    Object.keys(inflight).forEach((k) => {
      delete inflight[k]
    })
    m3uImport = null
    status.live = initialStatus()
    status.vod = initialStatus()
    status.series = initialStatus()
    categories.value = { live: [], vod: [], series: [] }
    totals.value = { live: 0, vod: 0, series: 0 }
    counts.value = { live: {}, vod: {}, series: {} }
    await clearCatalog()
  }

  async function clear() {
    await resetCatalogState()
  }

  return {
    status,
    categories,
    totals,
    counts,
    fetchLiveCategories,
    fetchLiveStreams,
    fetchVodCategories,
    fetchVodStreams,
    fetchSeriesCategories,
    fetchSeriesStreams,
    loadSection,
    refreshSection,
    countFor,
    getItems,
    resetCatalogState,
    clear,
  }
})
