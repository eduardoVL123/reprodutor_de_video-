import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * Sem este aviso, um WebView antigo demais (ou qualquer erro antes do Vue montar) deixa a tela escura para sempre,
 * sem explicação: o testador da loja reprova como "não carrega" e ninguém sabe o motivo. O script fica no index.html,
 * fora do bundle, porque precisa rodar justamente quando o bundle não roda.
 */
const html = readFileSync('index.html', 'utf8')
const code = (html.match(/<script id="boot-guard">([\s\S]*?)<\/script>/) || [])[1] || ''
const run = () => new Function(code)()
const app = () => document.getElementById('app')

describe('aviso quando o app não consegue iniciar', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    document.body.innerHTML = '<div id="app"></div>'
  })
  afterEach(() => vi.useRealTimers())

  // Script comum (sem defer/async/module): roda durante a leitura da página, antes do bundle, que é `defer`.
  it('é um script comum em JavaScript antigo (roda onde o bundle nem chega a ser lido)', () => {
    expect(code.length).toBeGreaterThan(0)
    expect(code).not.toMatch(/=>|\b(const|let|async|await|class)\b|`|\?\.|\?\?/)
  })

  it('erro antes de montar: mostra o aviso com o detalhe do erro', () => {
    run()
    window.dispatchEvent(new ErrorEvent('error', { message: 'Unexpected token function' }))
    vi.advanceTimersByTime(3000)

    expect(app().textContent).toContain('Não foi possível iniciar o Pulse Player')
    expect(app().textContent).toContain('Unexpected token function')
    expect(app().querySelector('[role="alert"]')).not.toBeNull()
  })

  it('app montado: um erro depois não troca a tela', () => {
    run()
    app().innerHTML = '<main>app</main>'
    window.dispatchEvent(new ErrorEvent('error', { message: 'falha qualquer' }))
    vi.advanceTimersByTime(60000)

    expect(app().innerHTML).toBe('<main>app</main>')
  })

  it('sem erro e sem montar (o bundle nem rodou): avisa depois do prazo, não antes', () => {
    run()
    vi.advanceTimersByTime(5000)
    expect(app().firstChild).toBeNull()

    vi.advanceTimersByTime(20000)
    expect(app().textContent).toContain('Não foi possível iniciar o Pulse Player')
  })

  it('o detalhe do erro entra como texto, nunca como HTML', () => {
    run()
    window.dispatchEvent(new ErrorEvent('error', { message: '<img src=x onerror=alert(1)>' }))
    vi.advanceTimersByTime(3000)

    expect(app().querySelector('img')).toBeNull()
  })
})
