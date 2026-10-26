import { describe, it, expect, vi, afterEach } from 'vitest'

// hls.js falso: registra o que o motor pede (startLoad/loadSource) e deixa o teste disparar os eventos.
const { instances, EVENTS } = vi.hoisted(() => ({
  instances: [],
  EVENTS: {
    MANIFEST_LOADING: 'manifestLoading',
    MANIFEST_PARSED: 'manifestParsed',
    LEVEL_LOADED: 'levelLoaded',
    FRAG_LOADING: 'fragLoading',
    FRAG_BUFFERED: 'fragBuffered',
    ERROR: 'hlsError',
  },
}))

vi.mock('hls.js', () => {
  class FakeHls {
    static Events = EVENTS
    static ErrorTypes = { NETWORK_ERROR: 'networkError', MEDIA_ERROR: 'mediaError' }
    static isSupported() {
      return true
    }
    constructor(config) {
      this.config = config
      this.handlers = {}
      this.calls = []
      instances.push(this)
    }
    on(event, fn) {
      ;(this.handlers[event] = this.handlers[event] || []).push(fn)
    }
    emit(event, data) {
      ;(this.handlers[event] || []).forEach((fn) => fn(event, data))
    }
    attachMedia() {}
    loadSource() {
      this.calls.push('loadSource')
    }
    startLoad() {
      this.calls.push('startLoad')
    }
    stopLoad() {
      this.calls.push('stopLoad')
    }
    detachMedia() {}
    destroy() {}
  }
  return { default: FakeHls }
})

afterEach(() => {
  vi.useRealTimers()
  instances.length = 0
})

const LIVE = {
  primaryUrl: 'http://srv.test/live/u/p/9.m3u8',
  fallbackUrl: null,
  isHls: true,
  section: 'live',
  containerExtension: 'm3u8',
}

/** Canal ao vivo tocando por 5 s; depois o tempo para (o buffer secou). */
async function startLiveAndPlay() {
  vi.useFakeTimers()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const { useVideoEngine } = await import('@/composables/useVideoEngine')
  const engine = useVideoEngine()
  const video = document.createElement('video')
  const state = { time: 0 }
  Object.defineProperty(video, 'currentTime', { configurable: true, get: () => state.time, set: (v) => { state.time = v } })
  Object.defineProperty(video, 'paused', { configurable: true, get: () => false })
  Object.defineProperty(video, 'buffered', { configurable: true, get: () => ({ length: 0 }) })
  video.play = vi.fn(() => Promise.resolve())
  video.pause = vi.fn()

  await engine.attachAndPlay(video, LIVE)
  const hls = instances[instances.length - 1]
  video.dispatchEvent(new Event('playing'))
  for (let i = 1; i <= 5; i++) {
    state.time = i
    await vi.advanceTimersByTimeAsync(1000)
  }
  return { engine, hls }
}

describe('useVideoEngine (HLS) — buffer secou no meio do canal', () => {
  it('não interrompe um segmento que ainda está chegando (rede lenta): nada de startLoad nem recarga', async () => {
    const { engine, hls } = await startLiveAndPlay()
    const frag = { sn: 7, stats: { loaded: 0 } }
    hls.emit(EVENTS.FRAG_LOADING, { frag })

    for (let s = 0; s < 20; s++) {
      frag.stats.loaded += 50000 // o segmento chega devagar, mas chega
      await vi.advanceTimersByTimeAsync(1000)
    }

    expect(hls.calls).toEqual(['loadSource']) // só a carga inicial
    expect(engine.recovering.value).toBe(false)
    expect(engine.error.value).toBe('')
    engine.destroyEngine()
  })

  it('sem nenhum dado chegando, ainda reconecta o canal', async () => {
    const { engine, hls } = await startLiveAndPlay()

    await vi.advanceTimersByTimeAsync(12000)

    expect(hls.calls.filter((c) => c === 'loadSource')).toHaveLength(2)
    expect(engine.recovering.value).toBe(true)
    engine.destroyEngine()
  })

  it('o hls.js não corta sozinho o download de um segmento lento (limite de pelo menos 60 s)', async () => {
    const { engine, hls } = await startLiveAndPlay()
    const { default: RealHls } = await vi.importActual('hls.js')

    const real = new RealHls(hls.config)

    expect(real.config.fragLoadPolicy.default.maxLoadTimeMs).toBeGreaterThanOrEqual(60000)
    real.destroy()
    engine.destroyEngine()
  })
})
