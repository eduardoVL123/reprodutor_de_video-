<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useAuthStore } from '@/stores/authStore'
import { usePlayerStore } from '@/stores/playerStore'
import { fetchVodInfo, fetchSeriesInfo, normalizeVodInfo } from '@/services/xtreamApi'
import { pushFocusScope, registerBackHandler } from '@/utils/spatialNavigation'
import { formatTime } from '@/utils/formatTime'
import HorizontalRail from '@/components/ui/HorizontalRail.vue'

/**
 * Tela de detalhes em tela cheia (RFC-014 layout 2.0) para filmes (`vod`) e séries (`series`).
 * Fundo em tela cheia com vinheta; informações à esquerda; botões "Assistir/Continuar",
 * "Do início" (se houver progresso), "Minha lista" e "Voltar".
 * Série: temporadas em abas horizontais e episódios em fileira horizontal de miniaturas 16:9
 * com número, título, duração e progresso.
 */
const props = defineProps({
  item: { type: Object, required: true },
  section: { type: String, required: true }, // 'vod' | 'series'
  // Contexto da categoria de origem: mantém a fila de zapping do filme (-1 = item avulso).
  categoryId: { type: String, default: '' },
  indexInCategory: { type: Number, default: -1 },
})
const emit = defineEmits(['close'])

const MIN_RESUME_SECS = 15

const auth = useAuthStore()
const player = usePlayerStore()

const rootEl = ref(null)
const isSeries = computed(() => props.section === 'series')
const info = ref(normalizeVodInfo(null, props.item))
const isLoadingInfo = ref(true)
const loadError = ref('')
const backdropFailed = ref(false)
const seriesData = ref(null)
const activeSeasonKey = ref('')

let loadingPromise = null
let previousFocusedEl = null
let popScope = null
let cleanupBack = null

const mediaId = computed(() => {
  const it = props.item
  if (isSeries.value) return it.stream_id !== undefined ? it.stream_id : it.series_id
  return it.stream_id
})
const primaryButtonId = computed(() => (isSeries.value ? 'series-play-btn' : 'details-play-btn'))

// ---------- Progresso e Favoritos (perfil ativo) ----------
function historyEntry(id, section) {
  return player.watchHistory.find((h) => String(h.stream_id) === String(id) && h.section === section) || null
}

const savedTime = computed(() => (isSeries.value ? 0 : player.getSavedTime(mediaId.value, 'vod')))
const hasMovieProgress = computed(() => savedTime.value > MIN_RESUME_SECS)
const movieProgressPct = computed(() => {
  const entry = historyEntry(mediaId.value, 'vod')
  return entry ? Math.min(100, entry.progressPct || 0) : 0
})

const isBookmarked = computed(() => player.isInCustomQueue({ stream_id: mediaId.value }, props.section))

function toggleBookmark() {
  if (isBookmarked.value) player.removeFromCustomQueue(mediaId.value, props.section)
  else player.enqueueItem(props.item, props.section)
}

const hasRating = computed(() => !!info.value.rating && Number(info.value.rating) !== 0)

// ---------- Temporadas e Episódios ----------
function episodesOf(seasonKey) {
  const episodes = seriesData.value && seriesData.value.episodes
  const list = episodes ? episodes[seasonKey] : null
  if (Array.isArray(list)) return list
  return list && typeof list === 'object' ? Object.values(list) : []
}

/** Número da temporada: campo `season` do episódio (painéis que devolvem array) ou a chave. */
function seasonNumberOf(key) {
  const first = episodesOf(key)[0]
  const fromEpisode = first ? parseInt(first.season, 10) : NaN
  return isNaN(fromEpisode) ? parseInt(key, 10) || 0 : fromEpisode
}

const seasons = computed(() => {
  const episodes = seriesData.value && seriesData.value.episodes
  if (!episodes || typeof episodes !== 'object') return []
  return Object.keys(episodes)
    .filter((key) => episodesOf(key).length > 0)
    .map((key) => ({ key, number: seasonNumberOf(key) }))
    .sort((a, b) => a.number - b.number)
})

const currentEpisodes = computed(() => episodesOf(activeSeasonKey.value))

/** Episódio mais recente desta série no histórico do perfil */
const seriesResume = computed(() => {
  const byId = new Map()
  seasons.value.forEach((season) => {
    episodesOf(season.key).forEach((ep, episodeIndex) => {
      byId.set(String(ep.id), { seasonKey: season.key, seasonNumber: season.number, episodeIndex, ep })
    })
  })
  if (!byId.size) return null
  const hit = player.watchHistory.find((h) => h.section === 'series' && byId.has(String(h.stream_id)))
  return hit ? byId.get(String(hit.stream_id)) : null
})

