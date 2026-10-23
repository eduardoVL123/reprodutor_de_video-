<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { usePlayerStore } from '@/stores/playerStore'
import { useAuthStore } from '@/stores/authStore'
import { buildStreamUrl } from '@/services/streamUrl'
import { formatTime } from '@/utils/formatTime'
import { useVideoEngine, PLAYBACK_ERROR } from '@/composables/useVideoEngine'
import { registerBackHandler, registerKeyHandler, focusFirstIn, pushFocusScope } from '@/utils/spatialNavigation'
import { onAppBackground, onPictureInPictureChange, setPictureInPictureEnabled } from '@/services/platform'
import { parseSeriesTitle } from '@/utils/seriesTitle'
import GridView from '@/components/GridView.vue'

const player = usePlayerStore()
const auth = useAuthStore()

const videoRef = ref(null)
const {
  error: engineError,
  errorDetail: engineErrorDetail,
  loadingProgress,
  loadingStage,
  recovering,
  attachAndPlay,
  destroyEngine,
} = useVideoEngine()

// Estado do OSD, controles e renderização de frame (RFC-009)
const hasRenderedFrame = ref(false)
const isOsdVisible = ref(true)
const isQueueDrawerOpen = ref(false)
const isPaused = ref(false)
const isBuffering = ref(false)
const isInPip = ref(false) // app no pop-up (Picture-in-Picture) do Android: só o vídeo aparece
const lastFocusedControlId = ref('osd-play-pause')

function onControlsFocusIn(e) {
  if (e.target && e.target.id) {
    lastFocusedControlId.value = e.target.id
  }
}

/** Foco no último controle usado (ou Play/Pausa): nunca no "Fechar", onde um OK acidental encerraria o vídeo. */
function focusOsdControl() {
  const target = document.getElementById(lastFocusedControlId.value) || document.getElementById('osd-play-pause')
  if (target) target.focus()
}

// Tempo e progresso (VOD / Filas)
const currentTime = ref(0)
const duration = ref(0)

// Auto-advance (VOD / Filas)
const autoAdvance = ref(null) // { nextItem: object, secondsLeft: number, timer: any }
const NEXT_OFFER_BEFORE_END_S = 20 // o próximo episódio aparece nos créditos, como nos streamings
let nextOfferDismissed = false // o usuário cancelou o próximo neste item

// Timers e Escopos de Foco
let osdTimer = null
let cleanupBack = null
let cleanupKey = null
let popPlayerScope = null
let popDrawerScope = null
let popAutoAdvanceScope = null
let popErrorScope = null
let cleanupBackground = null
let cleanupPip = null

const isLive = computed(() => player.mode === 'live' || player.currentSection === 'live')
/** Pop-up só com vídeo de fato tocando: pausado, carregando, com erro ou em menu, sair do app não abre janela. */
const canPictureInPicture = computed(
  () => player.isOpen && hasRenderedFrame.value && !isPaused.value && !engineError.value,
)
const isBookmarked = computed(() =>
  player.currentItem ? player.isInCustomQueue(player.currentItem, player.currentSection) : false,
)

const parsedSeriesInfo = computed(() => {
  const name = player.currentItem?.name || ''
  return parseSeriesTitle(name)
})

const nextItemInQueue = computed(() => {
  if (!player.hasNext) return null
  const idx = player.currentIndex + 1
  return idx < player.queue.length ? player.queue[idx] : null
})

const progressPercent = computed(() => {
  if (!duration.value || duration.value <= 0) return 0
  return Math.min(100, Math.max(0, (currentTime.value / duration.value) * 100))
})

// OSD Inactivity Timer (4000ms)
function resetOsdTimer() {
  if (osdTimer) clearTimeout(osdTimer)
  isOsdVisible.value = true
  if (isPaused.value || isQueueDrawerOpen.value || autoAdvance.value) return
  osdTimer = setTimeout(() => {
    if (!isPaused.value && !isQueueDrawerOpen.value && !autoAdvance.value) {
      isOsdVisible.value = false
    }
  }, 4000)
}

// Watch History / Continuar Assistindo (RFC-003)
let lastSaveTime = 0
let hasResumed = false
let lastPlayedToken = -1
/** Item a que `currentTime`/`duration` pertencem. Ao trocar de vídeo, `player.currentItem` já é o próximo. */
let playingItem = null

/** Salva o progresso do item que está (ou estava) na tela, nunca no próximo da fila. */
function saveCurrentProgress(cur = currentTime.value, dur = duration.value) {
  if (playingItem) player.saveProgress(cur, dur, playingItem)
}

