import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'

// Primeiro ponto de cada caminho: pulse-symbol.svg começa em "M56.00 122.00", o small em "M56.00 118.00".
const LARGE_START = 'M56.00 122.00'
const SMALL_START = 'M56.00 118.00'

async function render(props) {
  const { default: BrandMark } = await import('@/components/BrandMark.vue')
  return mount(BrandMark, { props })
}

describe('BrandMark — símbolo do Pulse Player', () => {
  it('é um SVG inline decorativo, sem imagem externa', async () => {
    const wrapper = await render({ size: 3 })

    expect(wrapper.find('svg').attributes('aria-hidden')).toBe('true')
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.findAll('path')).toHaveLength(2)
  })

  it('a partir de 2rem (32 px em 1080p) usa o desenho normal; abaixo, o de corte mais grosso', async () => {
    const big = await render({ size: 2 })
    const small = await render({ size: 1.5 })

    expect(big.find('path').attributes('d').startsWith(LARGE_START)).toBe(true)
    expect(small.find('path').attributes('d').startsWith(SMALL_START)).toBe(true)
  })

  it('aplica tamanho em rem e cor (padrão: herda a cor do texto)', async () => {
    const wrapper = await render({ size: 4, color: '#B8F000' })
    const svg = wrapper.find('svg')

    expect(svg.attributes('style')).toContain('height: 4rem')
    expect(svg.attributes('fill')).toBe('#B8F000')
    expect((await render({ size: 4 })).find('svg').attributes('fill')).toBe('currentColor')
  })
})
