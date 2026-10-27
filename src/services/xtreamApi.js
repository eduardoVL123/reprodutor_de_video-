/**
 * Cliente da API Xtream Codes (genérico, sem nenhum endereço pré-configurado).
 *
 * REGRA DE OURO (RFC-007): com usuário e senha preenchidos NUNCA fazemos fetch na
 * raiz "/" do servidor — vamos direto em `/player_api.php`. Servidores reais
 * redirecionam a raiz para páginas bloqueadas/HTTPS inválidos e isso quebrava o login.
 *
 * Redirecionamentos (301/302/307/308): `fetch` com `redirect: 'follow'` os segue
 * automaticamente. O host final (via `X-Final-Url` do proxy ou `response.url`) é
 * guardado como `resolvedUrl` para que as próximas chamadas não paguem o salto extra.
 *
 * CORS:
 *  - APK Android TV: o `MainActivity` intercepta estas chamadas e as refaz pelo HttpURLConnection
 *    nativo (sem CORS). O plugin CapacitorHttp está desligado (capacitor.config.json).
 *  - PC (vite em localhost): `smartFetch` refaz a chamada via `/__proxy__`.
 *  - Tizen/webOS empacotados: o WebView não aplica CORS do mesmo modo.
 *
 * Erros: toda falha vira um `XtreamError` com `code`, `userMessage` (português,
 * para o usuário) e `technicalDetail` (diagnóstico, SEMPRE com a senha mascarada).
 */

import { canUseDevProxy, devProxyUrl, maskSecrets } from '@/services/netEnv'
import { durationLabel } from '@/utils/formatTime'

export const GENERIC_CONNECTION_ERROR =
  'Falha ao conectar. Verifique seus dados ou a conexão com a internet.'

export const DEFAULT_TIMEOUT_MS = 15000
export const PLAYLIST_TIMEOUT_MS = 90000

export const MISSING_CREDENTIALS_ERROR =
  'Este link exige Usuário e Senha. Preencha os campos abaixo.'

export const ERROR_CODES = {
  AUTH_INVALID_CREDENTIALS: 'AUTH_INVALID_CREDENTIALS',
  AUTH_ACCOUNT_EXPIRED: 'AUTH_ACCOUNT_EXPIRED',
  HTTP_ERROR: 'HTTP_ERROR',
  TIMEOUT_ERROR: 'TIMEOUT_ERROR',
  CORS_OR_NETWORK_ERROR: 'CORS_OR_NETWORK_ERROR',
  INVALID_FORMAT_ERROR: 'INVALID_FORMAT_ERROR',
  EMPTY_M3U_ERROR: 'EMPTY_M3U_ERROR',
  INVALID_URL_ERROR: 'INVALID_URL_ERROR',
  MISSING_CREDENTIALS: 'MISSING_CREDENTIALS',
  INVALID_INPUT: 'INVALID_INPUT',
  NO_SESSION: 'NO_SESSION',
}

// Compatibilidade com códigos antigos (minúsculos) ainda usados em chamadas legadas.
const LEGACY_CODES = {
  invalid_url: ERROR_CODES.INVALID_URL_ERROR,
  invalid_input: ERROR_CODES.INVALID_INPUT,
  timeout: ERROR_CODES.TIMEOUT_ERROR,
  network: ERROR_CODES.CORS_OR_NETWORK_ERROR,
  http: ERROR_CODES.HTTP_ERROR,
  bad_response: ERROR_CODES.INVALID_FORMAT_ERROR,
  unauthorized: ERROR_CODES.AUTH_INVALID_CREDENTIALS,
  missing_credentials: ERROR_CODES.MISSING_CREDENTIALS,
}

