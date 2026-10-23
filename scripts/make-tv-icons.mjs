import { deflateSync, crc32 } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/**
 * Gera os ícones e splashes de Samsung/LG/Android a partir do símbolo do Pulse Player (verde-limão sobre grafite),
 * sem depender de bibliotecas de imagem. Mesmo desenho e enquadramento de ../logo/kit/dist/symbol/pulse-symbol-app-icon.svg.
 *
 *   node scripts/make-tv-icons.mjs
 */
const LIME = [184, 240, 0, 255] // #B8F000
const GRAPHITE = [11, 15, 12, 255] // #0B0F0C
const BOX = 256 // quadro do kit
const CORNER_RADIUS = 57.6 / BOX // cantos do ícone oficial
const SAMPLES = 3 // supersampling por eixo (bordas suaves)

// pulse-symbol-small.svg: ['M'|'L', x, y] e ['A', raio, x, y] (arco pequeno, sentido horário).
const SYMBOL_PATHS = [
  [['M', 56, 118], ['L', 56, 67.71], ['A', 16, 80, 53.86], ['L', 191.1, 118], ['L', 130.42, 118], ['L', 126.95, 124],
    ['L', 103.86, 84], ['L', 84.23, 118]],
  [['M', 56, 138], ['L', 95.77, 138], ['L', 103.86, 124], ['L', 126.95, 164], ['L', 141.96, 138], ['L', 191.1, 138],
    ['L', 80, 202.14], ['A', 16, 56, 188.29]],
]
// Ajuste óptico do ícone oficial: translate(-0.49 -5.12) scale(1.04) dentro do quadro.
const OPTICAL = { scale: 1.04, dx: -0.49, dy: -5.12 }

/** Pontos do arco SVG (rx = ry, sem rotação, arco pequeno, sentido horário) do ponto atual até (x2, y2). */
function arcPoints([x1, y1], r, x2, y2, steps = 16) {
  const hx = (x1 - x2) / 2
  const hy = (y1 - y2) / 2
  const k = Math.sqrt(Math.max(0, (r * r - hx * hx - hy * hy) / (hx * hx + hy * hy)))
  const cx = k * hy + (x1 + x2) / 2
  const cy = -k * hx + (y1 + y2) / 2
  const a1 = Math.atan2(y1 - cy, x1 - cx)
  let delta = Math.atan2(y2 - cy, x2 - cx) - a1
  if (delta < 0) delta += 2 * Math.PI
  const points = []
  for (let i = 1; i <= steps; i++) {
    const a = a1 + (delta * i) / steps
    points.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
  }
  return points
}

const POLYGONS = SYMBOL_PATHS.map((commands) => {
  const points = []
  for (const [op, ...args] of commands) {
    if (op === 'A') points.push(...arcPoints(points[points.length - 1], ...args))
    else points.push(args)
  }
  return points.map(([x, y]) => [x * OPTICAL.scale + OPTICAL.dx, y * OPTICAL.scale + OPTICAL.dy])
})

function insidePolygon(points, x, y) {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i]
    const [xj, yj] = points[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

const insideSymbol = (x, y) => POLYGONS.some((points) => insidePolygon(points, x, y))

/** Formato do ícone, em coordenadas 0..1 do quadro: quadrado, cantos do ícone oficial, círculo ou sem fundo. */
function insideShape(shape, u, v) {
  if (shape === 'circle') return (u - 0.5) ** 2 + (v - 0.5) ** 2 <= 0.25
  if (shape !== 'rounded') return true
  const r = CORNER_RADIUS
  const cx = Math.min(Math.max(u, r), 1 - r)
  const cy = Math.min(Math.max(v, r), 1 - r)
  return (u - cx) ** 2 + (v - cy) ** 2 <= r * r
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const out = Buffer.alloc(body.length + 8)
  out.writeUInt32BE(data.length, 0)
  body.copy(out, 4)
  out.writeUInt32BE(crc32(body), body.length + 4)
  return out
}

function encodePng(width, height, raw) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 6, 0, 0, 0], 8) // 8 bits, RGBA, sem entrelaçamento
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/**
 * PNG RGBA com o símbolo centralizado.
 * @param {{ width:number, height:number, shape?:'square'|'rounded'|'circle'|'none', boxScale?:number }} o
 *   `shape: 'none'` deixa o fundo transparente (camada da frente do ícone adaptativo do Android);
 *   `boxScale` é o lado do quadro do kit em relação ao menor lado da imagem (1 = ícone inteiro).
 */
