/**
 * Servidor de licença local (RFC-018): node:http + node:sqlite. Converte a requisição para Web Standards e
 * delega ao núcleo license-core.mjs; serve as páginas do painel em /admin/.
 * Variáveis: LICENSE_PORT (8789), LICENSE_HOST (127.0.0.1), LICENSE_DB_PATH, LICENSE_ADMIN_TOKEN, LICENSE_CONTACT_URL,
 * LICENSE_REPORT_TOKEN (leitura do sócio), PLAY_URL (RFC-025), MP_ACCESS_TOKEN e MP_WEBHOOK_SECRET (RFC-020; vazios = pagamento/webhook desligados), MP_PUBLIC_KEY (cartão em /pagar).
 */
import http from 'node:http'
import { Readable } from 'node:stream'
import { readFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { openSqlite } from './sqlite-d1.mjs'
import { migrate, purgeExpired } from './license-db.mjs'
import { createLicenseHandler, LICENSE_HEADERS, PAGE_HEADERS, SITE_CSP } from './license-core.mjs'
import { createMpClient } from './mp-client.mjs'
import { PAY_CSP } from './license-checkout.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PUBLIC_DIR = join(HERE, 'public')
const PURGE_EVERY_MS = 24 * 3600 * 1000 // guarda de 24 meses (PRIVACY.md): limpa ao subir e uma vez por dia
const ADMIN_FILES = {
  '/admin/': { file: 'admin/index.html', type: 'text/html; charset=utf-8' },
  '/admin/admin.js': { file: 'admin/admin.js', type: 'text/javascript; charset=utf-8' },
  '/admin/admin.css': { file: 'admin/admin.css', type: 'text/css; charset=utf-8' },
  // Painel do revendedor (RFC-022)
  '/revenda/': { file: 'revenda/index.html', type: 'text/html; charset=utf-8' },
  '/revenda/revenda.js': { file: 'revenda/revenda.js', type: 'text/javascript; charset=utf-8' },
  '/revenda/revenda.css': { file: 'revenda/revenda.css', type: 'text/css; charset=utf-8' },
  // Site (RFC-021)
  '/': { file: 'site/index.html', type: 'text/html; charset=utf-8' },
  // RFC-025: enviar lista saiu da raiz (agora a landing) e a área do cliente
  '/enviar': { file: 'site/enviar.html', type: 'text/html; charset=utf-8' },
  '/cliente': { file: 'site/cliente.html', type: 'text/html; charset=utf-8' },
  '/privacidade': { file: 'site/privacidade.html', type: 'text/html; charset=utf-8' },
  '/site/favicon.svg': { file: 'site/favicon.svg', type: 'image/svg+xml' },
  '/assinar': { file: 'site/assinar.html', type: 'text/html; charset=utf-8' },
  '/creditos': { file: 'site/creditos.html', type: 'text/html; charset=utf-8' },
  '/site/site.js': { file: 'site/site.js', type: 'text/javascript; charset=utf-8' },
  '/site/site.css': { file: 'site/site.css', type: 'text/css; charset=utf-8' },
  '/site/pair-lib.js': { file: 'site/pair-lib.js', type: 'text/javascript; charset=utf-8' },
  // Pagamento (RFC-020), com a CSP própria
  '/pagar': { file: 'site/pagar.html', type: 'text/html; charset=utf-8', csp: PAY_CSP },
  '/site/pagar.js': { file: 'site/pagar.js', type: 'text/javascript; charset=utf-8' },
}

function toWebRequest(req) {
  const headers = new Headers()
  for (const [k, v] of Object.entries(req.headers)) {
    if (Array.isArray(v)) v.forEach((item) => headers.append(k, item))
    else if (v !== undefined) headers.set(k, v)
  }
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD'
  return new Request(new URL(req.url, 'http://localhost').toString(), {
    method: req.method,
    headers,
    body: hasBody ? Readable.toWeb(req) : undefined,
    duplex: hasBody ? 'half' : undefined,
  })
}

async function sendWeb(res, webRes) {
  res.writeHead(webRes.status, Object.fromEntries(webRes.headers.entries()))
  res.end(webRes.body ? Buffer.from(await webRes.arrayBuffer()) : undefined)
}

export function createLicenseServer({ dbPath, adminToken = '', reportToken = '', contactUrl = '', playUrl = '', now = Date.now, publicDir = PUBLIC_DIR, mp = null, mpWebhookSecret = '', mpPublicKey = '', signingKey = '' } = {}) {
  const db = openSqlite(dbPath)
  const purge = () => purgeExpired(db, now()).catch((err) => console.warn('[license] Limpeza falhou:', err && err.message))
  const ready = migrate(db).then(purge)
  setInterval(purge, PURGE_EVERY_MS).unref()
  const handle = createLicenseHandler({ db, now, adminToken, reportToken, contactUrl, playUrl, mp, mpWebhookSecret, mpPublicKey, signingKey })
  setInterval(handle.sweep, 60 * 1000).unref()
  // Como o cron do Worker: estorno cujo webhook se perdeu.
  setInterval(() => handle.recheckRefunds().catch((err) => console.warn('[license] Conferência de estornos falhou:', err && err.message)), 3600 * 1000).unref()

  async function route(req, res) {
    await ready
    const reqUrl = new URL(req.url, 'http://localhost')
    const path = reqUrl.pathname
    if (path === '/healthz') {
      res.writeHead(200, { ...LICENSE_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' })
      return res.end('ok')
    }
    // Links antigos de "enviar lista": /?codigo=X agora é /enviar?codigo=X (RFC-025).
    if (req.method === 'GET' && path === '/' && reqUrl.searchParams.has('codigo')) {
      res.writeHead(302, { ...LICENSE_HEADERS, Location: `/enviar${reqUrl.search}` })
      return res.end()
    }
    const page = req.method === 'GET' && ADMIN_FILES[path === '/admin' || path === '/revenda' ? `${path}/` : path]
    if (page) {
      const content = readFileSync(join(publicDir, page.file)) // antes do writeHead: arquivo faltando vira 500, não resposta pendurada
      const html = page.type.startsWith('text/html')
      res.writeHead(200, { ...(html ? PAGE_HEADERS : LICENSE_HEADERS), 'Content-Type': page.type, 'Content-Security-Policy': page.csp || SITE_CSP })
      return res.end(content)
    }
    return sendWeb(res, await handle(toWebRequest(req), (req.socket && req.socket.remoteAddress) || 'unknown'))
  }

  return http.createServer((req, res) => {
    route(req, res).catch(() => {
      if (res.writableEnded) return
      res.writeHead(500, { ...LICENSE_HEADERS, 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ error: 'Erro interno.' }))
    })
  })
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const dbPath = process.env.LICENSE_DB_PATH || join(HERE, '.data', 'license.db')
  mkdirSync(dirname(dbPath), { recursive: true })
  const port = Number(process.env.LICENSE_PORT) || 8789
  const host = process.env.LICENSE_HOST || '127.0.0.1'
  const adminToken = process.env.LICENSE_ADMIN_TOKEN || ''
  const mp = process.env.MP_ACCESS_TOKEN ? createMpClient({ accessToken: process.env.MP_ACCESS_TOKEN }) : null
  const mpWebhookSecret = process.env.MP_WEBHOOK_SECRET || ''
  const mpPublicKey = process.env.MP_PUBLIC_KEY || ''
  const signingKey = process.env.LICENSE_SIGNING_KEY || ''
  createLicenseServer({ dbPath, adminToken, reportToken: process.env.LICENSE_REPORT_TOKEN || '', contactUrl: process.env.LICENSE_CONTACT_URL || '', playUrl: process.env.PLAY_URL || '', mp, mpWebhookSecret, mpPublicKey, signingKey }).listen(port, host, () => {
    console.log(`[license] http://${host}:${port} · banco ${dbPath}`)
    if (!adminToken) console.warn('[license] LICENSE_ADMIN_TOKEN vazio: o painel /admin/ fica fechado.')
  })
}
