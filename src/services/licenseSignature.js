import { licenseSignedText } from '../../server/license/license-rules.mjs'

/**
 * Confere a assinatura do servidor na resposta de acesso (server/license/license-sign.mjs): sem ela, um proxy ou um
 * arquivo hosts podia responder "activated". A chave pública vem do build (`VITE_LICENSE_PUBLIC_KEY`, "x.y").
 * Sem chave no build, ou numa TV sem Web Crypto, não há o que conferir e a resposta vale como antes.
 */

let keyPromise = null

function publicKeyText() {
  return String(import.meta.env.VITE_LICENSE_PUBLIC_KEY || '').trim()
}

function subtle() {
  const c = typeof globalThis !== 'undefined' ? globalThis.crypto : null
  return c && c.subtle ? c.subtle : null
}

/** A assinatura é exigida neste aparelho? */
export function isSignatureRequired() {
  return !!publicKeyText() && !!subtle()
}

function fromBase64Url(text) {
  const b64 = String(text).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

function importKey() {
  if (!keyPromise) {
    const [x, y] = publicKeyText().split('.')
    keyPromise = subtle().importKey('jwk', { kty: 'EC', crv: 'P-256', x, y, ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
  }
  return keyPromise
}

/**
 * @param {object} state resposta do servidor (access, code, trialEndsAt, activationEndsAt, serverTime, sig)
 * @param {{deviceKey: string, host: string}} who aparelho e lista que fizeram a consulta
 * @returns {Promise<boolean>} true se a assinatura confere (ou não é exigida)
 */
export async function verifyLicense(state, { deviceKey, host }) {
  if (!isSignatureRequired()) return true
  if (!state || typeof state.sig !== 'string' || !state.sig) return false
  try {
    const text = new TextEncoder().encode(licenseSignedText({ ...state, deviceKey, host }))
    return await subtle().verify({ name: 'ECDSA', hash: 'SHA-256' }, await importKey(), fromBase64Url(state.sig), text)
  } catch (_) {
    return false
  }
}
