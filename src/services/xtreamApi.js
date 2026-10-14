/**
 * Cliente da API Xtream Codes (genérico, sem nenhum endereço pré-configurado).
 *
 * Redirecionamentos (301/302/307/308): `fetch` com `redirect: 'follow'` os segue
 * automaticamente. Quando houver redirecionamento, `response.redirected` e
 * `response.url` revelam o host final, que guardamos como `resolvedUrl` para que
 * as próximas chamadas (catálogo de 50.000+ itens) não paguem o salto extra.
 *
 * CORS: em apps empacotados (Tizen/webOS) o WebView não aplica CORS do mesmo modo
 * que um navegador; no navegador de desenvolvimento, o proxy do DNS curto
 * (RFC §4.1) é quem deve liberar os cabeçalhos.
 */

export const GENERIC_CONNECTION_ERROR =
  'Falha ao conectar. Verifique seus dados ou a conexão com a internet.'

export const DEFAULT_TIMEOUT_MS = 15000

export const MISSING_CREDENTIALS_ERROR =
  'Este link exige Usuário e Senha. Preencha os campos abaixo.'

export class XtreamError extends Error {
  /** @param {string} code  invalid_url | invalid_input | timeout | network | http | bad_response | unauthorized | missing_credentials */
  constructor(code, detail = '') {
    const msg = code === 'missing_credentials' ? MISSING_CREDENTIALS_ERROR : GENERIC_CONNECTION_ERROR
    super(msg) // mensagem sempre amigável e única para o usuário
    this.name = 'XtreamError'
    this.code = code
    this.detail = detail // somente para diagnóstico em console (nunca contém a senha)
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
  const raw = String(input ?? '').trim()
  if (!raw) throw new XtreamError('invalid_url', 'DNS vazio')

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`

  let url
  try {
    url = new URL(withScheme)
  } catch (_) {
    throw new XtreamError('invalid_url', 'URL malformada')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new XtreamError('invalid_url', 'Protocolo não suportado')
  }
  if (!url.hostname) throw new XtreamError('invalid_url', 'Host ausente')

  const path = url.pathname
    .replace(/\/(player_api|get|panel_api)\.php$/i, '')
    .replace(/\/+$/, '')

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
function fetchWithTimeout(url, timeoutMs) {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
  let timer

  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      if (controller) controller.abort()
      reject(new XtreamError('timeout', `Sem resposta em ${timeoutMs}ms`))
    }, timeoutMs)
  })

  const request = fetch(url, {
    method: 'GET',
    redirect: 'follow', // segue 301/302 (domínios curtos)
    credentials: 'omit',
    cache: 'no-store',
    signal: controller ? controller.signal : undefined,
    headers: { Accept: 'application/json' },
  }).catch((err) => {
    if (err instanceof XtreamError) throw err
    throw new XtreamError('network', err && err.message)
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
 * Requisição genérica ao `player_api.php`.
 * @returns {Promise<{ data: any, resolvedUrl: string|null }>} `resolvedUrl` só vem
 *          preenchido quando houve redirecionamento.
 */
export async function apiRequest(baseUrl, credentials, { action, params, timeoutMs } = {}) {
  const url = buildApiUrl(baseUrl, { ...credentials, action, params })
  const res = await fetchWithTimeout(url, timeoutMs || DEFAULT_TIMEOUT_MS)

  if (!res.ok) throw new XtreamError('http', `HTTP ${res.status}`)

  let data
  try {
    data = await res.json()
  } catch (_) {
    throw new XtreamError('bad_response', 'Resposta não é JSON válido')
  }

  let resolvedUrl = null
  if (res.redirected && res.url) {
    try {
      resolvedUrl = normalizeBaseUrl(res.url.split('?')[0])
    } catch (_) {
      resolvedUrl = null
    }
  }
  return { data, resolvedUrl }
}

/**
 * Busca detalhes, temporadas e episódios de uma série no Xtream Codes.
 * @param {{ apiBase: string, credentials: { username: string, password: string }, seriesId: string|number, timeoutMs?: number }} params
 * @returns {Promise<any>}
 */
export async function fetchSeriesInfo({ apiBase, credentials, seriesId, timeoutMs }) {
  if (!apiBase || !credentials || seriesId === undefined || seriesId === null) {
    throw new XtreamError('invalid_input', 'Parâmetros insuficientes para buscar informações da série')
  }
  const { data } = await apiRequest(apiBase, credentials, {
    action: 'get_series_info',
    params: { series_id: seriesId },
    timeoutMs: timeoutMs || DEFAULT_TIMEOUT_MS,
  })
  return data
}

/**
 * Autentica no servidor. O Xtream Codes responde 200 mesmo com credenciais
 * erradas, sinalizando via `user_info.auth` (0/1) e `user_info.status`.
 * @returns {Promise<{baseUrl:string, resolvedUrl:string|null, userInfo:object, serverInfo:object}>}
 */
export async function authenticate({ dns, username, password, timeoutMs }) {
  const user = String(username ?? '').trim()
  const pass = String(password ?? '')
  if (!user || !pass) throw new XtreamError('invalid_input', 'Usuário ou senha vazios')

  const baseUrl = normalizeBaseUrl(dns)
  const { data, resolvedUrl } = await apiRequest(
    baseUrl,
    { username: user, password: pass },
    { timeoutMs },
  )

  const info = data && data.user_info
  const authorized = info && typeof info === 'object' && String(info.auth) === '1'
  const status = info && info.status ? String(info.status).toLowerCase() : 'active'

  if (!authorized || status !== 'active') {
    throw new XtreamError('unauthorized', `auth=${info && info.auth} status=${status}`)
  }

  return {
    baseUrl,
    resolvedUrl,
    userInfo: info,
    serverInfo: (data && data.server_info) || {},
  }
}

/**
 * Resolvedor Inteligente de Link Curto (RFC-005):
 * - Normaliza protocolo (http:// ou https://)
 * - Segue redirecionamentos 301/302/307/308
 * - Auto-extrai username e password de URLs encurtadas (ex.: get.php?username=... ou /v)
 * - Detecta listas M3U puras (#EXTM3U)
 * @returns {Promise<{ mode: 'xtream'|'m3u', resolvedUrl: string, baseUrl: string, username?: string, password?: string, m3uText?: string }>}
 */
export async function resolveShortInput({ dns, username = '', password = '', timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const raw = String(dns ?? '').trim()
  if (!raw) throw new XtreamError('invalid_input', 'Link ou URL vazio')

  let user = String(username ?? '').trim()
  let pass = String(password ?? '')

  // 1. Garante protocolo inicial
  const hasProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw)
  let targetUrl = hasProtocol ? raw : `http://${raw}`

  // Verifica se a URL de entrada já tem parâmetros de username e password
  try {
    const parsed = new URL(targetUrl)
    const qUser = parsed.searchParams.get('username')
    const qPass = parsed.searchParams.get('password')
    if (qUser && qPass) {
      user = qUser
      pass = qPass
      const resolved = normalizeBaseUrl(targetUrl)
      return {
        mode: 'xtream',
        resolvedUrl: resolved,
        baseUrl: resolved,
        username: user,
        password: pass,
      }
    }
  } catch (_) {}

  // 2. Realiza fetch seguindo redirecionamentos
  let res = null
  try {
    res = await fetchWithTimeout(targetUrl, timeoutMs)
  } catch (err) {
    if (!hasProtocol) {
      try {
        const httpsUrl = `https://${raw}`
        res = await fetchWithTimeout(httpsUrl, timeoutMs)
        targetUrl = httpsUrl
      } catch (_) {
        throw err
      }
    } else {
      throw err
    }
  }

  const finalUrlString = (res && res.url) || targetUrl

  // 3. Inspeciona a URL pós-redirect para credenciais
  try {
    const finalParsed = new URL(finalUrlString)
    const qUser = finalParsed.searchParams.get('username')
    const qPass = finalParsed.searchParams.get('password')
    if (qUser && qPass) {
      user = qUser
      pass = qPass
      const resolved = normalizeBaseUrl(finalUrlString)
      return {
        mode: 'xtream',
        resolvedUrl: resolved,
        baseUrl: normalizeBaseUrl(targetUrl),
        username: user,
        password: pass,
      }
    }
  } catch (_) {}

  // 4. Inspeciona o corpo da resposta para detecção de lista #EXTM3U
  let text = ''
  try {
    text = await res.text()
  } catch (_) {}

  if (text && text.trim().startsWith('#EXTM3U')) {
    return {
      mode: 'm3u',
      m3uText: text,
      resolvedUrl: finalUrlString,
      baseUrl: targetUrl,
      username: user || 'M3U Playlist',
      password: pass || '',
    }
  }

  // 5. Se for Xtream e o usuário não informou credenciais
  if (!user || !pass) {
    throw new XtreamError('missing_credentials', 'Link curto exige usuário e senha')
  }

  const resolvedBase = normalizeBaseUrl(finalUrlString)
  return {
    mode: 'xtream',
    resolvedUrl: resolvedBase,
    baseUrl: normalizeBaseUrl(targetUrl),
    username: user,
    password: pass,
  }
}
