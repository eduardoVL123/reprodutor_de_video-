/**
 * Assinatura das respostas de acesso (ECDSA P-256 + SHA-256, Web Crypto: igual no Node, no Workers e na TV).
 * Sem ela, um proxy ou um arquivo hosts podia devolver "activated" ao app. A chave privada fica só no servidor
 * (LICENSE_SIGNING_KEY, JWK); a pública vai no build do app (VITE_LICENSE_PUBLIC_KEY, "x.y").
 * Par novo: `node scripts/make-license-keys.mjs`.
 */
import { toBase64Url } from './license-resellers.mjs'

const ALGORITHM = { name: 'ECDSA', namedCurve: 'P-256' }
const SIGN = { name: 'ECDSA', hash: 'SHA-256' }

/**
 * Segredo colado pelo PowerShell pode chegar com BOM, em UTF-16 (um byte nulo depois de cada letra) e com quebra de
 * linha: tira o que não é texto e pega só o objeto JSON.
 */
export function cleanJwk(text) {
  // eslint-disable-next-line no-control-regex -- o byte nulo do UTF-16 é justamente o que precisa sair
  const plain = String(text).replace(/[\u0000\uFEFF\uFFFD\uFFFE]/g, '')
  const start = plain.indexOf('{')
  const end = plain.lastIndexOf('}')
  return start >= 0 && end > start ? plain.slice(start, end + 1) : plain.trim()
}

/**
 * Devolve `sign(text) -> base64url` ou null sem chave. Chave que não é um JWK válido também vira null (respostas sem
 * assinatura), com o motivo no log: em 2026-11-04 um segredo estragado fazia todo /v1/access dar 500 e o app nunca
 * recebia o código do aparelho. Sem assinatura o app trata a resposta como "serviço fora do ar", mas segue funcionando.
 */
export function createSigner(privateJwkText) {
  if (!privateJwkText) return null
  const jwkText = cleanJwk(privateJwkText)
  let jwk = null
  try {
    jwk = JSON.parse(jwkText)
  } catch (_) {
    const raw = String(privateJwkText)
    const first = raw.length ? `U+${raw.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}` : 'nada'
    console.warn(`[licença] LICENSE_SIGNING_KEY não é um JWK válido (${raw.length} caracteres, começa com ${first}): respostas sem assinatura. Grave de novo a chave.`)
    return null
  }
  let key = null
  return async function sign(text) {
    if (!key) {
      key = crypto.subtle.importKey('jwk', jwk, ALGORITHM, false, ['sign']).catch((err) => {
        console.warn(`[licença] LICENSE_SIGNING_KEY recusada pelo Web Crypto (${err && err.message}): respostas sem assinatura.`)
        return null
      })
    }
    if (!(await key)) return undefined
    const sig = await crypto.subtle.sign(SIGN, await key, new TextEncoder().encode(text))
    return toBase64Url(new Uint8Array(sig))
  }
}
