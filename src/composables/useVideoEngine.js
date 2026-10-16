import { ref, getCurrentInstance, onBeforeUnmount } from 'vue'
import { canUseDevProxy, devProxyUrl, maskSecrets } from '@/services/netEnv'

/**
 * Motor de reprodução: <video> + hls.js, com fallback nativo, barra de progresso real,
 * Pre-Buffer Gate e Watchdog anti-congelamento (RFC-009).
 */

export const PLAYBACK_ERROR =
  'Não foi possível reproduzir esta mídia no momento. Verifique sua conexão ou tente outro item.'

/**
 * Configuração otimizada para IPTV Xtream Codes em Smart TVs e Android TV (RFC-009).
 */
const HLS_CONFIG = {
  enableWorker: false,               // Evita falhas de WebWorker/CSP em WebViews de Smart TVs
  lowLatencyMode: false,             // CRÍTICO: Servidores Xtream usam HLS padrão (.ts), LL-HLS causa travamentos constantes
  backBufferLength: 15,              // Descarta rápido o que já passou para economizar RAM da TV
  maxBufferLength: 30,               // Mantém até 30s de folga à frente
  maxMaxBufferLength: 60,
  maxBufferSize: 30 * 1000 * 1000,   // Limite de 30MB em RAM para não engasgar a TV
  maxBufferHole: 0.5,                // Pula pequenos buracos de timestamp comuns em canais IPTV
  highBufferWatchdogPeriod: 2,
  nudgeOffset: 0.25,                 // Empurra o playhead automaticamente se um frame vier corrompido
  nudgeMaxRetry: 10,
  liveSyncDurationCount: 3,          // Fica a 3 segmentos do tempo real (equilíbrio ideal entre estabilidade e atraso)
  liveMaxLatencyDurationCount: 10,   // Se atrasar mais de 10 segmentos, ressincroniza suavemente
  liveDurationInfinity: true,
  abrEwmaDefaultEstimate: 4000000,   // Estimativa inicial de 4 Mbps para partida rápida
  manifestLoadingTimeOut: 12000,
  manifestLoadingMaxRetry: 4,
  manifestLoadingRetryDelay: 800,
  levelLoadingTimeOut: 12000,
  levelLoadingMaxRetry: 4,
  levelLoadingRetryDelay: 800,
  fragLoadingTimeOut: 15000,
  fragLoadingMaxRetry: 6,
  fragLoadingRetryDelay: 800,
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
  const loadingProgress = ref(0)
  const loadingStage = ref('Conectando à transmissão...')

  let hls = null
  let video = null
  let token = 0
  let nativeErrorListener = null
  let videoListeners = []

  // Timers
  let progressTimer = null
  let watchdogTimer = null
  let prebufferSafetyTimer = null
  let networkRetryTimer = null

  // Contadores de recuperação
  let networkRecoveryAttempts = 0
  let mediaRecoveryAttempts = 0
  let targetProgress = 0
  let gateOpen = false
  let lastCurTime = -1
  let stalledSeconds = 0

  function startProgressTimer() {
    if (progressTimer) return
    progressTimer = setInterval(() => {
      if (loadingProgress.value < targetProgress) {
        const delta = Math.max(0.75, (targetProgress - loadingProgress.value) * 0.2)
        loadingProgress.value = Math.min(targetProgress, loadingProgress.value + delta)
      } else if (targetProgress >= 100 && loadingProgress.value >= 100) {
        clearInterval(progressTimer)
        progressTimer = null
      }
    }, 50)
  }

  function setProgressTarget(val, stage) {
    if (stage) loadingStage.value = stage
    if (val > targetProgress) {
      targetProgress = Math.min(100, val)
    }
    startProgressTimer()
  }

  function completeLoading() {
    targetProgress = 100
    loadingProgress.value = 100
    loadingStage.value = 'Iniciando reprodução...'
    if (progressTimer) {
      clearInterval(progressTimer)
      progressTimer = null
    }
  }

  function getBufferedAhead(v) {
    if (!v || !v.buffered || v.buffered.length === 0) return 0
    const cur = v.currentTime || 0
    for (let i = 0; i < v.buffered.length; i++) {
      const start = v.buffered.start(i)
      const end = v.buffered.end(i)
      if (start <= cur + 0.35 && cur <= end) {
        return Math.max(0, end - cur)
      }
    }
    return 0
  }

  function checkPrebuffer(desc, my) {
    if (my !== token || gateOpen || !video) return
    const isLiveStream = (desc && desc.section === 'live') || (desc && desc.isHls)
    const targetBuffer = isLiveStream ? 2.5 : 2.0
    const buffered = getBufferedAhead(video)
    const ratio = Math.min(1, buffered / targetBuffer)
    const calcProgress = Math.min(95, 70 + ratio * 25)
    setProgressTarget(calcProgress, 'Preenchendo buffer de estabilidade...')

    if (buffered >= targetBuffer) {
      gateOpen = true
      if (prebufferSafetyTimer) {
        clearTimeout(prebufferSafetyTimer)
        prebufferSafetyTimer = null
      }
      completeLoading()
      safePlay(my)
    }
  }

  function startWatchdog(desc, my) {
    stopWatchdog()
    lastCurTime = -1
    stalledSeconds = 0

    watchdogTimer = setInterval(() => {
      if (my !== token || !video) return
      if (video.paused || error.value || !gateOpen) {
        stalledSeconds = 0
        return
      }

      const cur = video.currentTime || 0
      if (lastCurTime >= 0 && Math.abs(cur - lastCurTime) >= 0.25) {
        stalledSeconds = 0
        lastCurTime = cur
        return
      }

      lastCurTime = cur
      stalledSeconds++

      if (stalledSeconds === 6) {
        console.warn(`[player] Watchdog: Stream sem avanço há 6s. Nudge buffer / reload...`)
        const ahead = getBufferedAhead(video)
        if (ahead > 0.4) {
          video.currentTime = cur + 0.3
        }
        if (hls) {
          hls.startLoad()
        }
      }

      if (stalledSeconds >= 12) {
        console.warn(`[player] Watchdog: Stream congelado há 12s. Acionando recuperação automática.`)
        stalledSeconds = 0
        if (desc.fallbackUrl) {
          switchToFallback(desc, my, 'watchdog stall 12s')
        } else if (hls) {
          const sourceUrl = canUseDevProxy() ? devProxyUrl(desc.primaryUrl, { hls: true }) : desc.primaryUrl
          hls.loadSource(sourceUrl)
          safePlay(my)
        }
      }
    }, 1000)
  }

  function stopWatchdog() {
    if (watchdogTimer) {
      clearInterval(watchdogTimer)
      watchdogTimer = null
    }
  }

  function clearAllTimers() {
    if (progressTimer) {
      clearInterval(progressTimer)
      progressTimer = null
    }
    if (watchdogTimer) {
      clearInterval(watchdogTimer)
      watchdogTimer = null
    }
    if (prebufferSafetyTimer) {
      clearTimeout(prebufferSafetyTimer)
      prebufferSafetyTimer = null
    }
    if (networkRetryTimer) {
      clearTimeout(networkRetryTimer)
      networkRetryTimer = null
    }
  }

  function addVideoListener(el, event, handler) {
    el.addEventListener(event, handler)
    videoListeners.push({ el, event, handler })
  }

  function removeVideoListeners() {
    videoListeners.forEach(({ el, event, handler }) => {
      try {
        el.removeEventListener(event, handler)
      } catch (_) {}
    })
    videoListeners = []
  }

  /** Libera hls.js e o <video> sem invalidar o token atual. */
  function teardownMedia() {
    clearAllTimers()
    removeVideoListeners()

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
        try {
          video.removeEventListener('error', nativeErrorListener)
        } catch (_) {}
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
    networkRecoveryAttempts = 0
    mediaRecoveryAttempts = 0
    gateOpen = false
    stalledSeconds = 0
    lastCurTime = -1
  }

  /** Destruição estrita: invalida eventos pendentes e libera o decoder. */
  function destroyEngine() {
    token++
    teardownMedia()
    loadingProgress.value = 0
    targetProgress = 0
    loadingStage.value = 'Conectando à transmissão...'
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

  function switchToFallback(desc, my, reason) {
    if (my !== token) return
    console.warn('[player] Tentando formato alternativo após:', reason, desc.fallbackUrl)
    teardownMedia()
    startNative(desc.fallbackUrl, desc, my, true)
  }

  function startNative(url, desc, my, isFallback) {
    engineType.value = 'native'
    setProgressTarget(20, 'Conectando à transmissão...')

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

    addVideoListener(video, 'loadstart', () => {
      if (my === token) setProgressTarget(40, 'Carregando transmissão...')
    })
    addVideoListener(video, 'loadedmetadata', () => {
      if (my === token) setProgressTarget(65, 'Sincronizando áudio e vídeo...')
    })
    addVideoListener(video, 'progress', () => {
      checkPrebuffer(desc, my)
    })
    addVideoListener(video, 'canplay', () => {
      checkPrebuffer(desc, my)
    })
    addVideoListener(video, 'playing', () => {
      if (my === token) {
        gateOpen = true
        completeLoading()
      }
    })

    // Pre-Buffer Gate timeout de segurança (3500ms)
    prebufferSafetyTimer = setTimeout(() => {
      if (my === token && !gateOpen) {
        gateOpen = true
        completeLoading()
        safePlay(my)
      }
    }, 3500)

    video.src = url
    try {
      video.load()
    } catch (_) {}

    startWatchdog(desc, my)
  }

  function startHls(Hls, desc, my) {
    engineType.value = 'hls'
    networkRecoveryAttempts = 0
    mediaRecoveryAttempts = 0
    setProgressTarget(20, 'Conectando à transmissão...')

    const instance = new Hls(HLS_CONFIG)
    hls = instance

    instance.on(Hls.Events.MANIFEST_LOADING, () => {
      if (my === token && hls === instance) {
        setProgressTarget(35, 'Carregando manifesto de vídeo...')
      }
    })

    instance.on(Hls.Events.MANIFEST_PARSED, () => {
      if (my === token && hls === instance) {
        setProgressTarget(45, 'Manifesto validado...')
      }
    })

    instance.on(Hls.Events.LEVEL_LOADED, () => {
      if (my === token && hls === instance) {
        setProgressTarget(55, 'Sincronizando áudio e vídeo...')
      }
    })

    instance.on(Hls.Events.FRAG_LOADING, () => {
      if (my === token && hls === instance) {
        setProgressTarget(65, 'Sincronizando áudio e vídeo...')
      }
    })

    instance.on(Hls.Events.FRAG_BUFFERED, () => {
      checkPrebuffer(desc, my)
    })

    instance.on(Hls.Events.ERROR, (_evt, data) => {
      if (my !== token || hls !== instance || !data || !data.fatal) return
      const reason = `hls ${data.type}/${data.details}`
      let diagDetail = `HLS ${data.type}: ${data.details}`

      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
        const httpCode = data.response ? data.response.code : ''
        diagDetail = `HLS Network Error: ${data.details}${httpCode ? ` (HTTP ${httpCode})` : ''}`
        if (networkRecoveryAttempts < 3) {
          networkRecoveryAttempts++
          console.warn(`[player] Tentativa ${networkRecoveryAttempts}/3 de recuperação de rede: ${data.details}`)
          setProgressTarget(Math.max(25, loadingProgress.value - 15), 'Reconectando sinal ao vivo...')
          if (networkRetryTimer) clearTimeout(networkRetryTimer)
          networkRetryTimer = setTimeout(() => {
            if (my === token && hls === instance) {
              instance.startLoad()
            }
          }, 600)
          return
        }
      }

      if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        diagDetail = `HLS Media Error: ${data.details}`
        if (mediaRecoveryAttempts === 0) {
          mediaRecoveryAttempts++
          console.warn('[player] Recuperando erro de mídia HLS (tentativa 1):', data.details)
          setProgressTarget(loadingProgress.value, 'Recuperando sinal de vídeo...')
          instance.recoverMediaError()
          return
        } else if (mediaRecoveryAttempts === 1) {
          mediaRecoveryAttempts++
          console.warn('[player] Trocando codec e recuperando mídia HLS (tentativa 2):', data.details)
          setProgressTarget(loadingProgress.value, 'Ajustando decodificador de áudio...')
          instance.swapAudioCodec()
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

    if (video) {
      addVideoListener(video, 'loadedmetadata', () => {
        if (my === token) setProgressTarget(65, 'Sincronizando áudio e vídeo...')
      })
      addVideoListener(video, 'progress', () => {
        checkPrebuffer(desc, my)
      })
      addVideoListener(video, 'canplay', () => {
        checkPrebuffer(desc, my)
      })
      addVideoListener(video, 'playing', () => {
        if (my === token) {
          gateOpen = true
          completeLoading()
        }
      })
    }

    // Pre-Buffer Gate timeout de segurança (3500ms)
    prebufferSafetyTimer = setTimeout(() => {
      if (my === token && !gateOpen) {
        gateOpen = true
        completeLoading()
        safePlay(my)
      }
    }, 3500)

    instance.attachMedia(video)
    const sourceUrl = canUseDevProxy() ? devProxyUrl(desc.primaryUrl, { hls: true }) : desc.primaryUrl
    instance.loadSource(sourceUrl)

    startWatchdog(desc, my)
  }

  /**
   * @param {HTMLVideoElement} videoElement
   * @param {{primaryUrl:string, fallbackUrl:string|null, isHls:boolean, section?:string, containerExtension?:string}|null} desc
   */
  async function attachAndPlay(videoElement, desc) {
    destroyEngine()
    const my = token
    error.value = ''
    errorDetail.value = ''
    video = videoElement || null
    loadingProgress.value = 0
    targetProgress = 15
    loadingStage.value = 'Conectando à transmissão...'
    startProgressTimer()

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
      if (!video.canPlayType('application/vnd.apple.mpegurl')) {
        console.info('[player] Sem MSE nem HLS nativo declarado; tentando reprodução direta.')
      }
    }
    startNative(desc.primaryUrl, desc, my, false)
  }

  if (getCurrentInstance()) onBeforeUnmount(destroyEngine)

  return {
    error,
    errorDetail,
    engineType,
    loadingProgress,
    loadingStage,
    attachAndPlay,
    destroyEngine,
    clearError,
  }
}