const seriesPlayLabel = computed(() => {
  const resume = seriesResume.value
  if (resume) return `Continuar T${resume.seasonNumber}:E${resume.ep.episode_num}`
  const first = seasons.value[0]
  const firstEp = first ? episodesOf(first.key)[0] : null
  return `Assistir T${first ? first.number : 1}:E${firstEp ? firstEp.episode_num : 1}`
})

const episodeTitle = (ep) => ep.title || ep.name || `Episódio ${ep.episode_num}`
const episodeImage = (ep) => (ep.info && ep.info.movie_image) || info.value.poster

function episodeDuration(ep) {
  const secs = Number(ep.info && ep.info.duration_secs) || 0
  if (secs > 0) return `${Math.round(secs / 60)} min`
  return (ep.info && ep.info.duration) || ''
}

function episodeProgressPct(ep) {
  const entry = historyEntry(ep.id, 'series')
  return entry && entry.currentTime > 0 ? Math.min(100, entry.progressPct || 0) : 0
}

function episodeRemainingText(ep) {
  const entry = historyEntry(ep.id, 'series')
  const dur = Number(ep.info && ep.info.duration_secs) || 0
  if (entry && entry.currentTime > 0 && dur > 0) {
    const remMin = Math.ceil(Math.max(0, dur - entry.currentTime) / 60)
    return `faltam ${remMin} min`
  }
  return ''
}

function selectSeason(key) {
  activeSeasonKey.value = key
}

watch(
  () => info.value.backdrop,
  () => {
    backdropFailed.value = false
  },
)

// ---------- Reprodução ----------
function focusPrimary() {
  const el = document.getElementById(primaryButtonId.value)
  if (el) el.focus()
}

function playMovie() {
  const movie = {
    ...props.item,
    section: 'vod',
    container_extension: props.item.container_extension || info.value.container_extension,
  }
  if (props.indexInCategory >= 0 && props.categoryId) {
    player.playFromCatalog({
      section: 'vod',
      categoryId: props.categoryId,
      item: movie,
      indexInCategory: props.indexInCategory,
    })
    return
  }
  player.playItem(movie)
}

function playFromStart() {
  player.removeFromHistory(mediaId.value, 'vod')
  focusPrimary()
  playMovie()
}

function playEpisodeList(seasonKey, startIndex) {
  const seriesName = info.value.name || props.item.name || 'Série'
  const seasonNumber = seasonNumberOf(seasonKey)
  const items = episodesOf(seasonKey).map((ep) => ({
    stream_id: ep.id,
    name: `${seriesName} - T${seasonNumber}:E${ep.episode_num} - ${episodeTitle(ep)}`,
    stream_icon: episodeImage(ep),
    container_extension: ep.container_extension || 'mp4',
    section: 'series',
  }))
  player.playPlaylist({ items, startIndex, section: 'series' })
}

async function playSeries() {
  if (loadingPromise) await loadingPromise
  const resume = seriesResume.value
  if (resume) {
    activeSeasonKey.value = resume.seasonKey
    playEpisodeList(resume.seasonKey, resume.episodeIndex)
    return
  }
  const first = seasons.value[0]
  if (first && episodesOf(first.key).length) playEpisodeList(first.key, 0)
}

function playEpisode(index) {
  playEpisodeList(activeSeasonKey.value, index)
}

// ---------- Metadados ----------
async function loadSeries() {
  const data = await fetchSeriesInfo({
    apiBase: auth.apiBase,
    credentials: auth.credentials,
    seriesId: mediaId.value,
  })
  seriesData.value = data
  info.value = normalizeVodInfo({ info: data.info }, props.item)
  const resume = seriesResume.value
  const first = seasons.value[0]
  activeSeasonKey.value = resume ? resume.seasonKey : first ? first.key : ''
}

async function loadDetails() {
  isLoadingInfo.value = true
  loadError.value = ''
  try {
    if (isSeries.value) {
      await loadSeries()
    } else {
      info.value = await fetchVodInfo({
        apiBase: auth.apiBase,
        credentials: auth.credentials,
        vodId: mediaId.value,
        item: props.item,
      })
    }
  } catch (err) {
    console.warn('[details] Falha ao carregar temporadas da série:', err)
    loadError.value = (err && err.userMessage) || 'Não foi possível carregar os episódios desta série.'
  } finally {
    isLoadingInfo.value = false
  }
}