function buildUserMessage(code, ctx) {
  switch (code) {
    case ERROR_CODES.AUTH_INVALID_CREDENTIALS:
      return 'Usuário ou senha incorretos recusados pelo servidor.'
    case ERROR_CODES.AUTH_ACCOUNT_EXPIRED:
      return `Conta inativa ou expirada no servidor (Status: ${ctx.accountStatus || 'desconhecido'}).`
    case ERROR_CODES.HTTP_ERROR:
      return `O servidor retornou erro HTTP ${ctx.status || '?'} (${ctx.statusText || 'sem descrição'}).`
    case ERROR_CODES.TIMEOUT_ERROR:
      return `Tempo limite esgotado (${ctx.timeoutSec || '?'}s). O servidor demorou muito para responder.`
    case ERROR_CODES.CORS_OR_NETWORK_ERROR:
      return 'Falha de conexão com o servidor (DNS incorreto, servidor fora do ar ou bloqueio de rede/CORS).'
    case ERROR_CODES.INVALID_FORMAT_ERROR:
      return 'O servidor respondeu, mas não enviou dados Xtream Codes nem uma lista #EXTM3U válida.'
    case ERROR_CODES.EMPTY_M3U_ERROR:
      return 'A lista #EXTM3U foi baixada, mas não contém nenhum canal ou vídeo válido.'
    case ERROR_CODES.INVALID_URL_ERROR:
      return 'Endereço inválido. Informe algo como "servidor.com:8080" ou "http://servidor.com".'
    case ERROR_CODES.MISSING_CREDENTIALS:
      return MISSING_CREDENTIALS_ERROR
    case ERROR_CODES.INVALID_INPUT:
      return ctx.raw || 'Preencha os campos obrigatórios.'
    case ERROR_CODES.NO_SESSION:
      return 'Nenhuma lista ativa. Conecte-se novamente.'
    default:
      return GENERIC_CONNECTION_ERROR
  }
}

export class XtreamError extends Error {
  /**
   * @param {string} code  um dos ERROR_CODES (aceita os códigos legados minúsculos)
   * @param {string|{raw?:string, host?:string, endpoint?:string, status?:number,
   *          statusText?:string, timeoutSec?:number, accountStatus?:string}} [info]
   */
  constructor(code, info) {
    const normalized = LEGACY_CODES[code] || code || 'UNKNOWN_ERROR'
    const ctx = typeof info === 'string' ? { raw: info } : info || {}
    const userMessage = buildUserMessage(normalized, ctx)
    super(userMessage)
    this.name = 'XtreamError'
    this.code = normalized
    this.userMessage = userMessage
    this.technicalDetail = maskSecrets(
      `[${normalized}] Host: ${ctx.host || '-'} | Endpoint: ${ctx.endpoint || '-'} | Detalhe: ${ctx.raw || '-'}`,
    )
    this.detail = this.technicalDetail // compatibilidade com logs antigos
    this.status = ctx.status || 0
  }
}

/** Host e endpoint (sem credenciais) de uma URL, para diagnóstico. */
function describeUrl(url) {
  try {
    const u = new URL(url)
    const action = u.searchParams.get('action')
    return { host: u.origin, endpoint: `${u.pathname}${action ? `?action=${action}` : ''}` }
  } catch (_) {
    return { host: String(url || '-'), endpoint: '-' }
  }
}

/**
 * Normaliza o que o usuário digitou no campo DNS.
 *  - aceita domínios curtos sem protocolo ("dominio.xyz" => "http://dominio.xyz")
 *  - remove espaços, query, hash, barra final e "/player_api.php" / "/get.php"
 *  - preserva sub-caminhos (ex.: painéis atrás de "/painel")
 * @returns {string} base sem barra final, ex.: "http://dominio.xyz:8080"
 */
export function normalizeBaseUrl(input) {
  const raw = String(input == null ? '' : input).trim()
  if (!raw) throw new XtreamError(ERROR_CODES.INVALID_URL_ERROR, 'DNS vazio')

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`

  let url
  try {
    url = new URL(withScheme)
  } catch (_) {
    throw new XtreamError(ERROR_CODES.INVALID_URL_ERROR, `URL malformada: ${raw}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new XtreamError(ERROR_CODES.INVALID_URL_ERROR, `Protocolo não suportado: ${url.protocol}`)
  }
  if (!url.hostname) throw new XtreamError(ERROR_CODES.INVALID_URL_ERROR, 'Host ausente')

  const path = url.pathname.replace(/\/(player_api|get|panel_api)\.php$/i, '').replace(/\/+$/, '')

  return `${url.origin}${path}`
}

/** Monta `<base>/player_api.php?username=..&password=..[&action=..]`. */
export function buildApiUrl(baseUrl, { username, password, action, params } = {}) {
  const query = [
    ['username', username],
    ['password', password],
  ]
  if (action) query.push(['action', action])
  if (params) Object.keys(params).forEach((k) => query.push([k, params[k]]))

  const qs = query.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
  return `${baseUrl}/player_api.php?${qs}`
}

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
    return { res, finalUrl: res.url || url, viaProxy: false }
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

