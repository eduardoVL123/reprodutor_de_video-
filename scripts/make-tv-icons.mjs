import { deflateSync, crc32 } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/**
 * Gera os ícones das lojas Samsung/LG a partir da marca (raio vermelho sobre fundo escuro),
 * sem depender de bibliotecas de imagem. Substitua os PNGs por arte final quando houver.
 *
 *   node scripts/make-tv-icons.mjs
 */
const BACKGROUND = [10, 10, 10, 255]
const BOLT_COLOR = [229, 9, 20, 255]
// Mesmo desenho de src/views/Dashboard.vue e android/.../banner.xml (viewBox 24x24).
const BOLT = [
  [13, 2],
  [3, 14],
  [12, 14],
  [11, 22],
  [21, 10],
  [12, 10],
]
const SAMPLES = 3 // supersampling por eixo (bordas suaves)

function insideBolt(x, y) {
  let inside = false
  for (let i = 0, j = BOLT.length - 1; i < BOLT.length; j = i++) {
    const [xi, yi] = BOLT[i]
    const [xj, yj] = BOLT[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const out = Buffer.alloc(body.length + 8)
  out.writeUInt32BE(data.length, 0)
  body.copy(out, 4)
  out.writeUInt32BE(crc32(body), body.length + 4)
  return out
}

/** PNG RGBA `size` x `size` com a marca centralizada (60% do lado). */
export function renderIconPng(size) {
  const scale = (size * 0.6) / 24
  const offset = (size - 24 * scale) / 2
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1)
    raw[row] = 0 // filtro "None"
    for (let x = 0; x < size; x++) {
      let hits = 0
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const px = (x + (sx + 0.5) / SAMPLES - offset) / scale
          const py = (y + (sy + 0.5) / SAMPLES - offset) / scale
          if (insideBolt(px, py)) hits++
        }
      }
      const mix = hits / (SAMPLES * SAMPLES)
      for (let c = 0; c < 4; c++) {
        raw[row + 1 + x * 4 + c] = Math.round(BACKGROUND[c] * (1 - mix) + BOLT_COLOR[c] * mix)
      }
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header.set([8, 6, 0, 0, 0], 8) // 8 bits, RGBA, sem entrelaçamento
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const ICONS = [
  ['platforms/tizen/icon.png', 117],
  ['platforms/webos/icon.png', 80],
  ['platforms/webos/largeIcon.png', 130],
]

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  for (const [path, size] of ICONS) {
    const target = join(root, path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, renderIconPng(size))
    console.log(`[icons] ${path} (${size}x${size})`)
  }
}