function retryPlayback() {
  lastPlayedToken = -1
  startPlayback()
}

// Inicialização de Reprodução
async function startPlayback() {
  if (lastPlayedToken === player.playToken && !engineError.value) {
    return
  }

  if (videoRef.value && currentTime.value > 15 && duration.value > 0) {
    saveCurrentProgress()
  }

  cancelAutoAdvance()
  nextOfferDismissed = false
  hasRenderedFrame.value = false
  currentTime.value = 0
  duration.value = 0
  isPaused.value = false
  isBuffering.value = true
  hasResumed = false
  lastSaveTime = 0

  const item = player.currentItem
  playingItem = item
  if (!item) return

  // Marca o pedido já aqui: os watchers de isOpen e playToken disparam juntos e não podem iniciar duas vezes.
  lastPlayedToken = player.playToken
  resetOsdTimer()

  await nextTick()
  if (!videoRef.value) {
    lastPlayedToken = -1
    return
  }

  const stream = buildStreamUrl({
    apiBase: auth.apiBase,
    credentials: auth.credentials,
    section: player.currentSection,
    item,
  })

  await attachAndPlay(videoRef.value, stream)
}

// Watchers
watch(
  () => player.playToken,
  () => {
    if (player.isOpen) {
      startPlayback()
      // Zapping com o menu oculto: o botão focado sumiu; o foco volta para os controles.
      nextTick(() => {
        const rootEl = document.getElementById('video-player-root')
        if (rootEl && !rootEl.contains(document.activeElement)) focusOsdControl()
      })
    }
  },
)

watch(canPictureInPicture, (enabled) => {
  setPictureInPictureEnabled(enabled)
})

watch(
  () => player.isOpen,
  (open) => {
    if (open) {
      lastFocusedControlId.value = 'osd-play-pause'
      startPlayback()
      nextTick(() => {
        const rootEl = document.getElementById('video-player-root')
        if (rootEl) {
          if (popPlayerScope) popPlayerScope()
          popPlayerScope = pushFocusScope(rootEl)
        }
        focusOsdControl()
      })
    } else {
      lastPlayedToken = -1
      hasRenderedFrame.value = false
      isBuffering.value = false
      cancelAutoAdvance()
      destroyEngine()
      if (osdTimer) clearTimeout(osdTimer)
      if (popPlayerScope) {
        popPlayerScope()
        popPlayerScope = null
      }
      if (popDrawerScope) {
        popDrawerScope()
        popDrawerScope = null
      }
      if (popAutoAdvanceScope) {
        popAutoAdvanceScope()
        popAutoAdvanceScope = null
      }
      if (popErrorScope) {
        popErrorScope()
        popErrorScope = null
      }
    }
  },
)

watch(isQueueDrawerOpen, (open) => {
  if (open) {
    nextTick(() => {
      const el = document.getElementById('queue-drawer')
      if (el) {
        if (popDrawerScope) popDrawerScope()
        popDrawerScope = pushFocusScope(el)
      }
    })
  } else {
    if (popDrawerScope) {
      popDrawerScope()
      popDrawerScope = null
    }
  }
})

watch(autoAdvance, (val) => {
  if (val) {
    nextTick(() => {
      const el = document.getElementById('autoadvance-card')
      if (el) {
        if (popAutoAdvanceScope) popAutoAdvanceScope()
        popAutoAdvanceScope = pushFocusScope(el)
      }
    })
  } else {
    if (popAutoAdvanceScope) {
      popAutoAdvanceScope()
      popAutoAdvanceScope = null
    }
  }
})

watch(engineError, (err) => {
  if (err) {
    nextTick(() => {
      const el = document.getElementById('player-error-layer')
      if (el) {
        if (popErrorScope) popErrorScope()
        popErrorScope = pushFocusScope(el)
      }
      document.getElementById('player-retry')?.focus()
    })
  } else {
    if (popErrorScope) {
      popErrorScope()
      popErrorScope = null
    }
  }
})

// Manipuladores de Vídeo e Progresso (RFC-003)
function checkAutoResume() {
  if (hasResumed || isLive.value || !videoRef.value) return
  const dur = videoRef.value.duration || duration.value || 0
  if (dur <= 30) return

  const item = player.currentItem
  if (!item) return

  const resumeAt = player.getSavedTime(item.stream_id, player.currentSection)
  if (resumeAt > 15 && resumeAt < dur - 30) {
    hasResumed = true
    try {
      videoRef.value.currentTime = resumeAt
      currentTime.value = resumeAt
    } catch (_) {}
  } else {
    hasResumed = true
  }
}