/** Lê o corpo como JSON validando HTTP e formato. */
async function readJson(res, url) {
  const where = describeUrl(url)
  if (!res.ok) {
    throw new XtreamError(ERROR_CODES.HTTP_ERROR, {
      ...where,
      status: res.status,
      statusText: res.statusText,
      raw: `HTTP ${res.status} ${res.statusText || ''}`.trim(),
    })
  }
  let text = ''
  try {
    text = await res.text()
  } catch (err) {
    throw new XtreamError(ERROR_CODES.CORS_OR_NETWORK_ERROR, { ...where, raw: `Corpo interrompido: ${err && err.message}` })
  }
  try {
    return JSON.parse(text)
  } catch (_) {
    const snippet = text.replace(/\s+/g, ' ').trim().slice(0, 80)
    throw new XtreamError(ERROR_CODES.INVALID_FORMAT_ERROR, {
      ...where,
      raw: `Resposta não é JSON. Início: "${snippet || '(vazio)'}"`,
    })
  }
}

function baseFromFinalUrl(finalUrl, requestedBase) {
  if (!finalUrl) return null
  try {
    const resolved = normalizeBaseUrl(String(finalUrl).split('?')[0])
    if (resolved === requestedBase) return null
    // Se o requestedBase era http:// e o finalUrl apenas trocou o protocolo para https:// no mesmo host/porta,
    // preserva http:// como prioridade (RFC-008: muitos painéis Xtream falham ao baixar catálogo em HTTPS).
    if (/^http:\/\//i.test(requestedBase) && /^https:\/\//i.test(resolved)) {
      const httpResolved = resolved.replace(/^https:\/\//i, 'http://')
      if (httpResolved === requestedBase) {
        return null
      }
    }
    return resolved
  } catch (_) {
    return null
  }
}

/** Falha de transporte (rede/TLS/gateway) em vez de uma resposta legítima do servidor. */
function isTransportFailure(err) {
  if (!err) return false
  if (err.code === ERROR_CODES.CORS_OR_NETWORK_ERROR) return true
  return err.code === ERROR_CODES.HTTP_ERROR && err.status >= 500
}

/**
 * Requisição genérica ao `player_api.php`.
 * @returns {Promise<{ data: any, resolvedUrl: string|null, downgraded?: boolean }>} `resolvedUrl` só vem
 *          preenchido quando houve redirecionamento para outro host/caminho; `downgraded` quando
 *          o https falhou e a chamada (com usuário e senha na URL) foi refeita em http.
 */
export async function apiRequest(baseUrl, credentials, { action, params, timeoutMs } = {}) {
  const execute = async (targetBase) => {
    const url = buildApiUrl(targetBase, { ...(credentials || {}), action, params })
    const { res, finalUrl } = await smartFetch(url, { timeoutMs: timeoutMs || DEFAULT_TIMEOUT_MS })
    const data = await readJson(res, url)
    return { data, resolvedUrl: baseFromFinalUrl(finalUrl, targetBase) }
  }

  try {
    return await execute(baseUrl)
  } catch (err) {
    // Painéis com https quebrado (certificado inválido, redirecionamento) funcionam em http:// (RFC-008).
    // Só rebaixa quando o https nem chegou a responder: um erro HTTP 4xx (ex.: credenciais recusadas)
    // não pode reenviar usuário e senha em texto puro.
    if (/^https:\/\//i.test(baseUrl) && isTransportFailure(err)) {
      const httpBase = baseUrl.replace(/^https:\/\//i, 'http://')
      try {
        console.warn(`[xtream] Chamada em ${baseUrl} (action=${action || 'auth'}) falhou (${err.message}). Tentando fallback em http://...`)
        return { ...(await execute(httpBase)), downgraded: true }
      } catch (_) {
        // Se ambos falharem, propaga o erro original
        throw err
      }
    }
    throw err
  }
}

/**
 * Busca detalhes, temporadas e episódios de uma série no Xtream Codes.
 * @param {{ apiBase: string, credentials: { username: string, password: string }, seriesId: string|number, timeoutMs?: number }} params
 */
export async function fetchSeriesInfo({ apiBase, credentials, seriesId, timeoutMs }) {
  if (!apiBase || !credentials || seriesId === undefined || seriesId === null) {
    throw new XtreamError(ERROR_CODES.NO_SESSION, 'Parâmetros insuficientes para buscar informações da série')
  }
  const { data } = await apiRequest(apiBase, credentials, {
    action: 'get_series_info',
    params: { series_id: seriesId },
    timeoutMs: timeoutMs || DEFAULT_TIMEOUT_MS,
  })
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new XtreamError(ERROR_CODES.INVALID_FORMAT_ERROR, {
      ...describeUrl(buildApiUrl(apiBase, { action: 'get_series_info' })),
      raw: `get_series_info retornou ${Array.isArray(data) ? 'uma lista vazia' : typeof data}`,
    })
  }
  return data
}

const DEFAULT_VOD_PLOT = 'Sem sinopse disponível.'

/** Converte segundos para "2h 14min" / "48min" ('' se inválido). */
function formatDurationSecs(totalSecs) {
  const secs = Number(totalSecs) || 0
  if (secs <= 0) return ''
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  return h > 0 ? `${h}h ${m}min` : `${m}min`
}

const asObject = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {})

