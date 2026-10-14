import { ref, getCurrentInstance, onBeforeUnmount } from 'vue'

/**
 * Motor de reprodução: <video> + hls.js, com fallback nativo e teardown estrito.
 *
 * - hls.js é carregado sob demanda (import dinâmico) para não pesar a abertura do app.
 * - `destroyEngine()` roda SEMPRE antes de um novo stream: em Tizen/webOS o decoder
 *   de hardware é único e só é liberado com pause + remoção do src + load().
 * - Cada reprodução tem um `token`; eventos de instâncias antigas são ignorados.
 * - Logs nunca incluem URLs (elas contêm usuário/senha).
 */

export const PLAYBACK_ERROR =
  'Não foi possível reproduzir esta mídia no momento. Verifique sua conexão ou tente outro item.'

// Buffers conservadores para não estourar a RAM da TV.
const HLS_CONFIG = {
  enableWorker: true,
  lowLatencyMode: false,
  backBufferLength: 15,
  maxBufferLength: 30,
  maxMaxBufferLength: 60,
  manifestLoadingTimeOut: 15000,
  fragLoadingTimeOut: 20000,
}

let hlsModulePromise = null

function loadHls() {
  if (!hlsModulePromise) {
    hlsModulePromise = import('hls.js')
      .then((m) => m.default || m)
      .catch((err) => {
        console.warn('[player] hls.js indisponível:', err && err.message)
        hlsModulePromise = null
        return null
      })
  }
  return hlsModulePromise
}

export function useVideoEngine() {
  const error = ref('')
  const engineType = ref('') // 'hls' | 'native' | ''

  let hls = null
  let video = null
  let token = 0
  let nativeErrorListener = null

  /** Libera hls.js e o <video> sem invalidar o token atual. */
  function teardownMedia() {
    if (hls) {
      const instance = hls
      hls = null
      try {
        instance.stopLoad()
      } catch (_) {}
      try {
        instance.detachMedia()
      } catch (_) {}
      try {
        instance.destroy()
      } catch (_) {}
    }
    if (video) {
      if (nativeErrorListener) {
        video.removeEventListener('error', nativeErrorListener)
        nativeErrorListener = null
      }
      try {
        video.pause()
      } catch (_) {}
      video.removeAttribute('src')
      try {
        video.load()
      } catch (_) {}
    }
    engineType.value = ''
  }

  /** Destruição estrita: invalida eventos pendentes e libera o decoder. */
  function destroyEngine() {
    token++
    teardownMedia()
  }

  function clearError() {
    error.value = ''
  }

  function safePlay(my) {
    if (my !== token || !video) return
    let p
    try {
      p = video.play()
    } catch (_) {
      return
    }
    if (p && typeof p.catch === 'function') {
      p.catch((err) => {
        if (err && err.name !== 'AbortError') console.warn('[player] play() recusado:', err.name)
      })
    }
  }

  function fail(my, reason) {
    if (my !== token) return
    console.warn('[player] Reprodução falhou:', reason)
    token++
    teardownMedia()
    error.value = PLAYBACK_ERROR
  }

  function startNative(url, desc, my, isFallback) {
    engineType.value = 'native'
    nativeErrorListener = () => {
      if (my !== token) return
      const reason = `native code=${video && video.error ? video.error.code : '?'}`
      if (!isFallback && desc.fallbackUrl) switchToFallback(desc, my, reason)
      else fail(my, reason)
    }
    video.addEventListener('error', nativeErrorListener)
    video.src = url
    try {
      video.load()
    } catch (_) {}
    safePlay(my)
  }

  function switchToFallback(desc, my, reason) {
    if (my !== token) return
    console.warn('[player] Tentando formato alternativo após:', reason)
    teardownMedia()
    startNative(desc.fallbackUrl, desc, my, true)
  }

  function startHls(Hls, desc, my) {
    engineType.value = 'hls'
    let networkRetried = false
    let mediaRetried = false
    const instance = new Hls(HLS_CONFIG)
    hls = instance

    instance.on(Hls.Events.MANIFEST_PARSED, () => {
      if (hls === instance) safePlay(my)
    })
    instance.on(Hls.Events.ERROR, (_evt, data) => {
      if (my !== token || hls !== instance || !data || !data.fatal) return
      const reason = `hls ${data.type}/${data.details}` // sem data.url (contém credenciais)

      if (data.type === Hls.ErrorTypes.NETWORK_ERROR && !networkRetried) {
        networkRetried = true
        console.warn('[player] Erro de rede no HLS, tentando novamente:', data.details)
        instance.startLoad()
        return
      }
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !mediaRetried) {
        mediaRetried = true
        console.warn('[player] Erro de mídia no HLS, tentando recuperar:', data.details)
        instance.recoverMediaError()
        return
      }
      if (desc.fallbackUrl) switchToFallback(desc, my, reason)
      else fail(my, reason)
    })

    instance.attachMedia(video)
    instance.loadSource(desc.primaryUrl)
  }

  /**
   * @param {HTMLVideoElement} videoElement
   * @param {{primaryUrl:string, fallbackUrl:string|null, isHls:boolean}|null} desc
   */
  async function attachAndPlay(videoElement, desc) {
    destroyEngine()
    const my = token
    error.value = ''
    video = videoElement || null

    if (!video || !desc || !desc.primaryUrl) {
      fail(my, 'descritor de stream inválido')
      return
    }

    if (desc.isHls) {
      const Hls = await loadHls()
      if (my !== token) return
      if (Hls && Hls.isSupported()) {
        startHls(Hls, desc, my)
        return
      }
      // Sem MSE: HLS nativo (canPlayType) ou tentativa direta — vários WebViews de
      // TV tocam HLS nativamente mesmo respondendo '' em canPlayType.
      if (!video.canPlayType('application/vnd.apple.mpegurl')) {
        console.info('[player] Sem MSE nem HLS nativo declarado; tentando reprodução direta.')
      }
    }
    startNative(desc.primaryUrl, desc, my, false)
  }

  if (getCurrentInstance()) onBeforeUnmount(destroyEngine)

  return { error, engineType, attachAndPlay, destroyEngine, clearError }
}
