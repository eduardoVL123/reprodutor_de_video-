import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useAuthStore } from '@/stores/authStore'
import { useLicenseStore } from '@/stores/licenseStore'
import { loadOrCreateInboxKeys } from '@/services/inboxKeys'
import { pullInbox, ackInbox, isLicenseEnabled } from '@/services/licenseApi'
import { getDeviceKey } from '@/services/deviceIdentity'
import { describeList } from '@/composables/usePairing'

/**
 * Lista enviada pelo site (RFC-021), lado da TV: procura ao abrir a tela e a cada minuto; a primeira que abrir vira
 * "Adicionar esta lista?" (servidor e apelido, nunca a senha). Confirmar entra com `auth.login` e apaga do servidor;
 * descartar só apaga. Caixa que não abre (outra chave, lixo) é apagada em silêncio.
 */
export const INBOX_POLL_MS = 60 * 1000

export function useSiteInbox() {
  const auth = useAuthStore()
  const license = useLicenseStore()
  const received = ref(null) // { host, label, insecure }
  const connecting = ref(false)
  let pending = null // { id, list }
  let timer = null
  let alive = true

  async function ack(ids) {
    try {
      await ackInbox({ deviceKey: await getDeviceKey(), ids })
    } catch (err) {
      console.warn('[site] Não consegui apagar a lista do servidor:', err && err.message)
    }
  }

  async function check() {
    if (!alive || pending || !isLicenseEnabled() || !license.code) return
    try {
      const boxes = await pullInbox({ deviceKey: await getDeviceKey() })
      if (!boxes.length) return
      const keys = await loadOrCreateInboxKeys()
      const unreadable = []
      for (const { id, box } of boxes) {
        try {
          const list = await keys.open(box, license.code)
          pending = { id, list }
          received.value = { ...describeList(list.dns), label: list.label }
          break
        } catch (_) {
          unreadable.push(id)
        }
      }
      if (unreadable.length) await ack(unreadable)
    } catch (err) {
      console.warn('[site] Não consegui buscar listas enviadas pelo site:', err && err.message)
    }
  }

  function done() {
    pending = null
    received.value = null
  }

  /** @returns {Promise<boolean>} true se entrou na lista */
  async function confirm() {
    if (!pending || connecting.value) return false
    const { id, list } = pending
    connecting.value = true
    try {
      const ok = await auth.login(list)
      await ack([id])
      done()
      return ok
    } finally {
      connecting.value = false
    }
  }

  async function discard() {
    if (!pending) return
    const { id } = pending
    done()
    await ack([id])
  }

  onMounted(() => {
    check()
    timer = setInterval(check, INBOX_POLL_MS)
  })
  onBeforeUnmount(() => {
    alive = false
    clearInterval(timer)
  })

  return { received, connecting, confirm, discard, check }
}
