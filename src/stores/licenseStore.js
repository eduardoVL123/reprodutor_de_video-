import { defineStore } from 'pinia'
import { ref } from 'vue'
import { storage } from '@/services/storage'
import { checkAccess, sendEntry, isLicenseEnabled } from '@/services/licenseApi'
import { getDeviceKey, devicePlatform } from '@/services/deviceIdentity'
import { loadOrCreateInboxKeys } from '@/services/inboxKeys'
import { verifyLicense } from '@/services/licenseSignature'
import { normalizeHost } from '../../server/license/license-rules.mjs'

/**
 * Licença do aparelho (RFC-018): pergunta ao serviço se a lista ativa libera, guarda a resposta no aparelho e
 * conta a entrada (R4).
 *
 * Sem resposta do serviço (G2 revisado em 2026-11-03, antes era "falha aberta"): vale o último estado da MESMA lista,
 * assinado pelo servidor, por até 7 dias (carência). Passou da carência, a lista nunca foi confirmada, o relógio
 * voltou para trás ou o teste/ativação venceu nesse meio-tempo: bloqueia pedindo conexão. Antes, bloquear o servidor
 * no roteador liberava o app para sempre.
 */

const STATE_KEY = 'license:state'
const LAST_SEEN_KEY = 'license:lastSeen' // maior horário do relógio já visto: relógio voltado para trás não reabre a carência

