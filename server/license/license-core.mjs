/**
 * Núcleo HTTP do serviço de licença (RFC-018). Web Standards (Request/Response), igual ao server/pair:
 * roda no Node (license-server.mjs) e, depois, no Cloudflare Workers com D1.
 *
 * Do app chegam só deviceKey (hash), platform e o domínio da lista (G3); qualquer outro campo é ignorado.
 * Todos os horários vêm de now() do servidor (G4).
 */
import { generateCode, createLimiter, readJsonBody, networkKey, SECURITY_HEADERS, CORS_HEADERS, CODE_ALPHABET, PAGE_CSP } from '../pair/pair-core.mjs'
import { DAY_MS, TRIAL_MS, accessFor, cycleFor, normalizeHost, licenseSignedText, validNonce } from './license-rules.mjs'
import { createSigner } from './license-sign.mjs'
import { findDevice, insertDevice, activationEndsAt, partnerForHost, upsertEntry, hitLimit } from './license-db.mjs'
import { createAdminRoutes } from './license-admin.mjs'
import { createApiRoutes } from './license-api.mjs'
import { createInboxRoutes, validPub } from './license-inbox.mjs'
import { createCheckoutRoutes, WEBHOOK_PATH } from './license-checkout.mjs'
import { createCustomerRoutes } from './license-customer.mjs'
import { createReportRoutes } from './license-reports.mjs'
import { DEVICE_ANNUAL_PRICE, MIN_CREDITS, CREDIT_TIERS } from './pricing.mjs'

export const DEVICE_CODE_LENGTH = 8
export const MAX_BODY_BYTES = 4096
export const PLATFORMS = ['android', 'tizen', 'webos', 'desktop', 'web']
// newDevicesPerDay (por rede) e newDevicesGlobalPerDay (serviço todo): cortam o ataque de criar aparelhos falsos para
// inflar os ativos de um parceiro.
// newDevicesPerIPv4Day: no Brasil o CGNAT põe milhares de clientes atrás de um IPv4; o /64 do IPv6 é de uma casa só.
// shortcut: 300 por IPv4 é chute; se um provedor grande bater nele, subir (o teto geral de 3000 continua valendo).
export const LIMITS = { hello: 30, access: 60, entry: 60, newDevicesPerDay: 20, newDevicesPerIPv4Day: 300, newDevicesGlobalPerDay: 3000 }
const DEVICE_KEY = /^[A-Za-z0-9_-]{16,128}$/
// Painéis de terceiros chamam a API pelo navegador (RFC-019): a chave vai em Authorization e a operação em Idempotency-Key.
const LICENSE_CORS = { ...CORS_HEADERS, 'Access-Control-Allow-Headers': 'Content-Type, Authorization, Idempotency-Key' }
/** Cabeçalhos de toda resposta do serviço de licença (RFC-025 §6); o pulse-pair segue com os seus. */
export const LICENSE_HEADERS = {
  ...SECURITY_HEADERS,
  'Strict-Transport-Security': 'max-age=31536000',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), usb=()',
}
/** CSP das páginas do site e dos painéis: a fechada do pareamento + imagens do próprio site (favicon). */
export const SITE_CSP = `${PAGE_CSP}; img-src 'self'`
/** Páginas HTML: além dos de cima, isola a janela de quem abriu o site. */
export const PAGE_HEADERS = { ...LICENSE_HEADERS, 'Cross-Origin-Opener-Policy': 'same-origin' }
export const APK_URL = 'https://github.com/eduardoVL123/reprodutor_de_video-/releases/download/v2.0.0/pulse-player.apk'
const PLANS_ROUTE =new RegExp(`^/a/([${CODE_ALPHABET}]{${DEVICE_CODE_LENGTH}})$`)

export function json(status, body, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...LICENSE_HEADERS, ...LICENSE_CORS, ...extra },
  })
}

/** Mesma resposta sem CORS: o painel do dono é da mesma origem e outros sites não devem lê-lo (RFC-025 §5). */
export function privateJson(status, body, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...LICENSE_HEADERS, ...extra },
  })
}

const fail = (status, error, extra) => json(status, { error }, extra)

/**
 * `mp`: cliente do Mercado Pago (mp-client.mjs); null = pagamento desligado (sem MP_ACCESS_TOKEN).
 * `mpWebhookSecret`: assinatura secreta do webhook (MP_WEBHOOK_SECRET); vazio = webhook desligado.
 * `mpPublicKey`: chave pública do Mercado Pago (MP_PUBLIC_KEY), entregue à tela /pagar em /v1/mp-config.
 * `signingKey`: chave privada (JWK) que assina /v1/access (LICENSE_SIGNING_KEY); vazio = respostas sem assinatura.
 */
