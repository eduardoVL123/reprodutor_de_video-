import { storage } from '@/services/storage'
import { maskSecrets } from '@/services/netEnv'

/**
 * Últimos erros do app, guardados só no aparelho (Plano de robustez, item 6): o cliente abre "Diagnóstico" e
 * fotografa para o suporte. Nunca sai do aparelho sozinho. Endereços inteiros viram "[endereço]" (a URL da lista
 * leva usuário e senha) e o resto passa por maskSecrets.
 */
export const ERROR_LOG_KEY = 'diag:errors'
export const ERROR_LOG_MAX = 20
const MESSAGE_MAX = 300

let entries = [] // mais recente primeiro
let loaded = null
let saving = Promise.resolve()

/** Texto seguro para mostrar e guardar: sem URL, sem senha, curto. */
export function cleanErrorText(value) {
  const raw = value && value.message ? `${value.name && value.name !== 'Error' ? `${value.name}: ` : ''}${value.message}` : String(value == null ? '' : value)
  return maskSecrets(raw)
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, '[endereço]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MESSAGE_MAX)
}

/** Junta, uma vez, o que estava salvo com o que já foi registrado nesta abertura do app. */
function load() {
  loaded = loaded || storage
    .get(ERROR_LOG_KEY)
    .catch(() => null)
    .then((saved) => {
      entries = [...entries, ...(Array.isArray(saved) ? saved : [])].slice(0, ERROR_LOG_MAX)
    })
  return loaded.then(() => entries)
}

/** Registra um erro (mais recente primeiro). Nunca lança: o registro não pode derrubar o app. */
export function recordError(error, where = '') {
  try {
    const message = cleanErrorText(error)
    if (!message) return Promise.resolve()
    const entry = { at: Date.now(), where: cleanErrorText(where).slice(0, 60), message }
    entries = [entry, ...entries].slice(0, ERROR_LOG_MAX)
    saving = saving
      .then(load)
      .then((list) => storage.set(ERROR_LOG_KEY, list.slice(0, ERROR_LOG_MAX)))
      .catch(() => {})
    return saving
  } catch (_) {
    return Promise.resolve()
  }
}

/** @returns {Promise<Array<{at:number, where:string, message:string}>>} */
export async function readErrors() {
  await saving
  return [...(await load())]
}

export async function clearErrors() {
  await load()
  await saving
  entries = []
  saving = storage.remove(ERROR_LOG_KEY).catch(() => {})
  await saving
}

/** Erros não tratados do Vue, de scripts e de promessas. Os do Vue continuam no console. */
export function installErrorCapture(app) {
  app.config.errorHandler = (err, _instance, info) => {
    recordError(err, info)
    console.error(err)
  }
  window.addEventListener('error', (event) => recordError(event.error || event.message, 'script'))
  window.addEventListener('unhandledrejection', (event) => recordError(event.reason, 'promessa'))
}

/** Só para testes: esquece o que está em memória. */
export function resetErrorLogForTests() {
  entries = []
  loaded = null
  saving = Promise.resolve()
}
