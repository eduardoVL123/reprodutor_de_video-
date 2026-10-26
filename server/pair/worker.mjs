import { DurableObject } from 'cloudflare:workers'
import {
  createPairCore,
  SECURITY_HEADERS,
  PAGE_CSP,
  CODE_ALPHABET,
  CODE_LENGTH,
} from './pair-core.mjs'

const INTERNAL_IP_HEADER = 'x-internal-client-ip'
const CODE_PATH_RE = new RegExp(`^/([${CODE_ALPHABET}]{${CODE_LENGTH}})$`, 'i')
const ALLOWED_ASSETS = new Set(['/', '/index.html', '/app.js', '/pair-lib.js', '/app.css'])

function withSecurityHeaders(response, isHtml = false) {
  const headers = new Headers(response.headers)
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    headers.set(k, v)
  }
  if (isHtml) {
    headers.set('Content-Security-Policy', PAGE_CSP)
    headers.set('Content-Type', 'text/html; charset=utf-8')
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

/**
 * Durable Object singleton ("hub"):
 * Mantém o mesmo Map em memória e instâncias do núcleo de pareamento.
 */
export class PairHub extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env)
    this.core = createPairCore()
  }

  async fetch(request) {
    const ip = request.headers.get(INTERNAL_IP_HEADER) || '0.0.0.0'
    return this.core.handleApi(request, ip)
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const { pathname } = url
    const method = request.method.toUpperCase()

    // 1. Healthcheck direto no Worker (zero chamadas e custo do Durable Object)
    if (pathname === '/healthz') {
      if (method !== 'GET' && method !== 'HEAD') {
        return withSecurityHeaders(
          new Response('Método não permitido.', {
            status: 405,
            headers: { 'Content-Type': 'text/plain; charset=utf-8', Allow: 'GET, HEAD' },
          })
        )
      }
      return withSecurityHeaders(
        new Response(method === 'HEAD' ? null : 'ok', {
          status: 200,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        })
      )
    }

    // 2. Rotas da API (/v1/*) -> Durable Object singleton "hub"
    if (pathname.startsWith('/v1/')) {
      const clientIp = request.headers.get('CF-Connecting-IP') || '0.0.0.0'
      const cleanHeaders = new Headers(request.headers)
      cleanHeaders.delete(INTERNAL_IP_HEADER)
      cleanHeaders.set(INTERNAL_IP_HEADER, clientIp)

      const hasBody = method !== 'GET' && method !== 'HEAD'
      const forwardedReq = new Request(request.url, {
        method: request.method,
        headers: cleanHeaders,
        body: hasBody ? request.body : undefined,
        duplex: hasBody ? 'half' : undefined,
      })

      const id = env.PAIR.idFromName('hub')
      const stub = env.PAIR.get(id)
      return stub.fetch(forwardedReq)
    }

    // 3. Ativos estáticos e rota de código (/<código> -> /index.html)
    const isCodeRoute = CODE_PATH_RE.test(pathname)
    if (ALLOWED_ASSETS.has(pathname) || isCodeRoute) {
      if (method !== 'GET' && method !== 'HEAD') {
        return withSecurityHeaders(
          new Response('Método não permitido.', {
            status: 405,
            headers: { 'Content-Type': 'text/plain; charset=utf-8', Allow: 'GET, HEAD' },
          })
        )
      }

      const isHtml = pathname === '/' || pathname === '/index.html' || isCodeRoute
      const assetUrl = new URL(request.url)
      if (isHtml) {
        assetUrl.pathname = '/index.html'
      }

      const assetReq = new Request(assetUrl.toString(), { method: 'GET' })
      const assetRes = await env.ASSETS.fetch(assetReq)

      if (!assetRes || !assetRes.ok) {
        return withSecurityHeaders(
          new Response('Não encontrado.', {
            status: 404,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          })
        )
      }

      const responseHeaders = new Headers(assetRes.headers)
      for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
        responseHeaders.set(k, v)
      }
      if (isHtml) {
        responseHeaders.set('Content-Security-Policy', PAGE_CSP)
        responseHeaders.set('Content-Type', 'text/html; charset=utf-8')
      }

      return new Response(method === 'HEAD' ? null : assetRes.body, {
        status: 200,
        headers: responseHeaders,
      })
    }

    // 4. Outras rotas desconhecidas
    return withSecurityHeaders(
      new Response(method === 'HEAD' ? null : 'Não encontrado.', {
        status: 404,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    )
  },
}
