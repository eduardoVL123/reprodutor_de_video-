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

/**
 * Celular: o User-Agent de telefone traz "Mobile" (Android) ou "iPhone". TVs (Tizen, webOS, Android TV) e tablets
 * Android não se declaram assim. Largura ou `pointer: coarse` não servem: TVs Android de 960px pegariam a regra.
 */
export function isPhone(ua = navigator.userAgent) {
  return /iPhone|iPod|Android.*Mobile/i.test(ua)
}

/**
 * Marca o <html>: `no-flex-gap` quando preciso (o CSS troca o gap por margens, ver tailwind.config.js) e
 * `is-phone` em celular (o CSS aumenta a escala da fonte e os alvos de toque, ver style.css).
 */
export function applyCompatClasses(root = document.documentElement, flexGapSupported = supportsFlexGap, ua = navigator.userAgent) {
  if (!flexGapSupported()) root.classList.add('no-flex-gap')
  if (isPhone(ua)) root.classList.add('is-phone')
}
