// Formato dos itens, chaves de armazenamento e limites do histórico do player (saiu de playerStore.js).
import { storage } from '@/services/storage'
import { encryptSecret, decryptSecret } from '@/services/crypto'
import { useProfileStore } from '@/stores/profileStore'
import { useAuthStore } from '@/stores/authStore'

const WATCH_HISTORY_MAX = 16 // filmes e episódios no "Continuar assistindo"
const LIVE_HISTORY_MAX = 4 // canais recentes: limite próprio, para zapping não expulsar filmes/séries

export function activeListId() {
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

export const getQueueKey = (withList) => scopedKey('player:customQueue', withList)
export const getHistoryKey = (withList) => scopedKey('player:watchHistory', withList)

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
    // Categorias extras: o controle parental do Início bloqueia se QUALQUER uma estiver bloqueada (como o catálogo).
    category_ids: Array.isArray(item.category_ids) ? item.category_ids.map(String) : [],
    section: String(section || item.section || ''),
    directUrl: item.directUrl ? String(item.directUrl) : '',
    // Episódio: id da série a que pertence (um card por série no "Continuar assistindo").
    seriesId: item.seriesId !== undefined && item.seriesId !== null ? String(item.seriesId) : '',
  }
}

/** Link da M3U pode ter usuário e senha no caminho: no storage vai cifrado como a URL da lista (protectM3u). */
export async function sealDirectUrl(item) {
  if (!item || !item.directUrl) return item
  const directUrlEnc = await encryptSecret(item.directUrl)
  return directUrlEnc ? { ...item, directUrl: '', directUrlEnc } : item // sem WebCrypto: texto, como a lista
}

export async function openDirectUrl(item) {
  if (!item || !item.directUrlEnc) return item
  const { directUrlEnc, ...rest } = item
  return { ...rest, directUrl: (await decryptSecret(directUrlEnc)) || '' }
}

/** Entrada do "Continuar assistindo" (item plano + progresso), ou `null` se o item for inválido. */
export function toHistoryEntry(item) {
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
export function capHistory(list) {
  let live = 0
  let other = 0
  return list.filter((it) => (it.section === 'live' ? ++live <= LIVE_HISTORY_MAX : ++other <= WATCH_HISTORY_MAX))
}

export const sameSeries = (a, b) => !!a.seriesId && a.seriesId === b.seriesId && a.section === b.section

export const sameItem = (a, b) => !!a && !!b && String(a.stream_id) === String(b.stream_id) && a.section === b.section

/** Move os dados de antes dos perfis para a chave do perfil Principal e apaga a antiga (senão voltariam após "limpar"). */
export async function takeLegacy(legacyKey, newKey) {
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
