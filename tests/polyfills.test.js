import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

/**
 * WebView antigo (Fire OS 6: Fire TV Stick 4K, Cube, Gen 3 e TVs Fire TV Edition reprovados na Amazon com tela vazia;
 * Tizen 5 = Chromium 63): o build converte a sintaxe para ES2017, mas não as funções novas. Sem elas o app quebrava
 * ao montar o Início (Object.fromEntries) e no Pinia (Object.hasOwn).
 */

const SOURCE = readFileSync('src/polyfills.js', 'utf8')

/** Roda o polyfill num JavaScript isolado sem as funções novas, como num WebView antigo. */
function oldWebView() {
  const context = vm.createContext({})
  vm.runInContext('delete Object.hasOwn; delete Object.fromEntries; delete Array.prototype.flatMap', context)
  context.window = vm.runInContext('this', context)
  vm.runInContext(SOURCE, context)
  return context
}

describe('polyfills para WebView antigo', () => {
  it('instala Object.hasOwn, Object.fromEntries e flatMap quando o navegador não tem', () => {
    const ctx = oldWebView()
    const run = (code) => vm.runInContext(code, ctx)
    expect(run("Object.hasOwn({ a: 1 }, 'a')")).toBe(true)
    expect(run("Object.hasOwn(Object.create({ a: 1 }), 'a')")).toBe(false)
    expect(run("JSON.stringify(Object.fromEntries([['a', 1], ['b', 2]]))")).toBe('{"a":1,"b":2}')
    expect(run("JSON.stringify(Object.fromEntries(new Map([['x', 3]])))")).toBe('{"x":3}')
    expect(run('JSON.stringify([1, 2].flatMap((n) => [n, n * 10]))')).toBe('[1,10,2,20]')
    expect(run('JSON.stringify([[1], 2].flatMap((n) => n))')).toBe('[1,2]') // um nível só, como o nativo
    expect(run("Object.keys(Array.prototype).includes('flatMap')")).toBe(false) // não aparece em for...in
  })

  it('não troca a função nativa quando ela existe', () => {
    const ctx = vm.createContext({})
    const native = vm.runInContext('Object.hasOwn', ctx)
    ctx.window = vm.runInContext('this', ctx)
    vm.runInContext(SOURCE, ctx)
    expect(vm.runInContext('Object.hasOwn', ctx)).toBe(native)
  })

  it('é o primeiro import do app: roda antes do Vue, do Pinia e das telas', () => {
    const firstImport = readFileSync('src/main.js', 'utf8').match(/^import .+$/m)[0]
    expect(firstImport).toBe("import './polyfills'")
  })
})
