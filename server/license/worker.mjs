/**
 * Serviço de licença no Cloudflare Workers (RFC-018): o mesmo núcleo do servidor Node, com o banco D1 (binding DB)
 * no lugar do node:sqlite. Segredos (`wrangler secret put`): LICENSE_ADMIN_TOKEN, MP_ACCESS_TOKEN e MP_WEBHOOK_SECRET
 * (RFC-020; vazios = pagamento/webhook desligados). Variáveis: LICENSE_CONTACT_URL e MP_PUBLIC_KEY (cartão em /pagar).
 * O cron diário apaga o que passou dos 24 meses (PRIVACY.md).
 * shortcut: os limites por IP ficam na memória de cada isolate do Worker (um atacante espalhado por vários isolates
 * passa um pouco do limite); mover para um Durable Object, como o pareamento, se aparecer abuso no painel.
 */
import { SECURITY_HEADERS, PAGE_CSP } from '../pair/pair-core.mjs'
import { createLicenseHandler } from './license-core.mjs'
import { migrate, purgeExpired } from './license-db.mjs'
import { createMpClient } from './mp-client.mjs'
import { PAY_CSP } from './license-checkout.mjs'

const ADMIN_PAGES = new Set(['/admin/', '/admin/admin.js', '/admin/admin.css', '/revenda/', '/revenda/revenda.js', '/revenda/revenda.css', '/site/site.js', '/site/site.css', '/site/pair-lib.js', '/site/pagar.js'])
// Páginas do site (RFC-021) -> caminho canônico nos assets (o Workers serve /x.html como /x e index.html como /).
const SITE_PAGES = { '/': '/site/', '/assinar': '/site/assinar', '/creditos': '/site/creditos', '/pagar': '/site/pagar' }
const TYPES = { js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8' }
const SWEEP_EVERY_MS = 60 * 1000

let handle = null
let ready = null
let lastSweep = 0

function withHeaders(res, type, csp = PAGE_CSP) {
  const headers = new Headers(res.headers)
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v)
  headers.set('Content-Type', type)
  if (type.startsWith('text/html')) headers.set('Content-Security-Policy', csp)
  return new Response(res.body, { status: res.status, headers })
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname === '/healthz') return new Response('ok', { headers: { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' } })
    if (url.pathname === '/admin' || url.pathname === '/revenda') return Response.redirect(new URL(`${url.pathname}/`, url).toString(), 301)
    if (request.method === 'GET' && SITE_PAGES[url.pathname]) {
      const csp = url.pathname === '/pagar' ? PAY_CSP : PAGE_CSP
      return withHeaders(await env.ASSETS.fetch(new Request(new URL(SITE_PAGES[url.pathname], url).toString())), 'text/html; charset=utf-8', csp)
    }
    if (request.method === 'GET' && ADMIN_PAGES.has(url.pathname)) {
      const res = await env.ASSETS.fetch(new Request(new URL(url.pathname, url).toString()))
      return withHeaders(res, TYPES[url.pathname.split('.').pop()] || 'text/html; charset=utf-8')
    }

    if (!ready) {
      // CREATE TABLE IF NOT EXISTS: uma vez por isolate; se falhar, a próxima chamada tenta de novo
      ready = migrate(env.DB).catch((err) => {
        ready = null
        throw err
      })
    }
    await ready
    if (!handle) {
      const mp = env.MP_ACCESS_TOKEN ? createMpClient({ accessToken: env.MP_ACCESS_TOKEN }) : null
      handle = createLicenseHandler({
        db: env.DB,
        adminToken: env.LICENSE_ADMIN_TOKEN || '',
        contactUrl: env.LICENSE_CONTACT_URL || '',
        mp,
        mpWebhookSecret: env.MP_WEBHOOK_SECRET || '',
        mpPublicKey: env.MP_PUBLIC_KEY || '',
      })
    }
    if (Date.now() - lastSweep > SWEEP_EVERY_MS) {
      lastSweep = Date.now()
      handle.sweep()
    }
    return handle(request, request.headers.get('CF-Connecting-IP') || '0.0.0.0')
  },

  async scheduled(_event, env) {
    await migrate(env.DB)
    await purgeExpired(env.DB, Date.now())
  },
}