function onLoadedMetadata() {
  if (videoRef.value) {
    duration.value = videoRef.value.duration || 0
    checkAutoResume()
  }
}

function onDurationChange() {
  if (videoRef.value) {
    duration.value = videoRef.value.duration || 0
    checkAutoResume()
  }
}

function onTimeUpdate() {
  if (videoRef.value) {
    if (videoRef.value.currentTime > 0) {
      hasRenderedFrame.value = true
    }
    currentTime.value = videoRef.value.currentTime
    offerNextNearEnd()
    const now = Date.now()
    if (now - lastSaveTime >= 10000) {
      lastSaveTime = now
      saveCurrentProgress()
    }
  }
}

function onPlay() {
  isPaused.value = false
  isBuffering.value = false
  resetOsdTimer()
}

function onPause() {
  isPaused.value = true
  isOsdVisible.value = true
  if (osdTimer) clearTimeout(osdTimer)
  saveCurrentProgress()
}

function closePlayer() {
  if (videoRef.value) {
    saveCurrentProgress()
  }
  player.close()
}

function onWaiting() {
  isBuffering.value = true
}

function onPlaying() {
  isBuffering.value = false
  isPaused.value = false
  hasRenderedFrame.value = true
}

// Auto-Advance
function onEnded() {
  if (isLive.value) return
  if (duration.value > 0) {
    saveCurrentProgress(duration.value, duration.value)
  }
  if (autoAdvance.value) {
    playNextNow()
  } else if (player.hasNext && player.autoPlayNext && !nextOfferDismissed) {
    startAutoAdvanceCountdown()
  }
}

/** Nos últimos segundos abre o card do próximo item, com a contagem terminando junto com o vídeo. */
function offerNextNearEnd() {
  if (autoAdvance.value || nextOfferDismissed || isLive.value || !player.hasNext || !player.autoPlayNext) return
  const left = duration.value - currentTime.value
  if (duration.value > NEXT_OFFER_BEFORE_END_S * 2 && left > 0 && left <= NEXT_OFFER_BEFORE_END_S) {
    startAutoAdvanceCountdown(Math.ceil(left))
  }
}

function startAutoAdvanceCountdown(seconds = 5) {
  cancelAutoAdvance()
  const nextItem = nextItemInQueue.value
  if (!nextItem) return

  isOsdVisible.value = true
  autoAdvance.value = {
    nextItem,
    secondsLeft: seconds,
    timer: null,
  }

  const tick = () => {
    if (!autoAdvance.value) return
    if (isPaused.value) {
      autoAdvance.value.timer = setTimeout(tick, 1000) // pausado: a contagem espera junto
      return
    }
    if (autoAdvance.value.secondsLeft <= 1) {
      const run = () => {
        cancelAutoAdvance()
        player.next()
      }
      run()
    } else {
      autoAdvance.value.secondsLeft -= 1
      autoAdvance.value.timer = setTimeout(tick, 1000)
    }
  }

  autoAdvance.value.timer = setTimeout(tick, 1000)
  nextTick(() => {
    focusFirstIn('#autoadvance-play')
  })
}

function cancelAutoAdvance() {
  if (autoAdvance.value && autoAdvance.value.timer) {
    clearTimeout(autoAdvance.value.timer)
  }
  autoAdvance.value = null
}

/** Cancelar pelo usuário: o próximo não volta a aparecer nem entra sozinho neste item. */
function dismissNextOffer() {
  nextOfferDismissed = true
  cancelAutoAdvance()
}

function playNextNow() {
  cancelAutoAdvance()
  player.next()
}

// Controles de Mídia
function playVideo() {
  if (videoRef.value && videoRef.value.paused) {
    const p = videoRef.value.play()
    if (p && typeof p.catch === 'function') p.catch(() => {})
  }
  resetOsdTimer()
}

function pauseVideo() {
  if (videoRef.value && !videoRef.value.paused) videoRef.value.pause()
}

function togglePlayPause() {
  if (!videoRef.value) return
  if (videoRef.value.paused) {
    playVideo()
  } else {
    pauseVideo()
    resetOsdTimer()
  }
}

/** Troca de canal com o menu oculto; se não houver para onde ir, mostra o menu em vez de não reagir. */
function zap(stepFn) {
  stepFn().then((moved) => {
    if (moved) return
    resetOsdTimer()
    nextTick(focusOsdControl)
  })
}

