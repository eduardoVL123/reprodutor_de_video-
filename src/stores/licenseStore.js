import { defineStore } from 'pinia'
import { ref } from 'vue'
import { storage } from '@/services/storage'
import { checkAccess, sendEntry, isLicenseEnabled } from '@/services/licenseApi'
import { getDeviceKey, devicePlatform } from '@/services/deviceIdentity'
import { loadOrCreateInboxKeys } from '@/services/inboxKeys'
import { normalizeHost } from '../../server/license/license-rules.mjs'

/**
 * Licença do aparelho (RFC-018): pergunta ao serviço se a lista ativa libera, guarda a resposta no aparelho e
 * conta a entrada (R4). G2 (falha aberta): sem resposta, vale o último estado salvo da MESMA lista, e um bloqueio
 * salvo só vale por 7 dias; sem nada salvo, libera.
 */

const STATE_KEY = 'license:state'
export const ENTRY_DELAY_MS = 10 * 1000
export const BLOCK_STALE_MS = 7 * 24 * 3600 * 1000
const BLOCKING = ['blocked', 'suspended'] // suspended: o dono bloqueou o aparelho (RFC-019)

export const listHost = (session) => normalizeHost(session && session.baseUrl)

export const useLicenseStore = defineStore('license', () => {
  const code = ref('')
  const access = ref('')
  const host = ref('')
  const trialEndsAt = ref(0)
  const activationEndsAt = ref(null)
  const checkedAt = ref(0)
  let loaded = false
  let entryTimer = null

  async function load() {
    if (loaded) return
    loaded = true
    try {
      const saved = await storage.get(STATE_KEY)
      if (saved && typeof saved === 'object') apply(saved)
    } catch (_) {}
  }

  function apply(state) {
    code.value = state.code || ''
    access.value = state.access || ''
    host.value = state.host || ''
    trialEndsAt.value = state.trialEndsAt || 0
    activationEndsAt.value = state.activationEndsAt || null
    checkedAt.value = state.checkedAt || 0
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
    await load()
    try {
      const id = await identity(session)
      const r = await checkAccess(id)
      const state = { code: r.code, access: r.access, host: id.host, trialEndsAt: r.trialEndsAt, activationEndsAt: r.activationEndsAt, checkedAt: Date.now() }
      apply(state)
      await storage.set(STATE_KEY, state)
    } catch (err) {
      console.warn('[licença] Serviço indisponível; usando o último estado salvo:', err && err.message)
    }
  }

  function shouldBlock(session) {
    if (!isLicenseEnabled() || !BLOCKING.includes(access.value)) return false
    return host.value === listHost(session) && Date.now() - checkedAt.value < BLOCK_STALE_MS
  }

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

  return { code, access, trialEndsAt, activationEndsAt, refresh, announce, shouldBlock, scheduleEntry, cancelEntry }
})
