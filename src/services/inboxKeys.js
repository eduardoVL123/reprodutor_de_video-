import localforage from 'localforage'
import { generateEcdhPair, keysFromPair } from '@/services/pairingCrypto'

/**
 * Chave da caixa de entrada do site (RFC-021): um par ECDH P-256 do aparelho, guardado no IndexedDB como CryptoKey
 * (a privada não é extraível, como a chave da senha em crypto.js). O site cifra a lista para a pública; só esta TV
 * abre, com o código do aparelho como dado autenticado.
 */

const PAIR_ID = 'inbox-ecdh-v1'
const idb = localforage.createInstance({ name: 'neutral-media-player', storeName: 'keys', driver: localforage.INDEXEDDB })
const defaultStore = { get: (k) => idb.getItem(k), set: (k, v) => idb.setItem(k, v) }

/** @param {{get: Function, set: Function}} store onde guardar o par (padrão: IndexedDB do app) */
export async function loadOrCreateInboxKeys(store = defaultStore) {
  let pair = await store.get(PAIR_ID)
  if (!pair || !pair.privateKey || !pair.publicKey) {
    pair = await generateEcdhPair()
    await store.set(PAIR_ID, pair)
  }
  return keysFromPair(pair)
}
