/**
 * Funções que o build não converte (ele só reescreve a sintaxe para ES2017) e que WebViews antigos não têm:
 * Fire TV Stick 4K/Cube reprovados na Amazon com tela vazia, e Tizen 5 (Chromium 63). Object.hasOwn vem do Pinia;
 * as outras, do nosso código. Só instala o que falta. Precisa ser o primeiro import de main.js.
 */

const define = (target, name, value) =>
  Object.defineProperty(target, name, { value, writable: true, configurable: true, enumerable: false })

if (typeof globalThis === 'undefined') define(window, 'globalThis', window) // Chromium 71

if (!Object.hasOwn) define(Object, 'hasOwn', (obj, key) => Object.prototype.hasOwnProperty.call(Object(obj), key)) // 93

if (!Object.fromEntries) {
  // Chromium 73
  define(Object, 'fromEntries', (entries) => {
    const out = {}
    for (const [key, value] of entries) out[key] = value
    return out
  })
}

if (!Array.prototype.flatMap) {
  // Chromium 69: um nível só, como o nativo
  define(Array.prototype, 'flatMap', function flatMap(fn, thisArg) {
    return this.reduce((acc, item, i, arr) => acc.concat(fn.call(thisArg, item, i, arr)), [])
  })
}
