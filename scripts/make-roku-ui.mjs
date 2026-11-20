import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { encodePng } from './make-tv-icons.mjs'

/**
 * Imagens da interface do app Roku: a Roku não tem cantos arredondados no Rectangle, então painéis, cartões e botões
 * são PNG 9-patch (.9.png: a borda de 1 px marca em preto a faixa que estica) com as mesmas medidas e cores do CSS do
 * app web. Cores com transparência do CSS (ex.: borda white/10 sobre o painel) já saem misturadas com o fundo onde
 * ficam, como o navegador faria. Ícones de traço saem dos mesmos SVG das telas Vue.
 *
 *   node scripts/make-roku-ui.mjs   (npm run roku:ui)
 */

const SAMPLES = 4 // supersampling por eixo
const OUT = 'roku/images/ui'

const hex = (value) => [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16))
/** Cor `rgb` com opacidade `alpha` por cima de `under` (o que o navegador faz com bg-white/10 etc.). */
export const over = (rgb, alpha, under) => rgb.map((c, i) => Math.round(c * alpha + under[i] * (1 - alpha)))

const WHITE = [255, 255, 255]
const LIME = hex('#B8F000')
const DEEP = hex('#0B0F0C') // tv-deep: fundo das telas
const DIALOG = hex('#121215') // bg-[#121215]: painel do FTUE
const CARD = hex('#141418') // tv-card

/** Distância com sinal até um retângulo de cantos arredondados (negativa dentro). */
function roundedBoxDistance(px, py, x, y, w, h, r) {
  const cx = x + w / 2
  const cy = y + h / 2
  const qx = Math.abs(px - cx) - (w / 2 - r)
  const qy = Math.abs(py - cy) - (h / 2 - r)
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
}

/**
 * Desenha camadas de retângulos arredondados (a última por cima), cada uma { inset, radius, color, maxX? }:
 * `inset` recua a camada da borda da imagem; `maxX` corta a camada à esquerda (faixa do border-left).
 */
function renderLayers(width, height, layers) {
  const pixels = new Float64Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let [r, g, b, a] = [0, 0, 0, 0]
      for (const layer of layers) {
        let hits = 0
        for (let sy = 0; sy < SAMPLES; sy++) {
          for (let sx = 0; sx < SAMPLES; sx++) {
            const px = x + (sx + 0.5) / SAMPLES
            const py = y + (sy + 0.5) / SAMPLES
            const i = layer.inset
            const inside = roundedBoxDistance(px, py, i, i, width - 2 * i, height - 2 * i, layer.radius) <= 0
            if (inside && (layer.maxX === undefined || px <= layer.maxX)) hits++
          }
        }
        const cover = hits / (SAMPLES * SAMPLES)
        if (!cover) continue
        // "por cima" em alfa direto: a camada nova cobre a anterior na proporção da cobertura
        const outA = cover + a * (1 - cover)
        r = (layer.color[0] * cover + r * a * (1 - cover)) / outA
        g = (layer.color[1] * cover + g * a * (1 - cover)) / outA
        b = (layer.color[2] * cover + b * a * (1 - cover)) / outA
        a = outA
      }
      pixels.set([r, g, b, a], (y * width + x) * 4)
    }
  }
  return pixels
}

function toPng(width, height, pixels, { ninePatch = false } = {}) {
  const pad = ninePatch ? 1 : 0
  const W = width + 2 * pad
  const H = height + 2 * pad
  const raw = Buffer.alloc(H * (W * 4 + 1))
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const at = (y + pad) * (W * 4 + 1) + 1 + (x + pad) * 4
      raw.set([0, 1, 2].map((c) => Math.round(pixels[i + c])).concat(Math.round(pixels[i + 3] * 255)), at)
    }
  }
  if (ninePatch) {
    // Marca preta de 1 px no meio do topo e da esquerda: só o centro estica, os cantos ficam iguais.
    raw.set([0, 0, 0, 255], 1 + (Math.floor(W / 2)) * 4)
    raw.set([0, 0, 0, 255], Math.floor(H / 2) * (W * 4 + 1) + 1)
  }
  return encodePng(W, H, raw)
}

/** 9-patch de um retângulo arredondado: o lado é 2× o maior raio + 1 (o pixel do meio é o que estica). */
function ninePatch(layers) {
  const reach = Math.max(...layers.map((l) => l.inset + l.radius))
  const size = 2 * reach + 1
  return toPng(size, size, renderLayers(size, size, layers), { ninePatch: true })
}

