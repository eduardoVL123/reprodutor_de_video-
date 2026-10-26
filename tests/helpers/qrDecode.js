import jsQR from 'jsqr'

const QUIET = 4 // margem em módulos que o padrão QR exige em volta
const SCALE = 6

/** Lê de volta um QR (`{ size, path }` de qrSvgData) como um celular leria: preto sobre branco, com margem. */
export function decodeQr({ size, path }) {
  const dark = new Set()
  for (const [, x, y] of path.matchAll(/M(\d+) (\d+)h1v1h-1z/g)) dark.add(`${x},${y}`)
  const side = (size + QUIET * 2) * SCALE
  const pixels = new Uint8ClampedArray(side * side * 4).fill(255)
  for (let py = 0; py < side; py++) {
    for (let px = 0; px < side; px++) {
      const mx = Math.floor(px / SCALE) - QUIET
      const my = Math.floor(py / SCALE) - QUIET
      if (dark.has(`${mx},${my}`)) {
        const i = (py * side + px) * 4
        pixels[i] = pixels[i + 1] = pixels[i + 2] = 0
      }
    }
  }
  const found = jsQR(pixels, side, side)
  return found ? found.data : null
}

/** O mesmo, a partir do <svg> que a tela desenha (viewBox "-4 -4 N N" e um <path> com os módulos). */
export function decodeQrSvg(svg) {
  const [, , width] = svg.getAttribute('viewBox').split(' ').map(Number)
  return decodeQr({ size: width - QUIET * 2, path: svg.querySelector('path').getAttribute('d') })
}
