import { describe, it, expect } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function fakeDist() {
  const dir = mkdtempSync(join(tmpdir(), 'neutro-dist-'))
  mkdirSync(join(dir, 'assets'))
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>x</title>')
  writeFileSync(join(dir, 'assets', 'app.js'), 'console.log(1)')
  return dir
}

const pngSize = (buffer) => ({
  signature: buffer.subarray(0, 8).toString('hex'),
  width: buffer.readUInt32BE(16),
  height: buffer.readUInt32BE(20),
})

describe('ícones gerados a partir da marca', () => {
  it('renderiza PNG válido no tamanho pedido', async () => {
    const { renderIconPng } = await import('../scripts/make-tv-icons.mjs')

    const png = renderIconPng(80)

    expect(pngSize(png)).toEqual({ signature: '89504e470d0a1a0a', width: 80, height: 80 })
  })
})

describe('pacote Samsung Tizen', () => {
  it('copia o build, o config.xml com versão e id, e o ícone', async () => {
    const { prepareTvPackage } = await import('../scripts/package-tv.mjs')
    const distDir = fakeDist()
    const outDir = mkdtempSync(join(tmpdir(), 'neutro-tizen-'))

    prepareTvPackage({ platform: 'tizen', distDir, outDir, version: '2.3.4', env: { NEUTRO_TIZEN_PACKAGE_ID: 'AbCdEf1234' } })

    expect(existsSync(join(outDir, 'assets', 'app.js'))).toBe(true)
    const xml = readFileSync(join(outDir, 'config.xml'), 'utf8')
    expect(xml).toContain('version="2.3.4"')
    expect(xml).toContain('package="AbCdEf1234"')
    expect(xml).toContain('id="AbCdEf1234.NeutroTV"')
    expect(xml).toContain('http://tizen.org/privilege/internet')
    expect(xml).not.toMatch(/__[A-Z_]+__/)
    expect(pngSize(readFileSync(join(outDir, 'icon.png'))).width).toBe(117)
  })

  it('exige um id de pacote de 10 caracteres alfanuméricos', async () => {
    const { prepareTvPackage } = await import('../scripts/package-tv.mjs')
    const call = () =>
      prepareTvPackage({ platform: 'tizen', distDir: fakeDist(), outDir: mkdtempSync(join(tmpdir(), 'neutro-t-')), version: '1.0.0', env: { NEUTRO_TIZEN_PACKAGE_ID: 'curto' } })

    expect(call).toThrow(/10/)
  })
})

describe('pacote LG webOS', () => {
  it('copia o build, o appinfo.json e os dois ícones', async () => {
    const { prepareTvPackage } = await import('../scripts/package-tv.mjs')
    const distDir = fakeDist()
    const outDir = mkdtempSync(join(tmpdir(), 'neutro-webos-'))

    prepareTvPackage({ platform: 'webos', distDir, outDir, version: '2.3.4', env: {} })

    const info = JSON.parse(readFileSync(join(outDir, 'appinfo.json'), 'utf8'))
    expect(info).toMatchObject({ id: 'com.neutrotv.player', version: '2.3.4', type: 'web', main: 'index.html' })
    expect(pngSize(readFileSync(join(outDir, info.icon))).width).toBe(80)
    expect(pngSize(readFileSync(join(outDir, info.largeIcon))).width).toBe(130)
    expect(existsSync(join(outDir, 'index.html'))).toBe(true)
  })

  it('recusa plataformas desconhecidas', async () => {
    const { prepareTvPackage } = await import('../scripts/package-tv.mjs')

    expect(() => prepareTvPackage({ platform: 'roku', distDir: fakeDist(), outDir: tmpdir(), version: '1.0.0', env: {} })).toThrow(/plataforma/i)
  })
})
