import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { encodePng, SYMBOL_PATHS, arcPoints, insidePolygon } from './make-tv-icons.mjs'

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
const ACC_CARD = hex('#141A15') // .acc-card da Conta
const FAV_CARD = hex('#121215') // cartão da aba Favoritos

/** Distância com sinal até um retângulo de cantos arredondados (negativa dentro). */
function roundedBoxDistance(px, py, x, y, w, h, r) {
  const cx = x + w / 2
  const cy = y + h / 2
  const qx = Math.abs(px - cx) - (w / 2 - r)
  const qy = Math.abs(py - cy) - (h / 2 - r)
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
}

/**
 * Desenha camadas de retângulos arredondados (a última por cima), cada uma { inset, radius, color, maxX?, alpha?,
 * outside?, hole? }: `inset` recua a camada da borda da imagem; `maxX` corta a camada à esquerda (faixa do
 * border-left); `alpha` é a opacidade da cor (bg-white/15 sobre o que estiver atrás, na TV); `outside` pinta o lado
 * de fora do retângulo (máscara dos cantos); `hole` { inset, radius } tira um retângulo de dentro (só a borda fica).
 */
function renderLayers(width, height, layers) {
  const pixels = new Float64Array(width * height * 4)
  const inBox = (px, py, inset, radius) => roundedBoxDistance(px, py, inset, inset, width - 2 * inset, height - 2 * inset, radius) <= 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let [r, g, b, a] = [0, 0, 0, 0]
      for (const layer of layers) {
        let hits = 0
        for (let sy = 0; sy < SAMPLES; sy++) {
          for (let sx = 0; sx < SAMPLES; sx++) {
            const px = x + (sx + 0.5) / SAMPLES
            const py = y + (sy + 0.5) / SAMPLES
            let inside = inBox(px, py, layer.inset, layer.radius) !== Boolean(layer.outside)
            if (inside && layer.hole) inside = !inBox(px, py, layer.hole.inset, layer.hole.radius)
            // Borda tracejada (border-dashed): [período, traço] ao longo do lado mais perto.
            if (inside && layer.dash) inside = (Math.min(py, height - py) < Math.min(px, width - px) ? px : py) % layer.dash[0] < layer.dash[1]
            if (inside && (layer.maxX === undefined || px <= layer.maxX)) hits++
          }
        }
        const cover = (hits / (SAMPLES * SAMPLES)) * (layer.alpha ?? 1)
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

/**
 * Traços de SVG (viewBox 24) em PNG: polylines com espessura `stroke` e pontas/juntas redondas. Cada camada
 * { polylines, stroke, opacity } é desenhada por cima da anterior (ex.: o "carregando" tem o anel a 25 % e o arco cheio).
 */
function strokeIcon(size, layers, color) {
  const scale = size / 24
  const prepared = layers.map((layer) => ({
    ...layer,
    half: (layer.stroke * scale) / 2,
    segments: layer.polylines.flatMap((pts) => pts.slice(1).map((p, i) => [pts[i], p])),
  }))
  const pixels = new Float64Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let alpha = 0
      for (const { half, segments, opacity = 1 } of prepared) {
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
        const cover = (hits / (SAMPLES * SAMPLES)) * opacity
        alpha = cover + alpha * (1 - cover)
      }
      pixels.set([...color, alpha], (y * size + x) * 4)
    }
  }
  return toPng(size, size, pixels)
}

/** Arco SVG (A rx ry rot large sweep x y) em pontos, pela conversão de ponto final para centro da especificação SVG. */
function svgArc([x1, y1], rx, ry, rotation, largeArc, sweep, x2, y2, steps = 24) {
  if (rx === 0 || ry === 0) return [[x2, y2]]
  const phi = (rotation * Math.PI) / 180
  const cos = Math.cos(phi)
  const sin = Math.sin(phi)
  const dx = (x1 - x2) / 2
  const dy = (y1 - y2) / 2
  const x1p = cos * dx + sin * dy
  const y1p = -sin * dx + cos * dy
  rx = Math.abs(rx)
  ry = Math.abs(ry)
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry)
  if (lambda > 1) {
    rx *= Math.sqrt(lambda)
    ry *= Math.sqrt(lambda)
  }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p
  const coef = (largeArc === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den))
  const cxp = (coef * rx * y1p) / ry
  const cyp = (-coef * ry * x1p) / rx
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2
  const angle = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)
  const theta = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry)
  let delta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry)
  if (!sweep && delta > 0) delta -= 2 * Math.PI
  if (sweep && delta < 0) delta += 2 * Math.PI
  return Array.from({ length: steps }, (_, i) => {
    const t = theta + (delta * (i + 1)) / steps
    return [cos * rx * Math.cos(t) - sin * ry * Math.sin(t) + cx, sin * rx * Math.cos(t) + cos * ry * Math.sin(t) + cy]
  })
}

