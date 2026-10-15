import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import http from 'node:http'
import https from 'node:https'

/**
 * Proxy local anti-CORS (SOMENTE desenvolvimento/preview no PC).
 *
 * Uso: GET /__proxy__?url=<urlDestino>[&hls=1]
 *  - Faz a requisição pelo Node (sem CORS), seguindo 301/302/303/307/308.
 *  - Tolera certificados SSL inválidos (comuns em painéis IPTV).
 *  - Devolve `X-Final-Url` com o endereço final após os redirecionamentos.
 *  - Com `hls=1`, reescreve playlists .m3u8 para que segmentos/sub-playlists
 *    também passem pelo proxy (o hls.js usa XHR, que respeita CORS).
 *
 * No APK (Android TV) quem resolve o CORS é o CapacitorHttp; este proxy não
 * existe no build de produção.
 */
const PROXY_PATH = '/__proxy__'
const UPSTREAM_UA = 'IPTVSmarterPlayer/1.0'
const MAX_REDIRECTS = 8
const UPSTREAM_TIMEOUT_MS = 60000
const REDIRECT_CODES = [301, 302, 303, 307, 308]

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Expose-Headers': 'X-Final-Url, X-Proxy-Error',
}

function maskSecrets(text) {
  return String(text || '').replace(/(password=)[^&\s]*/gi, '$1***')
}

function proxify(uri, baseUrl) {
  let absolute
  try {
    absolute = new URL(uri, baseUrl).toString()
  } catch (_) {
    return uri
  }
  return `${PROXY_PATH}?hls=1&url=${encodeURIComponent(absolute)}`
}

function rewritePlaylist(text, baseUrl) {
  return text
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim()
      if (!trimmed) return line
      if (trimmed.charAt(0) === '#') {
        return line.replace(/URI="([^"]+)"/g, (_m, uri) => `URI="${proxify(uri, baseUrl)}"`)
      }
      return proxify(trimmed, baseUrl)
    })
    .join('\n')
}

function sendProxyError(res, status, message) {
  if (!res.headersSent) {
    res.writeHead(status, {
      ...CORS_HEADERS,
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Proxy-Error': '1',
    })
  }
  res.end(message)
}

function proxyHandler(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS)
    res.end()
    return
  }

  let target = ''
  let rewriteHls = false
  try {
    const parsed = new URL(req.url, 'http://localhost')
    target = parsed.searchParams.get('url') || ''
    rewriteHls = parsed.searchParams.get('hls') === '1'
  } catch (_) {
    target = ''
  }
  if (!/^https?:\/\//i.test(target)) {
    sendProxyError(res, 400, 'Proxy: parâmetro "url" ausente ou inválido.')
    return
  }

  let currentReq = null
  let finished = false
  res.on('close', () => {
    finished = true
    if (currentReq) currentReq.destroy()
  })

  const follow = (url, depth) => {
    if (finished) return
    const lib = url.indexOf('https:') === 0 ? https : http
    const headers = { 'User-Agent': UPSTREAM_UA, Accept: '*/*' }
    if (req.headers.range) headers.Range = req.headers.range

    const upReq = lib.request(url, { method: 'GET', headers, rejectUnauthorized: false }, (upRes) => {
      const status = upRes.statusCode || 502
      if (REDIRECT_CODES.indexOf(status) !== -1 && upRes.headers.location && depth < MAX_REDIRECTS) {
        upRes.resume()
        let nextUrl
        try {
          nextUrl = new URL(upRes.headers.location, url).toString()
        } catch (_) {
          sendProxyError(res, 502, `Proxy: redirecionamento inválido (${maskSecrets(upRes.headers.location)})`)
          return
        }
        follow(nextUrl, depth + 1)
        return
      }

      const contentType = String(upRes.headers['content-type'] || '')
      const outHeaders = { ...CORS_HEADERS, 'X-Final-Url': url, 'Cache-Control': 'no-store' }
      if (contentType) outHeaders['Content-Type'] = contentType

      const looksLikePlaylist =
        /mpegurl/i.test(contentType) || /\.m3u8(\?|$)/i.test(url.split('#')[0])

      if (rewriteHls && looksLikePlaylist) {
        const chunks = []
        upRes.on('data', (c) => chunks.push(c))
        upRes.on('end', () => {
          const body = rewritePlaylist(Buffer.concat(chunks).toString('utf8'), url)
          res.writeHead(status, outHeaders)
          res.end(body)
        })
        upRes.on('error', (err) => sendProxyError(res, 502, `Proxy: ${err.message}`))
        return
      }

      ;['content-length', 'content-range', 'accept-ranges'].forEach((h) => {
        if (upRes.headers[h]) outHeaders[h] = upRes.headers[h]
      })
      res.writeHead(status, outHeaders)
      upRes.pipe(res)
    })

    currentReq = upReq
    upReq.setTimeout(UPSTREAM_TIMEOUT_MS, () => {
      upReq.destroy(new Error(`Timeout de ${UPSTREAM_TIMEOUT_MS / 1000}s no servidor de destino`))
    })
    upReq.on('error', (err) => {
      if (finished) return
      const code = err && err.code ? `${err.code} ` : ''
      sendProxyError(res, 502, `Proxy: ${code}${maskSecrets(err && err.message)}`)
    })
    upReq.end()
  }

  follow(target, 0)
}

function devCorsProxy() {
  return {
    name: 'neutro-dev-cors-proxy',
    configureServer(server) {
      server.middlewares.use(PROXY_PATH, proxyHandler)
    },
    configurePreviewServer(server) {
      server.middlewares.use(PROXY_PATH, proxyHandler)
    },
  }
}

export default defineConfig({
  // Caminhos relativos: obrigatório para empacotar em .wgt (Tizen) e .ipk (webOS),
  // que carregam o app via file:// e não a partir da raiz de um domínio.
  base: './',
  plugins: [vue(), devCorsProxy()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    // Chromium de TVs antigas (Tizen 5.x ~ Chrome 63, webOS 4 ~ Chrome 53/68).
    target: 'es2017',
    cssTarget: 'chrome61',
  },
})
