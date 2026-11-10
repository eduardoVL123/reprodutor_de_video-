import { describe, it, expect, beforeEach, vi } from 'vitest'

const memory = new Map()
vi.mock('@/services/storage', async (importOriginal) => ({
  ...(await importOriginal()),
  storage: {
    get: async (k) => (memory.has(k) ? memory.get(k) : null),
    set: async (k, v) => void memory.set(k, v),
    remove: async (k) => void memory.delete(k),
  },
}))

const { recordError, readErrors, clearErrors, cleanErrorText, installErrorCapture, resetErrorLogForTests, ERROR_LOG_KEY, ERROR_LOG_MAX } = await import(
  '@/services/errorLog'
)

describe('registro local de erros (Diagnóstico, plano de robustez item 6)', () => {
  beforeEach(() => {
    memory.clear()
    resetErrorLogForTests()
  })

  it('nunca guarda endereço, usuário ou senha da lista', () => {
    const text = cleanErrorText(new TypeError('Falhou http://painel.tv:8080/get.php?username=joao&password=segredo123 e mais'))
    expect(text).toBe('TypeError: Falhou [endereço] e mais')
    expect(cleanErrorText('erro token=abc')).toBe('erro token=***')
    expect(cleanErrorText('x'.repeat(1000))).toHaveLength(300)
  })

  it('guarda o mais recente primeiro, no máximo 20, e sobrevive a reabrir o app', async () => {
    for (let i = 0; i < ERROR_LOG_MAX + 5; i++) recordError(new Error(`erro ${i}`), 'tela')
    const list = await readErrors()
    expect(list).toHaveLength(ERROR_LOG_MAX)
    expect(list[0]).toMatchObject({ where: 'tela', message: `erro ${ERROR_LOG_MAX + 4}` })
    resetErrorLogForTests() // app reaberto: só o que foi salvo
    expect((await readErrors()).map((e) => e.message)).toEqual(list.map((e) => e.message))
  })

  it('erro logo ao abrir o app não apaga o histórico salvo antes', async () => {
    memory.set(ERROR_LOG_KEY, [{ at: 1, where: '', message: 'antigo' }])
    await recordError('novo')
    expect((await readErrors()).map((e) => e.message)).toEqual(['novo', 'antigo'])
    expect(memory.get(ERROR_LOG_KEY).map((e) => e.message)).toEqual(['novo', 'antigo'])
  })

  it('limpar apaga da memória e do aparelho', async () => {
    await recordError('um')
    await clearErrors()
    expect(await readErrors()).toEqual([])
    expect(memory.has(ERROR_LOG_KEY)).toBe(false)
  })

  it('armazenamento quebrado não derruba o app', async () => {
    memory.set = () => {
      throw new Error('cheio')
    }
    await expect(recordError('qualquer')).resolves.toBeUndefined()
    memory.set = Map.prototype.set
  })

  it('captura erros do Vue, de script e de promessa sem engolir o console', async () => {
    const app = { config: {} }
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    installErrorCapture(app)
    app.config.errorHandler(new Error('quebrou no render'), null, 'render function')
    window.dispatchEvent(new ErrorEvent('error', { error: new Error('script') }))
    const rejection = new Event('unhandledrejection')
    rejection.reason = new Error('promessa')
    window.dispatchEvent(rejection)
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
    expect((await readErrors()).map((e) => `${e.where}|${e.message}`)).toEqual(['promessa|promessa', 'script|script', 'render function|quebrou no render'])
  })
})
