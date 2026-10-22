/**
 * jsdom não calcula layout. Para testar navegação por setas, descreva a tela com retângulos fixos:
 *
 *   layout(html, { 'group:menu': [0, 0, 96, 720], 'item-0': [120, 400, 200, 300] })
 *
 * Chaves "group:<nome>" apontam para `[data-focus-group="<nome>"]`; as demais são ids.
 * Valores: [x, y, largura, altura] em px.
 */
export function layout(html, rects) {
  document.body.innerHTML = html
  for (const [key, [x, y, w, h]] of Object.entries(rects)) {
    const el = key.startsWith('group:')
      ? document.querySelector(`[data-focus-group="${key.slice(6)}"]`)
      : document.getElementById(key)
    if (!el) throw new Error(`layout(): elemento "${key}" não existe no HTML`)
    el.getBoundingClientRect = () => ({ left: x, top: y, width: w, height: h, right: x + w, bottom: y + h, x, y })
  }
}

/** Dispara uma tecla do controle no elemento focado (mesmo caminho do D-pad real). */
export function press(name) {
  const keys = {
    up: ['ArrowUp', 38],
    down: ['ArrowDown', 40],
    left: ['ArrowLeft', 37],
    right: ['ArrowRight', 39],
    enter: ['Enter', 13],
    back: ['Escape', 27],
  }
  const [key, keyCode] = keys[name]
  ;(document.activeElement || document.body).dispatchEvent(
    new KeyboardEvent('keydown', { key, keyCode, bubbles: true, cancelable: true }),
  )
}