export function renderPng({ width, height, shape = 'square', boxScale = 1 }) {
  const box = Math.min(width, height) * boxScale
  const left = (width - box) / 2
  const top = (height - box) / 2
  const unit = box / BOX
  const raw = Buffer.alloc(height * (width * 4 + 1))
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1)
    raw[row] = 0 // filtro "None"
    for (let x = 0; x < width; x++) {
      let shapeHits = 0
      let symbolHits = 0
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const px = x + (sx + 0.5) / SAMPLES
          const py = y + (sy + 0.5) / SAMPLES
          if (shape === 'none' || insideShape(shape, px / width, py / height)) shapeHits++
          const bx = (px - left) / unit
          const by = (py - top) / unit
          if (bx >= 0 && by >= 0 && bx <= BOX && by <= BOX && insideSymbol(bx, by)) symbolHits++
        }
      }
      const total = SAMPLES * SAMPLES
      const symbol = symbolHits / total
      const at = row + 1 + x * 4
      if (shape === 'none') {
        raw.set([LIME[0], LIME[1], LIME[2], Math.round(255 * symbol)], at)
      } else {
        for (let c = 0; c < 3; c++) raw[at + c] = Math.round(GRAPHITE[c] * (1 - symbol) + LIME[c] * symbol)
        raw[at + 3] = Math.round((255 * shapeHits) / total)
      }
    }
  }
  return encodePng(width, height, raw)
}

/** Ícone quadrado de TV (Samsung/LG): o ícone oficial ocupando o quadro todo. */
export function renderIconPng(size) {
  return renderPng({ width: size, height: size })
}

const RES = 'android/app/src/main/res'
const DENSITIES = [['mdpi', 1], ['hdpi', 1.5], ['xhdpi', 2], ['xxhdpi', 3], ['xxxhdpi', 4]]
const SPLASH_SIZES = {
  mdpi: [480, 320], hdpi: [800, 480], xhdpi: [1280, 720], xxhdpi: [1600, 960], xxxhdpi: [1920, 1280],
}
const SPLASH_BOX = 0.5 // símbolo com ~30% do menor lado da tela de abertura

const OUTPUTS = [
  ['platforms/tizen/icon.png', { width: 117, height: 117 }],
  ['platforms/webos/icon.png', { width: 80, height: 80 }],
  ['platforms/webos/largeIcon.png', { width: 130, height: 130 }],
  ...DENSITIES.flatMap(([name, k]) => [
    [`${RES}/mipmap-${name}/ic_launcher.png`, { width: 48 * k, height: 48 * k, shape: 'rounded' }],
    [`${RES}/mipmap-${name}/ic_launcher_round.png`, { width: 48 * k, height: 48 * k, shape: 'circle' }],
    // Camada da frente do ícone adaptativo (108dp): o quadro ocupa 2/3, dentro da zona segura de 66dp.
    [`${RES}/mipmap-${name}/ic_launcher_foreground.png`, { width: 108 * k, height: 108 * k, shape: 'none', boxScale: 2 / 3 }],
  ]),
  ...Object.entries(SPLASH_SIZES).flatMap(([name, [w, h]]) => [
    [`${RES}/drawable-land-${name}/splash.png`, { width: w, height: h, boxScale: SPLASH_BOX }],
    [`${RES}/drawable-port-${name}/splash.png`, { width: h, height: w, boxScale: SPLASH_BOX }],
  ]),
  [`${RES}/drawable/splash.png`, { width: 480, height: 320, boxScale: SPLASH_BOX }],
]

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  for (const [path, options] of OUTPUTS) {
    const target = join(root, path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, renderPng(options))
    console.log(`[icons] ${path} (${options.width}x${options.height})`)
  }
}
