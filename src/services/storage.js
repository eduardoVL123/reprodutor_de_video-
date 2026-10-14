import localforage from 'localforage'

/**
 * Camada única de persistência local (IndexedDB via localforage).
 * Os drivers são forçados a IndexedDB com fallback para localStorage somente
 * se o WebView da TV não oferecer IndexedDB.
 */
const store = localforage.createInstance({
  name: 'neutral-media-player',
  storeName: 'app',
  driver: [localforage.INDEXEDDB, localforage.LOCALSTORAGE],
  description: 'Preferências e credenciais do reprodutor de mídia neutro',
})

export const STORAGE_KEYS = Object.freeze({
  FTUE_ACCEPTED: 'ftue:accepted',
})

export const storage = {
  get: (key) => store.getItem(key),
  set: (key, value) => store.setItem(key, value),
  remove: (key) => store.removeItem(key),
}

/** Retorna `true` se o usuário já aceitou o Aviso Legal. */
export async function hasAcceptedFtue() {
  try {
    const record = await store.getItem(STORAGE_KEYS.FTUE_ACCEPTED)
    return Boolean(record && record.accepted === true)
  } catch (err) {
    // Se o storage falhar, a opção segura (compliance) é exibir o aviso novamente.
    console.error('[storage] Falha ao ler aceite do FTUE:', err)
    return false
  }
}

/** Persiste o aceite com carimbo de data/hora (útil para auditoria). */
export async function acceptFtue() {
  await store.setItem(STORAGE_KEYS.FTUE_ACCEPTED, {
    accepted: true,
    acceptedAt: new Date().toISOString(),
    version: 1,
  })
}
