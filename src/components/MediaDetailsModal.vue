<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useAuthStore } from '@/stores/authStore'
import { usePlayerStore } from '@/stores/playerStore'
import { fetchVodInfo, fetchSeriesInfo, normalizeVodInfo } from '@/services/xtreamApi'
import { pushFocusScope, registerBackHandler, registerKeyHandler } from '@/utils/spatialNavigation'

/**
 * Tela de detalhes em tela cheia (RFC-012) para filmes (`vod`) e séries (`series`).
 * Nada toca ao abrir: a reprodução começa só pelos botões de ação. Ao fechar, o foco
 * volta ao elemento que abriu a tela; ao fechar o player por cima dela, volta ao
 * botão de ação usado (ou ao episódio escolhido).
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
const episodesListEl = ref(null)
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
let cleanupKey = null

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

/** Episódio mais recente desta série no histórico do perfil (o histórico já vem do mais novo ao mais antigo). */
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
const episodePlot = (ep) => (ep.info && ep.info.plot) || 'Episódio disponível em alta definição.'

function episodeDuration(ep) {
  const secs = Number(ep.info && ep.info.duration_secs) || 0
  if (secs > 0) return `${Math.round(secs / 60)} min`
  return (ep.info && ep.info.duration) || ''
}

function episodeProgressPct(ep) {
  const entry = historyEntry(ep.id, 'series')
  return entry && entry.currentTime > 0 ? Math.min(100, entry.progressPct || 0) : 0
}

function selectSeason(key) {
  activeSeasonKey.value = key
}

watch(activeSeasonKey, () => {
  if (episodesListEl.value) episodesListEl.value.scrollTop = 0
})

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
  // O player devolve o foco ao elemento ativo; o botão "do início" some sem progresso salvo.
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

function onEpisodeFocus(event) {
  try {
    event.target.scrollIntoView({ block: 'nearest' })
  } catch (_) {
    event.target.scrollIntoView(false)
  }
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

// ---------- Foco, Voltar e D-Pad ----------
function close() {
  emit('close')
}

/** Setas laterais na lista de episódios não "fogem" para os botões do cabeçalho. */
function onModalKey(action) {
  if (player.isOpen) return false
  if (action !== 'left' && action !== 'right') return false
  const el = document.activeElement
  return !!(el && el.closest && el.closest('[data-focus-group="series-episodes"]'))
}

// Player fechado por cima da tela: garante que o foco volte para dentro dela.
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
  cleanupKey = registerKeyHandler(onModalKey)
  nextTick(focusPrimary)
  loadingPromise = loadDetails()
})

onBeforeUnmount(() => {
  if (popScope) popScope()
  if (cleanupBack) cleanupBack()
  if (cleanupKey) cleanupKey()
  const el = previousFocusedEl
  previousFocusedEl = null
  nextTick(() => {
    if (el && document.body.contains(el)) el.focus()
  })
})