/** Atributo `d` de um <path> em polylines (uma por subcaminho): M L H V C S Q A Z, maiúsculas e minúsculas. */
export function svgPath(d) {
  const tokens = d.match(/[a-zA-Z]|-?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/g) || []
  const lines = []
  let current = null
  let [x, y] = [0, 0]
  let [startX, startY] = [0, 0]
  let lastControl = null
  let command = ''
  let i = 0
  const number = () => parseFloat(tokens[i++])
  const flag = () => {
    // Flags de arco podem vir coladas ("0 0117"): consome um dígito por vez.
    const token = tokens[i]
    if (token.length > 1 && /^[01]/.test(token)) {
      tokens[i] = token.slice(1)
      return Number(token[0])
    }
    i++
    return Number(token)
  }
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) command = tokens[i++]
    const relative = command === command.toLowerCase()
    const ox = relative ? x : 0
    const oy = relative ? y : 0
    switch (command.toUpperCase()) {
      case 'M':
        x = ox + number()
        y = oy + number()
        current = [[x, y]]
        lines.push(current)
        ;[startX, startY] = [x, y]
        command = relative ? 'l' : 'L' // pares seguintes ao M são linhas
        lastControl = null
        break
      case 'L':
        x = ox + number()
        y = oy + number()
        current.push([x, y])
        lastControl = null
        break
      case 'H':
        x = ox + number()
        current.push([x, y])
        lastControl = null
        break
      case 'V':
        y = oy + number()
        current.push([x, y])
        lastControl = null
        break
      case 'C':
      case 'S': {
        let c1
        if (command.toUpperCase() === 'C') {
          c1 = [ox + number(), oy + number()]
        } else {
          c1 = lastControl ? [2 * x - lastControl[0], 2 * y - lastControl[1]] : [x, y]
        }
        const c2 = [ox + number(), oy + number()]
        const end = [ox + number(), oy + number()]
        current.push(...cubic([x, y], c1, c2, end))
        lastControl = c2
        ;[x, y] = end
        break
      }
      case 'Q': {
        const c = [ox + number(), oy + number()]
        const end = [ox + number(), oy + number()]
        current.push(...cubic([x, y], [x + (2 / 3) * (c[0] - x), y + (2 / 3) * (c[1] - y)], [end[0] + (2 / 3) * (c[0] - end[0]), end[1] + (2 / 3) * (c[1] - end[1])], end))
        lastControl = null
        ;[x, y] = end
        break
      }
      case 'A': {
        const rx = number()
        const ry = number()
        const rotation = number()
        const large = flag()
        const sweep = flag()
        const end = [ox + number(), oy + number()]
        current.push(...svgArc([x, y], rx, ry, rotation, large, sweep, end[0], end[1]))
        ;[x, y] = end
        lastControl = null
        break
      }
      case 'Z':
        current.push([startX, startY])
        ;[x, y] = [startX, startY]
        lastControl = null
        break
      default:
        throw new Error(`Comando SVG não suportado: ${command}`)
    }
  }
  return lines
}

/** Formas SVG (viewBox 24) em polylines: { d } | { circle: [cx, cy, r] } | { rect: [x, y, w, h, rx] } | { points: [...] }. */
function svgShapes(shapes) {
  return shapes.flatMap((shape) => {
    if (shape.d) return svgPath(shape.d)
    if (shape.circle) {
      const [cx, cy, r] = shape.circle
      return [arcPath(cx, cy, r, 0, 2 * Math.PI, 64)]
    }
    if (shape.rect) {
      const [x, y, w, h, rx = 0] = shape.rect
      return [rx ? roundedRectPath(x, y, w, h, rx) : [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]]]
    }
    if (shape.points) {
      const pts = []
      for (let k = 0; k < shape.points.length; k += 2) pts.push([shape.points[k], shape.points[k + 1]])
      return [shape.closed ? [...pts, pts[0]] : pts]
    }
    return []
  })
}

