import { describe, it, expect, vi, afterEach } from 'vitest'

afterEach(() => {
  delete window.tizen
  delete window.webOS
  delete window.PalmSystem
  delete window.Capacitor
})

function mockCapacitorCore() {
  const plugin = {
    setEnabled: vi.fn(async () => {}),
    addListener: vi.fn(async (_event, cb) => {
      plugin.emit = cb
      return { remove: plugin.remove }
    }),
    remove: vi.fn(async () => {}),
  }
  vi.doMock('@capacitor/core', () => ({ registerPlugin: vi.fn(() => plugin) }))
  return plugin
}

describe('platform.exitApp', () => {
  it('encerra pelo Tizen quando disponível', async () => {
    const exit = vi.fn()
    window.tizen = { application: { getCurrentApplication: () => ({ exit }) } }
    const { exitApp } = await import('@/services/platform')

    await exitApp()

    expect(exit).toHaveBeenCalledTimes(1)
  })

  it('usa webOS.platformBack no LG', async () => {
    const platformBack = vi.fn()
    window.webOS = { platformBack }
    const { exitApp } = await import('@/services/platform')

    await exitApp()

    expect(platformBack).toHaveBeenCalledTimes(1)
  })

  it('fecha a janela no webOS sem a biblioteca webOSTV.js', async () => {
    window.PalmSystem = {}
    const close = vi.spyOn(window, 'close').mockImplementation(() => {})
    const { exitApp } = await import('@/services/platform')

    await exitApp()

    expect(close).toHaveBeenCalledTimes(1)
  })

  it('usa o plugin App do Capacitor dentro do APK', async () => {
    const capacitorExit = vi.fn(async () => {})
    vi.doMock('@capacitor/app', () => ({ App: { exitApp: capacitorExit } }))
    window.Capacitor = { isNativePlatform: () => true }
    const { exitApp } = await import('@/services/platform')

    await exitApp()

    expect(capacitorExit).toHaveBeenCalledTimes(1)
  })

  it('no navegador do PC não fecha a aba (Esc/Voltar não pode derrubar a página)', async () => {
    const close = vi.spyOn(window, 'close').mockImplementation(() => {})
    const { exitApp } = await import('@/services/platform')

    await exitApp()

    expect(close).not.toHaveBeenCalled()
  })
})

describe('platform.onAppBackground (pausar o vídeo quando o app sai da tela)', () => {
  function setHidden(hidden) {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
    document.dispatchEvent(new Event('visibilitychange'))
  }

  it('no APK, avisa quando o app para (Home sem pop-up ou pop-up fechado)', async () => {
    let emit = null
    const remove = vi.fn()
    vi.doMock('@capacitor/app', () => ({
      App: {
        addListener: vi.fn(async (event, cb) => {
          if (event === 'appStateChange') emit = cb
          return { remove }
        }),
      },
    }))
    window.Capacitor = { isNativePlatform: () => true }
    const { onAppBackground } = await import('@/services/platform')
    const cb = vi.fn()

    const stop = onAppBackground(cb)
    await vi.waitFor(() => expect(emit).toBeTypeOf('function'))
    emit({ isActive: true })
    emit({ isActive: false })
    stop()

    expect(cb).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(remove).toHaveBeenCalled())
  })

  it('na TV Samsung/LG, avisa quando a página fica oculta', async () => {
    window.tizen = {}
    const { onAppBackground } = await import('@/services/platform')
    const cb = vi.fn()

    const stop = onAppBackground(cb)
    setHidden(true)
    stop()
    setHidden(true)
    setHidden(false)

    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('no navegador do PC não pausa ao trocar de aba', async () => {
    const { onAppBackground } = await import('@/services/platform')
    const cb = vi.fn()

    const stop = onAppBackground(cb)
    setHidden(true)
    stop()
    setHidden(false)

    expect(cb).not.toHaveBeenCalled()
  })
})

describe('platform — Picture-in-Picture (pop-up no Android)', () => {
  it('liga e desliga o pop-up automático no APK', async () => {
    const plugin = mockCapacitorCore()
    window.Capacitor = { isNativePlatform: () => true }
    const { setPictureInPictureEnabled } = await import('@/services/platform')

    await setPictureInPictureEnabled(true)
    await setPictureInPictureEnabled(false)

    expect(plugin.setEnabled.mock.calls).toEqual([[{ enabled: true }], [{ enabled: false }]])
  })

  it('não chama o Android fora do APK (TV e navegador)', async () => {
    const plugin = mockCapacitorCore()
    const { setPictureInPictureEnabled } = await import('@/services/platform')

    await setPictureInPictureEnabled(true)

    expect(plugin.setEnabled).not.toHaveBeenCalled()
  })

  it('avisa quando o app entra e sai do pop-up', async () => {
    const plugin = mockCapacitorCore()
    window.Capacitor = { isNativePlatform: () => true }
    const { onPictureInPictureChange } = await import('@/services/platform')
    const seen = []

    const stop = onPictureInPictureChange((active) => seen.push(active))
    await vi.waitFor(() => expect(plugin.emit).toBeTypeOf('function'))
    plugin.emit({ active: true })
    plugin.emit({ active: false })
    stop()

    expect(seen).toEqual([true, false])
    await vi.waitFor(() => expect(plugin.remove).toHaveBeenCalled())
  })

  it('fora do APK, registrar o aviso não faz nada e devolve um cancelador', async () => {
    mockCapacitorCore()
    const { onPictureInPictureChange } = await import('@/services/platform')

    const stop = onPictureInPictureChange(() => {})

    expect(stop).toBeTypeOf('function')
    expect(() => stop()).not.toThrow()
  })
})

describe('platform.canExitApp', () => {
  it('só onde o app consegue se fechar: Tizen, webOS e APK; no navegador do PC não', async () => {
    const { canExitApp } = await import('@/services/platform')

    expect(canExitApp()).toBe(false)
    window.tizen = { application: {} }
    expect(canExitApp()).toBe(true)
    delete window.tizen
    window.PalmSystem = {}
    expect(canExitApp()).toBe(true)
  })
})
