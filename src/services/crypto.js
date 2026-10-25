import localforage from 'localforage'

/**
 * Cifra de segredos em repouso (senha do Xtream) com AES-GCM 256 / WebCrypto.
 *
 * A CryptoKey é gerada como NÃO-EXTRAÍVEL e guardada no IndexedDB (que suporta
 * clonar CryptoKey): o material da chave nunca fica legível em JS, de modo que um
 * dump do armazenamento não revela a senha. Não protege contra código malicioso
 * rodando dentro do próprio app — por isso o app não carrega scripts de terceiros.
 *
 * Se o WebView não tiver `crypto.subtle` (ex.: contexto inseguro) ou IndexedDB,
 * `encryptSecret` devolve `null` e quem chamou decide o fallback.
 */

const keyStore = localforage.createInstance({
  name: 'neutral-media-player',
  storeName: 'keys',
  driver: localforage.INDEXEDDB, // sem fallback: localStorage não clona CryptoKey
})

const KEY_ID = 'aes-gcm-v1'
const ALGO = 'AES-GCM'

export function isCryptoSupported() {
  return (
    typeof crypto !== 'undefined' &&
    !!crypto.subtle &&
    typeof crypto.getRandomValues === 'function' &&
    typeof TextEncoder !== 'undefined'
  )
}

let keyPromise = null // uma só criação por vez: chamadas simultâneas não geram chaves diferentes

async function loadOrCreateKey() {
  let key = await keyStore.getItem(KEY_ID)
  if (!key) {
    key = await crypto.subtle.generateKey({ name: ALGO, length: 256 }, false, ['encrypt', 'decrypt'])
    await keyStore.setItem(KEY_ID, key)
  }
  return key
}

function getKey() {
  if (!keyPromise) {
    keyPromise = loadOrCreateKey().catch((err) => {
      keyPromise = null // falha (ex.: IndexedDB indisponível) não pode ficar presa para sempre
      throw err
    })
  }
  return keyPromise
}

/** @returns {Promise<{v:number, iv:Uint8Array, data:Uint8Array}|null>} */
export async function encryptSecret(text) {
  if (!isCryptoSupported()) return null
  try {
    const key = await getKey()
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const buf = await crypto.subtle.encrypt({ name: ALGO, iv }, key, new TextEncoder().encode(String(text)))
    return { v: 1, iv, data: new Uint8Array(buf) }
  } catch (err) {
    console.warn('[crypto] Cifra indisponível, usando fallback:', err && err.message)
    return null
  }
}

/** @returns {Promise<string|null>} `null` se a chave sumiu ou o dado foi adulterado. */
export async function decryptSecret(blob) {
  if (!blob || blob.v !== 1 || !isCryptoSupported()) return null
  try {
    const key = await keyStore.getItem(KEY_ID)
    if (!key) return null
    const buf = await crypto.subtle.decrypt({ name: ALGO, iv: blob.iv }, key, blob.data)
    return new TextDecoder().decode(buf)
  } catch (err) {
    console.warn('[crypto] Falha ao decifrar segredo:', err && err.message)
    return null
  }
}
