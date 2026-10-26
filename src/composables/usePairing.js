import { ref, getCurrentInstance, onBeforeUnmount } from 'vue'
import { useAuthStore } from '@/stores/authStore'
import { createPairingKeys } from '@/services/pairingCrypto'
import { createSession, pollSession, pairPageUrl, pairDisplayUrl, PairingError } from '@/services/pairingApi'
import { normalizeBaseUrl } from '@/services/xtreamApi'

/**
 * Adicionar lista pelo celular (RFC-016), lado da TV.
 *
 * Estados: idle → starting → waiting → received → connecting → done, mais expired e error.
 * `errorKind`: 'unavailable' (sem serviço), 'badData' (o que chegou não abre ou é inválido) e 'login' (a lista recusou).
 * A lista recebida (com a senha) fica só dentro deste módulo; a tela recebe só servidor, apelido e se é http.
 * O login em si é o `auth.login` de sempre, então nada do fluxo existente muda.
 */

const POLL_INTERVAL_MS = 2000
const MAX_POLL_FAILURES = 5
const BAD_DATA_MESSAGE = 'Não foi possível abrir os dados recebidos. Gere um novo código e envie de novo.'
const UNAVAILABLE_MESSAGE = new PairingError('UNAVAILABLE').userMessage

/** Servidor (host:porta) e se a conexão é sem criptografia, com a mesma regra do login (sem protocolo = http). */
function describeList(dns) {
  const url = new URL(normalizeBaseUrl(dns))
  return { host: url.host, insecure: url.protocol === 'http:' }
}

export function usePairing() {
  const auth = useAuthStore()

  const state = ref('idle')
  const code = ref('')
  const pageUrl = ref('')
  const displayUrl = ref('')
  const secondsLeft = ref(0)
  const received = ref(null) // { host, label, insecure }
  const error = ref('')
  const errorDetail = ref('')
  const errorKind = ref('')

  let run = 0 // sobe a cada recomeço ou parada: respostas atrasadas de uma sessão antiga são ignoradas
  let keys = null
  let secret = ''
  let list = null
  let failures = 0
  let expiresAt = 0
  let pollTimer = null
  let tickTimer = null

  function clearTimers() {
    clearTimeout(pollTimer)
    clearInterval(tickTimer)
    pollTimer = null
    tickTimer = null
  }

  function reset() {
    run++
    clearTimers()
    keys = null
    secret = ''
    list = null
    failures = 0
  }

  function fail(kind, message, detail = '') {
    clearTimers()
    keys = null
    list = null
    state.value = 'error'
    errorKind.value = kind
    error.value = message
    errorDetail.value = detail
  }

  function expire() {
    clearTimers()
    keys = null
    secondsLeft.value = 0
    state.value = 'expired'
  }

  function tick() {
    secondsLeft.value = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000))
    if (secondsLeft.value === 0) expire()
  }

  async function receive(box, mine) {
    try {
      const data = await keys.open(box, code.value)
      if (mine !== run) return
      const { host, insecure } = describeList(data.dns)
      clearTimers() // a sessão no servidor já foi consumida: o prazo do código não importa mais
      keys = null
      list = data
      received.value = { host, label: data.label, insecure }
      state.value = 'received'
    } catch (_) {
      if (mine === run) fail('badData', BAD_DATA_MESSAGE)
    }
  }

  async function pollOnce(mine) {
    try {
      const result = await pollSession(code.value, secret)
      if (mine !== run) return
      failures = 0
      if (result.status === 'ready') return await receive(result.box, mine)
    } catch (err) {
      if (mine !== run) return
      if (err && err.code === 'EXPIRED') return expire()
      failures++
      if (failures >= MAX_POLL_FAILURES) return fail('unavailable', (err && err.userMessage) || UNAVAILABLE_MESSAGE)
    }
    schedulePoll(mine)
  }

  function schedulePoll(mine) {
    pollTimer = setTimeout(() => pollOnce(mine), POLL_INTERVAL_MS)
  }

  /** Pede um código novo (descarta o anterior, se houver). */
  async function start() {
    reset()
    const mine = run
    state.value = 'starting'
    code.value = ''
    pageUrl.value = ''
    displayUrl.value = ''
    received.value = null
    error.value = ''
    errorDetail.value = ''
    errorKind.value = ''
    try {
      const newKeys = await createPairingKeys()
      const session = await createSession(newKeys.publicKey)
      if (mine !== run) return
      keys = newKeys
      secret = session.secret
      code.value = session.code
      pageUrl.value = pairPageUrl(session.code)
      displayUrl.value = pairDisplayUrl(session.code)
      expiresAt = Date.now() + session.expiresIn * 1000
      secondsLeft.value = session.expiresIn
      state.value = 'waiting'
      tickTimer = setInterval(tick, 1000)
      schedulePoll(mine)
    } catch (err) {
      if (mine === run) fail('unavailable', (err && err.userMessage) || UNAVAILABLE_MESSAGE)
    }
  }

  /** Entra na lista recebida. @returns {Promise<boolean>} true se conectou. */
  async function confirm() {
    if (state.value !== 'received' || !list) return false
    const mine = run
    const { dns, username, password, label } = list
    state.value = 'connecting'
    auth.clearError()
    const ok = await auth.login({ dns, username, password, label })
    if (mine !== run) return ok
    list = null
    if (ok) {
      state.value = 'done'
    } else {
      fail('login', auth.error, auth.errorDetail)
      auth.clearError() // a mensagem fica no painel; a tela de login não repete
    }
    return ok
  }

  /** Não era a lista certa: esquece o que chegou e pede um código novo. */
  function discard() {
    return start()
  }

  function stop() {
    reset()
    state.value = 'idle'
  }

  if (getCurrentInstance()) onBeforeUnmount(stop)

  return { state, code, pageUrl, displayUrl, secondsLeft, received, error, errorDetail, errorKind, start, confirm, discard, stop }
}