/**
 * Normaliza `data.info` / `data.movie_data` (get_vod_info ou get_series_info) para a
 * tela de detalhes. Com `data` nulo, devolve só os dados básicos do próprio item.
 */
export function normalizeVodInfo(data, item) {
  const base = item || {}
  const info = asObject(data && data.info)
  const movie = asObject(data && data.movie_data)
  const backdrop = Array.isArray(info.backdrop_path) ? info.backdrop_path[0] : info.backdrop_path
  const cover = base.stream_icon || base.cover || ''
  return {
    name: movie.name || info.name || base.name || '',
    plot: info.plot || info.description || info.overview || base.plot || DEFAULT_VOD_PLOT,
    backdrop: backdrop || info.movie_image || info.cover_big || info.cover || cover,
    poster: info.movie_image || info.cover_big || info.cover || cover,
    rating: info.rating || base.rating || '',
    year: String(info.releasedate || info.releaseDate || '').slice(0, 4),
    duration: durationLabel(info.duration) || formatDurationSecs(info.duration_secs),
    genre: info.genre || base.genre || '',
    cast: info.cast || info.actors || '',
    director: info.director || '',
    container_extension: movie.container_extension || base.container_extension || 'mp4',
  }
}

/**
 * Metadados de um filme (sinopse, elenco, direção...). Nunca rejeita: listas M3U
 * (`directUrl`), servidores sem `get_vod_info` ou falhas de rede devolvem os dados
 * básicos do próprio `item`.
 * @param {{ apiBase: string, credentials: { username: string, password: string }, vodId: string|number, item: object, timeoutMs?: number }} params
 */
export async function fetchVodInfo({ apiBase, credentials, vodId, item, timeoutMs }) {
  const basic = normalizeVodInfo(null, item)
  const hasSession = apiBase && credentials && credentials.username && credentials.password
  if (!hasSession || vodId === undefined || vodId === null || (item && item.directUrl)) return basic

  try {
    const { data } = await apiRequest(apiBase, credentials, {
      action: 'get_vod_info',
      params: { vod_id: vodId },
      timeoutMs: timeoutMs || DEFAULT_TIMEOUT_MS,
    })
    if (!data || typeof data !== 'object' || Array.isArray(data)) return basic
    return normalizeVodInfo(data, item)
  } catch (err) {
    console.warn('[xtream] get_vod_info indisponível; usando dados básicos do item:', (err && err.technicalDetail) || err)
    return basic
  }
}

/** Variante http://host:8080 usada quando o host padrão falha (redirect HTTPS com SSL inválido). */
function port8080Variant(baseUrl) {
  try {
    const u = new URL(baseUrl)
    if (u.port) return null
    return `http://${u.hostname}:8080${u.pathname.replace(/\/+$/, '')}`
  } catch (_) {
    return null
  }
}

/**
 * Autentica no servidor. O Xtream Codes responde 200 mesmo com credenciais
 * erradas, sinalizando via `user_info.auth` (0/1) e `user_info.status`.
 * @returns {Promise<{baseUrl:string, resolvedUrl:string|null, userInfo:object, serverInfo:object, insecure:boolean}>}
 */