/** Aleatório por consulta: o servidor assina junto e uma resposta gravada não serve de novo (replay). */
function newNonce() {
  const c = globalThis.crypto
  if (!c || !c.getRandomValues) return ''
  return Array.from(c.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('')
}
export const ENTRY_DELAY_MS = 10 * 1000
export const OFFLINE_GRACE_MS = 7 * 24 * 3600 * 1000
// Relógio da TV pode andar um pouco para trás (acerto de horário); mais que isso conta como manipulação.
export const CLOCK_SKEW_MS = 24 * 3600 * 1000
const BLOCKING = ['blocked', 'suspended'] // suspended: o dono bloqueou o aparelho (RFC-019)

export const listHost = (session) => normalizeHost(session && session.baseUrl)

/**
 * A lista de demonstração (vídeos livres da Blender) nunca bloqueia: o revisor das lojas reabre o app depois dos 7 dias
 * de teste e precisa conseguir testar. Só a URL exata do build vale; outra lista no mesmo servidor continua bloqueando.
 */
function isDemoSession(session) {
  const demo = String(import.meta.env.VITE_DEMO_PLAYLIST_URL || '').trim()
  return !!demo && !!session && session.type === 'm3u' && (session.resolvedUrl === demo || session.baseUrl === demo)
}

export const useLicenseStore = defineStore('license', () => {
  const code = ref('')
  const access = ref('')
  const host = ref('')
  const trialEndsAt = ref(0)
  const activationEndsAt = ref(null)
  const checkedAt = ref(0)
  const serverTime = ref(0)
  const lastSeen = ref(0)
  // A última consulta da lista aberta falhou (sem rede ou resposta não assinada): vale a carência.
  const offline = ref(false)
  let loaded = false
  let entryTimer = null
  let refreshSeq = 0 // só a consulta mais nova grava: a resposta atrasada de outra lista não libera a atual

  /** Estado salvo só vale se a assinatura conferir para ESTE aparelho (editar o armazenamento não libera nada). */
  async function load() {
    if (loaded) return
    loaded = true
    try {
      lastSeen.value = Number(await storage.get(LAST_SEEN_KEY)) || 0
      const saved = await storage.get(STATE_KEY)
      if (saved && typeof saved === 'object' && (await verifyLicense(saved, { deviceKey: await getDeviceKey(), host: saved.host || '' }))) {
        apply(saved)
      }
    } catch (_) {}
  }

  function apply(state) {
    code.value = state.code || ''
    access.value = state.access || ''
    host.value = state.host || ''
    trialEndsAt.value = state.trialEndsAt || 0
    activationEndsAt.value = state.activationEndsAt || null
    // checkedAt não é assinado: não pode passar da hora do servidor (assinada), senão editar o storage reabre a carência.
    checkedAt.value = state.serverTime ? Math.min(state.checkedAt || 0, state.serverTime + CLOCK_SKEW_MS) : state.checkedAt || 0
    serverTime.value = state.serverTime || 0
  }

  /** Chave pública da caixa de entrada do site (RFC-021); sem cifra no aparelho, segue sem ela. */
  async function inboxPub() {
    try {
      return (await loadOrCreateInboxKeys()).publicKey
    } catch (_) {
      return undefined
    }
  }

  async function identity(session) {
    return { deviceKey: await getDeviceKey(), platform: devicePlatform(), host: listHost(session), pub: await inboxPub() }
  }

  /**
   * Tela de login (sem lista): registra o aparelho e publica a chave da caixa de entrada para o site poder mandar a
   * primeira lista (RFC-021). Só guarda o código: o estado de acesso salvo é o da lista e continua valendo (G2).
   */
  async function announce() {
    if (!isLicenseEnabled()) return
    await load()
    try {
      const r = await checkAccess({ ...(await identity(null)), host: '' })
      code.value = r.code || code.value
    } catch (err) {
      console.warn('[licença] Serviço indisponível ao registrar o aparelho:', err && err.message)
    }
  }

  /** Pergunta ao serviço sobre a lista da sessão; em falha mantém o que estava salvo. */
  async function refresh(session) {
    if (!isLicenseEnabled() || !session) return
    const my = ++refreshSeq
    await load()
    const now = Date.now()
    if (now > lastSeen.value) {
      lastSeen.value = now
      storage.set(LAST_SEEN_KEY, now).catch(() => {})
    }
    // Outra lista: o "sem serviço" da anterior não vale para ela enquanto a consulta não volta.
    if (listHost(session) !== host.value) offline.value = false
    try {
      const id = await identity(session)
      const nonce = newNonce()
      const r = await checkAccess({ ...id, nonce })
      // Resposta sem a assinatura do servidor (proxy, hosts falso, resposta antiga repetida) vale como fora do ar.
      if (!(await verifyLicense({ ...r, nonce }, id))) throw new Error('resposta sem assinatura válida')
      if (my !== refreshSeq) return
      const state = {
        code: r.code,
        access: r.access,
        host: id.host,
        trialEndsAt: r.trialEndsAt,
        activationEndsAt: r.activationEndsAt,
        serverTime: r.serverTime,
        sig: r.sig,
        nonce,
        checkedAt: Date.now(),
      }
      apply(state)
      offline.value = false
      await storage.set(STATE_KEY, state)
    } catch (err) {
      if (my !== refreshSeq) return
      offline.value = true
      console.warn('[licença] Serviço indisponível; usando o último estado salvo:', err && err.message)
    }
  }

  /**
   * Por que bloquear esta lista: '' (libera), 'offline' (sem confirmação recente: conecte e tente de novo) ou o
   * acesso salvo que bloqueia ('blocked'/'suspended'). Antes da primeira resposta, nada bloqueia.
   */
  function blockReason(session) {
    if (!isLicenseEnabled() || isDemoSession(session)) return ''
    const confirmed = checkedAt.value > 0 && host.value === listHost(session)
    if (!offline.value) return confirmed && BLOCKING.includes(access.value) ? access.value : ''
    if (!confirmed) return 'offline'
    const now = Date.now()
    if (now < lastSeen.value - CLOCK_SKEW_MS) return 'offline' // relógio voltado para trás depois de já ter andado
    const elapsed = Math.max(now, lastSeen.value) - checkedAt.value
    if (elapsed < -CLOCK_SKEW_MS || elapsed > OFFLINE_GRACE_MS) return 'offline'
    if (BLOCKING.includes(access.value)) return access.value
    // Hora do servidor estimada: o teste ou a ativação podem ter vencido enquanto a TV estava sem o serviço.
    const serverNow = (serverTime.value || checkedAt.value) + Math.max(0, elapsed)
    if (access.value === 'trial' && serverNow >= trialEndsAt.value) return 'offline'
    if (access.value === 'activated' && activationEndsAt.value && serverNow >= activationEndsAt.value) return 'offline'
    return ''
  }

  const shouldBlock = (session) => blockReason(session) !== ''

  /** Entrada (R4): lista de parceiro aberta por mais de 10 s. Uma por agendamento (abrir ou voltar ao app). */
  function scheduleEntry(session) {
    cancelEntry()
    if (!isLicenseEnabled() || access.value !== 'partner' || host.value !== listHost(session)) return
    entryTimer = setTimeout(async () => {
      entryTimer = null
      try {
        await sendEntry(await identity(session))
      } catch (err) {
        console.warn('[licença] Entrada não enviada:', err && err.message)
      }
    }, ENTRY_DELAY_MS)
  }

  function cancelEntry() {
    if (entryTimer) clearTimeout(entryTimer)
    entryTimer = null
  }

  return { code, access, trialEndsAt, activationEndsAt, refresh, announce, shouldBlock, blockReason, scheduleEntry, cancelEntry }
})
