import { describe, it, expect } from 'vitest'
import postcss from 'postcss'
import tailwindcss from 'tailwindcss'
import { readFileSync } from 'node:fs'
import config from '../tailwind.config.js'

const STYLE = readFileSync('src/style.css', 'utf8')
const compact = (css) => css.replace(/\s+/g, '')

async function compile(html) {
  const result = await postcss([tailwindcss({ ...config, content: [{ raw: html }] })]).process(STYLE, { from: undefined })
  return compact(result.css)
}

/** Corpo da primeira regra cujo seletor contém `selector` (CSS sem espaços). */
function ruleBody(css, selector) {
  const at = css.indexOf(selector)
  if (at === -1) return ''
  const open = css.indexOf('{', at)
  return css.slice(open + 1, css.indexOf('}', open))
}

describe('estilos de TV', () => {
  it('text-tv-xs existe (era usado em 55 lugares sem gerar CSS)', async () => {
    const css = await compile('<p class="text-tv-xs"></p>')

    expect(ruleBody(css, '.text-tv-xs{')).toContain('font-size:1.25rem')
  })

  it('o foco tem um contorno separado do botão, visível também em botões brancos', async () => {
    const css = await compile('<button class="tv-focusable tv-btn tv-btn-primary"></button>')

    const focus = ruleBody(css, '.tv-focusable:focus')
    expect(focus).toContain('--tw-ring-offset-width:3px')
    expect(focus).toContain('--tw-ring-offset-color:#0a0a0a')
  })

  it('nenhum texto abaixo do mínimo de TV (classes text-[0.xrem] fixas)', () => {
    const files = ['src/views/Dashboard.vue', 'src/components/GridItem.vue', 'src/components/ListManagerModal.vue', 'src/components/MediaDetailsModal.vue', 'src/components/SearchScreen.vue']
    const tiny = files.filter((f) => /text-\[0\.\d+rem\]/.test(readFileSync(f, 'utf8')))

    expect(tiny).toEqual([])
  })

  it('base 2.0: item de fileira cresce no foco e nada usa backdrop-filter', async () => {
    const css = await compile('<button class="tv-focusable tv-rail-item"></button><div class="tv-glass tv-btn-glass"></div>')

    expect(ruleBody(css, '.tv-rail-item.tv-focusable:focus{')).toContain('--tw-scale-x:1.08')
    expect(css).not.toMatch(/[;{](-webkit-)?backdrop-filter:/)
  })

  it('não esconde o ponteiro (Magic Remote da LG, mouse no PC e na Samsung)', () => {
    expect(STYLE).not.toMatch(/cursor:\s*none/)
  })
})