export async function authenticate({ dns, username, password, timeoutMs }) {
  const user = String(username == null ? '' : username).trim()
  const pass = String(password == null ? '' : password)
  if (!user || !pass) throw new XtreamError(ERROR_CODES.INVALID_INPUT, 'Preencha usuário e senha.')

  const baseUrl = normalizeBaseUrl(dns)
  const candidates = [baseUrl]
  const alt = port8080Variant(baseUrl)
  if (alt && alt !== baseUrl) candidates.push(alt)

  let result = null
  let usedBase = baseUrl
  let lastErr = null
  for (let i = 0; i < candidates.length; i++) {
    try {
      result = await apiRequest(candidates[i], { username: user, password: pass }, { timeoutMs })
      usedBase = candidates[i]
      break
    } catch (err) {
      lastErr = err
      const retryable = err && err.code === ERROR_CODES.CORS_OR_NETWORK_ERROR
      if (!retryable || i === candidates.length - 1) throw err
      console.warn('[xtream] Host padrão falhou, tentando porta 8080:', err.technicalDetail)
    }
  }
  if (!result) throw lastErr || new XtreamError(ERROR_CODES.CORS_OR_NETWORK_ERROR, 'Sem resposta')

  const data = result.data
  const where = describeUrl(buildApiUrl(usedBase, {}))
  const isEmpty =
    data === null ||
    data === false ||
    (Array.isArray(data) && data.length === 0) ||
    (typeof data === 'object' && !Array.isArray(data) && Object.keys(data).length === 0)
  if (isEmpty) {
    throw new XtreamError(ERROR_CODES.AUTH_INVALID_CREDENTIALS, { ...where, raw: 'player_api.php respondeu vazio' })
  }

  const info = data && data.user_info
  if (!info || typeof info !== 'object') {
    throw new XtreamError(ERROR_CODES.INVALID_FORMAT_ERROR, { ...where, raw: 'JSON sem o campo "user_info"' })
  }
  if (String(info.auth) !== '1') {
    throw new XtreamError(ERROR_CODES.AUTH_INVALID_CREDENTIALS, { ...where, raw: `user_info.auth=${info.auth}` })
  }
  const rawStatus = info.status ? String(info.status) : 'Active'
  if (rawStatus.toLowerCase() !== 'active') {
    throw new XtreamError(ERROR_CODES.AUTH_ACCOUNT_EXPIRED, {
      ...where,
      accountStatus: rawStatus,
      raw: `user_info.status=${rawStatus} exp_date=${info.exp_date || '-'}`,
    })
  }

  const resolvedUrl = result.resolvedUrl || (usedBase !== baseUrl ? usedBase : null)
  return {
    baseUrl,
    resolvedUrl,
    userInfo: info,
    serverInfo: (data && data.server_info) || {},
    // Senha trafegando sem TLS: digitou http, redirecionou para http ou o https falhou e caiu para http.
    insecure: Boolean(result.downgraded) || /^http:\/\//i.test(resolvedUrl || usedBase),
  }
}

/** Baixa uma playlist #EXTM3U (com proxy/CORS tratado) e valida o cabeçalho. */
export async function fetchM3uText(url, { timeoutMs = PLAYLIST_TIMEOUT_MS } = {}) {
  const { res, finalUrl } = await smartFetch(url, { timeoutMs, accept: '*/*' })
  const where = describeUrl(url)
  if (!res.ok) {
    throw new XtreamError(ERROR_CODES.HTTP_ERROR, {
      ...where,
      status: res.status,
      statusText: res.statusText,
      raw: `HTTP ${res.status} ao baixar a playlist`,
    })
  }
  const text = await res.text()
  if (!text || text.replace(/^\uFEFF/, '').trim().indexOf('#EXTM3U') !== 0) {
    const snippet = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 80)
    throw new XtreamError(ERROR_CODES.INVALID_FORMAT_ERROR, {
      ...where,
      raw: `Cabeçalho #EXTM3U ausente. Início: "${snippet || '(vazio)'}"`,
    })
  }
  return { text, finalUrl }
}

function credsFromUrl(urlString) {
  try {
    const u = new URL(urlString)
    const qUser = u.searchParams.get('username')
    const qPass = u.searchParams.get('password')
    return qUser && qPass ? { username: qUser, password: qPass } : null
  } catch (_) {
    return null
  }
}

