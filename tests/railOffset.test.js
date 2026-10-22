import { describe, it, expect } from 'vitest'

// Fileira de 10 itens de 200px com 20px de espaço, numa janela de 1000px: largura total 2180px.
const ROW = { itemSize: 200, gap: 20, count: 10, viewport: 1000 }

describe('railOffset — deslocamento da fileira deslizante', () => {
  it('o primeiro item fica no início', async () => {
    const { railOffset } = await import('@/utils/railOffset')

    expect(railOffset({ ...ROW, index: 0 })).toBe(0)
  })

  it('o item focado vai para a posição inicial da fileira', async () => {
    const { railOffset } = await import('@/utils/railOffset')

    expect(railOffset({ ...ROW, index: 3 })).toBe(-660)
  })

  it('no fim, não deixa espaço vazio à direita', async () => {
    const { railOffset } = await import('@/utils/railOffset')

    expect(railOffset({ ...ROW, index: 9 })).toBe(-1180)
    expect(railOffset({ ...ROW, index: 7 })).toBe(-1180)
  })

  it('fileira que cabe inteira na tela não desliza', async () => {
    const { railOffset } = await import('@/utils/railOffset')

    expect(railOffset({ itemSize: 200, gap: 20, count: 3, viewport: 1000, index: 2 })).toBe(0)
  })

  it('ignora medidas inválidas (antes do layout existir)', async () => {
    const { railOffset } = await import('@/utils/railOffset')

    expect(railOffset({ itemSize: 0, gap: 20, count: 10, viewport: 0, index: 5 })).toBe(0)
    expect(railOffset({ ...ROW, index: -1 })).toBe(0)
  })
})
