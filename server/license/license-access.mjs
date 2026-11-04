/**
 * Cloudflare Access na frente do painel do dono (RFC-025 §5). O Access coloca em cada pedido o cabeçalho
 * `Cf-Access-Jwt-Assertion` (JWT RS256). Conferimos aqui a assinatura com as chaves públicas da equipe, o `aud` da
 * aplicação, o emissor, a validade e o e-mail do dono. Sem isso, o painel não existe (404): vale também para o
 * endereço *.workers.dev e qualquer outro nome, onde o Access não está.
 */

const CERTS_TTL_MS = 60 * 60 * 1000
const MIN_REFETCH_MS = 60 * 1000

const fromB64Url = (text) => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
const decodeJson = (part) => JSON.parse(new TextDecoder().decode(fromB64Url(part)))

/** `team`: nome da equipe (vira <team>.cloudflareaccess.com) ou o domínio inteiro. */
export const accessIssuer = (team) => `https://${team.includes('.') ? team : `${team}.cloudflareaccess.com`}`

/**
 * Cria o conferidor. `fetchImpl` e `now` são injetáveis nos testes.
 * Devolve `verify(token)` → true só se tudo bater.
 */
export function createAccessVerifier({ team, aud, ownerEmail, fetchImpl = (...args) => fetch(...args), now = Date.now }) {
  const issuer = accessIssuer(team)
  const owner = String(ownerEmail || '').trim().toLowerCase()
  let keys = new Map()
  let fetchedAt = 0

  async function loadKeys() {
    const res = await fetchImpl(`${issuer}/cdn-cgi/access/certs`)
    if (!res.ok) throw new Error(`certs do Access: HTTP ${res.status}`)
    const body = await res.json()
    const next = new Map()
    for (const jwk of body.keys || []) {
      if (jwk.kty !== 'RSA' || !jwk.kid) continue
      next.set(jwk.kid, await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']))
    }
    keys = next
    fetchedAt = now()
  }

  async function keyFor(kid) {
    if (!keys.has(kid) || now() - fetchedAt > CERTS_TTL_MS) {
      // kid novo (rotação): busca de novo, mas no máximo 1x por minuto para um token forjado não virar enxurrada.
      if (now() - fetchedAt > MIN_REFETCH_MS || keys.size === 0) await loadKeys()
    }
    return keys.get(kid) || null
  }

  return async function verify(token) {
    if (!owner || !aud || typeof token !== 'string') return false
    const parts = token.split('.')
    if (parts.length !== 3) return false
    try {
      const header = decodeJson(parts[0])
      if (header.alg !== 'RS256') return false
      const key = await keyFor(header.kid)
      if (!key) return false
      const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
      if (!(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, fromB64Url(parts[2]), signed))) return false
      const claims = decodeJson(parts[1])
      const seconds = now() / 1000
      const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
      if (!audiences.includes(aud)) return false
      if (claims.iss !== issuer) return false
      if (typeof claims.exp !== 'number' || claims.exp <= seconds) return false
      if (typeof claims.nbf === 'number' && claims.nbf > seconds + 60) return false
      return String(claims.email || '').toLowerCase() === owner
    } catch {
      return false
    }
  }
}
