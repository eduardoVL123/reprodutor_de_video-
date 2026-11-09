import localforage from 'localforage'
import { normalizeText } from '@/utils/normalizeText'

/**
 * Persistência do catálogo (50.000+ itens) em IndexedDB, SEM carregar tudo em RAM.
 *
 * Layout (chaves no store "catalog"):
 *   meta:<secao>          { count, chunkSize, chunkCount, counts:{catId:n}, updatedAt }
 *   categories:<secao>    JSON bruto das categorias (poucas centenas)
 *   index:<secao>         { catId: [posicaoGlobal, ...] }  (apenas inteiros)
 *   chunk:<secao>:<n>     JSON BRUTO de até CHUNK_SIZE itens
 *   search:<secao>        [nomeNormalizado, ...] na ordem da posição global (busca)
 *
 * Ler uma "janela" de ~20 itens toca em 1–2 chunks; só poucos chunks ficam num
 * cache LRU. O array completo existe apenas durante a ingestão (resposta da rede).
 */

const db = localforage.createInstance({
  name: 'neutral-media-player',
  storeName: 'catalog',
  driver: localforage.INDEXEDDB, // localStorage (~5MB) não comporta o catálogo
  description: 'Catálogo bruto da API (chunks) para virtualização',
})

export const CHUNK_SIZE = 500
export const ALL_CATEGORIES = 'all'
/** Sobe quando o formato dos itens salvos muda (ex.: capas de terceiros): catálogos antigos são baixados de novo. */
const CATALOG_VERSION = 3 // 3: itens em todas as categorias de `category_ids`
const LRU_MAX_CHUNKS = 6

const metaKey = (s) => `meta:${s}`
const catKey = (s) => `categories:${s}`
const idxKey = (s) => `index:${s}`
const chunkKey = (s, n) => `chunk:${s}:${n}`
const searchKey = (s) => `search:${s}`

const metaCache = new Map()
const indexCache = new Map()
const catCache = new Map()
const searchCache = new Map() // seção => Promise<string[]> (inclui construções em andamento)
const chunkCache = new Map() // Map preserva ordem de inserção => LRU simples
const memoryChunks = new Map() // chunks que não coube gravar (cota cheia): fora do LRU, senão seriam perdidos
let generation = 0 // invalida leituras em voo quando o catálogo é trocado
let clearCount = 0 // só o clearCatalog (troca de lista): gravações em andamento da lista velha param

const hasValue = (v) => v !== undefined && v !== null && v !== ''

/**
 * Categorias do item: a principal (`category_id`) e as extras (`category_ids`, painéis Xtream novos).
 * Sem as extras, uma categoria cujos itens estão todos nela como secundária ficava vazia e sumia.
 */
export function categoriesOf(item) {
  if (!item) return ['none']
  const ids = [item.category_id].concat(Array.isArray(item.category_ids) ? item.category_ids : [])
  const unique = []
  ids.filter(hasValue).forEach((id) => {
    const key = String(id)
    if (unique.indexOf(key) === -1) unique.push(key)
  })
  return unique.length ? unique : ['none']
}

// ---------- Categorias fora da vista (controle parental / escondidas) ----------
// Valem para "Todos", Início, busca e zapping: quem lê o catálogo por aqui nunca vê esses itens.
const hiddenBySection = new Map() // seção => Set de category_id
const visibleCache = new Map() // seção => { list, blocked: Uint8Array, byCat } (null = sem filtro)

/** Define as categorias que não aparecem na seção. Item em várias categorias some se qualquer uma estiver fora. */
export function setHiddenCategories(section, ids) {
  hiddenBySection.set(section, new Set((ids || []).map(String)))
  visibleCache.delete(section)
}

async function visibility(section, meta) {
  const hidden = hiddenBySection.get(section)
  if (!hidden || !hidden.size) return null
  if (visibleCache.has(section)) return visibleCache.get(section)
  const index = await getIndex(section)
  const blocked = new Uint8Array(meta.count)
  hidden.forEach((id) => (index[id] || []).forEach((p) => (blocked[p] = 1)))
  const list = []
  for (let p = 0; p < meta.count; p++) if (!blocked[p]) list.push(p)
  const result = { list, blocked, byCat: {} } // byCat: categoria => posições visíveis (filtrada uma vez, não a cada página)
  visibleCache.set(section, result)
  return result
}

