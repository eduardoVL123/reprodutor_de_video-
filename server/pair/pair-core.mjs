/**
 * Núcleo do servidor de pareamento (RFC-016 / RFC-017).
 * Lógica pura desacoplada do transporte (Request/Response da Web Standard).
 * Roda idêntico no Node 22+ e no Cloudflare Workers (sem node:http, node:fs nem node:crypto).
 */

export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // 31 caracteres (sem 0/O/1/I/L)
export const CODE_LENGTH = 6
export const DEFAULT_TTL_MS = 10 * 60 * 1000
export const DEFAULT_DELIVERY_TTL_MS = 60 * 1000
export const DEFAULT_MAX_SESSIONS = 10000
export const DEFAULT_LIMITS = { create: 10, poll: 120, write: 30, miss: 20 }
export const WINDOW_MS = 60 * 1000
export const MAX_BODY_BYTES = 4096
export const MAX_PUB_CHARS = 128
export const MAX_BOX_CHARS = 3600
export const BASE64URL = /^[A-Za-z0-9_-]+$/
export const API_ROUTE = new RegExp(`^/v1/sessions(?:/([${CODE_ALPHABET}]{${CODE_LENGTH}})(/payload)?)?$`)

export const SECURITY_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
}

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Pair-Secret',
  'Access-Control-Max-Age': '600',
}

export const PAGE_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ')

/** Converte Uint8Array para base64url sem dependências externas. */
function toBase64Url(bytes) {
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/** Sorteio de código de 6 letras sem viés de módulo (rejeita bytes >= 248 para 31 caracteres: 31 * 8 = 248). */
export function generateCode(taken) {
  const buf = new Uint8Array(16)
  for (;;) {
    let code = ''
    while (code.length < CODE_LENGTH) {
      crypto.getRandomValues(buf)
      for (let i = 0; i < buf.length && code.length < CODE_LENGTH; i++) {
        if (buf[i] < 248) {
          code += CODE_ALPHABET[buf[i] % 31]
        }
      }
    }
    if (!taken || !taken.has(code)) return code
  }
}

/** Comparação em tempo constante (XOR acumulado em tamanho fixo). */
export function timingSafeEqualStr(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const enc = new TextEncoder()
  const bufA = enc.encode(a)
  const bufB = enc.encode(b)
  const len = Math.max(bufA.length, bufB.length)
  let diff = bufA.length ^ bufB.length
  for (let i = 0; i < len; i++) {
    diff |= (bufA[i] ?? 0) ^ (bufB[i] ?? 0)
  }
  return diff === 0
}

/** Leitura de corpo JSON em chunks com corte estrito no limite de bytes (erro 413). */
export async function readJsonBody(request, maxBytes = MAX_BODY_BYTES) {
  const contentLength = request.headers.get('content-length')
  if (contentLength && Number(contentLength) > maxBytes) {
    if (request.body) {
      try {
        const reader = request.body.getReader()
        await reader.cancel()
        reader.releaseLock()
      } catch (_) {}
    }
    const err = new Error('Corpo grande demais.')
    err.status = 413
    throw err
  }
  if (!request.body) {
    const err = new Error('JSON inválido.')
    err.status = 400
    throw err
  }

  const reader = request.body.getReader()
  const chunks = []
  let total = 0
  let tooLarge = false

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        tooLarge = true
        await reader.cancel()
        break
      }
      chunks.push(value)
    }
  } catch (_) {
    if (tooLarge) {
      const err = new Error('Corpo grande demais.')
      err.status = 413
      throw err
    }
    const err = new Error('Falha ao ler o corpo.')
    err.status = 400
    throw err
  } finally {
    try {
      reader.releaseLock()
    } catch (_) {}
  }

  if (tooLarge) {
    const err = new Error('Corpo grande demais.')
    err.status = 413
    throw err
  }

  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  const text = new TextDecoder().decode(merged)
  try {
    const body = JSON.parse(text)
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new Error('não é objeto')
    }
    return body
  } catch (_) {
    const err = new Error('JSON inválido.')
    err.status = 400
    throw err
  }
}

const isOpaqueText = (value, max) =>
  typeof value === 'string' && value.length > 0 && value.length <= max && BASE64URL.test(value)

/** Limitador de taxa em janela deslizante/fixa de 1 minuto por IP. */
function createLimiter(now) {
  const windows = new Map() // `${bucket}|${ip}` -> { start, count }
  const current = (bucket, ip) => {
    const key = `${bucket}|${ip}`
    let w = windows.get(key)
    if (!w || now() - w.start >= WINDOW_MS) {
      w = { start: now(), count: 0 }
      windows.set(key, w)
    }
    return w
  }
  return {
    retryAfter(bucket, ip, limit) {
      const w = current(bucket, ip)
      return w.count >= limit ? Math.max(1, Math.ceil((w.start + WINDOW_MS - now()) / 1000)) : 0
    },
    add(bucket, ip) {
      current(bucket, ip).count++
    },
    sweep() {
      for (const [key, w] of windows) {
        if (now() - w.start >= WINDOW_MS) windows.delete(key)
      }
    },
  }
}

