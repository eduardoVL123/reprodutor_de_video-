import { describe, it, expect } from 'vitest'
import { decodeQr } from './helpers/qrDecode.js'

/** QR do pareamento (RFC-016): o desenho tem que ser um QR de verdade que um celular consiga ler. */

function decode(text) {
  return import('@/utils/qrSvg').then(({ qrSvgData }) => decodeQr(qrSvgData(text)))
}

describe('qrSvgData', () => {
  it.each([
    'https://pulse.exemplo.com/K7M2QP',
    'http://localhost:8788/ABCDEF',
    'https://pulse.exemplo.com.br/pareamento/v1/K7M2QP',
  ])('o QR de %s é lido de volta com exatamente o mesmo endereço', async (url) => {
    expect(await decode(url)).toBe(url)
  })

  it('devolve o tamanho em módulos (21 a 177, sempre 4n+17) e só quadrados dentro da grade', async () => {
    const { qrSvgData } = await import('@/utils/qrSvg')

    const { size, path } = qrSvgData('https://pulse.exemplo.com/K7M2QP')

    expect((size - 17) % 4).toBe(0)
    expect(size).toBeGreaterThanOrEqual(21)
    expect(path).toMatch(/^(M\d+ \d+h1v1h-1z)+$/)
    for (const [, x, y] of path.matchAll(/M(\d+) (\d+)h1v1h-1z/g)) {
      expect(Number(x)).toBeLessThan(size)
      expect(Number(y)).toBeLessThan(size)
    }
  })

  it('é determinístico: o mesmo endereço sempre gera o mesmo desenho', async () => {
    const { qrSvgData } = await import('@/utils/qrSvg')

    expect(qrSvgData('https://pulse.exemplo.com/K7M2QP')).toEqual(qrSvgData('https://pulse.exemplo.com/K7M2QP'))
  })

  it('endereços diferentes geram desenhos diferentes', async () => {
    const { qrSvgData } = await import('@/utils/qrSvg')

    expect(qrSvgData('https://pulse.exemplo.com/K7M2QP').path).not.toBe(qrSvgData('https://pulse.exemplo.com/ABCDEF').path)
  })

  it('texto vazio ou grande demais para um QR é erro (a tela mostra só o código)', async () => {
    const { qrSvgData } = await import('@/utils/qrSvg')

    expect(() => qrSvgData('')).toThrow()
    expect(() => qrSvgData('x'.repeat(3000))).toThrow()
  })
})
