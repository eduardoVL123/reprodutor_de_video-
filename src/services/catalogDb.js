import localforage from 'localforage'

/**
 * Persistência do catálogo (50.000+ itens) em IndexedDB, SEM carregar tudo em RAM.
 *
 * Layout (chaves no store "catalog"):
 *   meta:<secao>          { count, chunkSize, chunkCount, counts:{catId:n}, updatedAt }
 *   categories:<secao>    JSON bruto das categorias (poucas centenas)
 *   index:<secao>         { catId: [posicaoGlobal, ...] }  (apenas inteiros)
 *   chunk:<secao>:<n>     JSON BRUTO de até CHUNK_SIZE itens
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
const LRU_MAX_CHUNKS = 6

const metaKey = (s) => `meta:${s}`
const catKey = (s) => `categories:${s}`
const idxKey = (s) => `index:${s}`
const chunkKey = (s, n) => `chunk:${s}:${n}`

const metaCache = new Map()
const indexCache = new Map()
const catCache = new Map()
const chunkCache = new Map() // Map preserva ordem de inserção => LRU simples
let generation = 0 // invalida leituras em voo quando o catálogo é trocado

const categoryOf = (item) =>
  item && item.category_id !== undefined && item.category_id !== null && item.category_id !== ''
    ? String(item.category_id)
    : 'none'

function resetCaches(section) {
  generation++
  metaCache.delete(section)
  indexCache.delete(section)
  catCache.delete(section)
  Array.from(chunkCache.keys()).forEach((k) => {
    if (k.indexOf(`${section}:`) === 0) chunkCache.delete(k)
  })
}

export async function getMeta(section) {
  if (metaCache.has(section)) return metaCache.get(section)
  try {
    const meta = await db.getItem(metaKey(section))
    if (meta) metaCache.set(section, meta)
    return meta || null
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
  } catch (_) {}
  resetCaches(section)
}

/**
 * Grava o JSON bruto em chunks de forma sequencial (loop for).
 * Se o IndexedDB estourar a cota (QuotaExceededError na Android TV),
 * mantém os chunks em memória (chunkCache) para que o catálogo ainda funcione.
 */
export async function saveSection(section, { categories, streams, onProgress }) {
  if (!Array.isArray(categories) || !Array.isArray(streams)) {
    throw new Error('Formato inválido para o catálogo')
  }
  await removeSection(section)

  const total = streams.length
  const chunkCount = Math.ceil(total / CHUNK_SIZE)
  const index = {}

  for (let n = 0; n < chunkCount; n++) {
    const base = n * CHUNK_SIZE
    const rawSlice = streams.slice(base, base + CHUNK_SIZE)
    const slice = rawSlice.map((it) => {
      if (!it) return it
      const streamId =
        it.stream_id !== undefined && it.stream_id !== null ? it.stream_id : it.series_id
      const icon =
        it.stream_icon ||
        it.cover ||
        (streamId !== undefined && streamId !== null ? `https://picsum.photos/seed/tv-${streamId}/400/600` : '')
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
      const cat = categoryOf(slice[k])
      if (!index[cat]) index[cat] = []
      index[cat].push(base + k)
    }

    try {
      await db.setItem(chunkKey(section, n), slice)
    } catch (quotaErr) {
      console.warn(`[catalogDb] IndexedDB falhou ao persistir chunk ${n} (${quotaErr.message}). Mantendo em memória LRU.`)
      chunkCache.set(`${section}:${n}`, Promise.resolve(slice))
    }

    if (onProgress) onProgress((n + 1) / chunkCount)
  }

  const counts = {}
  Object.keys(index).forEach((cat) => {
    counts[cat] = index[cat].length
  })

  const metaObj = {
    count: total,
    chunkSize: CHUNK_SIZE,
    chunkCount,
    counts,
    updatedAt: new Date().toISOString(),
  }

  try {
    await db.setItem(catKey(section), categories)
  } catch (_) {
    catCache.set(section, categories)
  }
  try {
    await db.setItem(idxKey(section), index)
  } catch (_) {
    indexCache.set(section, index)
  }
  try {
    await db.setItem(metaKey(section), metaObj)
  } catch (_) {
    metaCache.set(section, metaObj)
  }

  metaCache.set(section, metaObj)
  indexCache.set(section, index)
  catCache.set(section, categories)
}

async function getIndex(section) {
  if (indexCache.has(section)) return indexCache.get(section)
  const index = (await db.getItem(idxKey(section))) || {}
  indexCache.set(section, index)
  return index
}

function readChunk(section, n) {
  const key = `${section}:${n}`
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
  })
  chunkCache.set(key, promise)
  while (chunkCache.size > LRU_MAX_CHUNKS) {
    chunkCache.delete(chunkCache.keys().next().value)
  }
  return promise
}

/** Quantidade de itens da categoria (ou de todo o catálogo). */
export async function getCount(section, categoryId = ALL_CATEGORIES) {
  const meta = await getMeta(section)
  if (!meta) return 0
  return categoryId === ALL_CATEGORIES ? meta.count : meta.counts[String(categoryId)] || 0
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
    const end = Math.min(start + count, meta.count)
    positions = []
    for (let p = start; p < end; p++) positions.push(p)
  } else {
    const list = (await getIndex(section))[String(categoryId)] || []
    positions = list.slice(start, start + count)
  }

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
    if (item) {
      if (!item.stream_icon && item.stream_id !== undefined && item.stream_id !== null) {
        item.stream_icon = `https://picsum.photos/seed/tv-${item.stream_id}/400/600`
      }
      items.push(item)
    }
  })
  return items
}

/** Remove todo o catálogo (logout / troca de conta). */
export async function clearCatalog() {
  try {
    await db.clear()
  } catch (err) {
    console.warn('[catalogDb] Falha ao limpar catálogo:', err)
  }
  generation++
  metaCache.clear()
  indexCache.clear()
  chunkCache.clear()
}
