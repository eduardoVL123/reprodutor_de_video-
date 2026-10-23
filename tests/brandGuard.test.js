import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** Arquivos de código e telas nativas que o usuário vê (RFC-015). */
function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(vue|js|css)$/.test(name) ? [path] : []
  })
}
const FILES = [
  ...sourceFiles('src'),
  'index.html',
  'tailwind.config.js',
  'capacitor.config.json',
  'android/app/build.gradle',
  'android/app/src/main/res/values/strings.xml',
  'android/app/src/main/res/drawable/banner.xml',
  'platforms/tizen/config.xml',
  'platforms/webos/appinfo.json',
]
const read = (f) => readFileSync(f, 'utf8')

describe('marca Pulse Player', () => {
  it('não sobrou o nome, o pacote nem o vermelho da marca antiga', () => {
    const leftovers = FILES.filter((f) => /Neutro ?TV|Reprodutor de Mídia Neutro|com\.neutrotv|#e50914/i.test(read(f)))

    expect(leftovers).toEqual([])
  })

  it('texto sobre o limão sólido é grafite, nunca branco (contraste 1,3:1)', () => {
    const offenders = []
    for (const f of sourceFiles('src').filter((name) => !name.endsWith('.css'))) {
      for (const cls of read(f).match(/["'`][^"'`\n]*\b(bg-tv-accent(?!\/)|tv-badge-live)\b[^"'`\n]*["'`]/g) || []) {
        if (/\btext-white\b/.test(cls)) offenders.push(`${f}: ${cls}`)
      }
    }

    expect(offenders).toEqual([])
  })
})