function formatTime(sec) {
  if (!sec || isNaN(sec) || sec < 0) return '00:00'
  const s = Math.floor(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const remS = s % 60
  const pad = (n) => String(n).padStart(2, '0')
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(remS)}` : `${pad(m)}:${pad(remS)}`
}
</script>

<template>
  <div
    ref="rootEl"
    class="fixed inset-0 z-40 bg-[#0a0a0a] text-white overflow-hidden select-none"
    role="dialog"
    aria-modal="true"
    :aria-label="info.name"
    data-focus-group="media-details"
  >
    <!-- Backdrop cinematográfico à direita -->
    <img
      v-if="info.backdrop && !backdropFailed"
      :key="info.backdrop"
      :src="info.backdrop"
      alt=""
      referrerpolicy="no-referrer"
      class="absolute top-0 right-0 w-[68%] object-cover opacity-55 pointer-events-none"
      :class="isSeries ? 'h-[62%]' : 'h-full'"
      @error="backdropFailed = true"
    />
    <div class="absolute inset-0 bg-gradient-to-r from-[#0a0a0a] via-[#0a0a0a]/90 to-transparent pointer-events-none" />
    <div
      class="absolute inset-x-0 top-0 bg-gradient-to-t from-[#0a0a0a] via-[#0a0a0a]/30 to-transparent pointer-events-none"
      :class="isSeries ? 'h-[62%]' : 'h-full'"
    />

    <!-- ===================== FILME ===================== -->
    <div v-if="!isSeries" class="relative z-10 px-14 py-12 flex flex-col justify-between h-full max-w-[56rem]">
      <div>
        <div class="flex items-center gap-2.5">
          <span class="text-[#e50914] font-black text-tv-base tracking-widest">N</span>
          <span class="text-tv-xs font-bold tracking-[0.25em] text-neutral-400 uppercase">FILME</span>
        </div>

        <h1 class="text-[3.2rem] font-black uppercase tracking-tight leading-[1.0] text-white mt-2 line-clamp-2">
          {{ info.name }}
        </h1>

        <div class="flex items-center gap-3.5 text-tv-sm text-neutral-300 mt-4 font-medium">
          <span v-if="hasRating" class="text-[#22c55e] font-bold">Nota {{ info.rating }}</span>
          <span v-if="info.year">{{ info.year }}</span>
          <span>{{ info.duration || 'Longa-metragem' }}</span>
          <span class="px-2 py-0.5 border border-white/25 rounded text-tv-xs">4K UHD</span>
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

        <div data-focus-row="movie-details-actions" class="flex items-center gap-3 mt-8">
          <button
            id="details-play-btn"
            type="button"
            class="tv-focusable h-[3.4rem] px-8 rounded-lg bg-white text-black font-bold text-tv-sm flex items-center gap-3"
            @click="playMovie"
          >
            <svg class="w-4 h-4 fill-black shrink-0" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3" /></svg>
            <span>{{ hasMovieProgress ? 'Continuar assistindo' : 'Assistir agora' }}</span>
          </button>

          <button
            v-if="hasMovieProgress"
            id="details-restart-btn"
            type="button"
            class="tv-focusable h-[3.4rem] px-7 rounded-lg bg-neutral-800/85 border border-white/15 text-white font-medium text-tv-sm flex items-center gap-3"
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
            class="tv-focusable h-[3.4rem] px-7 rounded-lg bg-neutral-800/85 border border-white/15 text-white font-medium text-tv-sm flex items-center gap-3"
            @click="toggleBookmark"
          >
            <svg v-if="isBookmarked" class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <svg v-else class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span>{{ isBookmarked ? 'Nos Favoritos' : 'Favoritos' }}</span>
          </button>

          <button
            id="details-back-btn"
            type="button"
            class="tv-focusable h-[3.4rem] px-7 rounded-lg bg-neutral-800/85 border border-white/15 text-white font-medium text-tv-sm flex items-center gap-3"
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
    <div v-else class="relative z-10 flex flex-col h-full">
      <!-- Cabeçalho da série -->
      <header class="px-14 pt-10 shrink-0 max-w-[60rem]">
        <div class="flex items-center gap-2.5">
          <span class="text-[#e50914] font-black text-tv-base tracking-widest">N</span>
          <span class="text-tv-xs font-bold tracking-[0.25em] text-neutral-400 uppercase">SÉRIE</span>
        </div>

        <h1 class="text-[3.2rem] font-black uppercase tracking-tight leading-[1.0] text-white mt-2 line-clamp-2">
          {{ info.name }}
        </h1>

        <div class="flex items-center gap-3.5 text-tv-sm text-neutral-300 mt-4 font-medium">
          <span v-if="hasRating" class="text-[#22c55e] font-bold">Nota {{ info.rating }}</span>
          <span v-if="info.year">{{ info.year }}</span>
          <span v-if="seasons.length">{{ seasons.length }} {{ seasons.length === 1 ? 'Temporada' : 'Temporadas' }}</span>
          <span class="px-2 py-0.5 border border-white/25 rounded text-tv-xs">4K UHD</span>
          <span v-if="info.genre" class="truncate">{{ info.genre }}</span>
        </div>

        <div v-if="isLoadingInfo" class="mt-4 space-y-3 animate-pulse" aria-hidden="true">
          <div class="h-4 rounded bg-white/[0.08] w-full" />
          <div class="h-4 rounded bg-white/[0.06] w-3/4" />
        </div>
        <template v-else>
          <p class="text-tv-sm text-neutral-200 leading-relaxed line-clamp-2 mt-4">{{ info.plot }}</p>
          <p v-if="info.cast" class="mt-2 text-tv-xs text-neutral-400 line-clamp-1">
            <span class="text-neutral-500 font-semibold">Elenco:</span> {{ info.cast }}
          </p>
        </template>

        <div data-focus-row="series-details-actions" class="flex items-center gap-3 mt-6">
          <button
            id="series-play-btn"
            type="button"
            class="tv-focusable h-[3.4rem] px-8 rounded-lg bg-white text-black font-bold text-tv-sm flex items-center gap-3"
            @click="playSeries"
          >
            <svg class="w-4 h-4 fill-black shrink-0" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3" /></svg>
            <span>{{ seriesPlayLabel }}</span>
          </button>

          <button
            id="series-fav-btn"
            type="button"
            class="tv-focusable h-[3.4rem] px-7 rounded-lg bg-neutral-800/85 border border-white/15 text-white font-medium text-tv-sm flex items-center gap-3"
            @click="toggleBookmark"
          >
            <svg v-if="isBookmarked" class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <svg v-else class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span>{{ isBookmarked ? 'Nos Favoritos' : 'Favoritos' }}</span>
          </button>

          <button
            id="series-back-btn"
            type="button"
            class="tv-focusable h-[3.4rem] px-7 rounded-lg bg-neutral-800/85 border border-white/15 text-white font-medium text-tv-sm flex items-center gap-3"
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
      <div v-else-if="loadError" class="flex-1 flex flex-col items-center justify-center gap-4 text-center px-14">
        <p class="text-tv-base text-red-300 font-medium" role="alert">{{ loadError }}</p>
        <div data-focus-row="series-error-actions">
          <button id="series-retry-btn" type="button" class="tv-btn tv-btn-primary !px-6 !py-2.5" @click="retryLoad">
            Tentar novamente
          </button>
        </div>
      </div>

      <template v-else>
        <!-- Seletor horizontal de temporadas -->
        <div data-focus-row="series-seasons" class="px-14 mt-7 shrink-0 flex items-center gap-3 overflow-x-auto py-1.5">
          <button
            v-for="season in seasons"
            :id="'season-tab-' + season.key"
            :key="season.key"
            type="button"
            class="tv-focusable shrink-0 px-6 py-2.5 rounded-lg border text-tv-sm transition-colors"
            :class="
              season.key === activeSeasonKey
                ? 'bg-[#e50914] border-[#e50914] text-white font-bold'
                : 'border-white/10 bg-white/[0.04] text-neutral-300 font-semibold'
            "
            @click="selectSeason(season.key)"
          >
            Temporada {{ season.number }}
          </button>
          <span v-if="seasons.length" class="ml-3 shrink-0 text-tv-xs text-neutral-400 font-medium">
            {{ currentEpisodes.length }} {{ currentEpisodes.length === 1 ? 'episódio' : 'episódios' }}
          </span>
        </div>

        <!-- Lista de episódios -->
        <div
          ref="episodesListEl"
          class="flex-1 min-h-0 overflow-y-auto px-14 pt-4 pb-10 space-y-3"
          data-focus-group="series-episodes"
        >
          <button
            v-for="(ep, index) in currentEpisodes"
            :id="'episode-card-' + ep.id"
            :key="ep.id"
            type="button"
            class="tv-focusable w-full max-w-[72rem] flex items-center gap-6 p-3 rounded-xl bg-[#121215] border border-white/[0.08] text-left group"
            @focus="onEpisodeFocus"
            @click="playEpisode(index)"
          >
            <div class="w-[13rem] h-[7.2rem] rounded-lg overflow-hidden bg-[#1a1a20] relative shrink-0">
              <img
                v-if="episodeImage(ep)"
                :src="episodeImage(ep)"
                alt=""
                loading="lazy"
                referrerpolicy="no-referrer"
                class="w-full h-full object-cover"
                @error="$event.target.style.display = 'none'"
              />
              <div class="absolute inset-0 bg-black/35 group-focus:bg-black/10 flex items-center justify-center transition-colors">
                <div class="w-10 h-10 rounded-full border border-white/70 bg-black/40 flex items-center justify-center">
                  <svg class="w-4 h-4 fill-white ml-0.5" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                </div>
              </div>
              <span class="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-black/70 text-white text-[0.65rem] font-bold">
                E{{ ep.episode_num }}
              </span>
              <div v-if="episodeProgressPct(ep) > 0" class="absolute bottom-0 inset-x-0 h-1 bg-white/15">
                <div class="h-full bg-[#e50914]" :style="{ width: episodeProgressPct(ep) + '%' }" />
              </div>
            </div>

            <div class="flex-1 min-w-0 py-1">
              <div class="flex items-center justify-between gap-4">
                <span class="text-tv-base font-bold text-white truncate">{{ ep.episode_num }}. {{ episodeTitle(ep) }}</span>
                <span v-if="episodeDuration(ep)" class="text-tv-xs text-neutral-400 font-mono shrink-0">
                  {{ episodeDuration(ep) }}
                </span>
              </div>
              <p class="text-tv-xs text-neutral-400 line-clamp-2 mt-1.5">{{ episodePlot(ep) }}</p>
            </div>
          </button>

          <p v-if="!currentEpisodes.length" class="text-center py-12 text-tv-sm text-neutral-400">
            Nenhum episódio encontrado para esta temporada.
          </p>
        </div>
      </template>
    </div>
  </div>
</template>