/**
 * Resolvedor de entrada (Link Curto / URL Xtream / Playlist M3U):
 *  - Com usuário e senha (e URL que não seja playlist): NÃO faz nenhum fetch aqui;
 *    o `authenticate` chama `/player_api.php` diretamente.
 *  - URL com `?username=&password=` embutidos: extrai as credenciais sem fetch.
 *  - Link curto de 1 campo, `.m3u`, `.m3u8` ou `get.php`: baixa seguindo
 *    redirecionamentos e detecta credenciais na URL final ou uma lista #EXTM3U.
 * @returns {Promise<{ mode: 'xtream'|'m3u', resolvedUrl: string, baseUrl: string, username?: string, password?: string, m3uText?: string }>}
 */
export async function resolveShortInput({ dns, username = '', password = '', timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const raw = String(dns == null ? '' : dns).trim()
  if (!raw) throw new XtreamError(ERROR_CODES.INVALID_INPUT, 'Informe o Link Curto ou URL do Servidor.')

  const user = String(username == null ? '' : username).trim()
  const pass = String(password == null ? '' : password)

  const hasProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw)
  let targetUrl = hasProtocol ? raw : `http://${raw}`

  let parsed
  try {
    parsed = new URL(targetUrl)
  } catch (_) {
    throw new XtreamError(ERROR_CODES.INVALID_URL_ERROR, `URL malformada: ${raw}`)
  }

  // 1. Credenciais embutidas na própria URL (ex.: get.php?username=..&password=..)
  const embedded = credsFromUrl(targetUrl)
  if (embedded) {
    const base = normalizeBaseUrl(targetUrl)
    return { mode: 'xtream', resolvedUrl: base, baseUrl: base, ...embedded }
  }

  const isPlaylistUrl = /\.(m3u8?)$/i.test(parsed.pathname) || /\/get\.php$/i.test(parsed.pathname)

  // 2. REGRA DE OURO: usuário + senha => direto no player_api.php, sem tocar na raiz.
  if (user && pass && !isPlaylistUrl) {
    const base = normalizeBaseUrl(targetUrl)
    return { mode: 'xtream', resolvedUrl: base, baseUrl: base, username: user, password: pass }
  }

  // 3. Link curto / playlist: baixa seguindo redirecionamentos.
  let fetched
  try {
    fetched = await smartFetch(targetUrl, { timeoutMs: Math.max(timeoutMs, PLAYLIST_TIMEOUT_MS), accept: '*/*' })
  } catch (err) {
    if (hasProtocol || !(err instanceof XtreamError) || err.code !== ERROR_CODES.CORS_OR_NETWORK_ERROR) throw err
    const httpsUrl = `https://${raw}`
    fetched = await smartFetch(httpsUrl, { timeoutMs: Math.max(timeoutMs, PLAYLIST_TIMEOUT_MS), accept: '*/*' })
    targetUrl = httpsUrl
  }

  const { res, finalUrl } = fetched

  // 3a. Credenciais na URL final pós-redirect
  const finalCreds = credsFromUrl(finalUrl)
  if (finalCreds) {
    return {
      mode: 'xtream',
      resolvedUrl: normalizeBaseUrl(finalUrl),
      baseUrl: normalizeBaseUrl(targetUrl),
      ...finalCreds,
    }
  }

  if (!res.ok) {
    throw new XtreamError(ERROR_CODES.HTTP_ERROR, {
      ...describeUrl(finalUrl),
      status: res.status,
      statusText: res.statusText,
      raw: `HTTP ${res.status} ao resolver o link`,
    })
  }

  // 3b. Lista #EXTM3U pura
  let text = ''
  try {
    text = await res.text()
  } catch (_) {}
  if (text && text.replace(/^\uFEFF/, '').trim().indexOf('#EXTM3U') === 0) {
    return {
      mode: 'm3u',
      m3uText: text,
      resolvedUrl: finalUrl,
      baseUrl: targetUrl,
      username: user || 'M3U Playlist',
      password: pass || '',
    }
  }

  // 3c. Servidor Xtream (link curto) sem credenciais informadas
  if (!user || !pass) {
    throw new XtreamError(ERROR_CODES.MISSING_CREDENTIALS, {
      ...describeUrl(finalUrl),
      raw: 'O link não contém credenciais nem uma lista #EXTM3U',
    })
  }

  return {
    mode: 'xtream',
    resolvedUrl: normalizeBaseUrl(finalUrl),
    baseUrl: normalizeBaseUrl(targetUrl),
    username: user,
    password: pass,
  }
}
