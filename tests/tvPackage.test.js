import { describe, it, expect } from 'vitest'
import { inflateSync } from 'node:zlib'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function fakeDist() {
  const dir = mkdtempSync(join(tmpdir(), 'pulse-dist-'))
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

  // Decodifica um PNG RGBA sem filtros (como o script gera) uma vez; depois lê pixels.
  const decoded = new WeakMap()
  function pixel(png, x, y) {
    if (!decoded.has(png)) {
      const idat = []
      for (let at = 8; at < png.length; ) {
        const len = png.readUInt32BE(at)
        if (png.toString('ascii', at + 4, at + 8) === 'IDAT') idat.push(png.subarray(at + 8, at + 8 + len))
        at += len + 12
      }
      decoded.set(png, inflateSync(Buffer.concat(idat)))
    }
    const i = y * (png.readUInt32BE(16) * 4 + 1) + 1 + x * 4
    return [...decoded.get(png).subarray(i, i + 4)]
  }
  const LIME = [184, 240, 0, 255]
  const GRAPHITE = [11, 15, 12, 255]

  it('ícone de TV: símbolo verde-limão sobre grafite, sem o vermelho antigo', async () => {
    const { renderIconPng } = await import('../scripts/make-tv-icons.mjs')
    const png = renderIconPng(256)

    expect(pixel(png, 2, 2)).toEqual(GRAPHITE)
    expect(pixel(png, 70, 100)).toEqual(LIME) // metade de cima do play, longe das bordas
    expect(pixel(png, 70, 170)).toEqual(LIME) // metade de baixo
    expect(pixel(png, 220, 128)).toEqual(GRAPHITE) // à direita da ponta do play
  })

  it('formatos do Android: cantos arredondados, redondo e camada adaptativa transparente', async () => {
    const { renderPng } = await import('../scripts/make-tv-icons.mjs')

    expect(pixel(renderPng({ width: 192, height: 192, shape: 'rounded' }), 1, 1)[3]).toBe(0)
    expect(pixel(renderPng({ width: 192, height: 192, shape: 'circle' }), 20, 20)[3]).toBe(0)
    const foreground = renderPng({ width: 432, height: 432, shape: 'none', boxScale: 2 / 3 })
    expect(pixel(foreground, 5, 5)[3]).toBe(0)
    expect(pixel(foreground, 216, 216)[3]).toBe(0) // centro do corte do pulso (espaço negativo)
    expect(pixelsWith(foreground, LIME)).toBeGreaterThan(0)
  })

  it('splash: grafite no tamanho pedido, símbolo no centro', async () => {
    const { renderPng } = await import('../scripts/make-tv-icons.mjs')
    const png = renderPng({ width: 480, height: 320, shape: 'square', boxScale: 0.5 })

    expect(pngSize(png)).toMatchObject({ width: 480, height: 320 })
    expect(pixel(png, 0, 0)).toEqual(GRAPHITE)
    expect(pixelsWith(png, LIME)).toBeGreaterThan(0)
  })

  function pixelsWith(png, rgba) {
    const width = png.readUInt32BE(16)
    const height = png.readUInt32BE(20)
    let count = 0
    for (let y = 0; y < height; y += 4) for (let x = 0; x < width; x += 4) if (pixel(png, x, y).join() === rgba.join()) count++
    return count
  }
})

describe('pacote Samsung Tizen', () => {
  it('copia o build, o config.xml com versão e id, e o ícone', async () => {
    const { prepareTvPackage } = await import('../scripts/package-tv.mjs')
    const distDir = fakeDist()
    const outDir = mkdtempSync(join(tmpdir(), 'pulse-tizen-'))

    prepareTvPackage({ platform: 'tizen', distDir, outDir, version: '2.3.4', env: { PULSE_TIZEN_PACKAGE_ID: 'AbCdEf1234' } })

    expect(existsSync(join(outDir, 'assets', 'app.js'))).toBe(true)
    const xml = readFileSync(join(outDir, 'config.xml'), 'utf8')
    expect(xml).toContain('version="2.3.4"')
    expect(xml).toContain('package="AbCdEf1234"')
    expect(xml).toContain('id="AbCdEf1234.PulsePlayer"')
    expect(xml).toContain('http://tizen.org/privilege/internet')
    expect(xml).not.toMatch(/__[A-Z_]+__/)
    expect(pngSize(readFileSync(join(outDir, 'icon.png'))).width).toBe(117)
  })

  it('carrega a API da Samsung e declara o privilégio público productinfo (ID da TV para a licença, RFC-018)', async () => {
    const { prepareTvPackage } = await import('../scripts/package-tv.mjs')
    const distDir = fakeDist()
    writeFileSync(join(distDir, 'index.html'), '<!doctype html><html><head><title>x</title><script type="module" src="/a.js"></script></head><body></body></html>')
    const outDir = mkdtempSync(join(tmpdir(), 'pulse-tizen-'))

    prepareTvPackage({ platform: 'tizen', distDir, outDir, version: '2.3.4', env: { PULSE_TIZEN_PACKAGE_ID: 'AbCdEf1234' } })

    const html = readFileSync(join(outDir, 'index.html'), 'utf8')
    expect(html).toMatch(/<script src="\$WEBAPIS\/webapis\/webapis\.js"><\/script>\s*<\/head>/)
    expect(readFileSync(join(distDir, 'index.html'), 'utf8')).not.toContain('webapis') // o build web não muda
    expect(readFileSync(join(outDir, 'config.xml'), 'utf8')).toContain('http://developer.samsung.com/privilege/productinfo')
  })

  it('exige um id de pacote de 10 caracteres alfanuméricos', async () => {
    const { prepareTvPackage } = await import('../scripts/package-tv.mjs')
    const call = () =>
      prepareTvPackage({ platform: 'tizen', distDir: fakeDist(), outDir: mkdtempSync(join(tmpdir(), 'pulse-t-')), version: '1.0.0', env: { PULSE_TIZEN_PACKAGE_ID: 'curto' } })

    expect(call).toThrow(/10/)
  })
})

describe('pacote LG webOS', () => {
  it('copia o build, o appinfo.json e os dois ícones', async () => {
    const { prepareTvPackage } = await import('../scripts/package-tv.mjs')
    const distDir = fakeDist()
    const outDir = mkdtempSync(join(tmpdir(), 'pulse-webos-'))

    prepareTvPackage({ platform: 'webos', distDir, outDir, version: '2.3.4', env: {} })

    const info = JSON.parse(readFileSync(join(outDir, 'appinfo.json'), 'utf8'))
    expect(info).toMatchObject({ id: 'com.pulseplayer.app', version: '2.3.4', type: 'web', main: 'index.html' })
    expect(pngSize(readFileSync(join(outDir, info.icon))).width).toBe(80)
    expect(pngSize(readFileSync(join(outDir, info.largeIcon))).width).toBe(130)
    expect(existsSync(join(outDir, 'index.html'))).toBe(true)
  })

  it('recusa plataformas desconhecidas', async () => {
    const { prepareTvPackage } = await import('../scripts/package-tv.mjs')

    expect(() => prepareTvPackage({ platform: 'roku', distDir: fakeDist(), outDir: tmpdir(), version: '1.0.0', env: {} })).toThrow(/plataforma/i)
  })
})
