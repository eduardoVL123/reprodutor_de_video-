/**
 * Ferramentas de conferência para o console do navegador, instaladas só em `npm run dev`
 * (ver main.js). Ajudam a validar telas novas como uma TV faria:
 *
 *   await __pulse.walk(['Down', 'Right', 'Right', 'Enter', 'Back'])  // controle remoto
 *   __pulse.audit()          // layout idêntico no fallback de TVs antigas? (differ deve ser 0)
 *   __pulse.duplicateIds()   // ids repetidos quebram a memória de foco (deve ser [])
 */

const KEYS = {
  Up: ['ArrowUp', 38],
  Down: ['ArrowDown', 40],
  Left: ['ArrowLeft', 37],
  Right: ['ArrowRight', 39],
  Enter: ['Enter', 13],
  Back: ['Escape', 27],
}

const describeEl = (el) =>
  el ? el.id || `${el.tagName}.${String(el.className && (el.className.baseVal ?? el.className)).slice(0, 30)}` : 'nada'

/** Ids repetidos na página. */
export function duplicateIds() {
  const seen = {}
  const repeated = []
  document.querySelectorAll('[id]').forEach((el) => {
    if (seen[el.id] && repeated.indexOf(el.id) === -1) repeated.push(el.id)
    seen[el.id] = true
  })
  return repeated
}

/** Simula o controle remoto e devolve onde o foco ficou após cada tecla ("Right→item-3"). */
export async function walk(keys, delayMs = 350) {
  const log = []
  for (const name of keys) {
    const [key, keyCode] = KEYS[name]
    const target = document.activeElement || document.body
    const event = new KeyboardEvent('keydown', { key, keyCode, bubbles: true, cancelable: true })
    target.dispatchEvent(event)
    if (name === 'Enter' && !event.defaultPrevented && typeof target.click === 'function') target.click()
    await new Promise((resolve) => setTimeout(resolve, delayMs))
    log.push(`${name}→${describeEl(document.activeElement)}`)
  }
  return log
}

/**
 * Compara a tela normal com a simulação de uma TV sem `gap` em flexbox (classe `no-flex-gap`).
 * `differ` > 0 indica elemento fora do lugar nas TVs antigas (texto solto num flex com gap,
 * margem utilitária brigando com o fallback etc.).
 */
export function audit() {
  const noTransitions = document.createElement('style')
  noTransitions.textContent = '*{transition:none !important}'
  document.head.appendChild(noTransitions)
  const elements = Array.from(document.querySelectorAll('body *'))
  const snapshot = () =>
    elements.map((el) => {
      const r = el.getBoundingClientRect()
      return [r.left, r.top, r.width, r.height]
    })
  const base = snapshot()
  const noGap = document.createElement('style')
  noGap.textContent = '.flex{gap:0 !important}'
  document.head.appendChild(noGap)
  document.documentElement.classList.add('no-flex-gap')
  const fallback = snapshot()
  document.documentElement.classList.remove('no-flex-gap')
  noGap.remove()
  noTransitions.remove()
  const differ = elements.filter((el, i) => base[i].some((v, k) => Math.abs(v - fallback[i][k]) > 0.6))
  return { total: elements.length, differ: differ.length, sample: differ.slice(0, 5).map(describeEl) }
}

export function installDevTools() {
  window.__pulse = { audit, walk, duplicateIds }
}
