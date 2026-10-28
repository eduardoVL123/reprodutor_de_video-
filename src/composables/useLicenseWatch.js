import { watch, onBeforeUnmount } from 'vue'
import { useLicenseStore } from '@/stores/licenseStore'
import { onAppForeground, onAppBackground } from '@/services/platform'

/**
 * Liga a licença (RFC-018) ao ciclo do app: abrir ou trocar de lista e voltar ao app consultam o serviço; a entrada
 * de 10 s (R4) só é agendada com a lista carregada, para o parceiro não pagar por quem só viu erro; sair do app ou a
 * lista deixar de estar carregada cancela a entrada pendente.
 * @param {() => object|null} getSession sessão da lista ativa (authStore.session)
 * @param {() => boolean} isListLoaded a lista carregou (alguma seção do catálogo pronta)
 */
export function useLicenseWatch(getSession, isListLoaded) {
  const license = useLicenseStore()

  function scheduleIfLoaded() {
    const session = getSession()
    if (session && isListLoaded()) license.scheduleEntry(session)
    else license.cancelEntry()
  }

  async function check() {
    const session = getSession()
    if (!session) return
    await license.refresh(session)
    scheduleIfLoaded()
  }

  watch(() => getSession() && getSession().id, check, { immediate: true })
  watch(isListLoaded, scheduleIfLoaded)
  const stopForeground = onAppForeground(check)
  const stopBackground = onAppBackground(() => license.cancelEntry())

  onBeforeUnmount(() => {
    license.cancelEntry()
    stopForeground()
    stopBackground()
  })
}