function retryLoad() {
  loadingPromise = loadDetails()
}

function close() {
  emit('close')
}

// Player fechado por cima da tela: restaura o foco
watch(
  () => player.isOpen,
  (open) => {
    if (open) return
    nextTick(() => {
      const root = rootEl.value
      if (root && !root.contains(document.activeElement)) focusPrimary()
    })
  },
)

onMounted(() => {
  previousFocusedEl = document.activeElement
  popScope = pushFocusScope(rootEl.value)
  cleanupBack = registerBackHandler(() => {
    if (player.isOpen) return false
    close()
    return true
  })
  nextTick(focusPrimary)
  loadingPromise = loadDetails()
})

onBeforeUnmount(() => {
  if (popScope) popScope()
  if (cleanupBack) cleanupBack()
  const el = previousFocusedEl
  previousFocusedEl = null
  nextTick(() => {
    if (el && document.body.contains(el)) el.focus()
  })
})
</script>

<template>
  <div
    ref="rootEl"
    class="fixed inset-0 z-40 bg-[#07070a] text-white overflow-hidden select-none"
    role="dialog"
    aria-modal="true"
    :aria-label="info.name"
    data-focus-group="media-details"
  >
    <!-- Backdrop cinematográfico à direita em tela cheia com vinheta -->
    <div class="absolute inset-0 overflow-hidden pointer-events-none">
      <img
        v-if="info.backdrop && !backdropFailed"
        :key="info.backdrop"
        :src="info.backdrop"
        alt=""
        referrerpolicy="no-referrer"
        class="absolute top-0 right-0 w-[68%] h-full object-cover object-center opacity-60 pointer-events-none"
        @error="backdropFailed = true"
      />
      <div
        v-else
        class="absolute inset-0 bg-[radial-gradient(ellipse_at_75%_30%,#1e40af_0%,#312e81_25%,#0b0b1a_55%,#07070a_80%)] opacity-80"
      />
      <div class="absolute inset-0 tv-vignette pointer-events-none" />
    </div>

    <!-- ===================== FILME ===================== -->
    <div v-if="!isSeries" class="relative z-10 px-20 py-12 flex flex-col justify-between h-full max-w-[56rem]">
      <div>
        <div class="flex items-center gap-2.5">
          <svg class="w-5 h-5 text-[#e50914] fill-current shrink-0" viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg>
          <span class="text-tv-xs font-bold tracking-[0.25em] text-neutral-400 uppercase">FILME</span>
        </div>

        <h1 class="text-tv-hero font-black uppercase text-white mt-2 line-clamp-2">
          {{ info.name }}
        </h1>

        <div class="flex items-center gap-3.5 text-tv-sm text-tv-meta mt-4 font-medium flex-wrap">
          <span v-if="hasRating" class="text-[#4ade80] font-bold">Nota {{ info.rating }}</span>
          <span v-if="hasRating && (info.year || info.duration)" class="w-1 h-1 rounded-full bg-neutral-500" />
          <span v-if="info.year">{{ info.year }}</span>
          <span v-if="info.year && info.duration" class="w-1 h-1 rounded-full bg-neutral-500" />
          <span>{{ info.duration || 'Longa-metragem' }}</span>
          <span v-if="info.genre" class="truncate">{{ info.genre }}</span>
        </div>

        <div v-if="hasMovieProgress" class="flex items-center gap-4 mt-5">
          <div class="w-80 h-1.5 bg-white/15 rounded-full overflow-hidden">
            <div class="h-full bg-[#e50914]" :style="{ width: movieProgressPct + '%' }" />
          </div>
          <span class="text-tv-xs text-neutral-300">Em andamento · Retomar de {{ formatTime(savedTime) }}</span>
        </div>
      </div>

      <div>
        <div v-if="isLoadingInfo" class="mt-4 space-y-3 animate-pulse" aria-hidden="true">
          <div class="h-4 rounded bg-white/[0.08] w-full" />
          <div class="h-4 rounded bg-white/[0.08] w-11/12" />
          <div class="h-4 rounded bg-white/[0.06] w-3/5" />
        </div>
        <template v-else>
          <p class="text-tv-base text-neutral-200 leading-relaxed line-clamp-4 mt-4">{{ info.plot }}</p>
          <div class="mt-4 space-y-1 text-tv-xs text-neutral-400">
            <p v-if="info.cast" class="line-clamp-1">
              <span class="text-neutral-500 font-semibold">Elenco:</span> {{ info.cast }}
            </p>
            <p v-if="info.director">
              <span class="text-neutral-500 font-semibold">Direção:</span> {{ info.director }}
            </p>
          </div>
        </template>

        <div data-focus-row="movie-details-actions" class="flex items-center gap-3.5 mt-8">
          <button
            id="details-play-btn"
            type="button"
            class="tv-focusable h-[3.4rem] whitespace-nowrap shrink-0 px-8 rounded-lg bg-white text-black font-bold text-tv-sm flex items-center gap-3"
            @click="playMovie"
          >
            <svg class="w-4 h-4 fill-black shrink-0" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3" /></svg>
            <span>{{ hasMovieProgress ? 'Continuar assistindo' : 'Assistir agora' }}</span>
          </button>

          <button
            v-if="hasMovieProgress"
            id="details-restart-btn"
            type="button"
            class="tv-focusable h-[3.4rem] whitespace-nowrap shrink-0 px-7 rounded-lg tv-btn-glass text-white font-medium text-tv-sm flex items-center gap-3"
            @click="playFromStart"
          >
            <svg class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="1 4 1 10 7 10" />
              <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
            </svg>
            <span>Assistir do início</span>
          </button>

          <button
            id="details-fav-btn"
            type="button"
            class="tv-focusable h-[3.4rem] whitespace-nowrap shrink-0 px-7 rounded-lg tv-btn-glass text-white font-medium text-tv-sm flex items-center gap-3"
            @click="toggleBookmark"
          >
            <svg v-if="isBookmarked" class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <svg v-else class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span>{{ isBookmarked ? 'Na minha lista' : 'Minha lista' }}</span>
          </button>

          <button
            id="details-back-btn"
            type="button"
            class="tv-focusable h-[3.4rem] whitespace-nowrap shrink-0 px-7 rounded-lg tv-btn-glass text-white font-medium text-tv-sm flex items-center gap-3"
            @click="close"
          >
            <svg class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
            <span>Voltar</span>
          </button>
        </div>
      </div>
    </div>

    <!-- ===================== SÉRIE ===================== -->
    <div v-else class="relative z-10 flex flex-col h-full justify-between pb-8">
      <!-- Cabeçalho e Sinopse da série -->
      <header class="px-20 pt-10 shrink-0 max-w-[62rem]">
        <div class="flex items-center gap-2.5">
          <svg class="w-5 h-5 text-[#e50914] fill-current shrink-0" viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg>
          <span class="text-tv-xs font-bold tracking-[0.25em] text-neutral-400 uppercase">SÉRIE</span>
        </div>

        <h1 class="text-tv-hero font-black uppercase text-white mt-1.5 line-clamp-2">
          {{ info.name }}
        </h1>

        <div class="flex items-center gap-3.5 text-tv-sm text-tv-meta mt-3 font-medium flex-wrap">
          <span v-if="hasRating" class="text-[#4ade80] font-bold">Nota {{ info.rating }}</span>
          <span v-if="hasRating && (info.year || seasons.length)" class="w-1 h-1 rounded-full bg-neutral-500" />
          <span v-if="info.year">{{ info.year }}</span>
          <span v-if="info.year && seasons.length" class="w-1 h-1 rounded-full bg-neutral-500" />
          <span v-if="seasons.length">{{ seasons.length }} {{ seasons.length === 1 ? 'temporada' : 'temporadas' }}</span>
          <span v-if="info.genre" class="truncate">{{ info.genre }}</span>
        </div>

        <div v-if="isLoadingInfo" class="mt-3 space-y-2 animate-pulse" aria-hidden="true">
          <div class="h-4 rounded bg-white/[0.08] w-full" />
          <div class="h-4 rounded bg-white/[0.06] w-3/4" />
        </div>
        <template v-else>
          <p class="text-tv-sm text-neutral-200 leading-relaxed line-clamp-2 mt-3">{{ info.plot }}</p>
        </template>

        <!-- Botões de Ação da Série -->
        <div data-focus-row="series-details-actions" class="flex items-center gap-3.5 mt-5">
          <button
            id="series-play-btn"
            type="button"
            class="tv-focusable h-[3.4rem] whitespace-nowrap shrink-0 px-8 rounded-lg bg-white text-black font-bold text-tv-sm flex items-center gap-3"
            @click="playSeries"
          >
            <svg class="w-4 h-4 fill-black shrink-0" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3" /></svg>
            <span>{{ seriesPlayLabel }}</span>
          </button>

          <button
            id="series-fav-btn"
            type="button"
            class="tv-focusable h-[3.4rem] whitespace-nowrap shrink-0 px-7 rounded-lg tv-btn-glass text-white font-medium text-tv-sm flex items-center gap-3"
            @click="toggleBookmark"
          >
            <svg v-if="isBookmarked" class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <svg v-else class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span>{{ isBookmarked ? 'Na minha lista' : 'Minha lista' }}</span>
          </button>

          <button
            id="series-back-btn"
            type="button"
            class="tv-focusable h-[3.4rem] whitespace-nowrap shrink-0 px-7 rounded-lg tv-btn-glass text-white font-medium text-tv-sm flex items-center gap-3"
            @click="close"
          >
            <svg class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
            <span>Voltar</span>
          </button>
        </div>
      </header>

      <!-- Carregando temporadas -->
      <div v-if="isLoadingInfo" class="flex-1 flex items-center justify-center gap-4" role="status">
        <svg class="w-10 h-10 animate-spin text-[#e50914]" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2.5" opacity="0.2" />
          <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
        </svg>
        <p class="text-tv-sm text-neutral-400">Carregando episódios...</p>
      </div>

      <!-- Erro ao carregar -->
      <div v-else-if="loadError" class="flex-1 flex flex-col items-center justify-center gap-4 text-center px-20">
        <p class="text-tv-base text-red-300 font-medium" role="alert">{{ loadError }}</p>
        <div data-focus-row="series-error-actions">
          <button id="series-retry-btn" type="button" class="tv-btn tv-btn-primary !px-6 !py-2.5" @click="retryLoad">
            Tentar novamente
          </button>
        </div>
      </div>

      <!-- Temporadas em abas e Episódios em Fileira 16:9 (Mockup Detalhes de série) -->
      <div v-else class="px-20 mt-4 shrink-0 space-y-4">
        <!-- Seletor de Temporadas -->
        <div data-focus-row="series-seasons" class="flex items-center gap-3 overflow-x-auto py-1">
          <button
            v-for="season in seasons"
            :id="'season-tab-' + season.key"
            :key="season.key"
            type="button"
            class="tv-focusable shrink-0 px-6 py-2 rounded-lg text-tv-sm font-semibold transition-colors"
            :class="
              season.key === activeSeasonKey
                ? 'bg-white text-black font-bold'
                : 'tv-btn-glass text-neutral-300'
            "
            @click="selectSeason(season.key)"
          >
            Temporada {{ season.number }}
          </button>
          <span v-if="seasons.length" class="pl-2 shrink-0 text-tv-xs text-neutral-400 font-medium">
            {{ currentEpisodes.length }} {{ currentEpisodes.length === 1 ? 'episódio' : 'episódios' }}
          </span>
        </div>

        <!-- Fileira Deslizante de Episódios com HorizontalRail -->
        <div data-focus-group="series-episodes" class="min-h-[14rem]">
          <HorizontalRail
            v-if="currentEpisodes.length > 0"
            :items="currentEpisodes"
            id-prefix="episode-card"
            :item-key="(ep) => ep.id"
            :gap="1.2"
            @select="(_, idx) => playEpisode(idx)"
          >
            <template #item="{ item: ep }">
              <div class="w-[17rem] text-left group">
                <!-- Card Miniatura 16:9 -->
                <div class="w-[17rem] h-[9.56rem] rounded-xl overflow-hidden bg-[#141418] border border-white/10 relative">
                  <img
                    v-if="episodeImage(ep)"
                    :src="episodeImage(ep)"
                    alt=""
                    loading="lazy"
                    referrerpolicy="no-referrer"
                    class="w-full h-full object-cover"
                    @error="$event.target.style.display = 'none'"
                  />
                  <div class="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent pointer-events-none" />
                  <span class="tv-badge">
                    E{{ ep.episode_num }}
                  </span>
                  <div v-if="episodeProgressPct(ep) > 0" class="tv-progress">
                    <i :style="{ width: episodeProgressPct(ep) + '%' }" />
                  </div>
                </div>

                <!-- Título e duração abaixo da miniatura -->
                <div class="mt-2.5">
                  <p class="text-tv-sm font-bold text-white truncate">
                    {{ ep.episode_num }}. {{ episodeTitle(ep) }}
                  </p>
                  <p class="text-tv-xs text-tv-meta mt-0.5">
                    {{ episodeRemainingText(ep) || episodeDuration(ep) }}
                  </p>
                </div>
              </div>
            </template>
          </HorizontalRail>

          <p v-else class="py-8 text-tv-sm text-neutral-400">
            Nenhum episódio encontrado para esta temporada.
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