/** Cria instância do núcleo de pareamento. */
export function createPairCore(options = {}) {
  const {
    now = Date.now,
    ttlMs = DEFAULT_TTL_MS,
    deliveryTtlMs = DEFAULT_DELIVERY_TTL_MS,
    maxSessions = DEFAULT_MAX_SESSIONS,
  } = options
  const limits = { ...DEFAULT_LIMITS, ...options.limits }
  const sessions = new Map() // code -> { pub, secret, box, expiresAt }
  const limiter = createLimiter(now)

  function sweep() {
    const t = now()
    for (const [code, s] of sessions) {
      if (s.expiresAt <= t) sessions.delete(code)
    }
    limiter.sweep()
  }

  function liveSession(code) {
    const s = sessions.get(code)
    if (!s) return null
    if (s.expiresAt <= now()) {
      sessions.delete(code)
      return null
    }
    return s
  }

  function sendResponse(status, body = null, headers = {}) {
    const mergedHeaders = new Headers(SECURITY_HEADERS)
    for (const [k, v] of Object.entries(headers)) {
      mergedHeaders.set(k, v)
    }
    return new Response(body, {
      status,
      headers: mergedHeaders,
    })
  }

  function sendJson(status, data, headers = {}) {
    return sendResponse(
      status,
      JSON.stringify(data),
      {
        ...CORS_HEADERS,
        'Content-Type': 'application/json; charset=utf-8',
        ...headers,
      }
    )
  }

  const fail = (status, message, headers = {}) => sendJson(status, { error: message }, headers)

  function throttled(bucket, ip) {
    const retry = limiter.retryAfter(bucket, ip, limits[bucket])
    if (retry) {
      return fail(429, 'Muitas tentativas. Aguarde um minuto.', { 'Retry-After': String(retry) })
    }
    limiter.add(bucket, ip)
    return null
  }

  function notFound(ip) {
    limiter.add('miss', ip)
    return fail(404, 'Código não encontrado ou expirado.')
  }

  async function createSession(request, ip) {
    const rateErr = throttled('create', ip)
    if (rateErr) return rateErr

    const body = await readJsonBody(request)
    if (!isOpaqueText(body.pub, MAX_PUB_CHARS)) return fail(400, 'Chave pública inválida.')

    sweep()
    if (sessions.size >= maxSessions) return fail(503, 'Serviço ocupado. Tente em instantes.')

    const code = generateCode(sessions)
    const secretBytes = new Uint8Array(16)
    crypto.getRandomValues(secretBytes)
    const secret = toBase64Url(secretBytes)

    sessions.set(code, { pub: body.pub, secret, box: null, expiresAt: now() + ttlMs })
    return sendJson(201, { code, secret, expiresIn: Math.round(ttlMs / 1000) })
  }

  function blockedPhoneCall(ip) {
    const retry = limiter.retryAfter('miss', ip, limits.miss)
    if (retry) {
      return fail(429, 'Muitas tentativas. Aguarde um minuto.', { 'Retry-After': String(retry) })
    }
    return throttled('write', ip)
  }

  function readPublicKey(code, ip) {
    const rateErr = blockedPhoneCall(ip)
    if (rateErr) return rateErr

    const s = liveSession(code)
    if (!s) return notFound(ip)
    return sendJson(200, { pub: s.pub })
  }

  async function submitPayload(request, code, ip) {
    const rateErr = blockedPhoneCall(ip)
    if (rateErr) return rateErr

    const s = liveSession(code)
    if (!s) return notFound(ip)

    const body = await readJsonBody(request)
    if (!isOpaqueText(body.box, MAX_BOX_CHARS)) return fail(400, 'Dados inválidos.')
    if (s.box !== null) return fail(409, 'Esta sessão já recebeu uma lista.')

    s.box = body.box
    s.expiresAt = Math.min(s.expiresAt, now() + deliveryTtlMs)
    return sendResponse(204, null, CORS_HEADERS)
  }

  function collectPayload(request, code, ip) {
    const rateErr = throttled('poll', ip)
    if (rateErr) return rateErr

    const s = liveSession(code)
    if (!s) return fail(404, 'Código não encontrado ou expirado.')

    const clientSecret = request.headers.get('x-pair-secret') || ''
    if (!timingSafeEqualStr(clientSecret, s.secret)) return fail(403, 'Segredo inválido.')

    if (s.box === null) return sendResponse(204, null, CORS_HEADERS)

    sessions.delete(code)
    return sendJson(200, { box: s.box })
  }

  async function handleApi(request, ip = '0.0.0.0') {
    try {
      const url = new URL(request.url, 'http://localhost')
      const path = url.pathname

      if (request.method === 'OPTIONS') {
        return sendResponse(204, null, CORS_HEADERS)
      }

      const api = API_ROUTE.exec(path)
      if (!api) {
        return fail(404, 'Não encontrado.')
      }

      const [, code, payload] = api
      if (!code) {
        return request.method === 'POST'
          ? await createSession(request, ip)
          : fail(405, 'Método não permitido.', { Allow: 'POST' })
      }
      if (payload) {
        if (request.method === 'POST') return await submitPayload(request, code, ip)
        if (request.method === 'GET') return collectPayload(request, code, ip)
        return fail(405, 'Método não permitido.', { Allow: 'GET, POST' })
      }
      return request.method === 'GET'
        ? readPublicKey(code, ip)
        : fail(405, 'Método não permitido.', { Allow: 'GET' })
    } catch (err) {
      const status = err && err.status ? err.status : 500
      return fail(status, status === 500 ? 'Erro interno.' : err.message)
    }
  }

  return {
    handleApi,
    sweep,
  }
}