/**
 * Teclas de mídia do controle (Samsung, LG e Android TV): funcionam com o menu visível ou não.
 * @returns {boolean} true se a tecla era de mídia
 */
function handleMediaKey(action) {
  const handlers = {
    play: playVideo,
    pause: pauseVideo,
    playPause: togglePlayPause,
    stop: closePlayer,
    rewind: () => seek(-10),
    fastForward: () => seek(10),
  }
  if (!handlers[action]) return false
  handlers[action]()
  return true
}

function seek(deltaSec) {
  if (!videoRef.value || isLive.value) return
  const cur = videoRef.value.currentTime || 0
  const dur = videoRef.value.duration || 0
  const target = Math.max(0, Math.min(dur, cur + deltaSec))
  videoRef.value.currentTime = target
  currentTime.value = target
  resetOsdTimer()
}

function toggleBookmark() {
  if (!player.currentItem) return
  if (isBookmarked.value) {
    player.removeFromCustomQueue(player.currentItem.stream_id, player.currentSection)
  } else {
    player.enqueueItem(player.currentItem, player.currentSection)
  }
  resetOsdTimer()
}

function toggleQueueDrawer() {
  isQueueDrawerOpen.value = !isQueueDrawerOpen.value
  if (isQueueDrawerOpen.value) {
    isOsdVisible.value = true
    if (osdTimer) clearTimeout(osdTimer)
    nextTick(() => {
      focusFirstIn('[data-grid="player-queue"]')
    })
  } else {
    resetOsdTimer()
    nextTick(() => {
      document.getElementById('osd-queue')?.focus()
    })
  }
}

// Provider de Itens da Gaveta de Fila para GridView
const loadQueueItems = (start, count) => {
  return Promise.resolve(player.queue.slice(start, start + count))
}

function selectQueueItem(item, index) {
  player.playAt(index)
  isQueueDrawerOpen.value = false
  resetOsdTimer()
}

// Interceptação de Teclas e Tecla Voltar (Fase 4 & CT 4.4)
onMounted(() => {
  // Pilha de Tecla Voltar
  cleanupBack = registerBackHandler(() => {
    if (!player.isOpen) return false

    // 1. Gaveta de Fila aberta -> fecha gaveta e foca botão da fila
    if (isQueueDrawerOpen.value) {
      isQueueDrawerOpen.value = false
      resetOsdTimer()
      nextTick(() => {
        document.getElementById('osd-queue')?.focus()
      })
      return true
    }

    // 2. Card de Auto-Advance aberto -> cancela auto-advance
    if (autoAdvance.value) {
      dismissNextOffer()
      resetOsdTimer()
      return true
    }

    // 3. OSD visível -> oculta OSD imediatamente
    if (isOsdVisible.value) {
      isOsdVisible.value = false
      return true
    }

    // 4. OSD já oculto -> fecha o player e restaura foco
    closePlayer()
    return true
  })

  // Interceptador Global de Teclas durante reprodução
  cleanupKey = registerKeyHandler((action) => {
    if (!player.isOpen) return false
    if (handleMediaKey(action)) return true

    // Intercepta seek na barra de progresso quando o foco estiver nela
    if (isOsdVisible.value && document.activeElement && document.activeElement.id === 'osd-progress') {
      if (action === 'left') {
        seek(-10)
        return true
      }
      if (action === 'right') {
        seek(10)
        return true
      }
      if (action === 'down') {
        const target =
          document.getElementById(lastFocusedControlId.value) ||
          document.getElementById('osd-play-pause')
        if (target) {
          target.focus()
          return true
        }
      }
      if (action === 'up') {
        const topClose = document.getElementById('osd-top-close')
        if (topClose) {
          topClose.focus()
          return true
        }
      }
    }

    // Qualquer tecla acorda o OSD (se não estiver em modo zapping puro)
    if (!isQueueDrawerOpen.value && !autoAdvance.value) {
      // Zapping Rápido em Live TV quando OSD estiver OCULTO (sem outro canal, o menu aparece):
      if (isLive.value && !isOsdVisible.value) {
        if (action === 'up' || action === 'channelUp') {
          zap(player.next)
          return true
        }
        if (action === 'down' || action === 'channelDown') {
          zap(player.prev)
          return true
        }
      }

      // Se o OSD estiver oculto e o usuário apertar setas/Enter, o menu volta no último controle usado
      if (!isOsdVisible.value) {
        if (action === 'select' || action === 'left' || action === 'right' || action === 'up' || action === 'down') {
          resetOsdTimer()
          nextTick(focusOsdControl)
          return true
        }
      } else {
        // Se o OSD já estiver visível, resetamos o timer de inatividade
        resetOsdTimer()
      }
    }

    // Ações de canal e mídia diretas
    if (action === 'channelUp') {
      player.next()
      return true
    }
    if (action === 'channelDown') {
      player.prev()
      return true
    }

    return false
  })

  // Samsung/LG exigem parar a reprodução quando o app sai da tela; no pop-up do Android ela continua.
  cleanupBackground = onAppBackground(() => {
    if (player.isOpen) pauseVideo()
  })
  cleanupPip = onPictureInPictureChange((active) => {
    isInPip.value = active
    if (active) {
      isQueueDrawerOpen.value = false
      isOsdVisible.value = false
    } else {
      resetOsdTimer()
    }
  })
})

