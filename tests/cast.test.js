import { describe, it, expect, vi, afterEach } from 'vitest'

afterEach(() => {
  delete window.Capacitor
  vi.resetModules()
})

function mockCastPlugin(overrides = {}) {
  const plugin = {
    isAvailable: vi.fn(async () => ({ available: true })),
    requestSession: vi.fn(async () => ({ deviceName: 'TV da sala' })),
    load: vi.fn(async () => {}),
    play: vi.fn(async () => {}),
    pause: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    addListener: vi.fn(async (_event, cb) => {
      plugin.emit = cb
      return { remove: plugin.remove }
    }),
    remove: vi.fn(async () => {}),
    ...overrides,
  }
  vi.doMock('@capacitor/core', () => ({ registerPlugin: vi.fn(() => plugin) }))
  return plugin
}

describe('castMediaFor', () => {
  it('canal ao vivo vai como HLS ao vivo, com a URL principal', async () => {
    const { castMediaFor } = await import('@/services/cast')
    const stream = {
      primaryUrl: 'http://srv/live/u/p/1.m3u8',
      fallbackUrl: 'http://srv/live/u/p/1.ts',
      isHls: true,
      containerExtension: 'm3u8',
    }

    expect(castMediaFor(stream, { name: 'Canal 1' }, 'live')).toEqual({
      url: 'http://srv/live/u/p/1.m3u8',
      contentType: 'application/x-mpegurl',
      title: 'Canal 1',
      live: true,
    })
  })

  it('filme usa o tipo do contêiner e não é ao vivo', async () => {
    const { castMediaFor } = await import('@/services/cast')
    const stream = { primaryUrl: 'http://srv/movie/u/p/9.mkv', isHls: false, containerExtension: 'mkv' }

    expect(castMediaFor(stream, { name: 'Filme' }, 'vod')).toMatchObject({
      contentType: 'video/x-matroska',
      live: false,
    })
  })

  it('extensão desconhecida cai para MP4', async () => {
    const { castMediaFor } = await import('@/services/cast')
    const stream = { primaryUrl: 'http://srv/x', isHls: false, containerExtension: 'xyz' }

    expect(castMediaFor(stream, {}, 'series').contentType).toBe('video/mp4')
  })

  it('sem stream não há o que transmitir', async () => {
    const { castMediaFor } = await import('@/services/cast')

    expect(castMediaFor(null, {}, 'live')).toBeNull()
  })
})

describe('plugin Cast', () => {
  it('fora do APK não está disponível e não chama o nativo', async () => {
    const plugin = mockCastPlugin()
    const { isCastAvailable } = await import('@/services/cast')

    expect(await isCastAvailable()).toBe(false)
    expect(plugin.isAvailable).not.toHaveBeenCalled()
  })

  it('no APK pergunta ao nativo (que responde falso em TV)', async () => {
    window.Capacitor = { isNativePlatform: () => true }
    mockCastPlugin({ isAvailable: vi.fn(async () => ({ available: false })) })
    const { isCastAvailable } = await import('@/services/cast')

    expect(await isCastAvailable()).toBe(false)
  })

  it('erro do nativo vira indisponível, sem rejeitar', async () => {
    window.Capacitor = { isNativePlatform: () => true }
    mockCastPlugin({ isAvailable: vi.fn(async () => Promise.reject(new Error('sem plugin'))) })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { isCastAvailable } = await import('@/services/cast')

    expect(await isCastAvailable()).toBe(false)
  })

  it('repassa o estado da mídia na TV', async () => {
    window.Capacitor = { isNativePlatform: () => true }
    const plugin = mockCastPlugin()
    const { onCastMediaStatus } = await import('@/services/cast')
    const callback = vi.fn()

    const cancel = onCastMediaStatus(callback)
    await Promise.resolve()
    plugin.emit({ state: 'playing' })

    expect(callback).toHaveBeenCalledWith({ state: 'playing' })
    cancel()
  })
})
