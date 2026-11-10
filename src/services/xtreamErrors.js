// Mensagens, códigos e classe de erro do cliente Xtream (saiu de xtreamApi.js, que reexporta tudo).
import { maskSecrets } from '@/services/netEnv'

export const GENERIC_CONNECTION_ERROR =
  'Falha ao conectar. Verifique seus dados ou a conexão com a internet.'

export const UNEXPECTED_ERROR =
  'Algo deu errado. Tente de novo; se continuar, fale com o suporte e informe a causa técnica.'

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
  SAVED_DATA_UNREADABLE: 'SAVED_DATA_UNREADABLE',
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
      if (ctx.status >= 500) {
        return `O servidor da lista está com problema (erro ${ctx.status}). Tente de novo em alguns minutos.`
      }
      return `O servidor recusou o pedido (erro ${ctx.status || '?'}). Confira o endereço da lista.`
    case ERROR_CODES.TIMEOUT_ERROR:
      return `O servidor demorou mais de ${ctx.timeoutSec || '?'}s para responder. Confira sua internet e tente de novo.`
    case ERROR_CODES.CORS_OR_NETWORK_ERROR:
      return 'Não foi possível falar com o servidor. Confira sua internet e o endereço da lista; o servidor pode estar fora do ar.'
    case ERROR_CODES.SAVED_DATA_UNREADABLE:
      return 'Não foi possível ler os dados salvos desta lista. Exclua a lista e adicione de novo.'
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

/**
 * Texto para a tela e detalhe técnico de qualquer erro. Só mensagens feitas para o usuário (userMessage) vão para a
 * tela; erro inesperado mostra `fallback` e leva o código UNEXPECTED no detalhe, para o suporte reconhecer.
 */
export function describeError(err, fallback = UNEXPECTED_ERROR) {
  if (err && err.userMessage) return { message: err.userMessage, detail: err.technicalDetail || err.detail || '' }
  const raw = `${(err && err.name) || 'Error'}: ${(err && err.message) || String(err)}`
  return { message: fallback, detail: maskSecrets(`[UNEXPECTED] ${raw}`) }
}

/** Host e endpoint (sem credenciais) de uma URL, para diagnóstico. */
export function describeUrl(url) {
  try {
    const u = new URL(url)
    const action = u.searchParams.get('action')
    // Fora de .php o caminho pode levar usuário e senha (/playlist/USUARIO/SENHA/m3u_plus): só o último trecho aparece.
    const path = /\.php$/i.test(u.pathname) ? u.pathname : u.pathname.replace(/[^/]+(?=\/)/g, '***')
    return { host: u.origin, endpoint: `${path}${action ? `?action=${action}` : ''}` }
  } catch (_) {
    return { host: String(url || '-'), endpoint: '-' }
  }
}
