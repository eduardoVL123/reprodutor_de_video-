/**
 * API pública dos revendedores e painéis de terceiros (RFC-019 §4): `Authorization: Bearer <chave do revendedor>`.
 * Todo acesso é filtrado pelo revendedor dono da chave (G12). Documentação: server/license/API.md.
 */
import { readJsonBody } from '../pair/pair-core.mjs'
import { findDeviceByCode, activationEndsAt } from './license-db.mjs'
import {
  findResellerByKey,
  publicReseller,
  activateDevice,
  movements,
  createReseller,
  rotateKey,
  transferCredits,
  ResellerError,
} from './license-resellers.mjs'

const MAX_BODY = 4096
const PAGE = 50
const CODE = /^[A-Z0-9]{4,16}$/

const before = (url) => Number(url.searchParams.get('before')) || null

function requireIdempotency(key) {
  if (!key) throw new ResellerError(400, 'Envie o cabeçalho Idempotency-Key (um valor novo por operação).')
  return key
}

/** Revenda direta de quem chama (R3: cada um só mexe nas suas). */
async function directChild(db, parentId, id) {
  const child = await db.prepare('SELECT * FROM resellers WHERE id = ? AND parent_id = ?').bind(id, parentId).first()
  if (!child) throw new ResellerError(404, 'Revenda não encontrada entre as suas.')
  return child
}

async function resellerActivations(db, resellerId, cursor) {
  const sql = `SELECT a.id, a.starts_at, a.ends_at, a.revoked_at, d.code FROM activations a JOIN devices d ON d.device_key = a.device_key
               WHERE a.reseller_id = ? ${cursor ? 'AND a.id < ?' : ''} ORDER BY a.id DESC LIMIT ?`
  const rows = cursor ? await db.prepare(sql).bind(resellerId, cursor, PAGE).all() : await db.prepare(sql).bind(resellerId, PAGE).all()
  return rows.results.map((a) => ({ id: a.id, code: a.code, startsAt: a.starts_at, endsAt: a.ends_at, revokedAt: a.revoked_at ?? null }))
}

/** `checkout`: rotas de pagamento (license-checkout.mjs), para a compra de créditos pelo painel (RFC-020). */
export function createApiRoutes({ db, now, json, limiter, checkout, limitPerMinute = 120 }) {
  const routes = [
    ['GET', /^\/api\/v1\/me$/, async ({ reseller }) => json(200, publicReseller(reseller))],
    [
      'GET',
      /^\/api\/v1\/devices\/([A-Za-z0-9]{4,16})$/,
      async ({ match }) => {
        const device = await findDeviceByCode(db, match[1].toUpperCase())
        if (!device) throw new ResellerError(404, 'Código não encontrado. Abra o Pulse Player na TV uma vez e tente de novo.')
        return json(200, { code: device.code, platform: device.platform, activationEndsAt: await activationEndsAt(db, device.device_key), suspended: !!device.blocked_at })
      },
    ],
    [
      'POST',
      /^\/api\/v1\/activations$/,
      async ({ reseller, body, idempotencyKey, now: at }) => {
        const code = String(body.code || '').trim().toUpperCase()
        if (!CODE.test(code)) throw new ResellerError(400, 'Código do aparelho inválido.')
        return json(200, await activateDevice(db, { reseller, code, idempotencyKey: requireIdempotency(idempotencyKey), now: at }))
      },
    ],
    ['GET', /^\/api\/v1\/activations$/, async ({ reseller, url }) => json(200, await resellerActivations(db, reseller.id, before(url)))],
    ['GET', /^\/api\/v1\/movements$/, async ({ reseller, url }) => json(200, await movements(db, reseller.id, { before: before(url) }))],
    ['POST', /^\/api\/v1\/me\/key$/, async ({ reseller }) => json(200, { key: await rotateKey(db, reseller.id) })],
    ['POST', /^\/api\/v1\/credits\/checkout$/, async ({ reseller, body }) => json(201, await checkout.startForReseller(reseller, body))],
    [
      'GET',
      /^\/api\/v1\/sub-resellers$/,
      async ({ reseller }) =>
        json(200, (await db.prepare('SELECT * FROM resellers WHERE parent_id = ? ORDER BY name').bind(reseller.id).all()).results.map(publicReseller)),
    ],
    [
      'POST',
      /^\/api\/v1\/sub-resellers$/,
      async ({ reseller, body, now: at }) => json(201, await createReseller(db, { name: body.name, contact: body.contact, parentId: reseller.id, now: at })),
    ],
    [
      'POST',
      /^\/api\/v1\/sub-resellers\/(\d+)\/credits$/,
      async ({ reseller, match, body, idempotencyKey, now: at }) =>
        json(200, await transferCredits(db, { from: reseller, toId: Number(match[1]), amount: body.amount, idempotencyKey: requireIdempotency(idempotencyKey), now: at })),
    ],
    [
      'POST',
      /^\/api\/v1\/sub-resellers\/(\d+)\/key$/,
      async ({ reseller, match }) => json(200, { key: await rotateKey(db, (await directChild(db, reseller.id, Number(match[1]))).id) }),
    ],
  ]

  return async function handleApi(request, url) {
    const auth = request.headers.get('Authorization') || ''
    const reseller = auth.startsWith('Bearer ') ? await findResellerByKey(db, auth.slice(7).trim()) : null
    if (!reseller) return json(401, { error: 'Chave inválida.' })
    if (!reseller.active) return json(403, { error: 'Revenda bloqueada. Fale com quem forneceu a sua chave.' })
    const wait = limiter.retryAfter('api', `r${reseller.id}`, limitPerMinute)
    if (wait) return json(429, { error: 'Muitas chamadas. Aguarde um pouco.' }, { 'Retry-After': String(wait) })
    limiter.add('api', `r${reseller.id}`)

    for (const [method, pattern, run] of routes) {
      const match = request.method === method && url.pathname.match(pattern)
      if (!match) continue
      try {
        const body = method === 'GET' ? {} : await readJsonBody(request, MAX_BODY)
        return await run({ reseller, match, body, url, idempotencyKey: (request.headers.get('Idempotency-Key') || '').slice(0, 64), now: now() })
      } catch (err) {
        return json(err.status || 500, { error: err.status ? err.message : 'Erro interno.' })
      }
    }
    return json(404, { error: 'Não encontrado.' })
  }
}