/** Quantos itens "Todos" mostra com o filtro atual (null = sem filtro: vale o total do catálogo). */
export async function visibleCount(section) {
  const meta = await getMeta(section)
  if (!meta) return null
  const v = await visibility(section, meta)
  return v ? v.list.length : null
}

/** Itens visíveis por categoria com o filtro atual (null = sem filtro: valem as contagens do catálogo). */
export async function visibleCategoryCounts(section) {
  const meta = await getMeta(section)
  const v = meta ? await visibility(section, meta) : null
  if (!v) return null
  const index = await getIndex(section)
  const counts = {}
  for (const id of Object.keys(index)) counts[id] = index[id].reduce((n, p) => n + (v.blocked[p] ? 0 : 1), 0)
  return counts
}

/** Posições globais fora da vista (para a busca descartar); null = nada escondido. */
export async function blockedPositions(section) {
  const meta = await getMeta(section)
  const v = meta ? await visibility(section, meta) : null
  return v ? v.blocked : null
}

function resetCaches(section) {
  generation++
  visibleCache.delete(section)
  metaCache.delete(section)
  indexCache.delete(section)
  catCache.delete(section)
  searchCache.delete(section)
  ;[chunkCache, memoryChunks].forEach((cache) => {
    Array.from(cache.keys()).forEach((k) => {
      if (k.indexOf(`${section}:`) === 0) cache.delete(k)
    })
  })
}

export async function getMeta(section) {
  if (metaCache.has(section)) return metaCache.get(section)
  try {
    const meta = await db.getItem(metaKey(section))
    if (!meta || meta.version !== CATALOG_VERSION) return null
    metaCache.set(section, meta)
    return meta
  } catch (_) {
    return null
  }
}

export async function getCategories(section) {
  if (catCache.has(section)) return catCache.get(section)
  try {
    const cats = (await db.getItem(catKey(section))) || []
    if (cats && cats.length) catCache.set(section, cats)
    return cats
  } catch (_) {
    return []
  }
}

async function removeSection(section) {
  try {
    const meta = await db.getItem(metaKey(section))
    await db.removeItem(metaKey(section)) // sem meta o catálogo é considerado inexistente
    if (meta) {
      for (let n = 0; n < meta.chunkCount; n++) await db.removeItem(chunkKey(section, n))
    }
    await db.removeItem(catKey(section))
    await db.removeItem(idxKey(section))
    await db.removeItem(searchKey(section))
  } catch (err) {
    console.warn('[catalogDb] Falha ao apagar seção do banco local:', err)
  }
  resetCaches(section)
}

/**
 * Grava o JSON bruto em chunks de forma sequencial (loop for).
 * Se o IndexedDB estourar a cota (QuotaExceededError na Android TV),
 * mantém os chunks em memória (memoryChunks) para que o catálogo ainda funcione.
 */
