// fetch com timeout, proxy de desenvolvimento e leitura de texto/JSON (saiu de xtreamApi.js, que reexporta o que era público).
import { canUseDevProxy, devProxyUrl } from '@/services/netEnv'
import { createJsonArrayReader } from '@/utils/jsonArrayReader'
import { ERROR_CODES, XtreamError, describeUrl } from '@/services/xtreamErrors'

export const DEFAULT_TIMEOUT_MS = 15000
export const PLAYLIST_TIMEOUT_MS = 90000

/**
 * fetch com timeout garantido. Usa Promise.race (e não só AbortController) porque
 * WebViews de TVs mais antigas (Chromium < 66) não têm AbortController.
 */
function fetchWithTimeout(url, timeoutMs, accept, diagUrl) {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
  const where = describeUrl(diagUrl || url)
  let timer

  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      if (controller) controller.abort()
      reject(
        new XtreamError(ERROR_CODES.TIMEOUT_ERROR, {
          ...where,
          timeoutSec: Math.round(timeoutMs / 1000),
          raw: `Sem resposta em ${timeoutMs}ms`,
        }),
      )
    }, timeoutMs)
  })

  const request = fetch(url, {
    method: 'GET',
    redirect: 'follow', // segue 301/302 (domínios curtos)
    credentials: 'omit',
    cache: 'no-store',
    signal: controller ? controller.signal : undefined,
    headers: { Accept: accept || 'application/json, text/plain, */*' },
  }).catch((err) => {
    if (err instanceof XtreamError) throw err
    const raw = `${(err && err.name) || 'Error'}: ${(err && err.message) || 'falha de rede'}`
    throw new XtreamError(ERROR_CODES.CORS_OR_NETWORK_ERROR, { ...where, raw })
  })

  return Promise.race([request, timeout]).then(
    (res) => {
      clearTimeout(timer)
      return res
    },
    (err) => {
      clearTimeout(timer)
      throw err
    },
  )
}

/**
 * fetch "inteligente":
 *  1. tenta direto (no APK o MainActivity já elimina o CORS);
 *  2. se falhar por rede/CORS no PC (localhost), refaz via `/__proxy__`.
 * @returns {Promise<{ res: Response, finalUrl: string, viaProxy: boolean }>}
 */
export async function smartFetch(url, { timeoutMs = DEFAULT_TIMEOUT_MS, accept } = {}) {
  try {
    const res = await fetchWithTimeout(url, timeoutMs, accept)
    // No APK o motor nativo segue os redirecionamentos por conta própria e diz onde parou neste cabeçalho.
    return { res, finalUrl: (res.headers && res.headers.get('X-Final-Url')) || res.url || url, viaProxy: false }
  } catch (err) {
    if (!(err instanceof XtreamError) || err.code !== ERROR_CODES.CORS_OR_NETWORK_ERROR || !canUseDevProxy()) {
      throw err
    }
    const directDetail = err.technicalDetail
    const res = await fetchWithTimeout(devProxyUrl(url), timeoutMs, accept, url)
    if (res.headers.get('X-Proxy-Error')) {
      let proxyMsg = ''
      try {
        proxyMsg = await res.text()
      } catch (_) {}
      throw new XtreamError(ERROR_CODES.CORS_OR_NETWORK_ERROR, {
        ...describeUrl(url),
        raw: `${proxyMsg || `Proxy HTTP ${res.status}`} (tentativa direta: ${directDetail})`,
      })
    }
    return { res, finalUrl: res.headers.get('X-Final-Url') || url, viaProxy: true }
  }
}

/**
 * Lê o corpo como texto. Falha se ficar `idleMs` sem chegar nenhum byte (servidor que mandou os cabeçalhos e parou):
 * `res.text()` sozinho esperaria para sempre. Um download lento que continua chegando não é cortado.
 * Com `onPiece`, cada pedaço vai para ele e nada é acumulado (listas grandes, ver jsonArrayReader).
 */
export async function readText(res, idleMs, where, onPiece) {
  if (!res.body || typeof res.body.getReader !== 'function') {
    // WebView antiga sem leitura em partes: não há como medir pausa, então o limite vale para o corpo inteiro.
    let timer
    const limit = new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(
          new XtreamError(ERROR_CODES.TIMEOUT_ERROR, {
            ...where,
            timeoutSec: Math.round(idleMs / 1000),
            raw: `Resposta não terminou em ${idleMs}ms`,
          }),
        )
      }, idleMs)
    })
    let all
    try {
      all = await Promise.race([res.text(), limit])
    } finally {
      clearTimeout(timer)
    }
    return onPiece ? onPiece(all) : all
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  for (;;) {
    let timer
    const idle = new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(
          new XtreamError(ERROR_CODES.TIMEOUT_ERROR, {
            ...where,
            timeoutSec: Math.round(idleMs / 1000),
            raw: `Resposta parou de chegar por ${idleMs}ms`,
          }),
        )
        Promise.resolve(reader.cancel()).catch(() => {}) // depois do reject: cancelar encerra o read() e ele ganharia a corrida
      }, idleMs)
    })
    let chunk
    try {
      chunk = await Promise.race([reader.read(), idle])
    } finally {
      clearTimeout(timer)
    }
    const piece = chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true })
    if (onPiece) onPiece(piece)
    else text += piece
    if (chunk.done) return text
  }
}

/** Lê o corpo como JSON validando HTTP e formato. */
export async function readJson(res, url, idleMs) {
  const where = describeUrl(url)
  if (!res.ok) {
    // 502 montado pelo motor HTTP nativo do APK (MainActivity.java): o servidor nem respondeu (ex.: certificado inválido).
    if (res.headers && res.headers.get('X-Pulse-Native-Error') === '1') {
      throw new XtreamError(ERROR_CODES.CORS_OR_NETWORK_ERROR, { ...where, raw: `HTTP ${res.status} do motor nativo` })
    }
    throw new XtreamError(ERROR_CODES.HTTP_ERROR, {
      ...where,
      status: res.status,
      statusText: res.statusText,
      raw: `HTTP ${res.status} ${res.statusText || ''}`.trim(),
    })
  }
  // Converte item a item enquanto chega: a lista inteira em texto + em objetos não cabe em TV com pouca RAM.
  const reader = createJsonArrayReader()
  try {
    await readText(res, idleMs, where, reader.push)
  } catch (err) {
    if (err instanceof XtreamError) throw err
    throw new XtreamError(ERROR_CODES.CORS_OR_NETWORK_ERROR, { ...where, raw: `Corpo interrompido: ${err && err.message}` })
  }
  try {
    return reader.finish()
  } catch (_) {
    const snippet = reader.head().replace(/\s+/g, ' ').trim().slice(0, 80)
    throw new XtreamError(ERROR_CODES.INVALID_FORMAT_ERROR, {
      ...where,
      raw: `Resposta não é JSON. Início: "${snippet || '(vazio)'}"`,
    })
  }
}
