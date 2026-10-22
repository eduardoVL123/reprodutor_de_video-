/**
 * Compatibilidade com WebViews de Smart TVs antigas (Chromium 63+ em Tizen 5 / webOS 5).
 */

/** `gap` em flexbox só existe a partir do Chromium 84; mede com dois filhos vazios e `row-gap: 1px`. */
export function supportsFlexGap(doc = document) {
  const box = doc.createElement('div')
  box.style.cssText = 'display:flex;flex-direction:column;row-gap:1px;position:absolute;visibility:hidden'
  box.appendChild(doc.createElement('div'))
  box.appendChild(doc.createElement('div'))
  doc.body.appendChild(box)
  const supported = box.scrollHeight === 1
  doc.body.removeChild(box)
  return supported
}

/** Marca o <html> com `no-flex-gap` quando preciso: o CSS troca o gap por margens (ver tailwind.config.js). */
export function applyCompatClasses(root = document.documentElement, flexGapSupported = supportsFlexGap) {
  if (!flexGapSupported()) root.classList.add('no-flex-gap')
}
