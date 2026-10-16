/**
 * Busca no catálogo local (RFC-013). Varre só o índice de nomes normalizados
 * (`search:<secao>` no IndexedDB, em memória após a 1ª leitura) e lê do disco
 * apenas os itens que entram no resultado.
 */
import { getSearchIndex, getItemsAt } from '@/services/catalogDb'
import { foldText, normalizeText } from '@/utils/normalizeText'

export { normalizeText }

export const MIN_QUERY_LENGTH = 3
export const SEARCH_SECTIONS = ['vod', 'series', 'live']

/**
 * Pontuação do nome (menor = melhor) ou -1 se não contém todos os tokens.
 * 0: igual · 1: começa com a busca · 2: uma palavra começa com o 1º token · 3: contém.
 */
function scoreName(name, query, tokens) {
  for (let i = 0; i < tokens.length; i++) {
    if (name.indexOf(tokens[i]) === -1) return -1
  }
  if (name === query) return 0
  if (name.indexOf(query) === 0) return 1
  if (name.indexOf(tokens[0]) === 0 || name.indexOf(` ${tokens[0]}`) !== -1) return 2
  return 3
}

// Chave de ordenação compacta: pontuação (0–3) * 256 + tamanho do nome (até 255).
const LENGTH_SLOTS = 256
const KEY_SLOTS = 4 * LENGTH_SLOTS
const rankKey = (score, name) => score * LENGTH_SLOTS + Math.min(name.length, LENGTH_SLOTS - 1)
const byRank = (a, b) => a.key - b.key || a.pos - b.pos

// Última varredura por seção. Se a nova busca só acrescenta letras à anterior
// ("fil" -> "film"), todo acerto novo também era acerto antigo: basta revarrer esses.
const lastScan = {}

function scanSection(section, names, query, tokens) {
  const prev = lastScan[section]
  const candidates = prev && prev.names === names && query.indexOf(prev.query) === 0 ? prev.positions : null
  const count = candidates ? candidates.length : names.length
  const positions = []
  const keys = []
  for (let i = 0; i < count; i++) {
    const pos = candidates ? candidates[i] : i
    const name = names[pos]
    if (!name) continue
    const score = scoreName(name, query, tokens)
    if (score < 0) continue
    positions.push(pos)
    keys.push(rankKey(score, name))
  }
  lastScan[section] = { names, query, positions }
  return { positions, keys }
}

/** Os `limit` melhores acertos sem ordenar a lista inteira (histograma das chaves acha o corte). */
function topMatches(positions, keys, limit) {
  let cutoff = KEY_SLOTS - 1
  if (positions.length > limit) {
    const histogram = new Array(KEY_SLOTS).fill(0)
    for (let i = 0; i < keys.length; i++) histogram[keys[i]]++
    let acc = 0
    for (cutoff = 0; cutoff < KEY_SLOTS; cutoff++) {
      acc += histogram[cutoff]
      if (acc >= limit) break
    }
  }
  const picked = []
  for (let i = 0; i < positions.length; i++) {
    if (keys[i] <= cutoff) picked.push({ pos: positions[i], key: keys[i] })
  }
  return picked.sort(byRank).slice(0, limit)
}

async function searchSection(section, query, tokens, limit) {
  const names = await getSearchIndex(section)
  const { positions, keys } = scanSection(section, names, query, tokens)
  const top = topMatches(positions, keys, limit)
  const items = await getItemsAt(section, top.map((m) => m.pos))
  const results = []
  for (let i = 0; i < top.length && i < items.length; i++) {
    results.push({ section, item: items[i], key: top[i].key, pos: top[i].pos })
  }
  return { section, total: positions.length, results }
}

/**
 * @param {string} query texto digitado (com ou sem acentos)
 * @param {{ sections?: string[], limit?: number }} [options] `limit` por seção
 * @returns {Promise<{ query: string, total: number, counts: Object<string, number>,
 *           results: Array<{ section: string, item: object, key: number, pos: number }> }>}
 */
export async function searchCatalog(query, { sections = SEARCH_SECTIONS, limit = 60 } = {}) {
  const normalized = normalizeText(query)
  const counts = {}
  sections.forEach((s) => {
    counts[s] = 0
  })
  if (normalized.length < MIN_QUERY_LENGTH) return { query: normalized, total: 0, counts, results: [] }

  const tokens = normalized.split(' ')
  const perSection = await Promise.all(sections.map((s) => searchSection(s, normalized, tokens, limit)))

  let total = 0
  let results = []
  perSection.forEach((r) => {
    counts[r.section] = r.total
    total += r.total
    results = results.concat(r.results)
  })
  results.sort(byRank)
  return { query: normalized, total, counts, results }
}

/** Até `max` títulos únicos para a lista de sugestões, os mais relevantes primeiro. */
export function getSuggestions(results, max = 8) {
  const seen = {}
  const titles = []
  for (let i = 0; i < results.length && titles.length < max; i++) {
    const name = String((results[i].item && results[i].item.name) || '').trim()
    const key = normalizeText(name)
    if (!key || seen[key]) continue
    seen[key] = true
    titles.push(name)
  }
  return titles
}

/**
 * Divide `name` em trechos para destacar a parte que casa com a busca, ignorando
 * acentos e maiúsculas. @returns {Array<{ text: string, match: boolean }>}
 */
export function highlightParts(name, query) {
  const text = String(name || '')
  const needle = foldText(query).trim()
  // Só vale quando remover o acento não muda o tamanho (posições batem 1:1).
  const folded = foldText(text)
  const at = needle && folded.length === text.length ? folded.indexOf(needle) : -1
  if (at === -1) return [{ text, match: false }]
  return [
    { text: text.slice(0, at), match: false },
    { text: text.slice(at, at + needle.length), match: true },
    { text: text.slice(at + needle.length), match: false },
  ].filter((part) => part.text)
}
