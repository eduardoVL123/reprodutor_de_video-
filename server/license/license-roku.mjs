/**
 * Licença na Roku (docs/roku/domains/08-licenca-roku-pay.md e 10-servidor.md): a cobrança é só pelo Roku Pay.
 * - O app manda o transactionId da compra em /v1/access; o servidor confere na API de parceiros da Roku
 *   (validate-transaction) e transforma a assinatura ativa numa ativação do aparelho até o fim do período.
 * - A resposta de /v1/access também sai assinada em RSA (sigRsa): a Roku não tem ECDSA, só roRSA.
 * Tudo desligado sem ROKU_API_KEY / LICENSE_RSA_KEY: as outras plataformas não mudam.
 */
import { toBase64Url } from '../pair/pair-core.mjs'
import { cleanJwk } from './license-sign.mjs'

export const ROKU_VALIDATE_URL = 'https://apipub.roku.com/listen/transaction-service.svc/validate-transaction'
export const ROKU_CACHE_MS = 10 * 60 * 1000
export const ROKU_TIMEOUT_MS = 8000
export const ROKU_SOURCE = 'roku_pay'
/** shortcut: a assinatura vale para todos os aparelhos da conta Roku; acima disso a compra foi espalhada. Subir se
 * contas reais passarem perto (Roku não diz quantos aparelhos a conta tem). */
export const ROKU_MAX_DEVICES = 10

const RSA = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }

/** transactionId do Roku Pay aceito do app (o resto é ignorado). */
export const validTransactionId = (id) => (typeof id === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(id) ? id : '')

/**
 * Data da Roku em milissegundos: ISO ("2026-12-01T00:00:00Z"), o formato dos serviços .svc ("/Date(1764547200000+0000)/")
 * ou número. null se não der para ler.
 * UNVERIFIED: o formato exato do expirationDate vem da documentação; conferir com a resposta real da conta de teste.
 */
export function parseRokuDate(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string' || !value) return null
  const wcf = value.match(/^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/)
  if (wcf) return Number(wcf[1])
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

/**
 * Cliente do validate-transaction. `validate(transactionId)` → { entitled, endsAt } ou null quando a Roku não respondeu
 * (rede, 5xx, JSON estranho): quem chama mantém o estado que já tinha. Respostas ficam ROKU_CACHE_MS na memória.
 */
export function createRokuPay({ apiKey, fetchImpl = (...args) => fetch(...args), now = Date.now } = {}) {
  if (!apiKey) return null
  const cache = new Map()
  return async function validate(transactionId) {
    const hit = cache.get(transactionId)
    if (hit && now() - hit.at < ROKU_CACHE_MS) return hit.result
    let result = null
    try {
      const res = await fetchImpl(`${ROKU_VALIDATE_URL}/${encodeURIComponent(apiKey)}/${encodeURIComponent(transactionId)}`, {
        headers: { Accept: 'application/json' },
        // A TV espera a resposta de /v1/access: a Roku lenta não pode segurar a abertura do app.
        signal: AbortSignal.timeout(ROKU_TIMEOUT_MS),
      })
      if (res.ok) {
        const body = await res.json()
        if (body && typeof body === 'object') {
          const endsAt = parseRokuDate(body.expirationDate)
          // Compra que a Roku não reconhece volta com status de falha: não é assinatura.
          const failed = typeof body.status === 'string' && body.status.toLowerCase() !== 'success'
          result = { entitled: body.isEntitled === true && !failed, endsAt }
        }
      }
    } catch (_) {
      result = null
    }
    if (result) cache.set(transactionId, { at: now(), result })
    if (cache.size > 5000) cache.clear()
    return result
  }
}

/**
 * Leva o resultado da Roku para as ativações do aparelho: assinatura ativa estende (ou cria) a ativação desta compra
 * até o fim do período; cancelada ou vencida, revoga. A compra fica em `note` para achar a mesma ativação depois.
 * Devolve 'activated' | 'revoked' | 'limit' | 'unchanged'.
 */
export async function applyRokuPay(db, { deviceKey, transactionId, result, now }) {
  if (!result) return 'unchanged'
  const mine = await db
    .prepare('SELECT id, ends_at FROM activations WHERE device_key = ? AND source = ? AND note = ? AND revoked_at IS NULL')
    .bind(deviceKey, ROKU_SOURCE, transactionId)
    .all()
  const rows = mine.results || []
  if (!result.entitled || !result.endsAt || result.endsAt <= now) {
    for (const row of rows) await db.prepare('UPDATE activations SET revoked_at = ? WHERE id = ?').bind(now, row.id).run()
    return rows.length ? 'revoked' : 'unchanged'
  }
  if (rows.length) {
    for (const row of rows) {
      if (row.ends_at !== result.endsAt) await db.prepare('UPDATE activations SET ends_at = ? WHERE id = ?').bind(result.endsAt, row.id).run()
    }
    return 'activated'
  }
  // Revogada pelo dono no painel (evento 'revoke' no mesmo instante): a Roku não recria. A revogação da própria Roku
  // (cancelada) não grava evento, então uma nova assinatura da mesma compra volta a ativar (auditoria 2026-11-26, item 2).
  const revokedByOwner = await db
    .prepare(
      "SELECT 1 FROM activations a JOIN device_events e ON e.device_key = a.device_key AND e.action = 'revoke' AND e.created_at = a.revoked_at WHERE a.device_key = ? AND a.source = ? AND a.note = ? LIMIT 1",
    )
    .bind(deviceKey, ROKU_SOURCE, transactionId)
    .first()
  if (revokedByOwner) return 'unchanged'
  const others = await db
    .prepare('SELECT COUNT(DISTINCT device_key) AS n FROM activations WHERE source = ? AND note = ? AND revoked_at IS NULL')
    .bind(ROKU_SOURCE, transactionId)
    .first()
  if (others && others.n >= ROKU_MAX_DEVICES) return 'limit'
  await db
    .prepare('INSERT INTO activations (device_key, starts_at, ends_at, source, note, created_by) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(deviceKey, now, result.endsAt, ROKU_SOURCE, transactionId, 'roku')
    .run()
  return 'activated'
}

/**
 * Assina o mesmo texto de /v1/access em RSA PKCS#1 v1.5 + SHA-256 (o que o roRSA da Roku confere). Chave privada RSA em
 * JWK (LICENSE_RSA_KEY); par novo: `node scripts/make-license-keys.mjs --rsa`. null sem chave ou com chave estragada.
 */
export function createRsaSigner(privateJwkText) {
  if (!privateJwkText) return null
  let jwk = null
  try {
    jwk = JSON.parse(cleanJwk(privateJwkText))
  } catch (_) {
    console.warn('[licença] LICENSE_RSA_KEY não é um JWK válido: respostas da Roku sem sigRsa.')
    return null
  }
  let key = null
  return async function signRsa(text) {
    if (!key) {
      key = crypto.subtle.importKey('jwk', jwk, RSA, false, ['sign']).catch((err) => {
        console.warn(`[licença] LICENSE_RSA_KEY recusada pelo Web Crypto (${err && err.message}): respostas sem sigRsa.`)
        return null
      })
    }
    if (!(await key)) return undefined
    const sig = await crypto.subtle.sign(RSA, await key, new TextEncoder().encode(text))
    return toBase64Url(new Uint8Array(sig))
  }
}
