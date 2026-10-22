import { describe, it, expect, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

async function setup({ withNavigation = false } = {}) {
  const attachAndPlay = vi.fn(async () => {})
  vi.doMock('@/composables/useVideoEngine', async () => {
    const { ref } = await import('vue')
    return {
      PLAYBACK_ERROR: 'erro',
      useVideoEngine: () => ({
        error: ref(''),
        errorDetail: ref(''),
        loadingProgress: ref(0),
        loadingStage: ref(''),
        attachAndPlay,
        destroyEngine: vi.fn(),
      }),
    }
  })
  const platform = {
    exitApp: vi.fn(),
    setPictureInPictureEnabled: vi.fn(async () => {}),
    pipCallback: null,
    backgroundCallback: null,
  }
  platform.onPictureInPictureChange = vi.fn((cb) => {
    platform.pipCallback = cb
    return vi.fn()
  })
  platform.onAppBackground = vi.fn((cb) => {
    platform.backgroundCallback = cb
    return vi.fn()
  })
  vi.doMock('@/services/platform', () => platform)

  const { createPinia, setActivePinia } = await import('pinia')
  const pinia = createPinia()
  setActivePinia(pinia)
  if (withNavigation) (await import('@/utils/spatialNavigation')).initSpatialNavigation()
  const { default: VideoPlayerOverlay } = await import('@/components/VideoPlayerOverlay.vue')
  const { usePlayerStore } = await import('@/stores/playerStore')
  const wrapper = mount(VideoPlayerOverlay, { global: { plugins: [pinia] }, attachTo: document.body })
  return { wrapper, player: usePlayerStore(), attachAndPlay, platform }
}

const MOVIE = { stream_id: 1, name: 'Filme', section: 'vod', directUrl: 'http://srv.test/a.mp4' }
const video = () => document.querySelector('video')
const pressKey = (key, keyCode) =>
  (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', { key, keyCode, bubbles: true, cancelable: true }))

/** jsdom não reproduz mídia: simula um vídeo de 100s parado em 20s. */
function fakePlayback(el, { paused = false } = {}) {
  let time = 20
  let isPaused = paused
  Object.defineProperty(el, 'duration', { configurable: true, get: () => 100 })
  Object.defineProperty(el, 'currentTime', {
    configurable: true,
    get: () => time,
    set: (v) => {
      time = v
    },
  })
  Object.defineProperty(el, 'paused', { configurable: true, get: () => isPaused })
  el.play = vi.fn(async () => {
    isPaused = false
  })
  el.pause = vi.fn(() => {
    isPaused = true
  })
  return { time: () => time }
}

describe('VideoPlayerOverlay — início da reprodução', () => {
  it('inicia o motor de reprodução uma única vez ao abrir um item', async () => {
    const { wrapper, player, attachAndPlay } = await setup()

    player.playItem(MOVIE)
    await flushPromises()

    expect(attachAndPlay).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('inicia de novo quando o usuário troca para outro item', async () => {
    const { wrapper, player, attachAndPlay } = await setup()
    player.playItem({ ...MOVIE, stream_id: 1 })
    await flushPromises()

    player.playItem({ ...MOVIE, stream_id: 2, directUrl: 'http://srv.test/b.mp4' })
    await flushPromises()

    expect(attachAndPlay).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })

  it('o foco inicial fica no Play/Pausa (OK acidental não fecha o vídeo)', async () => {
    const { wrapper, player } = await setup()

    player.playItem(MOVIE)
    await flushPromises()

    expect(document.activeElement.id).toBe('osd-play-pause')
    wrapper.unmount()
  })
})

describe('VideoPlayerOverlay — teclas de mídia do controle', () => {
  it('Pause pausa e Play retoma, sem alternar por engano', async () => {
    const { wrapper, player } = await setup({ withNavigation: true })
    player.playItem(MOVIE)
    await flushPromises()
    const el = video()
    fakePlayback(el)

    pressKey('MediaPlay', 415)
    expect(el.pause).not.toHaveBeenCalled()
    pressKey('MediaPause', 19)
    expect(el.pause).toHaveBeenCalledTimes(1)
    pressKey('MediaPlay', 415)
    expect(el.play).toHaveBeenCalled()
    wrapper.unmount()
  })

  it('Avançar e Voltar pulam 10 segundos no filme', async () => {
    const { wrapper, player } = await setup({ withNavigation: true })
    player.playItem(MOVIE)
    await flushPromises()
    const playback = fakePlayback(video())

    pressKey('MediaFastForward', 417)
    expect(playback.time()).toBe(30)
    pressKey('MediaRewind', 412)
    pressKey('MediaRewind', 412)
    expect(playback.time()).toBe(10)
    wrapper.unmount()
  })

  it('Stop encerra a reprodução', async () => {
    const { wrapper, player } = await setup({ withNavigation: true })
    player.playItem(MOVIE)
    await flushPromises()

    pressKey('MediaStop', 413)
    await flushPromises()

    expect(player.isOpen).toBe(false)
    wrapper.unmount()
  })
})

describe('VideoPlayerOverlay — segundo plano e pop-up', () => {
  it('pausa o vídeo quando o app vai para segundo plano', async () => {
    const { wrapper, player, platform } = await setup()
    player.playItem(MOVIE)
    await flushPromises()
    const el = video()
    fakePlayback(el)

    platform.backgroundCallback()

    expect(el.pause).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('libera o pop-up só enquanto o vídeo está tocando', async () => {
    const { wrapper, player, platform } = await setup()
    player.playItem(MOVIE)
    await flushPromises()
    const el = video()

    el.dispatchEvent(new Event('playing'))
    await flushPromises()
    el.dispatchEvent(new Event('pause'))
    await flushPromises()
    el.dispatchEvent(new Event('playing'))
    await flushPromises()
    player.close()
    await flushPromises()

    const calls = platform.setPictureInPictureEnabled.mock.calls.map(([v]) => v)
    expect(calls).toEqual([true, false, true, false])
    wrapper.unmount()
  })

  it('dentro do pop-up esconde os controles e ao voltar mostra de novo', async () => {
    const { wrapper, player, platform } = await setup()
    player.playItem(MOVIE)
    await flushPromises()
    expect(document.getElementById('player-osd')).not.toBeNull()

    platform.pipCallback(true)
    await flushPromises()
    expect(document.getElementById('player-osd')).toBeNull()

    platform.pipCallback(false)
    await flushPromises()
    expect(document.getElementById('player-osd')).not.toBeNull()
    wrapper.unmount()
  })
})

describe('VideoPlayerOverlay — layout 2.0', () => {
  it('exibe série com subtítulo TxEy e título do episódio', async () => {
    const { wrapper, player } = await setup()
    player.playItem({
      stream_id: 10,
      name: 'Maré Alta - T2:E5 - O Farol',
      section: 'series',
      directUrl: 'http://srv.test/s.mp4',
    })
    await flushPromises()

    const osd = document.getElementById('player-osd')
    expect(osd.textContent).toContain('Maré Alta · T2:E5')
    expect(osd.textContent).toContain('O Farol')

    // Botão discreto de fechar no topo
    expect(document.getElementById('osd-top-close')).not.toBeNull()
    // Controles da interface
    expect(document.getElementById('osd-play-pause')).not.toBeNull()
    expect(document.getElementById('osd-queue').textContent).toContain('Episódios')
    expect(document.getElementById('osd-bookmark').textContent).toContain('Minha lista')

    wrapper.unmount()
  })
})

