import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { checkSize, MAX_PACKAGE_BYTES, rooibosPassed } from '../scripts/roku.mjs'

const manifest = Object.fromEntries(
  readFileSync('roku/manifest', 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.includes('='))
    .map((line) => line.split('=').map((part) => part.trim())),
)

/** Largura e altura do cabeçalho IHDR do PNG. */
function pngSize(path) {
  const buf = readFileSync(path)
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)]
}

describe('app Roku — manifest e ativos exigidos pela loja', () => {
  it('declara as chaves que a análise estática da Roku exige', () => {
    expect(manifest).toMatchObject({ title: 'Pulse Player', ui_resolutions: 'fhd', rsg_version: '1.3' })
  })

  it.each([
    ['mm_icon_focus_fhd', 540, 405],
    ['mm_icon_focus_hd', 290, 218],
    ['splash_screen_fhd', 1920, 1080],
    ['splash_screen_hd', 1280, 720],
  ])('%s aponta para uma imagem %ix%i', (key, width, height) => {
    expect(manifest[key]).toMatch(/^pkg:\/images\/.+\.png$/)
    expect(pngSize(manifest[key].replace('pkg:/', 'roku/'))).toEqual([width, height])
  })

  it('splash usa o fundo grafite da marca', () => {
    expect(manifest.splash_color).toBe('#0B0F0C')
  })
})

describe('app Roku — resultado dos testes Rooibos no simulador', () => {
  it.each([
    ['RESULT: Success\n[Rooibos Result]: PASS\n[Rooibos Shutdown]', true],
    ['RESULT: Fail\n[Rooibos Result]: FAIL\n[Rooibos Shutdown]', false],
    ['>>>>>> It: trava aqui', false], // travou ou quebrou antes do relatório
    ['', false],
  ])('%j → passou=%s', (output, passed) => {
    expect(rooibosPassed(output)).toBe(passed)
  })
})

describe('app Roku — limite de tamanho do pacote', () => {
  it('aceita até 4 MB e recusa acima', () => {
    expect(checkSize(MAX_PACKAGE_BYTES)).toBe(MAX_PACKAGE_BYTES)
    expect(() => checkSize(MAX_PACKAGE_BYTES + 1)).toThrow(/limite/)
  })
})
