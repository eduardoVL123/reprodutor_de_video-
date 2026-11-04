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
import { PAGE_CSP } from '../pair/pair-core.mjs'
import { createLicenseHandler, LICENSE_HEADERS, PAGE_HEADERS } from './license-core.mjs'
import { migrate, purgeExpired } from './license-db.mjs'
import { createMpClient } from './mp-client.mjs'
import { PAY_CSP } from './license-checkout.mjs'
import { createAccessVerifier } from './license-access.mjs'

const STATIC_FILES = new Set(['/revenda/', '/revenda/revenda.js', '/revenda/revenda.css', '/site/site.js', '/site/site.css', '/site/pair-lib.js', '/site/pagar.js'])
// Painel do dono (RFC-025 §5): só com o Cloudflare Access conferido.
const OWNER_FILES = new Set(['/admin/', '/admin/admin.js', '/admin/admin.css'])
// Páginas do site (RFC-021/025) -> caminho canônico nos assets (o Workers serve /x.html como /x e index.html como /).
const SITE_PAGES = { '/': '/site/', '/enviar': '/site/enviar', '/cliente': '/site/cliente', '/assinar': '/site/assinar', '/creditos': '/site/creditos', '/pagar': '/site/pagar' }
const TYPES = { js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8' }
const SWEEP_EVERY_MS = 60 * 1000

let handle = null
let ready = null
let lastSweep = 0
let verifyOwner = null

function withHeaders(res, type, csp = PAGE_CSP) {
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
  if (!verifyOwner) verifyOwner = createAccessVerifier({ team: env.ACCESS_TEAM, aud: env.ACCESS_AUD, ownerEmail: env.ACCESS_OWNER_EMAIL })
  return (await verifyOwner(request.headers.get('Cf-Access-Jwt-Assertion'))) ? null : notFound()
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
      const csp = url.pathname === '/pagar' ? PAY_CSP : PAGE_CSP
      return withHeaders(await env.ASSETS.fetch(new Request(new URL(SITE_PAGES[url.pathname], url).toString())), 'text/html; charset=utf-8', csp)
    }
    if (request.method === 'GET' && (STATIC_FILES.has(url.pathname) || OWNER_FILES.has(url.pathname))) {
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
      if (env.LICENSE_ADMIN_TOKEN && env.LICENSE_ADMIN_TOKEN.length < 32) {
        console.warn('[licença] LICENSE_ADMIN_TOKEN curto: use 32+ caracteres aleatórios (README, "Painel do dono").')
      }
      handle = createLicenseHandler({
        db: env.DB,
        adminToken: env.LICENSE_ADMIN_TOKEN || '',
        reportToken: env.LICENSE_REPORT_TOKEN || '',
        contactUrl: env.LICENSE_CONTACT_URL || '',
        playUrl: env.PLAY_URL || '',
        mp,
        mpWebhookSecret: env.MP_WEBHOOK_SECRET || '',
        mpPublicKey: env.MP_PUBLIC_KEY || '',
        signingKey: env.LICENSE_SIGNING_KEY || '',
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
