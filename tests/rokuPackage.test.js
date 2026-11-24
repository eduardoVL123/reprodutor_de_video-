import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { checkSize, MAX_PACKAGE_BYTES, rooibosPassed, buildConfig } from '../scripts/roku.mjs'
import { OUTPUTS, over } from '../scripts/make-roku-ui.mjs'

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

describe('app Roku — imagens da interface (npm run roku:ui)', () => {
  it.each(OUTPUTS.map(([name, render]) => [name, render]))('%s está igual ao que o script gera', (name, render) => {
    expect(readFileSync(`roku/images/ui/${name}`).equals(render())).toBe(true)
  })

  it('mistura cores com opacidade como o navegador (white/10 sobre o painel #121215)', () => {
    // 255 × 0,1 + 18 × 0,9 = 41,7 → 42; 255 × 0,1 + 21 × 0,9 = 44,4 → 44
    expect(over([255, 255, 255], 0.1, [18, 18, 21])).toEqual([42, 42, 44])
  })

  it('9-patch tem a marca preta de 1 px no topo e na esquerda', () => {
    const buf = readFileSync('roku/images/ui/btn.9.png')
    expect(buf.subarray(1, 4).toString('ascii')).toBe('PNG')
    expect(pngSize('roku/images/ui/btn.9.png')).toEqual([19, 19]) // 2 × raio 8 + 1, mais a borda da marca
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

describe('app Roku — configuração do build (pkg:/build-config.json)', () => {
  it('leva o endereço do pareamento sem a barra final; sem ele o pareamento fica desligado', () => {
    expect(buildConfig({ PULSE_PAIR_BASE_URL: ' https://par.exemplo.com/ ' })).toEqual({ pairBaseUrl: 'https://par.exemplo.com' })
    expect(buildConfig({ VITE_PAIR_BASE_URL: 'http://localhost:8788' })).toEqual({ pairBaseUrl: 'http://localhost:8788' })
    expect(buildConfig({})).toEqual({ pairBaseUrl: '' })
  })
})
