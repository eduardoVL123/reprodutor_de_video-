import http from 'node:http'
import { Readable } from 'node:stream'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  createPairCore,
  CODE_ALPHABET,
  CODE_LENGTH,
  SECURITY_HEADERS,
  PAGE_CSP,
  DEFAULT_TTL_MS,
  DEFAULT_DELIVERY_TTL_MS,
  DEFAULT_MAX_SESSIONS,
  DEFAULT_LIMITS,
} from './pair-core.mjs'

export { CODE_ALPHABET }

const PAGE_ROUTE = new RegExp(`^/[${CODE_ALPHABET}]{${CODE_LENGTH}}$`, 'i')
const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), 'public')

const ASSETS = {
  '/app.js': { file: 'app.js', type: 'text/javascript; charset=utf-8' },
  '/pair-lib.js': { file: 'pair-lib.js', type: 'text/javascript; charset=utf-8' },
  '/app.css': { file: 'app.css', type: 'text/css; charset=utf-8' },
}

/**
 * Adaptador Node.js para o servidor de pareamento (RFC-016 / RFC-017).
 * Converte requisições node:http para Web Standards (Request/Response) e delega
 * a lógica de negócio para o núcleo pair-core.mjs.
 */
export function createPairHandler(options = {}) {
  const {
    now = Date.now,
    ttlMs = DEFAULT_TTL_MS,
    deliveryTtlMs = DEFAULT_DELIVERY_TTL_MS,
    maxSessions = DEFAULT_MAX_SESSIONS,
    trustProxy = false,
    publicDir = PUBLIC_DIR,
    limits = DEFAULT_LIMITS,
  } = options

  const core = createPairCore({
    now,
    ttlMs,
    deliveryTtlMs,
    maxSessions,
    limits,
  })

  const pageCache = new Map()

  function clientIp(req) {
    if (trustProxy) {
      const forwarded = String(req.headers['x-forwarded-for'] || '')
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean)
      if (forwarded.length) return forwarded[forwarded.length - 1]
    }
    return (req.socket && req.socket.remoteAddress) || 'unknown'
  }

  function send(res, status, body, headers = {}) {
    res.writeHead(status, { ...SECURITY_HEADERS, ...headers })
    res.end(body)
  }

  function servePage(req, res, file, type, isHtml) {
    let content = pageCache.get(file)
    if (content === undefined) {
      content = readFileSync(join(publicDir, file))
      pageCache.set(file, content)
    }
    send(res, 200, req.method === 'HEAD' ? null : content, {
      'Content-Type': type,
      ...(isHtml ? { 'Content-Security-Policy': PAGE_CSP } : {}),
    })
  }

  async function route(req, res) {
    const url = new URL(req.url, 'http://localhost')
    const path = url.pathname
    const ip = clientIp(req)

    if (path === '/healthz') {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return send(res, 405, 'Método não permitido.', {
          'Content-Type': 'text/plain; charset=utf-8',
          Allow: 'GET, HEAD',
        })
      }
      return send(res, 200, req.method === 'HEAD' ? null : 'ok', {
        'Content-Type': 'text/plain; charset=utf-8',
      })
    }

    if (path.startsWith('/v1/')) {
      const headers = new Headers()
      for (const [k, v] of Object.entries(req.headers)) {
        if (Array.isArray(v)) {
          for (const item of v) headers.append(k, item)
        } else if (v !== undefined) {
          headers.set(k, v)
        }
      }

      const hasBody = req.method !== 'GET' && req.method !== 'HEAD'
      const webReq = new Request(url.toString(), {
        method: req.method,
        headers,
        body: hasBody ? Readable.toWeb(req) : undefined,
        duplex: hasBody ? 'half' : undefined,
      })

      const webRes = await core.handleApi(webReq, ip)
      const resHeaders = {}
      for (const [k, v] of webRes.headers.entries()) {
        resHeaders[k] = v
      }

      res.writeHead(webRes.status, resHeaders)
      if (webRes.body) {
        const reader = webRes.body.getReader()
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          res.write(value)
        }
      }
      res.end()
      return
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return send(res, 405, 'Método não permitido.', {
        'Content-Type': 'text/plain; charset=utf-8',
        Allow: 'GET, HEAD',
      })
    }

    if (path === '/' || PAGE_ROUTE.test(path)) {
      return servePage(req, res, 'index.html', 'text/html; charset=utf-8', true)
    }

    const asset = ASSETS[path]
    if (asset) {
      return servePage(req, res, asset.file, asset.type, false)
    }

    send(res, 404, 'Não encontrado.', { 'Content-Type': 'text/plain; charset=utf-8' })
  }

  const handler = (req, res) => {
    route(req, res).catch((err) => {
      if (res.writableEnded) return
      const status = err && err.status ? err.status : 500
      send(
        res,
        status,
        JSON.stringify({ error: status === 500 ? 'Erro interno.' : err.message }),
        { 'Content-Type': 'application/json; charset=utf-8' }
      )
    })
  }

  handler.sweep = core.sweep
  return handler
}

/** Sobe o servidor com a configuração vinda do ambiente (nada fixo no código). */
export function startPairServer(env = process.env) {
  const port = Number(env.PAIR_PORT || 8788)
  const host = env.PAIR_HOST || '0.0.0.0'
  const handler = createPairHandler({ trustProxy: env.PAIR_TRUST_PROXY === '1' })
  const server = http.createServer(handler)
  setInterval(handler.sweep, 60 * 1000).unref()
  server.listen(port, host, () => console.log(`[pair] ouvindo em http://${host}:${port}`))
  return server
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) startPairServer()
