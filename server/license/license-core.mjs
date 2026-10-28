/**
 * Núcleo HTTP do serviço de licença (RFC-018). Web Standards (Request/Response), igual ao server/pair:
 * roda no Node (license-server.mjs) e, depois, no Cloudflare Workers com D1.
 *
 * Do app chegam só deviceKey (hash), platform e o domínio da lista (G3); qualquer outro campo é ignorado.
 * Todos os horários vêm de now() do servidor (G4).
 */
import { generateCode, createLimiter, readJsonBody, SECURITY_HEADERS, CORS_HEADERS, CODE_ALPHABET, PAGE_CSP } from '../pair/pair-core.mjs'
import { DAY_MS, TRIAL_MS, accessFor, cycleFor, normalizeHost } from './license-rules.mjs'
import { findDevice, findDeviceByCode, insertDevice, activationEndsAt, partnerForHost, upsertEntry } from './license-db.mjs'
import { createAdminRoutes } from './license-admin.mjs'
import { createApiRoutes } from './license-api.mjs'
import { plansPage, PLANS_CSS, NOT_FOUND_PAGE } from './license-pages.mjs'

export const DEVICE_CODE_LENGTH = 8
export const MAX_BODY_BYTES = 4096
export const PLATFORMS = ['android', 'tizen', 'webos', 'web']
// newDevicesPerDay: corta o ataque barato de criar aparelhos falsos para inflar os ativos de um parceiro.
export const LIMITS = { hello: 30, access: 60, entry: 60, newDevicesPerDay: 20 }
const DEVICE_KEY = /^[A-Za-z0-9_-]{16,128}$/
// Painéis de terceiros chamam a API pelo navegador (RFC-019): a chave vai em Authorization e a operação em Idempotency-Key.
const LICENSE_CORS = { ...CORS_HEADERS, 'Access-Control-Allow-Headers': 'Content-Type, Authorization, Idempotency-Key' }
const PLANS_ROUTE = new RegExp(`^/a/([${CODE_ALPHABET}]{${DEVICE_CODE_LENGTH}})$`)

export function json(status, body, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...SECURITY_HEADERS, ...LICENSE_CORS, ...extra },
  })
}

const fail = (status, error, extra) => json(status, { error }, extra)

function page(status, body, type = 'text/html; charset=utf-8') {
  return new Response(body, { status, headers: { 'Content-Type': type, ...SECURITY_HEADERS, 'Content-Security-Policy': PAGE_CSP } })
}

export function createLicenseHandler({ db, now = Date.now, adminToken = '', contactUrl = '', limits = LIMITS } = {}) {
  const limiter = createLimiter(now)
  const dailyLimiter = createLimiter(now, DAY_MS)
  const handleAdmin = createAdminRoutes({ db, now, adminToken, json })
  const handleApi = createApiRoutes({ db, now, json, limiter })

  /** Aparelho da chave; cria com 7 dias de teste na primeira vez (reinstalar acha o mesmo). */
  async function ensureDevice(deviceKey, platform, ip) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const found = await findDevice(db, deviceKey)
      if (found) return found
      if (attempt === 0) {
        if (dailyLimiter.retryAfter('device', ip, limits.newDevicesPerDay)) {
          throw Object.assign(new Error('Muitos aparelhos novos desta rede hoje.'), { status: 429 })
        }
        dailyLimiter.add('device', ip)
      }
      const at = now()
      const code = generateCode(null, DEVICE_CODE_LENGTH)
      await insertDevice(db, { deviceKey, code, platform, now: at, trialEndsAt: at + TRIAL_MS })
    }
    throw new Error('não foi possível criar o aparelho')
  }

  async function deviceState(body, ip) {
    const device = await ensureDevice(body.deviceKey, PLATFORMS.includes(body.platform) ? body.platform : 'web', ip)
    return { device, activationEnd: await activationEndsAt(db, device.device_key) }
  }

  /** Parceiro ativo, já começado, do domínio da lista (null se não houver). */
  async function partnerOf(host, at) {
    const name = normalizeHost(host)
    const partner = name ? await partnerForHost(db, name) : null
    if (!partner || !partner.active) return null
    const cycle = cycleFor(partner.started_on, at)
    return cycle ? { id: partner.id, cycle } : null
  }

  async function access(body, ip) {
    const at = now()
    const { device, activationEnd } = await deviceState(body, ip)
    const partner = await partnerOf(body.host, at)
    const result = accessFor({ trialEndsAt: device.trial_ends_at, activationEndsAt: activationEnd, isPartner: !!partner, now: at, blockedAt: device.blocked_at })
    return { at, device, activationEnd, partner, access: result }
  }

  function publicState({ device, activationEnd }, at) {
    return { code: device.code, trialEndsAt: device.trial_ends_at, activationEndsAt: activationEnd, serverTime: at }
  }

  const routes = {
    '/v1/hello': async (body, ip) => {
      const state = await deviceState(body, ip)
      return json(200, publicState(state, now()))
    },
    '/v1/access': async (body, ip) => {
      const result = await access(body, ip)
      return json(200, { access: result.access, ...publicState(result, result.at) })
    },
    '/v1/entry': async (body, ip) => {
      const result = await access(body, ip)
      if (result.access !== 'partner') return json(200, { recorded: false })
      await upsertEntry(db, {
        deviceKey: result.device.device_key,
        partnerId: result.partner.id,
        cycleStart: result.partner.cycle.start,
        at: result.at,
      })
      return json(200, { recorded: true })
    },
  }

  async function handle(request, ip = '') {
    const url = new URL(request.url)
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...LICENSE_CORS } })
    if (url.pathname.startsWith('/admin/api/')) return handleAdmin(request, url)
    if (url.pathname.startsWith('/api/v1/')) return handleApi(request, url)
    if (request.method === 'GET' && url.pathname === '/a/plans.css') return page(200, PLANS_CSS, 'text/css; charset=utf-8')
    const plans = request.method === 'GET' && url.pathname.match(PLANS_ROUTE)
    if (plans) {
      const device = await findDeviceByCode(db, plans[1])
      return device ? page(200, plansPage(device.code, contactUrl)) : page(404, NOT_FOUND_PAGE)
    }
    const route = request.method === 'POST' && routes[url.pathname]
    if (!route) return fail(404, 'Não encontrado.')
    const bucket = url.pathname.slice(4)
    const wait = limiter.retryAfter(bucket, ip, limits[bucket])
    if (wait) return fail(429, 'Muitas tentativas. Aguarde um pouco.', { 'Retry-After': String(wait) })
    limiter.add(bucket, ip)

    let body
    try {
      body = await readJsonBody(request, MAX_BODY_BYTES)
    } catch (err) {
      return fail(err.status || 400, err.message)
    }
    if (typeof body.deviceKey !== 'string' || !DEVICE_KEY.test(body.deviceKey)) return fail(400, 'Aparelho inválido.')
    try {
      return await route(body, ip)
    } catch (err) {
      if (err.status) return fail(err.status, err.message)
      throw err
    }
  }

  // O servidor chama de tempos em tempos (como o pareamento): sem isso os contadores por IP só crescem.
  handle.sweep = () => {
    limiter.sweep()
    dailyLimiter.sweep()
  }
  return handle
}