export async function saveSection(section, { categories, streams, onProgress }) {
  if (!Array.isArray(categories) || !Array.isArray(streams)) {
    throw new Error('Formato inválido para o catálogo')
  }
  await removeSection(section)
  // Lista trocada (clearCatalog) no meio da gravação: para de gravar, senão a meta antiga volta ao disco depois da
  // limpeza e a lista nova a usa como "pronta" (categorias velhas, fileiras vazias, em todo boot).
  const clears = clearCount
  const replaced = () => clears !== clearCount

  const total = streams.length
  const chunkCount = Math.ceil(total / CHUNK_SIZE)
  const index = {}
  const searchIndex = new Array(total)
  // Algo que só coube na memória: o resumo (meta) não vai para o disco, senão o próximo boot acha o catálogo
  // "pronto" com buracos e nunca baixa de novo. Sem meta no disco, o próximo boot baixa a lista outra vez.
  let incomplete = false

  for (let n = 0; n < chunkCount; n++) {
    const base = n * CHUNK_SIZE
    const rawSlice = streams.slice(base, base + CHUNK_SIZE)
    const slice = rawSlice.map((it) => {
      if (!it) return it
      const streamId =
        it.stream_id !== undefined && it.stream_id !== null ? it.stream_id : it.series_id
      const icon = it.stream_icon || it.cover || ''
      return {
        ...it,
        stream_id: streamId,
        series_id: streamId,
        stream_icon: icon,
        container_extension: it.container_extension || (section === 'vod' || section === 'series' ? 'mp4' : ''),
        section: it.section || section,
      }
    })
    for (let k = 0; k < slice.length; k++) {
      categoriesOf(slice[k]).forEach((cat) => {
        if (!index[cat]) index[cat] = []
        index[cat].push(base + k)
      })
      searchIndex[base + k] = normalizeText(slice[k] && slice[k].name)
    }

    if (replaced()) return
    try {
      await db.setItem(chunkKey(section, n), slice)
    } catch (quotaErr) {
      console.warn(`[catalogDb] IndexedDB falhou ao persistir chunk ${n} (${quotaErr.message}). Mantendo em memória.`)
      memoryChunks.set(`${section}:${n}`, slice)
      incomplete = true
    }

    if (onProgress) onProgress((n + 1) / chunkCount)
  }

  const counts = {}
  Object.keys(index).forEach((cat) => {
    counts[cat] = index[cat].length
  })

  const metaObj = {
    version: CATALOG_VERSION,
    count: total,
    chunkSize: CHUNK_SIZE,
    chunkCount,
    counts,
    updatedAt: new Date().toISOString(),
  }

  if (replaced()) return
  try {
    await db.setItem(catKey(section), categories)
  } catch (err) {
    console.warn(`[catalogDb] Categorias de "${section}" mantidas só em memória:`, err)
    catCache.set(section, categories)
    incomplete = true
  }
  try {
    await db.setItem(idxKey(section), index)
  } catch (err) {
    console.warn(`[catalogDb] Índice de "${section}" mantido só em memória:`, err)
    indexCache.set(section, index)
    incomplete = true
  }
  try {
    await db.setItem(searchKey(section), searchIndex)
  } catch (err) {
    console.warn(`[catalogDb] Índice de busca de "${section}" mantido só em memória (${err && err.message}).`)
  }
  if (replaced()) return
  if (!incomplete) {
    try {
      await db.setItem(metaKey(section), metaObj)
    } catch (err) {
      console.warn('[catalogDb] Falha ao salvar o resumo da seção (vai baixar de novo na próxima vez):', err)
    }
  }
  if (replaced()) return

  metaCache.set(section, metaObj)
  indexCache.set(section, index)
  catCache.set(section, categories)
  searchCache.set(section, Promise.resolve(searchIndex))
}

async function getIndex(section) {
  if (indexCache.has(section)) return indexCache.get(section)
  const index = (await db.getItem(idxKey(section))) || {}
  indexCache.set(section, index)
  return index
}

function readChunk(section, n) {
  const key = `${section}:${n}`
  if (memoryChunks.has(key)) return Promise.resolve(memoryChunks.get(key))
  if (chunkCache.has(key)) {
    const hit = chunkCache.get(key)
    chunkCache.delete(key) // reinsere => marca como "mais recente"
    chunkCache.set(key, hit)
    return hit
  }
  const gen = generation
  const promise = db.getItem(chunkKey(section, n)).then((data) => {
    if (gen !== generation) chunkCache.delete(key) // catálogo trocado enquanto lia
    return data || []
  }, (err) => {
    // Falha passageira do IndexedDB: não guarda a falha, a próxima leitura tenta de novo.
    if (chunkCache.get(key) === promise) chunkCache.delete(key)
    throw err
  })
  chunkCache.set(key, promise)
  while (chunkCache.size > LRU_MAX_CHUNKS) {
    chunkCache.delete(chunkCache.keys().next().value)
  }
  return promise
}

