/**
 * Serviço de licença no Cloudflare Workers (RFC-018): o mesmo núcleo do servidor Node, com o banco D1 (binding DB)
 * no lugar do node:sqlite. Segredos (`wrangler secret put`): LICENSE_ADMIN_TOKEN, LICENSE_SIGNING_KEY (assina o
 * acesso), MP_ACCESS_TOKEN e MP_WEBHOOK_SECRET (RFC-020; vazios = pagamento/webhook desligados), ACCESS_AUD e
 * ACCESS_OWNER_EMAIL (RFC-025: Cloudflare Access do painel do dono) e LICENSE_REPORT_TOKEN (leitura do sócio).
 * Variáveis: LICENSE_CONTACT_URL, MP_PUBLIC_KEY (cartão em /pagar), ACCESS_TEAM e PLAY_URL (link da Google Play).
 * O cron diário apaga o que passou dos 24 meses (PRIVACY.md).
 * Limites: os que protegem dinheiro e o painel (novos aparelhos, checkout, token errado) ficam no D1 (rate_limits);
 * os de volume por minuto ficam na memória de cada isolate (um atacante espalhado por vários isolates passa um pouco).
 */
import { createLicenseHandler, LICENSE_HEADERS, PAGE_HEADERS, SITE_CSP } from './license-core.mjs'
import { migrate, purgeExpired } from './license-db.mjs'
import { createMpClient } from './mp-client.mjs'
import { PAY_CSP } from './license-checkout.mjs'
import { createAccessVerifier } from './license-access.mjs'