export function createLicenseHandler({ db, now = Date.now, adminToken = '', reportToken = '', contactUrl = '', playUrl = '', limits = LIMITS, mp = null, mpWebhookSecret = '', mpPublicKey = '', signingKey = '' } = {}) {
  const limiter = createLimiter(now)
  const sign = createSigner(signingKey)
  const handleCheckout = createCheckoutRoutes({ db, now, json, limiter, mp, webhookSecret: mpWebhookSecret })
  const handleAdmin = createAdminRoutes({ db, now, adminToken, json: privateJson, checkout: handleCheckout })
  const handleApi = createApiRoutes({ db, now, json, limiter, checkout: handleCheckout })
  const handleInbox = createInboxRoutes({ db, now, json, limiter })
  const handleCustomer = createCustomerRoutes({ db, now, json, limiter, checkout: handleCheckout })
  const handleReports = createReportRoutes({ db, now, json: privateJson, reportToken })

  /** Aparelho da chave; cria com 7 dias de teste na primeira vez (reinstalar acha o mesmo). */
  async function ensureDevice(deviceKey, platform, ip) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const found = await findDevice(db, deviceKey)
      if (found) return found
      // No banco (não na memória do isolate): o limite vale para o serviço todo e sobrevive a reinícios.
      if (attempt === 0 && (await hitLimit(db, { bucket: 'device', key: ip, limit: ip.includes(':') ? limits.newDevicesPerDay : limits.newDevicesPerIPv4Day, windowMs: DAY_MS, now: now() }))) {
        throw Object.assign(new Error('Muitos aparelhos novos desta rede hoje.'), { status: 429 })
      }
      // Teto do serviço todo (auditoria RFC-025, item 3): muitas redes juntas não inflam os ativos de um parceiro sem
      // limite. shortcut: valor fixo; se o crescimento real chegar perto, subir aqui (ou ler de variável).
      if (attempt === 0 && (await hitLimit(db, { bucket: 'deviceAll', key: '*', limit: limits.newDevicesGlobalPerDay, windowMs: DAY_MS, now: now() }))) {
        console.warn('[licença] teto diário de aparelhos novos atingido: confira se é crescimento real ou ataque')
        throw Object.assign(new Error('Muitos aparelhos novos hoje. Tente de novo mais tarde.'), { status: 429 })
      }
      const at = now()
      const code = generateCode(null, DEVICE_CODE_LENGTH)
      await insertDevice(db, { deviceKey, code, platform, now: at, trialEndsAt: at + TRIAL_MS })
    }
    throw new Error('não foi possível criar o aparelho')
  }

  async function deviceState(body, ip) {
    const device = await ensureDevice(body.deviceKey, PLATFORMS.includes(body.platform) ? body.platform : 'web', ip)
    // RFC-021: a TV publica a chave da caixa de entrada; o site cifra a lista para ela.
    if (validPub(body.pub) && body.pub !== device.inbox_pub) {
      await db.prepare('UPDATE devices SET inbox_pub = ? WHERE device_key = ?').bind(body.pub, device.device_key).run()
    }
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
      const reply = { access: result.access, ...publicState(result, result.at) }
      if (!sign) return json(200, reply)
      const sig = await sign(licenseSignedText({ ...reply, deviceKey: body.deviceKey, host: normalizeHost(body.host) || '', nonce: validNonce(body.nonce) }))
      return json(200, { ...reply, sig })
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

  async function handle(request, rawIp = '') {
    const ip = networkKey(rawIp)
    const url = new URL(request.url)
    if (url.pathname.startsWith('/admin/api/')) {
      return request.method === 'OPTIONS' ? new Response(null, { status: 404, headers: LICENSE_HEADERS }) : handleAdmin(request, url, ip)
    }
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...LICENSE_CORS } })
    if (url.pathname.startsWith('/api/v1/reports/')) return handleReports(request, url, ip)
    if (url.pathname.startsWith('/api/v1/')) return handleApi(request, url, ip)
    if (url.pathname.startsWith('/v1/inbox')) return handleInbox(request, url, ip)
    const customer = await handleCustomer(request, url, ip)
    if (customer) return customer
    if (url.pathname === '/v1/checkout' || url.pathname.startsWith('/v1/checkout/') || url.pathname === WEBHOOK_PATH) {
      return handleCheckout(request, url, ip)
    }
    // Endereço curto para o app Downloader da TV: digitar <site>/apk em vez do link do GitHub (que mostrava o
    // nome do usuário do GitHub na tela). Leva ao APK assinado da release fixa.
    if (request.method === 'GET' && url.pathname === '/apk') {
      return new Response(null, { status: 302, headers: { ...LICENSE_HEADERS, Location: APK_URL, 'Cache-Control': 'no-store' } })
    }
    // RFC-021: o QR da tela de ativação abre a aba Assinar do site com o código preenchido.
    const plans = request.method === 'GET' && url.pathname.match(PLANS_ROUTE)
    if (plans) return new Response(null, { status: 302, headers: { ...LICENSE_HEADERS, Location: `/assinar?codigo=${plans[1]}` } })
    if (request.method === 'GET' && url.pathname === '/v1/site-config') {
      return json(200, { payments: !!mp, contactUrl, playUrl, devicePriceCents: DEVICE_ANNUAL_PRICE, minCredits: MIN_CREDITS, creditTiers: CREDIT_TIERS })
    }
    // RFC-020: chave pública do cartão só para a tela /pagar; sem ela o cartão fica indisponível (o Pix continua).
    if (request.method === 'GET' && url.pathname === '/v1/mp-config') {
      const noStore = { 'Cache-Control': 'no-store, max-age=0' }
      if (!mpPublicKey) return json(503, { error: 'Pagamento com cartão indisponível: defina MP_PUBLIC_KEY no servidor.' }, noStore)
      return json(200, { publicKey: mpPublicKey }, noStore)
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
  }
  return handle
}