/** Ícone SVG de traço (stroke-current) em branco: a Roku tinge com blendColor, como o currentColor do CSS. */
function svgIcon(size, shapes, { stroke = 2, fill = false } = {}) {
  const polylines = svgShapes(shapes)
  if (fill) return fillIcon(size, polylines, WHITE)
  return strokeIcon(size, [{ polylines, stroke }], WHITE)
}

/** Polígonos preenchidos (fill="currentColor"), viewBox 24. */
function fillIcon(size, polygons, color) {
  const scale = size / 24
  const pixels = new Float64Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let hits = 0
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const px = (x + (sx + 0.5) / SAMPLES) / scale
          const py = (y + (sy + 0.5) / SAMPLES) / scale
          if (polygons.some((points) => insidePolygon(points, px, py))) hits++
        }
      }
      pixels.set([...color, hits / (SAMPLES * SAMPLES)], (y * size + x) * 4)
    }
  }
  return toPng(size, size, pixels)
}

/**
 * Degradê linear do CSS em PNG estreito (a Roku estica): `stops` = [[posição 0..1, [r,g,b], alfa], ...].
 * vertical = de cima para baixo; horizontal = da esquerda para a direita.
 */
function gradient(length, stops, { vertical = false } = {}) {
  const pixels = new Float64Array(length * 4)
  for (let i = 0; i < length; i++) {
    const t = (i + 0.5) / length
    let k = 0
    while (k < stops.length - 2 && t > stops[k + 1][0]) k++
    const [p0, c0, a0] = stops[k]
    const [p1, c1, a1] = stops[k + 1]
    const f = Math.min(1, Math.max(0, (t - p0) / (p1 - p0 || 1)))
    // Mistura em alfa pré-multiplicado, como o navegador faz nos degradês.
    const alpha = a0 + (a1 - a0) * f
    const rgb = c0.map((c, j) => (alpha ? (c * a0 * (1 - f) + c1[j] * a1 * f) / alpha : c))
    pixels.set([...rgb, alpha], i * 4)
  }
  return vertical ? toPng(1, length, pixels) : toPng(length, 1, pixels)
}

/** Símbolo da marca como o BrandMark.vue: caminhos "small" do kit no recorte 52 48 152 160, altura `height` px. */
function brandMark(height, color) {
  const box = { x: 52, y: 48, width: 152, height: 160 }
  const scale = height / box.height
  const width = Math.round(box.width * scale)
  const polygons = SYMBOL_PATHS.map((commands) => {
    const points = []
    for (const [op, ...args] of commands) {
      if (op === 'A') points.push(...arcPoints(points[points.length - 1], ...args))
      else points.push(args)
    }
    return points
  })
  const pixels = new Float64Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let hits = 0
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const bx = box.x + (x + (sx + 0.5) / SAMPLES) / scale
          const by = box.y + (y + (sy + 0.5) / SAMPLES) / scale
          if (polygons.some((points) => insidePolygon(points, bx, by))) hits++
        }
      }
      pixels.set([...color, hits / (SAMPLES * SAMPLES)], (y * width + x) * 4)
    }
  }
  return toPng(width, height, pixels)
}

/** Retângulo de cantos arredondados como polyline (viewBox 24), para ícones como o teclado. */
function roundedRectPath(x, y, w, h, r) {
  const corner = (cx, cy, from) => Array.from({ length: 7 }, (_, i) => {
    const a = from + (Math.PI / 2) * (i / 6)
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
  })
  return [
    ...corner(x + w - r, y + r, -Math.PI / 2),
    ...corner(x + w - r, y + h - r, 0),
    ...corner(x + r, y + h - r, Math.PI / 2),
    ...corner(x + r, y + r, Math.PI),
    [x + w - r, y],
  ]
}

/** Arco de circunferência (viewBox 24) de `from` a `to` radianos. */
function arcPath(cx, cy, r, from, to, steps = 24) {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const a = from + ((to - from) * i) / steps
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
  })
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

