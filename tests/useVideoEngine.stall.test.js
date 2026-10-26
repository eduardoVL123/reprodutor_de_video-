import { describe, it, expect, vi, afterEach } from 'vitest'

afterEach(() => {
  vi.useRealTimers()
})

const EPISODE = {
  primaryUrl: 'http://srv.test/series/u/p/77.mp4',
  fallbackUrl: 'http://srv.test/series/u/p/77.m3u8',
  isHls: false,
  section: 'series',
  containerExtension: 'mp4',
}

/** <video> do jsdom com relógio controlável: simula um episódio tocando e depois travando. */
function fakeVideo() {
  const video = document.createElement('video')
  const state = { time: 0, paused: false, srcHistory: [] }
  Object.defineProperty(video, 'currentTime', { configurable: true, get: () => state.time, set: (v) => { state.time = v } })
  Object.defineProperty(video, 'paused', { configurable: true, get: () => state.paused })
  Object.defineProperty(video, 'duration', { configurable: true, get: () => 2700 })
  Object.defineProperty(video, 'buffered', { configurable: true, get: () => ({ length: 0 }) })
  const srcDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src')
  Object.defineProperty(video, 'src', {
    configurable: true,
    get: () => srcDescriptor.get.call(video),
    set: (v) => {
      state.srcHistory.push(v)
      srcDescriptor.set.call(video, v)
    },
  })
  video.play = vi.fn(() => Promise.resolve())
  video.pause = vi.fn()
  return { video, state }
}

async function startEpisodeAt(minute) {
  vi.useFakeTimers()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const { useVideoEngine } = await import('@/composables/useVideoEngine')
  const engine = useVideoEngine()
  const { video, state } = fakeVideo()
  await engine.attachAndPlay(video, EPISODE)
  video.dispatchEvent(new Event('playing'))
  // Toca normalmente até o minuto pedido…
  for (let i = 0; i < 5; i++) {
    state.time = minute * 60 + i
    await vi.advanceTimersByTimeAsync(1000)
  }
  return { engine, video, state }
}

describe('useVideoEngine — travamento no meio do episódio', () => {
  it('reconecta no MESMO arquivo e volta ao ponto onde parou (não recomeça do zero em outro formato)', async () => {
    const { engine, video, state } = await startEpisodeAt(20)
    const stoppedAt = state.time

    await vi.advanceTimersByTimeAsync(15000) // a rede trava: o tempo não avança
    video.dispatchEvent(new Event('loadedmetadata'))

    expect(state.srcHistory).not.toContain(EPISODE.fallbackUrl)
    expect(state.srcHistory[state.srcHistory.length - 1]).toBe(EPISODE.primaryUrl)
    expect(Math.abs(state.time - stoppedAt)).toBeLessThan(2)
    expect(engine.loadingStage.value).toMatch(/Reconectando/)
    engine.destroyEngine()
  })

  it('não reconecta enquanto o arquivo ainda está chegando (rede lenta): reconectar jogaria fora o download', async () => {
    const { engine, video, state } = await startEpisodeAt(20)

    for (let s = 0; s < 20; s++) {
      video.dispatchEvent(new Event('progress')) // o navegador segue recebendo dados
      await vi.advanceTimersByTimeAsync(1000)
    }

    expect(state.srcHistory).toHaveLength(1)
    expect(engine.recovering.value).toBe(false)
    engine.destroyEngine()
  })

  it('desiste depois de algumas tentativas e mostra erro (não fica preso em 100% para sempre)', async () => {
    const { engine, state } = await startEpisodeAt(20)

    await vi.advanceTimersByTimeAsync(180000) // servidor fora do ar por 3 minutos

    expect(engine.error.value).not.toBe('')
    expect(state.srcHistory.length).toBeLessThan(8)
    engine.destroyEngine()
  })
})

describe('useVideoEngine — canal ou vídeo que nunca começa', () => {
  const LIVE = { primaryUrl: 'http://srv.test/live/u/p/9.m3u8', fallbackUrl: '', isHls: false, section: 'live', containerExtension: 'm3u8' }

  it('mostra o erro em menos de 30 segundos (Samsung: a tela responde em até 30 s)', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { useVideoEngine } = await import('@/composables/useVideoEngine')
    const engine = useVideoEngine()
    const { video } = fakeVideo()
    await engine.attachAndPlay(video, LIVE)

    await vi.advanceTimersByTimeAsync(29000) // nada chega: o tempo nunca sai do zero

    expect(engine.error.value).not.toBe('')
    engine.destroyEngine()
  })
})
