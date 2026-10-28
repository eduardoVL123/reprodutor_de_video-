/**
 * Lado da TV da cifra do pareamento pelo celular (RFC-016). O celular (server/pair/public/pair-lib.js)
 * cifra a lista para a chave pública que a TV mandou; só esta TV, com a chave privada que nunca sai
 * da memória (não extraível), consegue abrir. O servidor de pareamento só vê texto cifrado.
 *
 * Formato do `box`: base64url( chave pública efêmera do celular [65 bytes] | iv [12] | AES-GCM(JSON) ),
 * chave AES-256 = ECDH P-256, com o código da sessão como dado autenticado adicional.
 */

const ECDH = { name: 'ECDH', namedCurve: 'P-256' }
const PUBLIC_KEY_BYTES = 65
const IV_BYTES = 12
const GCM_TAG_BYTES = 16

function toBase64Url(bytes) {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text) {
  const base64 = String(text).replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(base64 + '==='.slice((base64.length + 3) % 4))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

const asText = (value) => (typeof value === 'string' ? value : '')

/** Valida o que veio do celular: endereço é obrigatório; o resto vira texto vazio quando falta. */
function toListInput(data) {
  if (!data || typeof data !== 'object' || !asText(data.dns).trim()) throw new Error('lista sem endereço')
  return { dns: data.dns, username: asText(data.username), password: asText(data.password), label: asText(data.label) }
}

/**
 * @returns {Promise<{ publicKey: string, open: (box: string, code: string) => Promise<{ dns: string, username: string, password: string, label: string }> }>}
 *          `open` rejeita com `Error('BAD_DATA')` para qualquer dado que não seja deste par de chaves e desta sessão.
 */
export async function createPairingKeys() {
  return keysFromPair(await crypto.subtle.generateKey(ECDH, false, ['deriveKey']))
}

/** Novo par ECDH P-256 com a chave privada não extraível (a caixa de entrada do site guarda o par no aparelho). */
export function generateEcdhPair() {
  return crypto.subtle.generateKey(ECDH, false, ['deriveKey'])
}

/** `publicKey` + `open` de um par já existente (mesmo formato e regras do pareamento). */
export async function keysFromPair(pair) {
  const publicKey = toBase64Url(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)))

  async function open(box, code) {
    try {
      const bytes = fromBase64Url(box)
      if (bytes.length <= PUBLIC_KEY_BYTES + IV_BYTES + GCM_TAG_BYTES) throw new Error('box curto')
      const ephemeral = await crypto.subtle.importKey('raw', bytes.slice(0, PUBLIC_KEY_BYTES), ECDH, false, [])
      const aes = await crypto.subtle.deriveKey({ name: 'ECDH', public: ephemeral }, pair.privateKey, { name: 'AES-GCM', length: 256 }, false, ['decrypt'])
      const plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: bytes.slice(PUBLIC_KEY_BYTES, PUBLIC_KEY_BYTES + IV_BYTES), additionalData: new TextEncoder().encode(code) },
        aes,
        bytes.slice(PUBLIC_KEY_BYTES + IV_BYTES),
      )
      return toListInput(JSON.parse(new TextDecoder().decode(plain)))
    } catch (_) {
      throw new Error('BAD_DATA')
    }
  }

  return { publicKey, open }
}