/**
 * Devolve os itens [start, start+count) da categoria. Objetos PLANOS e fora do
 * estado reativo; o chamador deve guardá-los em shallowRef/variável comum.
 */
export async function getItems(section, categoryId, start, count) {
  const meta = await getMeta(section)
  if (!meta || count <= 0) return []

  let positions
  if (categoryId === ALL_CATEGORIES) {
    const v = await visibility(section, meta)
    if (v) {
      positions = v.list.slice(start, start + count)
    } else {
      const end = Math.min(start + count, meta.count)
      positions = []
      for (let p = start; p < end; p++) positions.push(p)
    }
  } else {
    let list = (await getIndex(section))[String(categoryId)] || []
    // Item em várias categorias (category_ids): bloqueado em uma, some de todas (como em "Todos" e na busca).
    const v = await visibility(section, meta)
    if (v) list = v.byCat[categoryId] || (v.byCat[categoryId] = list.filter((p) => !v.blocked[p]))
    positions = list.slice(start, start + count)
  }
  return readPositions(section, meta, positions)
}

/** Itens nas posições globais informadas (ex.: resultados da busca), na mesma ordem. */
export async function getItemsAt(section, positions) {
  const meta = await getMeta(section)
  if (!meta || !positions || !positions.length) return []
  return readPositions(section, meta, positions)
}

async function readPositions(section, meta, positions) {
  const chunkNos = []
  positions.forEach((p) => {
    const n = Math.floor(p / meta.chunkSize)
    if (chunkNos.indexOf(n) === -1) chunkNos.push(n)
  })
  const chunks = {}
  await Promise.all(
    chunkNos.map((n) =>
      readChunk(section, n).then((data) => {
        chunks[n] = data
      }),
    ),
  )

  const items = []
  positions.forEach((p) => {
    const item = chunks[Math.floor(p / meta.chunkSize)][p % meta.chunkSize]
    if (item) items.push(item)
  })
  return items
}

/** Monta o índice de busca varrendo os chunks (catálogos salvos antes do índice existir). */
async function buildSearchIndex(section, meta) {
  const names = new Array(meta.count)
  for (let n = 0; n < meta.chunkCount; n++) {
    const chunk = await readChunk(section, n)
    for (let k = 0; k < chunk.length; k++) {
      names[n * meta.chunkSize + k] = normalizeText(chunk[k] && chunk[k].name)
    }
  }
  try {
    await db.setItem(searchKey(section), names)
  } catch (err) {
    console.warn(`[catalogDb] Índice de busca de "${section}" mantido só em memória (${err && err.message}).`)
  }
  return names
}

/**
 * Nomes normalizados da seção, indexados pela posição global (vazio se a seção
 * não foi baixada). Fica em memória depois da primeira leitura.
 */
export function getSearchIndex(section) {
  if (searchCache.has(section)) return searchCache.get(section)
  const gen = generation
  const promise = (async () => {
    const meta = await getMeta(section)
    if (!meta) return []
    const saved = await db.getItem(searchKey(section))
    if (Array.isArray(saved) && saved.length === meta.count) return saved
    return buildSearchIndex(section, meta)
  })().then(
    (names) => {
      if (gen !== generation || !names.length) searchCache.delete(section)
      return names
    },
    (err) => {
      searchCache.delete(section)
      throw err
    },
  )
  searchCache.set(section, promise)
  return promise
}

/** Remove todo o catálogo (logout / troca de conta). */
export async function clearCatalog() {
  clearCount++
  try {
    await db.clear()
  } catch (err) {
    console.warn('[catalogDb] Falha ao limpar catálogo:', err)
    // Sem os resumos (meta) o catálogo antigo conta como inexistente: a próxima lista não herda os canais desta.
    for (const section of ['live', 'vod', 'series']) {
      await db.removeItem(metaKey(section)).catch(() => {})
    }
  }
  generation++
  metaCache.clear()
  indexCache.clear()
  searchCache.clear()
  chunkCache.clear()
  memoryChunks.clear()
  visibleCache.clear() // os ids de categoria da próxima lista são outros
}
