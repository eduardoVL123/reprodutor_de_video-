/**
 * Assinatura das respostas de acesso (ECDSA P-256 + SHA-256, Web Crypto: igual no Node, no Workers e na TV).
 * Sem ela, um proxy ou um arquivo hosts podia devolver "activated" ao app. A chave privada fica só no servidor
 * (LICENSE_SIGNING_KEY, JWK); a pública vai no build do app (VITE_LICENSE_PUBLIC_KEY, "x.y").
 * Par novo: `node scripts/make-license-keys.mjs`.
 */
import { toBase64Url } from './license-resellers.mjs'

const ALGORITHM = { name: 'ECDSA', namedCurve: 'P-256' }
const SIGN = { name: 'ECDSA', hash: 'SHA-256' }

/** Devolve `sign(text) -> base64url` ou null sem chave. Chave inválida quebra na primeira assinatura (erro claro no log). */
export function createSigner(privateJwkText) {
  if (!privateJwkText) return null
  let key = null
  return async function sign(text) {
    if (!key) key = crypto.subtle.importKey('jwk', JSON.parse(privateJwkText), ALGORITHM, false, ['sign'])
    const sig = await crypto.subtle.sign(SIGN, await key, new TextEncoder().encode(text))
    return toBase64Url(new Uint8Array(sig))
  }
}
