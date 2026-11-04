import { ref, computed, onBeforeUnmount, getCurrentInstance } from 'vue'
import { isPhone } from '@/utils/compat'

/**
 * Forma do aparelho (RFC-023), num lugar só:
 *  - 'tv': sem tela de toque (TV, PC) — layout de hoje;
 *  - 'phone-landscape': celular ou tablet deitado — layout de celular de hoje;
 *  - 'phone-portrait': celular ou tablet em pé — barra de baixo e telas em uma coluna.
 * O CSS usa as variantes `phone:`/`phone-portrait:` (tailwind.config.js); este composable serve para trocar a
 * estrutura (menu lateral → barra de baixo), que o CSS sozinho não faz.
 */
export function useFormFactor() {
  const handheld = isPhone()
  const query = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(orientation: portrait)') : null
  const portrait = ref(!!(query && query.matches))
  const onChange = (e) => {
    portrait.value = !!e.matches
  }

  if (query && handheld) {
    // Chromium < 72 (TVs antigas) só tem addListener; aqui só roda em aparelho de mão, mas fica o fallback.
    if (query.addEventListener) query.addEventListener('change', onChange)
    else query.addListener(onChange)
    if (getCurrentInstance()) {
      onBeforeUnmount(() => {
        if (query.removeEventListener) query.removeEventListener('change', onChange)
        else query.removeListener(onChange)
      })
    }
  }

  const layout = computed(() => (!handheld ? 'tv' : portrait.value ? 'phone-portrait' : 'phone-landscape'))
  return { layout, isPhonePortrait: computed(() => layout.value === 'phone-portrait') }
}