const STATIC_FILES = new Set(['/revenda/', '/revenda/revenda.js', '/revenda/revenda.css', '/site/site.js', '/site/site.css', '/site/pair-lib.js', '/site/pagar.js', '/site/favicon.svg'])
// Painel do dono (RFC-025 §5): só com o Cloudflare Access conferido.
const OWNER_FILES = new Set(['/admin/', '/admin/admin.js', '/admin/admin.css'])
// Páginas do site (RFC-021/025) -> caminho canônico nos assets (o Workers serve /x.html como /x e index.html como /).
const SITE_PAGES = { '/': '/site/', '/enviar': '/site/enviar', '/cliente': '/site/cliente', '/assinar': '/site/assinar', '/creditos': '/site/creditos', '/pagar': '/site/pagar', '/privacidade': '/site/privacidade' }
const TYPES = { js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', svg: 'image/svg+xml' }
const SWEEP_EVERY_MS = 60 * 1000

let handle = null
let migrated = false
let lastSweep = 0
let verifyOwner = null

function withHeaders(res, type, csp = SITE_CSP) {
  const headers = new Headers(res.headers)
  const html = type.startsWith('text/html')
  for (const [k, v] of Object.entries(html ? PAGE_HEADERS : LICENSE_HEADERS)) headers.set(k, v)
  headers.set('Content-Type', type)
  if (html) headers.set('Content-Security-Policy', csp)
  return new Response(res.body, { status: res.status, headers })
}

const notFound = () => new Response(JSON.stringify({ error: 'Não encontrado.' }), { status: 404, headers: { ...LICENSE_HEADERS, 'Content-Type': 'application/json; charset=utf-8' } })

/** Painel do dono: 503 sem o Access configurado; 404 para quem não passou pelo Access com o e-mail do dono. */
async function ownerGate(request, env) {
  if (!env.ACCESS_AUD || !env.ACCESS_TEAM || !env.ACCESS_OWNER_EMAIL) {
    return new Response(JSON.stringify({ error: 'Painel desligado: configure o Cloudflare Access (RFC-025 §5).' }), {
      status: 503,
      headers: { ...LICENSE_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
    })
  }
  if (!verifyOwner) {
    verifyOwner = createAccessVerifier({
      team: env.ACCESS_TEAM,
      aud: env.ACCESS_AUD,
      ownerEmail: env.ACCESS_OWNER_EMAIL,
      // Visível em `wrangler tail`: diz por que o painel recusou (sem mostrar segredos).
      onReject: (reason) => console.warn(`[painel] Access recusado: ${reason}`),
    })
  }
  return (await verifyOwner(request.headers.get('Cf-Access-Jwt-Assertion'))) ? null : notFound()
}

/** Monta o servidor com os segredos e variáveis do Worker (fetch e rotina periódica). */
function buildHandle(env) {
  // Segredos colados no terminal podem vir com BOM/espaço/quebra de linha (o BOM na LICENSE_SIGNING_KEY derrubou o
  // /v1/access em 2026-11-04): limpa todos ao ler.
  // \u0000 = UTF-16 do pipe do PowerShell; \uFEFF/\uFFFD/\uFFFE = BOM e o lixo que ele vira.
  // eslint-disable-next-line no-control-regex -- o byte nulo é justamente o que precisa sair
  const v = (name) => String(env[name] || '').replace(/[\u0000\uFEFF\uFFFD\uFFFE]/g, '').trim()
  const mp = v('MP_ACCESS_TOKEN') ? createMpClient({ accessToken: v('MP_ACCESS_TOKEN') }) : null
  if (v('LICENSE_ADMIN_TOKEN') && v('LICENSE_ADMIN_TOKEN').length < 32) {
    console.warn('[licença] LICENSE_ADMIN_TOKEN curto: use 32+ caracteres aleatórios (README, "Painel do dono").')
  }
  return createLicenseHandler({
    db: env.DB,
    adminToken: v('LICENSE_ADMIN_TOKEN'),
    reportToken: v('LICENSE_REPORT_TOKEN'),
    contactUrl: v('LICENSE_CONTACT_URL'),
    playUrl: v('PLAY_URL'),
    mp,
    mpWebhookSecret: v('MP_WEBHOOK_SECRET'),
    mpPublicKey: v('MP_PUBLIC_KEY'),
    signingKey: v('LICENSE_SIGNING_KEY'),
  })
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname === '/healthz') return new Response('ok', { headers: { ...LICENSE_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' } })
    if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) {
      const blocked = await ownerGate(request, env)
      if (blocked) return blocked
    }
    if (url.pathname === '/admin' || url.pathname === '/revenda') return Response.redirect(new URL(`${url.pathname}/`, url).toString(), 301)
    // Links antigos de "enviar lista" (app e TVs já instalados): /?codigo=X agora é /enviar?codigo=X.
    if (request.method === 'GET' && url.pathname === '/' && url.searchParams.has('codigo')) {
      return new Response(null, { status: 302, headers: { ...LICENSE_HEADERS, Location: `/enviar${url.search}` } })
    }
    if (request.method === 'GET' && SITE_PAGES[url.pathname]) {
      const csp = url.pathname === '/pagar' ? PAY_CSP : SITE_CSP
      return withHeaders(await env.ASSETS.fetch(new Request(new URL(SITE_PAGES[url.pathname], url).toString())), 'text/html; charset=utf-8', csp)
    }
    if (request.method === 'GET' && (STATIC_FILES.has(url.pathname) || OWNER_FILES.has(url.pathname))) {
      const res = await env.ASSETS.fetch(new Request(new URL(url.pathname, url).toString()))
      return withHeaders(res, TYPES[url.pathname.split('.').pop()] || 'text/html; charset=utf-8')
    }

    // CREATE TABLE IF NOT EXISTS até dar certo uma vez no isolate. Cada pedido espera a sua própria migração: uma
    // promessa compartilhada nascida num pedido que foi cancelado nunca termina no Workers e travava todos os
    // pedidos seguintes do isolate (visto em produção em 2026-11-04). Rodar duas juntas é seguro (IF NOT EXISTS).
    if (!migrated) {
      await migrate(env.DB)
      migrated = true
    }
    if (!handle) handle = buildHandle(env)
    if (Date.now() - lastSweep > SWEEP_EVERY_MS) {
      lastSweep = Date.now()
      handle.sweep()
    }
    return handle(request, request.headers.get('CF-Connecting-IP') || '0.0.0.0')
  },

  // De hora em hora (wrangler.jsonc): limpeza da guarda de 24 meses, estornos sem webhook e pedido pago parado.
  async scheduled(_event, env) {
    await migrate(env.DB)
    await purgeExpired(env.DB, Date.now())
    if (!handle) handle = buildHandle(env)
    await handle.recheckRefunds()
    await handle.warnStuckOrders()
  },
}