/** Traços de SVG (viewBox 24) em PNG: polylines com espessura `stroke` e pontas/juntas redondas. */
function strokeIcon(size, polylines, stroke, color) {
  const scale = size / 24
  const half = (stroke * scale) / 2
  const segments = polylines.flatMap((pts) => pts.slice(1).map((p, i) => [pts[i], p]))
  const pixels = new Float64Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let hits = 0
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const px = (x + (sx + 0.5) / SAMPLES) / scale
          const py = (y + (sy + 0.5) / SAMPLES) / scale
          const near = segments.some(([[x1, y1], [x2, y2]]) => {
            const dx = x2 - x1
            const dy = y2 - y1
            const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy || 1)))
            return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy)) * scale <= half
          })
          if (near) hits++
        }
      }
      pixels.set([...color, hits / (SAMPLES * SAMPLES)], (y * size + x) * 4)
    }
  }
  return toPng(size, size, pixels)
}

/** Pontos de uma curva cúbica de Bézier (sem o primeiro). */
function cubic([x0, y0], [x1, y1], [x2, y2], [x3, y3], steps = 24) {
  return Array.from({ length: steps }, (_, i) => {
    const t = (i + 1) / steps
    const u = 1 - t
    return [u ** 3 * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t ** 3 * x3, u ** 3 * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t ** 3 * y3]
  })
}

// Escudo do FTUE (src/views/FTUE.vue): "M12 3l8 3v6c0 4.5-3.2 8.2-8 9-4.8-.8-8-4.5-8-9V6l8-3z" + "M9 12l2 2 4-4".
const SHIELD = [
  [[12, 3], [20, 6], [20, 12], ...cubic([20, 12], [20, 16.5], [16.8, 20.2], [12, 21]), ...cubic([12, 21], [7.2, 20.2], [4, 16.5], [4, 12]), [4, 6], [12, 3]],
  [[9, 12], [11, 14], [15, 10]],
]

const btnSecondary = over(WHITE, 0.06, DIALOG) // bg-white/[0.06] sobre o painel
const termCard = over(DEEP, 0.6, DIALOG) // bg-tv-bg/60 sobre o painel
const iconBox = over(WHITE, 0.08, DIALOG) // bg-white/[0.08]

export const OUTPUTS = [
  // Painel do FTUE: rounded-2xl (16), borda white/10 de 1 px, fundo #121215.
  ['dialog.9.png', () => ninePatch([{ inset: 0, radius: 16, color: over(WHITE, 0.1, DIALOG) }, { inset: 1, radius: 15, color: DIALOG }])],
  // Aviso legal: fundo tv-card, border-l-8 limão, cantos 16.
  ['notice.9.png', () => ninePatch([{ inset: 0, radius: 16, color: CARD }, { inset: 0, radius: 16, color: LIME, maxX: 8 }])],
  // Cartão dos termos: borda 2 px white/10, fundo tv-bg/60, cantos 16.
  ['term-card.9.png', () => ninePatch([{ inset: 0, radius: 16, color: over(WHITE, 0.1, termCard) }, { inset: 2, radius: 14, color: termCard }])],
  // Quadro do ícone do FTUE: 80×80, white/[0.08], borda white/10, cantos 16.
  ['icon-box.9.png', () => ninePatch([{ inset: 0, radius: 16, color: over(WHITE, 0.1, iconBox) }, { inset: 1, radius: 15, color: iconBox }])],
  // .tv-btn: rounded-lg (8), borda 1 px white/15, fundo white/[0.06].
  ['btn.9.png', () => ninePatch([{ inset: 0, radius: 8, color: over(WHITE, 0.15, btnSecondary) }, { inset: 1, radius: 7, color: btnSecondary }])],
  // .tv-btn-primary: branco.
  ['btn-primary.9.png', () => ninePatch([{ inset: 0, radius: 8, color: WHITE }])],
  // Foco (.tv-focusable): anel branco de 2 px afastado 3 px por uma faixa grafite (ring-offset #0b0f0c).
  ['focus-ring.9.png', () => ninePatch([{ inset: 0, radius: 13, color: WHITE }, { inset: 2, radius: 11, color: DEEP }])],
  ['icon-shield.png', () => strokeIcon(56, SHIELD, 1.8, WHITE)],
]

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  mkdirSync(join(root, OUT), { recursive: true })
  for (const [name, render] of OUTPUTS) {
    writeFileSync(join(root, OUT, name), render())
    console.log(`[roku-ui] ${OUT}/${name}`)
  }
}