const NEUTRAL_400 = hex('#A3A3A3')
const RED_500 = hex('#EF4444')
const errorBg = over(RED_500, 0.1, DIALOG) // bg-red-500/10 sobre o painel
const errorDetailBg = over([0, 0, 0], 0.5, errorBg) // bg-black/50 dentro da caixa de erro
const btnSecondary = over(WHITE, 0.06, DIALOG) // bg-white/[0.06] sobre o painel
const termCard = over(DEEP, 0.6, DIALOG) // bg-tv-bg/60 sobre o painel
const iconBox = over(WHITE, 0.08, DIALOG) // bg-white/[0.08]
const LIST_CARD = over(WHITE, 0.02, DIALOG) // cartão de lista: bg-white/[0.02] sobre o painel
const LIST_CARD_ACTIVE = over(WHITE, 0.04, DIALOG) // lista ativa: bg-white/[0.04]
const EMERALD = hex('#10B981')
const AMBER = hex('#F59E0B')

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
  ['icon-shield.png', () => strokeIcon(56, [{ polylines: SHIELD, stroke: 1.8 }], WHITE)],

  // ---- Login (src/views/Login.vue) ----
  // Símbolo ao lado de "PULSE PLAYER · CONEXÃO": BrandMark size 1.5 (24 px), limão.
  ['brand-mark.png', () => brandMark(24, LIME)],
  // Ícone de teclado da dica: rect 2,4 20×16 rx 2 + 4 pontos, traço 2, neutral-400.
  ['icon-keyboard.png', () => strokeIcon(16, [{ polylines: [roundedRectPath(2, 4, 20, 16, 2), [[6, 8], [6.01, 8]], [[10, 8], [10.01, 8]], [[14, 8], [14.01, 8]], [[18, 8], [18.01, 8]]], stroke: 2 }], NEUTRAL_400)],
  // .tv-input: rounded-lg, borda 1 px white/15, fundo tv-bg.
  ['input.9.png', () => ninePatch([{ inset: 0, radius: 8, color: over(WHITE, 0.15, DEEP) }, { inset: 1, radius: 7, color: DEEP }])],
  // .tv-input:focus: borda branca + ring-1 branco afastado 3 px por grafite (ring-offset).
  ['input-focus.9.png', () => ninePatch([{ inset: 0, radius: 12, color: WHITE }, { inset: 1, radius: 11, color: DEEP }, { inset: 4, radius: 8, color: WHITE }, { inset: 5, radius: 7, color: DEEP }])],
  // Caixa de erro: rounded-2xl, border-2 red-500/60, fundo red-500/10, sobre o painel.
  ['error-box.9.png', () => ninePatch([{ inset: 0, radius: 16, color: over(RED_500, 0.6, errorBg) }, { inset: 2, radius: 14, color: errorBg }])],
  // Detalhe técnico do erro: rounded (4), borda red-500/20, fundo black/50, dentro da caixa de erro.
  ['error-detail.9.png', () => ninePatch([{ inset: 0, radius: 4, color: over(RED_500, 0.2, errorDetailBg) }, { inset: 1, radius: 3, color: errorDetailBg }])],
  // Círculo decorativo do canto: 35rem (560 px), bg-tv-accent/10 sobre o fundo.
  ['glow-circle.png', () => toPng(560, 560, renderLayers(560, 560, [{ inset: 0, radius: 280, color: over(LIME, 0.1, DEEP) }]))],
  // "Conectando...": anel a 25 % + arco "M21 12a9 9 0 0 0-9-9", traço 3, 32 px, preto (sobre o botão branco).
  ['spinner.png', () => strokeIcon(32, [{ polylines: [arcPath(12, 12, 9, 0, 2 * Math.PI, 48)], stroke: 3, opacity: 0.25 }, { polylines: [arcPath(12, 12, 9, 0, -Math.PI / 2)], stroke: 3 }], [0, 0, 0])],

  // ---- Início (src/views/Dashboard.vue e src/components/SideMenu.vue) ----
  // Ícones do menu lateral (w-6, stroke 2), brancos: a tela tinge (neutral-400 / branco no ativo).
  ['icon-search.png', () => svgIcon(24, [{ circle: [11, 11, 7] }, { d: 'M20 20l-3.5-3.5' }])],
  ['icon-home.png', () => svgIcon(24, [{ d: 'M3 10l9-7 9 7v10H3z' }])],
  ['icon-live.png', () => svgIcon(24, [{ rect: [3, 6, 18, 12, 2] }, { d: 'M8 3l4 3 4-3' }])],
  ['icon-vod.png', () => svgIcon(24, [{ rect: [4, 3, 16, 18, 2] }, { d: 'M4 8h16M4 16h16' }])],
  ['icon-series.png', () => svgIcon(24, [{ rect: [3, 5, 18, 12, 2] }, { d: 'M8 21h8' }])],
  ['icon-heart.png', () => svgIcon(24, [{ d: 'M12 20s-7-4.5-7-10a4 4 0 017-2.5A4 4 0 0119 10c0 5.5-7 10-7 10z' }])],
  ['icon-account.png', () => svgIcon(24, [{ circle: [12, 8, 4] }, { d: 'M4 21c0-4 3.5-7 8-7s8 3 8 7' }])],
  // Botões do destaque (w-4): play cheio, informação e favoritos (contorno e cheio).
  ['icon-play.png', () => svgIcon(16, [{ points: [5, 3, 19, 12, 5, 21, 5, 3] }], { fill: true })],
  ['icon-info.png', () => svgIcon(16, [{ circle: [12, 12, 10] }, { points: [12, 16, 12, 12] }, { points: [12, 8, 12.01, 8] }])],
  ['icon-heart-small.png', () => svgIcon(16, [{ d: 'M12 20s-7-4.5-7-10a4 4 0 017-2.5A4 4 0 0119 10c0 5.5-7 10-7 10z' }])],
  ['icon-heart-filled.png', () => svgIcon(16, [{ d: 'M12 20s-7-4.5-7-10a4 4 0 017-2.5A4 4 0 0119 10c0 5.5-7 10-7 10z' }], { fill: true })],
  // "Ver todos" (chevron) e o ícone de canais da fileira ao vivo (w-5).
  ['icon-chevron-right.png', () => svgIcon(24, [{ points: [9, 18, 15, 12, 9, 6] }])],
  // Detalhes (MediaDetailsModal.vue): Voltar e "Assistir do início", w-4 stroke 2.
  // .tv-badge (selo E1 do episódio): rounded (4), bg-black/60, border white/25.
  ['badge.9.png', () => ninePatch([{ inset: 0, radius: 4, color: WHITE, alpha: 0.25, hole: { inset: 1, radius: 3 } }, { inset: 1, radius: 3, color: [0, 0, 0], alpha: 0.6 }])],
  // ---- Abas do catálogo (src/components/CatalogBrowser.vue e GridItem.vue) ----
  // Categoria: rounded-full; inativa bg-white/[0.08] + border white/10; ativa bg-tv-accent. Anel de foco em volta.
  ['pill.9.png', () => ninePatch([{ inset: 0, radius: 17, color: WHITE, alpha: 0.1, hole: { inset: 1, radius: 16 } }, { inset: 1, radius: 16, color: WHITE, alpha: 0.08 }])],
  ['pill-active.9.png', () => ninePatch([{ inset: 0, radius: 16, color: LIME }])],
  ['focus-ring-pill.9.png', () => ninePatch([{ inset: 0, radius: 22, color: WHITE }, { inset: 2, radius: 20, color: DEEP }])],
  // Controle parental / Atualizar lista: rounded-lg bg-white/[0.06] border white/10.
  ['btn-soft.9.png', () => ninePatch([{ inset: 0, radius: 8, color: WHITE, alpha: 0.1, hole: { inset: 1, radius: 7 } }, { inset: 1, radius: 7, color: WHITE, alpha: 0.06 }])],
  // Mais informações / favoritos do destaque da aba: rounded-lg bg-white/10 border white/10.
  ['btn-hero.9.png', () => ninePatch([{ inset: 0, radius: 8, color: WHITE, alpha: 0.1, hole: { inset: 1, radius: 7 } }, { inset: 1, radius: 7, color: WHITE, alpha: 0.1 }])],
  // Selos: ● AO VIVO (bg #ef4444) e NOVO (bg-tv-accent), rounded (4).
  ['badge-red.9.png', () => ninePatch([{ inset: 0, radius: 4, color: hex('#EF4444') }])],
  ['badge-lime.9.png', () => ninePatch([{ inset: 0, radius: 4, color: LIME }])],
  // Faixa do nome no pôster: bg-gradient-to-t from-black/95 via-black/60 (o da grade usa via-black/70).
  ['title-shade.png', () => gradient(56, [[0, [0, 0, 0], 0], [0.5, [0, 0, 0], 0.6], [1, [0, 0, 0], 0.95]], { vertical: true })],
  ['title-shade-grid.png', () => gradient(69, [[0, [0, 0, 0], 0], [0.5, [0, 0, 0], 0.7], [1, [0, 0, 0], 0.95]], { vertical: true })],
  // Destaque da aba: bg-gradient-to-r from-deep via-deep/85 to-transparent e to-t from-deep via-deep/30.
  ['hero-fade-r.png', () => gradient(256, [[0, DEEP, 1], [0.5, DEEP, 0.85], [1, DEEP, 0]])],
  ['hero-fade-t.png', () => gradient(256, [[0, DEEP, 0], [0.5, DEEP, 0.3], [1, DEEP, 1]], { vertical: true })],
  // Fim da faixa de categorias: some em degradê (mask-image) sobre o cabeçalho bg-[#0b0f0c]/90.
  ['strip-fade.png', () => gradient(64, [[0, DEEP, 0], [1, DEEP, 0.9]])],
  ['icon-lock.png', () => svgIcon(16, [{ rect: [5, 11, 14, 10, 2] }, { d: 'M8 11V7a4 4 0 0 1 8 0v4' }])],
  ['icon-refresh.png', () => svgIcon(16, [{ points: [23, 4, 23, 10, 17, 10] }, { d: 'M20.49 15a9 9 0 1 1-2.12-9.36L23 10' }])],
  ['icon-back.png', () => svgIcon(16, [{ points: [19, 12, 5, 12] }, { points: [12, 19, 5, 12, 12, 5] }])],
  ['icon-restart.png', () => svgIcon(16, [{ points: [1, 4, 1, 10, 7, 10] }, { d: 'M3.51 15a9 9 0 1 0 2.13-9.36L1 10' }])],
  ['icon-broadcast.png', () => svgIcon(20,[{ d: 'M4.93 19.07A10 10 0 0 1 19.07 4.93' }, { d: 'M7.76 16.24a6 6 0 0 1 8.48-8.48' }, { circle: [12, 12, 2] }])],
  // Item do menu: ativo bg-white/15, rounded-xl (12).
  // Busca (SearchScreen.vue): ícones de Espaço, Apagar e buscas recentes; filtro (rounded-lg) e sugestão focada.
  ['icon-space.png', () => svgIcon(24, [{ points: [3, 10, 3, 15, 21, 15, 21, 10] }], { stroke: 1.75 })],
  ['icon-backspace.png', () => svgIcon(24, [{ d: 'M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z' }, { points: [18, 9, 12, 15] }, { points: [12, 9, 18, 15] }], { stroke: 1.75 })],
  ['icon-clock.png', () => svgIcon(20, [{ circle: [12, 12, 10] }, { points: [12, 6, 12, 12, 16, 14] }], { stroke: 1.75 })],
  ['chip-soft.9.png', () => ninePatch([{ inset: 0, radius: 8, color: WHITE, alpha: 0.1, hole: { inset: 1, radius: 7 } }, { inset: 1, radius: 7, color: WHITE, alpha: 0.04 }])],
  ['chip-active.9.png', () => ninePatch([{ inset: 0, radius: 8, color: LIME }])],
  ['row-focus.9.png', () => ninePatch([{ inset: 0, radius: 8, color: WHITE, alpha: 0.08 }])],
  // Conta (AccountScreen.vue): .acc-card (rounded 16, #141a15, borda white/8), anel das linhas (rounded 16) e os
  // ícones das linhas (w-7, stroke 1.9), brancos para a tela tingir.
  ['acc-card.9.png', () => ninePatch([{ inset: 0, radius: 16, color: over(WHITE, 0.08, ACC_CARD) }, { inset: 1, radius: 15, color: ACC_CARD }])],
  // Gerenciador de listas (ListManagerModal.vue), sobre o painel #121215: cartão da lista (rounded-xl; ativa com borda
  // limão e white/4, as outras white/10 e white/2), selos ATIVA e SEM CRIPTOGRAFIA (cor/15, borda cor/30, rounded),
  // Excluir confirmando (borda red-400) e os ícones de Fechar, lixeira e sair (w-4).
  ['list-card.9.png', () => ninePatch([{ inset: 0, radius: 12, color: over(WHITE, 0.1, LIST_CARD) }, { inset: 1, radius: 11, color: LIST_CARD }])],
  ['list-card-active.9.png', () => ninePatch([{ inset: 0, radius: 12, color: LIME }, { inset: 1, radius: 11, color: LIST_CARD_ACTIVE }])],
  ['badge-ok.9.png', () => ninePatch([{ inset: 0, radius: 4, color: over(EMERALD, 0.3, LIST_CARD_ACTIVE) }, { inset: 1, radius: 3, color: over(EMERALD, 0.15, LIST_CARD_ACTIVE) }])],
  ['badge-warn.9.png', () => ninePatch([{ inset: 0, radius: 4, color: over(AMBER, 0.3, LIST_CARD_ACTIVE) }, { inset: 1, radius: 3, color: over(AMBER, 0.15, LIST_CARD_ACTIVE) }])],
  ['btn-danger.9.png', () => ninePatch([{ inset: 0, radius: 8, color: hex('#F87171') }, { inset: 1, radius: 7, color: btnSecondary }])],
  ['icon-close.png', () => svgIcon(16, [{ points: [18, 6, 6, 18] }, { points: [6, 6, 18, 18] }])],
  ['icon-trash.png', () => svgIcon(16, [{ points: [3, 6, 5, 6, 21, 6] }, { d: 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2' }], { stroke: 1.75 })],
  ['icon-logout.png', () => svgIcon(16, [{ d: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4' }, { points: [16, 17, 21, 12, 16, 7] }, { points: [21, 12, 9, 12] }])],
  // Escolha de perfil (ProfileGate.vue): borda branca do avatar focado (border-2, rounded-xl) e o cartão "Adicionar
  // Perfil" (152×152, bg-white/[0.03], border-2 dashed white/20; branca com foco) e o + (w-12, stroke 1.75).
  ['avatar-ring-12.9.png', () => ninePatch([{ inset: 0, radius: 12, color: WHITE, hole: { inset: 2, radius: 10 } }])],
  ['add-profile.png', () => toPng(152, 152, renderLayers(152, 152, [{ inset: 0, radius: 12, color: WHITE, alpha: 0.03 }, { inset: 0, radius: 12, color: WHITE, alpha: 0.2, hole: { inset: 2, radius: 10 }, dash: [12, 6] }]))],
  ['add-profile-focus.png', () => toPng(152, 152, renderLayers(152, 152, [{ inset: 0, radius: 12, color: WHITE, alpha: 0.03 }, { inset: 0, radius: 12, color: WHITE, hole: { inset: 2, radius: 10 }, dash: [12, 6] }]))],
  // Cores do novo perfil (w-8 rounded-full): bolinha branca para tingir, a borda branca da escolhida e o anel de foco.
  ['circle.png', () => toPng(32, 32, renderLayers(32, 32, [{ inset: 0, radius: 16, color: WHITE }]))],
  ['circle-ring.png', () => toPng(32, 32, renderLayers(32, 32, [{ inset: 0, radius: 16, color: WHITE, hole: { inset: 2, radius: 14 } }]))],
  ['circle-focus.png', () => toPng(42, 42, renderLayers(42, 42, [{ inset: 0, radius: 21, color: WHITE, hole: { inset: 2, radius: 19 } }]))],
  ['icon-plus.png', () => svgIcon(48, [{ points: [12, 5, 12, 19] }, { points: [5, 12, 19, 12] }], { stroke: 1.75 })],
  ['avatar-12.9.png', () => ninePatch([{ inset: 0, radius: 12, color: WHITE }])],
  ['focus-ring-16.9.png', () => ninePatch([{ inset: 0, radius: 21, color: WHITE }, { inset: 2, radius: 19, color: DEEP }])],
  ['icon-acc-heart.png', () => svgIcon(28, [{ d: 'M12 20s-7-4.5-7-10a4 4 0 017-2.5A4 4 0 0119 10c0 5.5-7 10-7 10z' }], { stroke: 1.9 })],
  ['icon-acc-lists.png', () => svgIcon(28, [{ d: 'M8 6h13M8 12h13M8 18h13' }, { circle: [4, 6, 1] }, { circle: [4, 12, 1] }, { circle: [4, 18, 1] }], { stroke: 1.9 })],
  ['icon-acc-info.png', () => svgIcon(28, [{ circle: [12, 12, 9] }, { d: 'M12 11v5M12 7.5v.01' }], { stroke: 1.9 })],
  ['icon-acc-exit.png', () => svgIcon(28, [{ d: 'M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l5-5-5-5M15 12H3' }], { stroke: 1.9 })],

  ['nav-active.9.png', () => ninePatch([{ inset: 0, radius: 12, color: WHITE, alpha: 0.15 }])],
  // Anel de foco em volta de algo rounded-xl (cartões e itens do menu): ring 2 branco + offset 3 grafite.
  ['focus-ring-12.9.png', () => ninePatch([{ inset: 0, radius: 17, color: WHITE }, { inset: 2, radius: 15, color: DEEP }])],
  // Cartão de pôster e "Ver todos": rounded-xl, bg #141418, borda white/10.
  ['card.9.png', () => ninePatch([{ inset: 0, radius: 12, color: over(WHITE, 0.1, CARD) }, { inset: 1, radius: 11, color: CARD }])],
  // Por cima da capa: cantos arredondados (o fundo da tela fora deles) e a borda white/10 (overflow-hidden do card).
  ['card-mask.9.png', () => ninePatch([{ inset: 0, radius: 12, color: DEEP, outside: true }, { inset: 0, radius: 12, color: WHITE, alpha: 0.1, hole: { inset: 1, radius: 11 } }])],
  // bg-gradient-to-t from-black/85 via-black/20 to-transparent (de cima para baixo: transparente → 20 % → 85 %).
  ['card-shade.png', () => gradient(252, [[0, [0, 0, 0], 0], [0.5, [0, 0, 0], 0.2], [1, [0, 0, 0], 0.85]], { vertical: true })],
  // Aba Favoritos (Dashboard.vue): cartão rounded-xl bg-[#121215] com borda white/[0.08]; a capa rounded-lg sobre
  // bg-[#1a1a20], com os cantos tapados na cor do cartão.
  ['fav-card.9.png', () => ninePatch([{ inset: 0, radius: 12, color: over(WHITE, 0.08, FAV_CARD) }, { inset: 1, radius: 11, color: FAV_CARD }])],
  ['fav-art.9.png', () => ninePatch([{ inset: 0, radius: 8, color: hex('#1a1a20') }])],
  ['fav-art-mask.9.png', () => ninePatch([{ inset: 0, radius: 8, color: FAV_CARD, outside: true }])],
  // Botões de vidro do destaque (.tv-btn-glass): white/12, borda white/14, rounded-lg.
  ['btn-glass.9.png', () => ninePatch([{ inset: 0, radius: 8, color: WHITE, alpha: 0.14, hole: { inset: 1, radius: 7 } }, { inset: 1, radius: 7, color: WHITE, alpha: 0.12 }])],
  // Círculo de vidro do "Ver todos" (w-12 rounded-full tv-glass).
  ['glass-circle.png', () => toPng(48, 48, renderLayers(48, 48, [{ inset: 0, radius: 24, color: WHITE, alpha: 0.14 }, { inset: 1, radius: 23, color: over(WHITE, 0.12, CARD) }]))],
  // .tv-vignette: horizontal (#0b0f0c 0 → .92 30% → .35 60% → 0 80%) e de baixo para cima (#0b0f0c 4% → .6 32% → 0 60%).
  ['vignette-h.png', () => gradient(256, [[0, DEEP, 1], [0.3, DEEP, 0.92], [0.6, DEEP, 0.35], [0.8, DEEP, 0], [1, DEEP, 0]])],
  ['vignette-v.png', () => gradient(256, [[0, DEEP, 0], [0.4, DEEP, 0], [0.68, DEEP, 0.6], [0.96, DEEP, 1], [1, DEEP, 1]], { vertical: true })],
  // Menu lateral fechado: bg-gradient-to-r from-black/85 via-black/40 to-transparent.
  ['menu-fade.png', () => gradient(112, [[0, [0, 0, 0], 0.85], [0.5, [0, 0, 0], 0.4], [1, [0, 0, 0], 0]])],
  // Menu lateral aberto (w-[19rem] = 304): bg-tv-deep/95, border-r white/10 e shadow-[12px_0_40px_rgba(0,0,0,0.85)].
  ['menu-open.png', () => gradient(360, [[0, DEEP, 0.95], [303 / 360, DEEP, 0.95], [303 / 360, over(WHITE, 0.1, DEEP), 0.96], [304 / 360, over(WHITE, 0.1, DEEP), 0.96], [304 / 360, [0, 0, 0], 0.6], [1, [0, 0, 0], 0]])],
  // Avatar do perfil: w-8 rounded-lg, cor do perfil (a tela tinge) e borda white/20 por cima.
  ['avatar.9.png', () => ninePatch([{ inset: 0, radius: 8, color: WHITE }])],
  ['avatar-border.9.png', () => ninePatch([{ inset: 0, radius: 8, color: WHITE, alpha: 0.2, hole: { inset: 1, radius: 7 } }])],
]

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  mkdirSync(join(root, OUT), { recursive: true })
  for (const [name, render] of OUTPUTS) {
    writeFileSync(join(root, OUT, name), render())
    console.log(`[roku-ui] ${OUT}/${name}`)
  }
}
