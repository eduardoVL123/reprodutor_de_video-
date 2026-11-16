import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { parse, compileStyle } from '@vue/compiler-sfc'

/**
 * No Vue, `:global(html.is-phone) .acc-row` compila para só `html.is-phone`: o resto do seletor some. A regra caía no
 * próprio <html> (width 1.4rem, overflow hidden) e a página encolhia para ~20px em todo celular e tablet: tela vazia
 * na Play e reprovação da Amazon nos tablets. O certo é o seletor inteiro dentro: `:global(html.is-phone .acc-row)`.
 */
function vueFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? vueFiles(path) : path.endsWith('.vue') ? [path] : []
  })
}

// Seletores de uma regra que apontam para a raiz da página (html/body/#app), com ou sem classe.
const ROOT_ONLY = /^(html|body|#app|:root)(\.[\w-]+)*$/

function rootRules(file) {
  const { descriptor } = parse(readFileSync(file, 'utf8'), { filename: file })
  return descriptor.styles.flatMap((style, i) => {
    const { code } = compileStyle({ source: style.content, filename: file, id: `data-v-${i}`, scoped: style.scoped })
    return [...code.matchAll(/([^{}]+)\{([^}]*)\}/g)]
      .filter(([, selector]) => selector.split(',').some((s) => ROOT_ONLY.test(s.trim())))
      .map(([, selector, body]) => `${selector.trim()} { ${body.trim()} }`)
  })
}

describe('estilos dos componentes não mexem na raiz da página', () => {
  it.each(vueFiles('src').map((f) => [f]))('%s', (file) => {
    expect(rootRules(file)).toEqual([])
  })
})
