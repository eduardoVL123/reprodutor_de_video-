/**
 * Decide a ação da tecla Voltar no Dashboard (RFC-014):
 *  - Player aberto ou escolha de perfil aberta: eles tratam a tecla -> null
 *  - Fora do Início: volta para 'home'
 *  - No Início: deixa a cadeia de Voltar continuar (sai do app) -> null
 *
 * @param {{ tab: string, playerOpen?: boolean, gateOpen?: boolean }} state
 * @returns {'home' | null}
 */
export function tabBackAction({ tab, playerOpen = false, gateOpen = false } = {}) {
  if (playerOpen || gateOpen) return null
  if (tab && tab !== 'home') return 'home'
  return null
}
