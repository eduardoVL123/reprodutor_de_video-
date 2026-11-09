import { watch, onBeforeUnmount } from 'vue'
import { useLicenseStore } from '@/stores/licenseStore'
import { onAppForeground, onAppBackground } from '@/services/platform'

const RECHECK_MS = 6 * 3600 * 1000

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
  // TV de bar ou PC com o app sempre aberto: sem isto o teste de 7 dias nunca vencia. Só consulta: a entrada (R4)
  // continua sendo uma por abertura. shortcut: o vencimento pode passar até 6 h; diminuir se o custo do Worker deixar.
  const recheck = setInterval(() => {
    const session = getSession()
    if (session) license.refresh(session)
  }, RECHECK_MS)

  onBeforeUnmount(() => {
    clearInterval(recheck)
    license.cancelEntry()
    stopForeground()
    stopBackground()
  })
}
