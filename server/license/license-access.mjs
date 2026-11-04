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
export function createAccessVerifier({ team, aud, ownerEmail, fetchImpl = (...args) => fetch(...args), now = Date.now, onReject = () => {} }) {
  // Segredos colados no terminal podem vir com espaço ou quebra de linha.
  const issuer = accessIssuer(String(team || '').trim())
  aud = String(aud || '').trim()
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

  /** Motivo da recusa (sem valores secretos) para o log; null = aceito. */
  async function check(token) {
    if (!owner || !aud) return 'configuração incompleta'
    if (typeof token !== 'string' || !token) return 'sem cabeçalho Cf-Access-Jwt-Assertion'
    const parts = token.split('.')
    if (parts.length !== 3) return 'token mal formado'
    const header = decodeJson(parts[0])
    if (header.alg !== 'RS256') return `algoritmo ${header.alg}`
    const key = await keyFor(header.kid)
    if (!key) return 'chave (kid) desconhecida'
    const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
    if (!(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, fromB64Url(parts[2]), signed))) return 'assinatura inválida'
    const claims = decodeJson(parts[1])
    const seconds = now() / 1000
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
    if (!audiences.includes(aud)) return 'aud diferente de ACCESS_AUD'
    if (claims.iss !== issuer) return `emissor ${claims.iss} diferente de ${issuer}`
    if (typeof claims.exp !== 'number' || claims.exp <= seconds) return 'token vencido'
    if (typeof claims.nbf === 'number' && claims.nbf > seconds + 60) return 'token ainda não vale'
    if (String(claims.email || '').trim().toLowerCase() !== owner) return 'e-mail diferente de ACCESS_OWNER_EMAIL'
    return null
  }

  return async function verify(token) {
    let reason
    try {
      reason = await check(token)
    } catch (err) {
      reason = `erro: ${err && err.message}`
    }
    if (reason) onReject(reason)
    return !reason
  }
}
