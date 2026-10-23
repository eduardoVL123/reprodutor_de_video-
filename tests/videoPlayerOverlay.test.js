import { describe, it, expect, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

let recovering = null

async function setup({ withNavigation = false } = {}) {
  const attachAndPlay = vi.fn(async () => {})
  vi.doMock('@/composables/useVideoEngine', async () => {
    const { ref } = await import('vue')
    recovering = ref(false)
    return {
      PLAYBACK_ERROR: 'erro',
      useVideoEngine: () => ({
        error: ref(''),
        errorDetail: ref(''),
        loadingProgress: ref(0),
        loadingStage: ref(''),
        recovering,
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


describe('VideoPlayerOverlay — progresso ao trocar de item', () => {
  it('o tempo assistido fica no item anterior, não no próximo', async () => {
    const { wrapper, player } = await setup()
    await player.hydrate(true)
    player.playItem({ ...MOVIE, stream_id: 1 })
    await flushPromises()
    const el = video()
    const playback = fakePlayback(el)
    Object.defineProperty(el, 'duration', { configurable: true, get: () => 3000 })
    el.currentTime = 600
    el.dispatchEvent(new Event('durationchange'))
    el.dispatchEvent(new Event('timeupdate'))

    player.playItem({ ...MOVIE, stream_id: 2, directUrl: 'http://srv.test/b.mp4' })
    await flushPromises()

    expect(playback.time()).toBe(600)
    expect(player.getSavedTime(1, 'vod')).toBe(600)
    expect(player.getSavedTime(2, 'vod')).toBe(0)
    wrapper.unmount()
  })
})

describe('VideoPlayerOverlay — carregamento no meio do vídeo', () => {
  it('mostra "Carregando" sem a barra de porcentagem da abertura', async () => {
    const { wrapper, player } = await setup()
    player.playItem(MOVIE)
    await flushPromises()
    const el = video()
    fakePlayback(el)
    el.dispatchEvent(new Event('playing'))
    el.dispatchEvent(new Event('timeupdate'))
    await flushPromises()

    el.dispatchEvent(new Event('waiting'))
    await flushPromises()

    const status = document.querySelector('#video-player-root [role="status"]')
    expect(status.textContent).toContain('Carregando')
    expect(status.textContent).not.toContain('%')
    wrapper.unmount()
  })

  it('durante a reconexão avisa que está reconectando', async () => {
    const { wrapper, player } = await setup()
    player.playItem(MOVIE)
    await flushPromises()
    const el = video()
    fakePlayback(el)
    el.dispatchEvent(new Event('playing'))
    el.dispatchEvent(new Event('timeupdate'))
    el.dispatchEvent(new Event('waiting'))
    recovering.value = true
    await flushPromises()

    expect(document.querySelector('#video-player-root [role="status"]').textContent).toContain('Reconectando')
    wrapper.unmount()
  })
})

describe('VideoPlayerOverlay — próximo episódio antes do fim', () => {
  const EPISODES = [1, 2].map((n) => ({
    stream_id: n,
    name: `Série - T1:E${n} - Ep ${n}`,
    section: 'series',
    seriesId: 9,
    directUrl: `http://srv.test/e${n}.mp4`,
  }))

  async function playFirstEpisodeAt(seconds) {
    const ctx = await setup()
    ctx.player.playPlaylist({ items: EPISODES, startIndex: 0, section: 'series' })
    await flushPromises()
    const el = video()
    fakePlayback(el)
    Object.defineProperty(el, 'duration', { configurable: true, get: () => 1500 })
    el.currentTime = seconds
    el.dispatchEvent(new Event('durationchange'))
    el.dispatchEvent(new Event('timeupdate'))
    await flushPromises()
    return { ...ctx, el }
  }

  it('faltando 20 segundos mostra o próximo episódio, com a contagem até o fim', async () => {
    const { wrapper } = await playFirstEpisodeAt(1481)

    expect(document.getElementById('autoadvance-card')).not.toBeNull()
    expect(document.getElementById('autoadvance-card').textContent).toContain('19s')
    wrapper.unmount()
  })

  it('antes dos 20 segundos finais não mostra nada', async () => {
    const { wrapper } = await playFirstEpisodeAt(1400)

    expect(document.getElementById('autoadvance-card')).toBeNull()
    wrapper.unmount()
  })

  it('"Reproduzir agora" pula para o próximo episódio sem esperar o fim', async () => {
    const { wrapper, player } = await playFirstEpisodeAt(1485)

    document.getElementById('autoadvance-play').click()
    await flushPromises()

    expect(player.currentItem.stream_id).toBe(2)
    wrapper.unmount()
  })

  it('cancelado, não volta a aparecer no mesmo episódio nem troca sozinho no fim', async () => {
    const { wrapper, player, el } = await playFirstEpisodeAt(1485)

    document.getElementById('autoadvance-cancel').click()
    await flushPromises()
    el.currentTime = 1495
    el.dispatchEvent(new Event('timeupdate'))
    el.dispatchEvent(new Event('ended'))
    await flushPromises()

    expect(document.getElementById('autoadvance-card')).toBeNull()
    expect(player.currentItem.stream_id).toBe(1)
    wrapper.unmount()
  })
})