onBeforeUnmount(() => {
  if (videoRef.value) {
    saveCurrentProgress()
  }
  if (cleanupBack) cleanupBack()
  if (cleanupKey) cleanupKey()
  if (cleanupBackground) cleanupBackground()
  if (cleanupPip) cleanupPip()
  setPictureInPictureEnabled(false)
  if (osdTimer) clearTimeout(osdTimer)
  if (popPlayerScope) popPlayerScope()
  if (popDrawerScope) popDrawerScope()
  if (popAutoAdvanceScope) popAutoAdvanceScope()
  if (popErrorScope) popErrorScope()
  cancelAutoAdvance()
  destroyEngine()
})
</script>

<template>
  <div
    v-if="player.isOpen"
    id="video-player-root"
    class="fixed inset-0 z-50 bg-black flex flex-col justify-between overflow-hidden select-none"
    @mousemove="resetOsdTimer"
  >
    <!-- Camada de Vídeo -->
    <div class="absolute inset-0 flex items-center justify-center bg-black">
      <video
        ref="videoRef"
        :class="[
          'w-full h-full object-contain transition-opacity duration-300',
          hasRenderedFrame ? 'opacity-100' : 'opacity-0',
        ]"
        playsinline
        poster="data:image/gif;base64,R0lGODlhAQABAIAAAAUEBAAAACwAAAAAAQABAAACAkQBADs="
        @loadedmetadata="onLoadedMetadata"
        @timeupdate="onTimeUpdate"
        @durationchange="onDurationChange"
        @play="onPlay"
        @pause="onPause"
        @waiting="onWaiting"
        @playing="onPlaying"
        @ended="onEnded"
      />
    </div>

    <!-- Tela de Carregamento Black Cinema + Barra de Progressão Real (RFC-009) -->
    <transition
      enter-active-class="transition-opacity duration-200"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition-opacity duration-300"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="(isBuffering || !hasRenderedFrame) && !engineError"
        class="absolute inset-0 z-20 flex flex-col items-center justify-center select-none pointer-events-none"
        :class="!hasRenderedFrame ? 'bg-black' : 'bg-black/40'"
        role="status"
        aria-live="polite"
      >
        <!-- Abertura do vídeo: nome + etapa + barra de progresso real -->
        <template v-if="!hasRenderedFrame">
          <h2 class="text-tv-lg font-bold text-white tracking-tight mb-3 text-center max-w-[42rem] truncate px-4">
            {{ player.currentItem?.name || 'Carregando transmissão...' }}
          </h2>
          <div class="flex items-center justify-between w-[28rem] mb-2 px-1 text-tv-xs text-neutral-400">
            <span class="truncate pr-2 font-medium">{{ loadingStage }}</span>
            <span class="font-mono font-semibold text-white shrink-0">{{ Math.round(loadingProgress) }}%</span>
          </div>
          <div class="w-[28rem] h-1.5 rounded-full bg-white/10 overflow-hidden shadow-inner">
            <div
              class="h-full bg-tv-accent transition-all duration-200 ease-out rounded-full"
              :style="{ width: loadingProgress + '%' }"
            />
          </div>
        </template>

        <!-- No meio do vídeo: só um indicador (a porcentagem da abertura não se aplica) -->
        <template v-else>
          <svg class="w-16 h-16 animate-spin text-white" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2.5" opacity="0.25" />
            <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
          </svg>
          <p class="mt-4 text-tv-sm font-medium text-white drop-shadow">
            {{ recovering ? 'Reconectando ao servidor…' : 'Carregando…' }}
          </p>
        </template>
      </div>
    </transition>

    <!-- Camada de Erro -->
    <div
      v-if="engineError"
      id="player-error-layer"
      class="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black/90 px-12"
      role="alert"
    >
      <div class="max-w-[45rem] rounded-2xl border border-red-500/30 bg-[#121215] p-10 text-center shadow-2xl">
        <div class="w-16 h-16 mx-auto mb-5 rounded-full bg-red-500/15 flex items-center justify-center text-red-400">
          <svg class="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </div>
        <h3 class="text-tv-xl font-bold text-white mb-3">Falha na Reprodução</h3>
        <p class="text-tv-base text-tv-muted mb-4 leading-relaxed">
          {{ engineError || PLAYBACK_ERROR }}
        </p>
        <p
          v-if="engineErrorDetail"
          class="font-mono text-tv-xs text-red-300/90 bg-black/60 border border-red-500/20 rounded p-2.5 mb-8 break-all text-left"
        >
          Causa técnica: {{ engineErrorDetail }}
        </p>
        <div class="flex items-center justify-center gap-6">
          <button id="player-retry" type="button" class="tv-btn tv-btn-primary" @click="retryPlayback">
            Tentar novamente
          </button>
          <button id="player-error-close" type="button" class="tv-btn" @click="closePlayer()">
            Fechar reprodutor
          </button>
        </div>
      </div>
    </div>

    <!-- Camada OSD (On-Screen Display) -->
    <transition
      enter-active-class="transition-opacity duration-200"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition-opacity duration-200"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="isOsdVisible && !engineError && !isInPip"
        id="player-osd"
        class="absolute inset-0 flex flex-col justify-between pointer-events-auto bg-gradient-to-t from-black/90 via-transparent to-black/80 px-24 py-14 z-10"
      >
        <!-- Topo do OSD -->
        <header data-focus-row="osd-header" class="flex items-start justify-between">
          <div class="pr-8">
            <template v-if="parsedSeriesInfo.header">
              <p class="text-tv-sm text-tv-meta font-medium mb-1">
                {{ parsedSeriesInfo.header }}
              </p>
              <h1 class="text-tv-2xl font-black text-white max-w-[65rem] truncate leading-tight">
                {{ parsedSeriesInfo.title }}
              </h1>
            </template>
            <template v-else-if="isLive">
              <div class="flex items-center gap-3 mb-1">
                <span
                  class="px-2.5 py-0.5 rounded bg-tv-accent text-tv-on-accent font-bold text-tv-xs uppercase tracking-wider"
                >
                  AO VIVO
                </span>
                <span v-if="player.currentItem?.category_name" class="text-tv-sm text-tv-meta font-medium">
                  {{ player.currentItem.category_name }}
                </span>
              </div>
              <h1 class="text-tv-2xl font-black text-white max-w-[65rem] truncate leading-tight">
                {{ player.currentItem?.name }}
              </h1>
            </template>
            <template v-else>
              <p v-if="player.currentItem?.category_name" class="text-tv-sm text-tv-meta font-medium mb-1">
                {{ player.currentItem.category_name }}
              </p>
              <h1 class="text-tv-2xl font-black text-white max-w-[65rem] truncate leading-tight">
                {{ player.currentItem?.name }}
              </h1>
            </template>
          </div>

          <button
            id="osd-top-close"
            type="button"
            class="tv-btn tv-glass !w-12 !h-12 !p-0 rounded-full flex items-center justify-center text-tv-meta hover:text-white"
            title="Fechar reprodutor"
            @click="closePlayer()"
          >
            <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </header>

        <!-- Base do OSD -->
        <footer class="flex flex-col gap-6">
          <!-- Barra de Progresso (VOD / Filas) -->
          <div v-if="!isLive && duration > 0" data-focus-row="osd-progress-row" class="w-full">
            <div class="flex justify-between items-center text-tv-xs text-tv-meta mb-2 font-mono">
              <span>{{ formatTime(currentTime) }}</span>
              <span>-{{ formatTime(Math.max(0, duration - currentTime)) }}</span>
            </div>
            <div
              id="osd-progress"
              role="slider"
              tabindex="0"
              class="tv-focusable relative w-full h-1.5 rounded-full bg-white/20 cursor-pointer"
              :aria-valuenow="Math.round(currentTime)"
              :aria-valuemin="0"
              :aria-valuemax="Math.round(duration)"
            >
              <div
                class="absolute left-0 top-0 bottom-0 bg-tv-accent rounded-full"
                :style="{ width: progressPercent + '%' }"
              />
              <div
                class="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-white shadow pointer-events-none"
                :style="{ left: progressPercent + '%' }"
              />
            </div>
          </div>

          <!-- Botões de Controle -->
          <div
            data-focus-row="osd-controls"
            class="flex items-center justify-between"
            @focusin="onControlsFocusIn"
          >
            <!-- Controles redondos de reprodução -->
            <div class="flex items-center gap-4">
              <!-- Anterior -->
              <button
                id="osd-prev"
                type="button"
                class="tv-btn tv-glass !w-[3.5rem] !h-[3.5rem] !p-0 rounded-full flex items-center justify-center text-white"
                :disabled="!player.hasPrev"
                title="Anterior"
                @click="player.prev()"
              >
                <svg class="w-5 h-5 fill-current" viewBox="0 0 24 24">
                  <polygon points="19 20 9 12 19 4 19 20" />
                  <line x1="5" y1="19" x2="5" y2="5" stroke="currentColor" stroke-width="2.5" />
                </svg>
              </button>

              <!-- Seek -10s (VOD) -->
              <button
                v-if="!isLive"
                id="osd-seek-back"
                type="button"
                class="tv-btn tv-glass !w-[3.5rem] !h-[3.5rem] !p-0 rounded-full flex items-center justify-center text-white"
                title="-10 segundos"
                @click="seek(-10)"
              >
                <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M1 4v6h6" />
                  <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                </svg>
              </button>

              <!-- Play / Pause grande -->
              <button
                id="osd-play-pause"
                type="button"
                class="tv-btn !w-[4.75rem] !h-[4.75rem] !p-0 rounded-full bg-white text-black hover:bg-neutral-200 flex items-center justify-center font-bold shadow-xl"
                :title="isPaused ? 'Reproduzir' : 'Pausar'"
                @click="togglePlayPause"
              >
                <svg v-if="isPaused" class="w-7 h-7 fill-current translate-x-0.5" viewBox="0 0 24 24">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
                <svg v-else class="w-7 h-7 fill-current" viewBox="0 0 24 24">
                  <rect x="6" y="4" width="4" height="16" />
                  <rect x="14" y="4" width="4" height="16" />
                </svg>
              </button>

              <!-- Seek +10s (VOD) -->
              <button
                v-if="!isLive"
                id="osd-seek-fwd"
                type="button"
                class="tv-btn tv-glass !w-[3.5rem] !h-[3.5rem] !p-0 rounded-full flex items-center justify-center text-white"
                title="+10 segundos"
                @click="seek(10)"
              >
                <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M23 4v6h-6" />
                  <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                </svg>
              </button>

              <!-- Próximo -->
              <button
                id="osd-next"
                type="button"
                class="tv-btn tv-glass !w-[3.5rem] !h-[3.5rem] !p-0 rounded-full flex items-center justify-center text-white"
                :disabled="!player.hasNext"
                title="Próximo"
                @click="player.next()"
              >
                <svg class="w-5 h-5 fill-current" viewBox="0 0 24 24">
                  <polygon points="5 4 15 12 5 20 5 4" />
                  <line x1="19" y1="5" x2="19" y2="19" stroke="currentColor" stroke-width="2.5" />
                </svg>
              </button>
            </div>

            <!-- Fila e Minha Lista -->
            <div class="flex items-center gap-4">
              <button
                id="osd-queue"
                type="button"
                class="tv-btn tv-glass !px-6 !py-3 rounded-xl flex items-center gap-2 font-bold text-tv-xs"
                :class="isQueueDrawerOpen ? 'bg-tv-accent border-tv-accent text-tv-on-accent' : 'text-white'"
                @click="toggleQueueDrawer"
              >
                <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="8" y1="6" x2="21" y2="6" />
                  <line x1="8" y1="12" x2="21" y2="12" />
                  <line x1="8" y1="18" x2="21" y2="18" />
                  <line x1="3" y1="6" x2="3.01" y2="6" />
                  <line x1="3" y1="12" x2="3.01" y2="12" />
                  <line x1="3" y1="18" x2="3.01" y2="18" />
                </svg>
                <span>{{ player.currentSection === 'series' ? 'Episódios' : 'Fila' }}</span>
              </button>

              <button
                id="osd-bookmark"
                type="button"
                class="tv-btn tv-glass !px-6 !py-3 rounded-xl flex items-center gap-2 font-bold text-tv-xs text-white"
                :class="isBookmarked ? 'border-white/40' : ''"
                @click="toggleBookmark"
              >
                <svg v-if="isBookmarked" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <svg v-else class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                <span>{{ isBookmarked ? 'Na minha lista' : 'Minha lista' }}</span>
              </button>
            </div>
          </div>
        </footer>
      </div>
    </transition>

    <!-- Gaveta Lateral da Fila (Queue Drawer) -->
    <transition
      enter-active-class="transition-transform duration-200 ease-out"
      enter-from-class="translate-x-full"
      enter-to-class="translate-x-0"
      leave-active-class="transition-transform duration-200 ease-in"
      leave-from-class="translate-x-0"
      leave-to-class="translate-x-full"
    >
      <aside
        v-if="isQueueDrawerOpen"
        id="queue-drawer"
        class="fixed right-0 top-0 bottom-0 w-[40rem] bg-tv-surface/95 border-l-2 border-tv-border z-40 pl-8 pr-24 py-14 flex flex-col shadow-2xl"
        data-focus-group="player-drawer"
      >
        <header class="flex items-center justify-between mb-6 pb-4 border-b border-tv-border">
          <div>
            <h2 class="text-tv-lg font-bold text-white">Fila de Reprodução</h2>
            <p class="text-tv-sm text-tv-muted">
              {{ player.mode === 'live' ? 'Canais' : 'Vídeos' }}
            </p>
          </div>
          <button
            id="drawer-close"
            type="button"
            class="tv-btn !px-4 !py-2"
            @click="toggleQueueDrawer"
          >
            ✕
          </button>
        </header>

        <div class="flex-1 min-h-0" data-grid="player-queue">
          <GridView
            :count="player.queue.length"
            :load-items="loadQueueItems"
            :columns="1"
            :row-height="8.5"
            :gap="1"
            :max-dom-items="7"
            reset-key="player-queue-drawer"
            @select="selectQueueItem"
          >
            <template #item="{ item, index, select }">
              <button
                type="button"
                class="tv-focusable flex items-center justify-between w-full h-full px-6 rounded-2xl border-2 text-left bg-tv-card transition-colors"
                :class="
                  index === player.currentIndex
                    ? 'border-tv-accent bg-tv-accent/25 text-white font-bold'
                    : 'border-tv-border text-tv-text'
                "
                :id="`drawer-item-${index}`"
                :data-grid-index="index"
                @click="select(item, index)"
              >
                <div class="flex items-center gap-4 min-w-0 pr-2">
                  <span class="text-tv-sm text-tv-muted font-mono w-8 shrink-0">
                    {{ index + 1 }}
                  </span>
                  <span class="text-tv-base truncate">{{ item.name }}</span>
                </div>
                <span v-if="index === player.currentIndex" class="text-tv-sm text-tv-accent-soft shrink-0">
                  ▶ Tocando
                </span>
              </button>
            </template>
          </GridView>
        </div>
      </aside>
    </transition>

    <!-- Card de Auto-Advance (Contagem regressiva no fim do vídeo) -->
    <transition
      enter-active-class="transition-transform duration-200 ease-out"
      enter-from-class="translate-y-8 opacity-0"
      enter-to-class="translate-y-0 opacity-100"
      leave-active-class="transition-transform duration-200 ease-in"
      leave-from-class="translate-y-0 opacity-100"
      leave-to-class="translate-y-8 opacity-0"
    >
      <div
        v-if="autoAdvance && !isInPip"
        id="autoadvance-card"
        class="absolute bottom-14 right-24 z-30 w-[32rem] rounded-3xl border-2 border-tv-accent bg-tv-surface/95 p-8 shadow-2xl"
      >
        <p class="text-tv-sm uppercase tracking-wider text-tv-accent-soft font-semibold mb-1">
          Próximo na fila
        </p>
        <h4 class="text-tv-lg font-bold text-white truncate mb-2">
          {{ autoAdvance.nextItem?.name }}
        </h4>
        <p class="text-tv-sm text-tv-muted mb-6">
          Iniciando automaticamente em <strong class="text-white">{{ autoAdvance.secondsLeft }}s</strong>...
        </p>
        <div class="flex items-center gap-4">
          <button
            id="autoadvance-play"
            type="button"
            class="tv-btn tv-btn-primary flex-1"
            @click="playNextNow"
          >
            Reproduzir agora
          </button>
          <button
            id="autoadvance-cancel"
            type="button"
            class="tv-btn flex-1"
            @click="dismissNextOffer"
          >
            Cancelar
          </button>
        </div>
      </div>
    </transition>
  </div>
</template>
