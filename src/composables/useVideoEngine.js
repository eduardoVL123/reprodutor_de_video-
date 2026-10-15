import { ref, getCurrentInstance, onBeforeUnmount } from 'vue'
import { canUseDevProxy, devProxyUrl, maskSecrets } from '@/services/netEnv'

/**
 * Motor de reprodução: <video> + hls.js, com fallback nativo e teardown estrito.
 *
 * - hls.js é carregado sob demanda (import dinâmico) para não pesar a abertura do app.
 * - enableWorker: false para evitar quebras de CSP/blob worker em WebViews de Android TV.
 * - destroyEngine() roda SEMPRE antes de um novo stream: em Tizen/webOS o decoder
 *   de hardware é único e só é liberado com pause + remoção do src + load().
 * - Cada reprodução tem um `token`; eventos de instâncias antigas são ignorados.
 * - Diagnósticos mostram motor, formato e URL com credenciais mascaradas.
 */

export const PLAYBACK_ERROR =
  'Não foi possível reproduzir esta mídia no momento. Verifique sua conexão ou tente outro item.'

// Buffers conservadores para não estourar a RAM da TV.
// enableWorker: false é OBRIGATÓRIO em Smart TVs (Web Workers com blob URLs falham por CSP/CORS).
const HLS_CONFIG = {
  enableWorker: false,
  lowLatencyMode: false,
  backBufferLength: 15,
  maxBufferLength: 30,
  maxMaxBufferLength: 60,
  manifestLoadingTimeOut: 20000,
  fragLoadingTimeOut: 25000,
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
  const errorDetail = ref('')
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
    errorDetail.value = ''
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

  function fail(my, reason, detail, triedUrl, ext) {
    if (my !== token) return
    console.warn('[player] Reprodução falhou:', reason, detail)
    token++
    teardownMedia()
    error.value = PLAYBACK_ERROR
    const eng = engineType.value || (detail && detail.indexOf('HLS') !== -1 ? 'hls' : 'native')
    const format = ext || 'mídia'
    const masked = triedUrl ? maskSecrets(triedUrl) : '-'
    errorDetail.value = `[Engine: ${eng}] [Formato: ${format}] ${detail || reason || 'Erro na reprodução'} | URL: ${masked}`
  }

  function startNative(url, desc, my, isFallback) {
    engineType.value = 'native'
    nativeErrorListener = () => {
      if (my !== token) return
      const errCode = video && video.error ? video.error.code : 0
      const errMsgs = {
        1: 'MEDIA_ERR_ABORTED (reprodução cancelada)',
        2: 'MEDIA_ERR_NETWORK (falha na conexão de rede)',
        3: 'MEDIA_ERR_DECODE (erro na decodificação do vídeo)',
        4: 'MEDIA_ERR_SRC_NOT_SUPPORTED (formato ou link offline)',
      }
      const codeName = errMsgs[errCode] || 'MEDIA_ERR_UNKNOWN'
      const detail = `HTML5 Video Error Code ${errCode}: ${codeName}`
      const reason = `native code=${errCode}`
      if (!isFallback && desc.fallbackUrl) {
        switchToFallback(desc, my, reason)
      } else {
        fail(my, reason, detail, url, desc.containerExtension)
      }
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
    console.warn('[player] Tentando formato alternativo após:', reason, desc.fallbackUrl)
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
      const reason = `hls ${data.type}/${data.details}`
      let diagDetail = `HLS ${data.type}: ${data.details}`

      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
        const httpCode = data.response ? data.response.code : ''
        diagDetail = `HLS Network Error: ${data.details}${httpCode ? ` (HTTP ${httpCode})` : ''}`
        if (!networkRetried) {
          networkRetried = true
          console.warn('[player] Erro de rede no HLS, tentando novamente:', data.details)
          instance.startLoad()
          return
        }
      }
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        diagDetail = `HLS Media Error: ${data.details}`
        if (!mediaRetried) {
          mediaRetried = true
          console.warn('[player] Erro de mídia no HLS, tentando recuperar:', data.details)
          instance.recoverMediaError()
          return
        }
      }
      if (desc.fallbackUrl) {
        switchToFallback(desc, my, reason)
      } else {
        fail(my, reason, diagDetail, desc.primaryUrl, desc.containerExtension || 'm3u8')
      }
    })

    instance.attachMedia(video)
    const sourceUrl = canUseDevProxy() ? devProxyUrl(desc.primaryUrl, { hls: true }) : desc.primaryUrl
    instance.loadSource(sourceUrl)
  }

  /**
   * @param {HTMLVideoElement} videoElement
   * @param {{primaryUrl:string, fallbackUrl:string|null, isHls:boolean, containerExtension?:string}|null} desc
   */
  async function attachAndPlay(videoElement, desc) {
    destroyEngine()
    const my = token
    error.value = ''
    errorDetail.value = ''
    video = videoElement || null

    if (!video || !desc || !desc.primaryUrl) {
      fail(my, 'descritor de stream inválido', 'Dados de stream ausentes ou parâmetros de reprodução incompletos', '', '')
      return
    }

    if (desc.isHls) {
      const Hls = await loadHls()
      if (my !== token) return
      if (Hls && Hls.isSupported()) {
        startHls(Hls, desc, my)
        return
      }
      // Sem MSE: HLS nativo (canPlayType) ou tentativa direta
      if (!video.canPlayType('application/vnd.apple.mpegurl')) {
        console.info('[player] Sem MSE nem HLS nativo declarado; tentando reprodução direta.')
      }
    }
    startNative(desc.primaryUrl, desc, my, false)
  }

  if (getCurrentInstance()) onBeforeUnmount(destroyEngine)

  return { error, errorDetail, engineType, attachAndPlay, destroyEngine, clearError }
}
