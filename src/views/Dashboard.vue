<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/authStore'
import { usePlayerStore } from '@/stores/playerStore'
import { useCatalogStore } from '@/stores/catalogStore'
import { useProfileStore } from '@/stores/profileStore'
import SideMenu from '@/components/SideMenu.vue'
import BrandMark from '@/components/BrandMark.vue'
import HorizontalRail from '@/components/ui/HorizontalRail.vue'
import CatalogBrowser from '@/components/CatalogBrowser.vue'
import ListManagerModal from '@/components/ListManagerModal.vue'
import MediaDetailsModal from '@/components/MediaDetailsModal.vue'
import ProfileGate from '@/components/ProfileGate.vue'
import SearchScreen from '@/components/SearchScreen.vue'
import { registerBackHandler, focusFirstIn } from '@/utils/spatialNavigation'
import { ALL_CATEGORIES } from '@/services/catalogDb'
import { formatTime } from '@/utils/formatTime'
import { pickArtwork } from '@/utils/artwork'
import { normalizeVodInfo, fetchVodInfo, fetchSeriesInfo } from '@/services/xtreamApi'
import { tabBackAction } from '@/utils/tabBack'
import { playHistoryItem } from '@/utils/seriesPlaylist'

const router = useRouter()
const auth = useAuthStore()
const player = usePlayerStore()
const catalog = useCatalogStore()
const profileStore = useProfileStore()

// Abas de Navegação ('home' | 'live' | 'vod' | 'series' | 'favorites' | 'search')
const activeTab = ref('home')

// Gerenciador de listas
const listModal = ref(null)

// Tela de Detalhes aberta a partir da aba Início ou Minha Lista: { item, index, section } | null
const homeDetails = ref(null)

let cleanupRootBack = null

// Vitrine montada com itens da lista conectada (RFC-014)
const vodShowcase = ref([])
const seriesShowcase = ref([])
const liveShowcase = ref([])
const heroInfo = ref(normalizeVodInfo(null, null))
const heroArtworkFailed = ref(false)

// Destaque "Continuar assistindo": o filme ou episódio mais recente; canal só se não houver outro.
const recentHistoryItem = computed(
  () => player.watchHistory.find((it) => it.section !== 'live') || player.watchHistory[0] || null,
)

/** "Continuar assistindo": episódio toca a série inteira a partir dele (o próximo segue sozinho). */
function playFromHistory(item) {
  return playHistoryItem(item, {
    player,
    loadSeries: (seriesId) => fetchSeriesInfo({ apiBase: auth.apiBase, credentials: auth.credentials, seriesId }),
  })
}

// Item prioritário em exibição no destaque
const heroItem = computed(() => {
  return recentHistoryItem.value || vodShowcase.value[0] || seriesShowcase.value[0] || liveShowcase.value[0] || null
})

// Arte do destaque (backdrop -> pôster -> neutro)
const heroArtwork = computed(() => {
  if (heroArtworkFailed.value) return { url: '', mode: 'none' }
  const it = heroItem.value?.rawItem || heroItem.value
  return pickArtwork(it, heroInfo.value)
})

// Filme 1 e série 1 podem ter o mesmo número: a chave inclui a seção.
const heroKey = computed(() => {
  const it = heroItem.value?.rawItem || heroItem.value
  return it ? `${it.section || heroItem.value.section}:${it.seriesId || it.stream_id}` : ''
})
let heroRequest = 0

watch(
  heroKey,
  async () => {
    const my = ++heroRequest
    heroArtworkFailed.value = false
    const it = heroItem.value?.rawItem || heroItem.value
    if (!it) {
      heroInfo.value = normalizeVodInfo(null, null)
      return
    }
    heroInfo.value = normalizeVodInfo(null, it)
    if (it.directUrl || !auth.isAuthenticated) return

    try {
      let info = null
      if (it.section === 'series') {
        // Episódio do "Continuar assistindo": os detalhes são da série (seriesId), não do episódio.
        const data = await fetchSeriesInfo({
          apiBase: auth.apiBase,
          credentials: auth.credentials,
          seriesId: it.seriesId || it.series_id || it.stream_id,
        })
        if (data && data.info) info = normalizeVodInfo({ info: data.info }, it)
      } else if (it.section === 'vod') {
        info = await fetchVodInfo({ apiBase: auth.apiBase, credentials: auth.credentials, vodId: it.stream_id, item: it })
      }
      // Só aplica se o destaque ainda for este item (resposta antiga não sobrescreve a nova).
      if (info && my === heroRequest) heroInfo.value = info
    } catch (_) {}
  },
  { immediate: true },
)

const heroBadgeLabel = computed(() => {
  if (recentHistoryItem.value) return 'CONTINUAR ASSISTINDO'
  const it = heroItem.value
  if (!it) return 'DA SUA LISTA'
  if (it.section === 'series') return 'SÉRIE DA SUA LISTA'
  if (it.section === 'live') return 'CANAL DA SUA LISTA'
  return 'FILME DA SUA LISTA'
})

const heroTitle = computed(() => {
  return heroInfo.value?.name || heroItem.value?.name || 'PULSE PLAYER'
})

const heroRating = computed(() => {
  const r = heroInfo.value?.rating
  if (!r || Number(r) === 0) return ''
  return `Nota ${r}`
})

const heroYear = computed(() => {
  return heroInfo.value?.year || ''
})

const heroDuration = computed(() => {
  const it = heroItem.value
  if (it?.section === 'series') return heroInfo.value?.duration || 'Série'
  if (it?.section === 'live') return 'Ao vivo'
  if (recentHistoryItem.value && recentHistoryItem.value.currentTime) {
    return formatTime(recentHistoryItem.value.currentTime)
  }
  return heroInfo.value?.duration || 'Filme'
})

const heroGenre = computed(() => {
  return heroInfo.value?.genre || ''
})

const heroSynopsis = computed(() => {
  if (heroInfo.value?.plot && heroInfo.value.plot !== 'Sem sinopse disponível.') {
    return heroInfo.value.plot
  }
  if (recentHistoryItem.value) {
    return recentHistoryItem.value.section === 'live'
      ? 'Volte ao canal que você estava assistindo.'
      : 'Retome a reprodução de onde você parou.'
  }
  if (heroItem.value?.name) {
    return `Disponível diretamente da sua lista conectada.`
  }
  return 'Explore o catálogo da sua lista conectada.'
})

const heroPlayButtonText = computed(() => {
  if (recentHistoryItem.value) {
    return recentHistoryItem.value.section === 'series' ? 'Continuar' : 'Continuar assistindo'
  }
  if (heroItem.value?.section === 'series') return 'Assistir T1:E1'
  return 'Assistir agora'
})

const isHeroBookmarked = computed(() => {
  const it = heroItem.value?.rawItem || heroItem.value
  if (!it) return false
  return player.isInCustomQueue(it, it.section || heroItem.value.section)
})

function handleHeroBookmark() {
  const it = heroItem.value?.rawItem || heroItem.value
  if (!it) return
  const sec = it.section || heroItem.value.section || 'vod'
  if (player.isInCustomQueue(it, sec)) {
    player.removeFromCustomQueue(it.stream_id, sec)
  } else {
    player.enqueueItem(it, sec)
  }
}

function handleHeroPlay() {
  if (recentHistoryItem.value) {
    playFromHistory(recentHistoryItem.value)
    return
  }
  const item = heroItem.value
  if (!item) return
  if (item.section === 'series') {
    homeDetails.value = { item: item.rawItem || item, index: 0, section: 'series' }
    return
  }
  handleCardPlay(item, item.section || 'vod')
}

function handleHeroInfo() {
  const item = recentHistoryItem.value || heroItem.value
  if (!item) {
    openListModal()
    return
  }
  if (item.section === 'series') {
    homeDetails.value = { item: item.rawItem || item, index: -1, section: 'series' }
    return
  }
  if (item.section === 'vod') {
    homeDetails.value = { item: item.rawItem || item, index: -1, section: 'vod' }
    return
  }
  openListModal()
}

/**
 * Carrega as seções do catálogo e monta as fileiras do Início.
 */
async function loadCatalogShowcase({ reset = false } = {}) {
  if (reset) {
    vodShowcase.value = []
    seriesShowcase.value = []
    liveShowcase.value = []
  }

  const loads = []
  if (catalog.status.vod.state === 'idle') loads.push(catalog.loadSection('vod'))
  if (catalog.status.series.state === 'idle') loads.push(catalog.loadSection('series'))
  if (catalog.status.live.state === 'idle') loads.push(catalog.loadSection('live'))
  if (loads.length > 0) {
    try {
      await Promise.all(loads)
    } catch (_) {}
  }

  try {
    const vodItems = await catalog.getItems('vod', ALL_CATEGORIES, 0, 20)
    if (vodItems && vodItems.length > 0) {
      vodShowcase.value = vodItems.map((item) => ({
        stream_id: item.stream_id,
        name: item.name,
        section: 'vod',
        image: item.stream_icon || item.cover,
        stream_icon: item.stream_icon || item.cover,
        subtitle: item.genre || 'Filme',
        rawItem: item,
      }))
    }
  } catch (_) {}

  try {
    const seriesItems = await catalog.getItems('series', ALL_CATEGORIES, 0, 20)
    if (seriesItems && seriesItems.length > 0) {
      seriesShowcase.value = seriesItems.map((item) => ({
        stream_id: item.stream_id || item.series_id,
        name: item.name,
        section: 'series',
        image: item.stream_icon || item.cover,
        stream_icon: item.stream_icon || item.cover,
        subtitle: 'Série',
        rawItem: item,
      }))
    }
  } catch (_) {}

  try {
    const liveItems = await catalog.getItems('live', ALL_CATEGORIES, 0, 20)
    if (liveItems && liveItems.length > 0) {
      liveShowcase.value = liveItems.map((item) => {
        return {
          stream_id: item.stream_id,
          name: item.name,
          section: 'live',
          program: 'Transmissão contínua',
          schedule: `Canal ${item.num || ''} · Ao vivo`,
          image: item.stream_icon,
          stream_icon: item.stream_icon,
          rawItem: item,
        }
      })
    }
  } catch (_) {}
}

watch(
  () => [catalog.status.vod.state, catalog.status.series.state, catalog.status.live.state],
  ([vodState, seriesState, liveState]) => {
    if (vodState === 'ready' || seriesState === 'ready' || liveState === 'ready') {
      loadCatalogShowcase()
    }
  },
)

// Seção que falhou ao carregar e ficou sem fileira: o início mostra o aviso (as abas já mostravam) com "Tentar novamente".
const showcaseBySection = { vod: vodShowcase, series: seriesShowcase, live: liveShowcase }
const failedSections = computed(() =>
  Object.keys(showcaseBySection).filter(
    (s) => catalog.status[s].state === 'error' && showcaseBySection[s].value.length === 0,
  ),
)
const homeError = computed(() => (failedSections.value.length ? catalog.status[failedSections.value[0]].error : ''))

function retryHome() {
  failedSections.value.forEach((s) => catalog.refreshSection(s))
}

// Itens das fileiras com card "Ver todos" no final
const vodRailItems = computed(() => {
  if (!vodShowcase.value.length) return []
  return [...vodShowcase.value, { isSeeAll: true, section: 'vod', name: 'Ver todos os filmes' }]
})
const seriesRailItems = computed(() => {
  if (!seriesShowcase.value.length) return []
  return [...seriesShowcase.value, { isSeeAll: true, section: 'series', name: 'Ver todas as séries' }]
})
const liveRailItems = computed(() => {
  if (!liveShowcase.value.length) return []
  return [...liveShowcase.value, { isSeeAll: true, section: 'live', name: 'Explorar canais' }]
})

function handleCardPlay(card, section) {
  if (card.directUrl) {
    player.playItem({
      stream_id: card.stream_id,
      name: card.name,
      section: card.section || section,
      stream_icon: card.stream_icon || card.image,
      container_extension: card.container_extension || (section === 'live' ? 'm3u8' : 'mp4'),
      directUrl: card.directUrl,
    })
    return
  }

  if (card.rawItem) {
    player.playFromCatalog({
      section,
      categoryId: ALL_CATEGORIES,
      item: card.rawItem,
      indexInCategory: 0,
    })
    return
  }

  player.playItem({
    stream_id: card.stream_id,
    name: card.name,
    section: card.section || section,
    stream_icon: card.stream_icon || card.image,
    container_extension: section === 'live' ? 'm3u8' : 'mp4',
  })
}

function openMovieDetails(card, index) {
  homeDetails.value = { item: card.rawItem || card, index, section: 'vod' }
}

function openSeriesDetails(card, index) {
  homeDetails.value = { item: card.rawItem || card, index, section: 'series' }
}

function onHistoryRailSelect(item) {
  playFromHistory(item)
}

function onVodRailSelect(item, index) {
  if (item.isSeeAll) {
    activeTab.value = 'vod'
    return
  }
  openMovieDetails(item, index)
}

function onSeriesRailSelect(item, index) {
  if (item.isSeeAll) {
    activeTab.value = 'series'
    return
  }
  openSeriesDetails(item, index)
}

function onLiveRailSelect(item) {
  if (item.isSeeAll) {
    activeTab.value = 'live'
    return
  }
  handleCardPlay(item, 'live')
}

const FAVORITE_LABELS = { live: 'Canal de TV', series: 'Série salva', vod: 'Filme salvo' }

function openFavorite(item) {
  if (item.section === 'series') {
    homeDetails.value = { item, index: -1, section: 'series' }
    return
  }
  player.playFromCustomQueue(item)
}

function getRemainingText(item) {
  if (!item.duration || item.duration <= 0) return ''
  const remSec = Math.max(0, item.duration - (item.currentTime || 0))
  const remMin = Math.ceil(remSec / 60)
  return `Faltam ${remMin} min`
}

function openListModal() {
  listModal.value?.open()
}

function onListChanged() {
  activeTab.value = 'home'
  return showcaseAfterListChange()
}

async function onLoggedOut() {
  await router.replace({ name: 'login' })
}

function openProfileGate() {
  profileStore.openProfileGate()
}

function onProfileSelected() {
  nextTick(() => {
    const heroBtn = document.getElementById('hero-play')
    if (heroBtn) heroBtn.focus()
    else focusFirstIn('[data-focus-group="side-menu"]')
  })
}

async function showcaseAfterListChange() {
  catalog.loadSection('vod')
  catalog.loadSection('live')
  catalog.loadSection('series')
  await loadCatalogShowcase({ reset: true })
}

watch(activeTab, (tab) => {
  nextTick(() => {
    if (tab === 'home') {
      const hero = document.getElementById('hero-play')
      if (hero) hero.focus()
      else focusFirstIn('[data-focus-group="home-vitrine"]')
    } else if (tab === 'series') {
      focusFirstIn('[data-focus-group="content"]') || focusFirstIn('[data-focus-group="categories"]')
    } else if (tab === 'favorites') {
      focusFirstIn('[data-focus-group="favorites-view"]')
    } else if (tab === 'live' || tab === 'vod') {
      focusFirstIn('[data-focus-group="categories"]')
    } else if (tab === 'search') {
      focusFirstIn('[data-focus-group="search-keyboard"]')
    }
    // Aba sem nada focável (ex.: Minha lista vazia) e o foco caiu com a tela antiga: volta ao item ativo do menu.
    if (!document.activeElement || document.activeElement === document.body) {
      focusFirstIn('[data-focus-group="side-menu"]')
    }
  })
})

onMounted(async () => {
  await profileStore.hydrate()
  await player.hydrate()
  await auth.hydrate()
  await loadCatalogShowcase()

  cleanupRootBack = registerBackHandler(() => {
    const action = tabBackAction({
      tab: activeTab.value,
      playerOpen: player.isOpen,
      gateOpen: profileStore.isProfileGateOpen,
    })
    if (action === 'home') {
      activeTab.value = 'home'
      nextTick(() => {
        document.getElementById('nav-home')?.focus()
      })
      return true
    }
    return false
  })

  nextTick(() => {
    if (!profileStore.isProfileGateOpen) {
      const heroBtn = document.getElementById('hero-play')
      if (heroBtn) {
        heroBtn.focus()
      } else {
        focusFirstIn('[data-focus-group="side-menu"]')
      }
    }
  })
})

onBeforeUnmount(() => {
  if (cleanupRootBack) cleanupRootBack()
})
</script>

<template>
  <div class="w-full h-full flex bg-tv-deep text-white overflow-hidden select-none relative">
    <!-- Menu Lateral Recolhido (Layout B aprovado) -->
    <SideMenu
      :active-tab="activeTab"
      :profile="profileStore.activeProfile"
      :list-label="auth.activeListLabel || auth.username || ''"
      @navigate="activeTab = $event"
      @manage-lists="openListModal"
      @switch-profile="openProfileGate"
    />

    <!-- Área de Conteúdo Principal (espaçada à esquerda pelo menu lateral recolhido de 7rem) -->
    <main class="flex-1 min-w-0 h-full pl-[7rem] flex flex-col overflow-hidden relative">
      <!-- Aba TV ao Vivo -->
      <div v-if="activeTab === 'live'" class="w-full h-full">
        <CatalogBrowser section="live" />
      </div>

      <!-- Aba Filmes -->
      <div v-else-if="activeTab === 'vod'" class="w-full h-full">
        <CatalogBrowser section="vod" />
      </div>

      <!-- Aba Séries -->
      <div v-else-if="activeTab === 'series'" class="w-full h-full">
        <CatalogBrowser section="series" />
      </div>

      <!-- Aba Busca -->
      <div v-else-if="activeTab === 'search'" class="w-full h-full">
        <SearchScreen />
      </div>

      <!-- Aba Minha lista (Favoritos) -->
      <div
        v-else-if="activeTab === 'favorites'"
        class="flex flex-col h-full pl-16 pr-24 py-14 overflow-y-auto"
        data-focus-group="favorites-view"
      >
        <div class="flex items-center justify-between mb-8">
          <div>
            <h1 class="text-tv-xl font-bold text-white tracking-tight">Minha lista</h1>
            <p class="text-tv-sm text-neutral-400 mt-1">Seus títulos favoritos, em um só lugar.</p>
          </div>
          <div v-if="player.customQueue.length > 0" class="flex items-center gap-4">
            <button
              id="fav-play-all"
              type="button"
              class="tv-btn tv-btn-primary !px-6 !py-2.5 text-tv-sm flex items-center gap-2"
              @click="player.playFromCustomQueue()"
            >
              <svg class="w-4 h-4 fill-black" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              <span>Reproduzir Tudo</span>
            </button>
            <button
              id="fav-clear"
              type="button"
              class="tv-btn !px-5 !py-2.5 text-tv-sm text-neutral-400 hover:text-white"
              @click="player.clearCustomQueue()"
            >
              Limpar Lista
            </button>
          </div>
        </div>

        <!-- Estado Vazio -->
        <div
          v-if="player.customQueue.length === 0"
          class="flex flex-col items-center justify-center flex-1 py-28 text-center"
        >
          <svg class="w-10 h-10 text-neutral-500 stroke-[1.5] mb-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path d="M12 20s-7-4.5-7-10a4 4 0 017-2.5A4 4 0 0119 10c0 5.5-7 10-7 10z" />
          </svg>
          <p class="text-tv-base font-medium text-neutral-200">Sua lista está vazia</p>
          <p class="text-tv-sm text-neutral-500 mt-1">Adicione filmes, séries e canais para assistir quando quiser.</p>
        </div>

        <!-- Grade de Cards da Minha Lista -->
        <div v-else class="grid grid-cols-4 gap-5">
          <div
            v-for="item in player.customQueue"
            :id="'fav-card-' + item.section + '-' + item.stream_id"
            :key="item.stream_id + ':' + (item.section || '')"
            tabindex="0"
            class="tv-focusable rounded-xl bg-[#121215] border border-white/[0.08] p-2.5 flex flex-col gap-2.5 text-left cursor-pointer group"
            @click="openFavorite(item)"
            @keydown.enter.prevent="openFavorite(item)"
          >
            <div class="relative w-full h-[9.5rem] rounded-lg overflow-hidden bg-[#1a1a20]">
              <img
                v-if="item.stream_icon"
                :src="item.stream_icon"
                alt=""
                loading="lazy"
                decoding="async"
                class="w-full h-full object-cover"
                @error="$event.target.style.display = 'none'"
              />
              <div class="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent pointer-events-none" />
              <span
                class="absolute top-2.5 left-2.5 px-2 py-0.5 rounded text-tv-xs font-bold uppercase tracking-wider"
                :class="item.section === 'live' ? 'bg-tv-accent text-tv-on-accent' : 'bg-black/60 border border-white/25 text-white'"
              >
                {{ item.section === 'live' ? 'AO VIVO' : item.section === 'series' ? 'SÉRIE' : 'FILME' }}
              </span>
              <span class="absolute bottom-2 left-2.5 right-2.5 text-tv-base font-black uppercase tracking-tight text-white truncate drop-shadow">
                {{ item.name }}
              </span>
            </div>

            <div class="flex items-center justify-between px-1 pb-0.5">
              <div class="min-w-0 pr-2">
                <p class="text-tv-sm font-medium text-white truncate">{{ item.name }}</p>
                <p class="text-tv-xs text-neutral-500">{{ FAVORITE_LABELS[item.section] || 'Filme salvo' }}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Aba Início (Layout B — Destaque em tela cheia com vinheta + Fileiras deslizantes) -->
      <div
        v-else
        class="flex-1 overflow-y-auto overflow-x-hidden relative"
        data-focus-group="home-vitrine"
      >
        <!-- Hero Banner Destaque (Full-Bleed com vinheta lateral e inferior) -->
        <div class="relative w-full min-h-[31rem] px-16 pt-10 pb-14 flex flex-col justify-end overflow-hidden">
          <!-- Arte de fundo com vinheta cinematográfica -->
          <div class="absolute inset-0 pointer-events-none overflow-hidden">
            <img
              v-if="heroArtwork.url"
              :key="heroArtwork.url"
              :src="heroArtwork.url"
              alt=""
              class="absolute right-0 top-0 w-[68%] h-full object-cover object-center pointer-events-none"
              :class="heroArtwork.mode === 'backdrop' ? 'opacity-65' : 'opacity-35 scale-105'"
              @error="heroArtworkFailed = true"
            />
            <div
              v-else
              class="absolute inset-0 bg-[radial-gradient(ellipse_at_70%_40%,#0e7490_0%,#164e63_25%,#0b1220_52%,#0b0f0c_78%)] opacity-80"
            />
            <!-- Vinheta 2.0 (fusão à esquerda e na base) -->
            <div class="absolute inset-0 tv-vignette pointer-events-none" />
          </div>

          <!-- Conteúdo do Hero -->
          <div class="relative z-10 max-w-[44rem] space-y-3.5">
            <!-- Selo superior com o símbolo da marca -->
            <div class="flex items-center gap-2.5">
              <BrandMark :size="1.25" class="text-tv-accent" />
              <span class="text-tv-xs font-bold tracking-[0.22em] text-neutral-300 uppercase">
                {{ heroBadgeLabel }}
              </span>
            </div>

            <!-- Título Principal -->
            <h1 class="text-tv-hero font-black uppercase text-white line-clamp-2">
              {{ heroTitle }}
            </h1>

            <!-- Linha de Metadados -->
            <div class="flex items-center gap-3 text-tv-xs text-tv-meta font-medium flex-wrap">
              <span v-if="heroRating" class="text-[#4ade80] font-bold">{{ heroRating }}</span>
              <span v-if="heroRating && (heroYear || heroDuration)" class="w-1 h-1 rounded-full bg-neutral-500" />
              <span v-if="heroYear">{{ heroYear }}</span>
              <span v-if="heroYear && heroDuration" class="w-1 h-1 rounded-full bg-neutral-500" />
              <span>{{ heroDuration }}</span>
              <span v-if="heroGenre" class="truncate">{{ heroGenre }}</span>
            </div>

            <!-- Sinopse -->
            <p class="text-tv-sm text-tv-meta leading-relaxed line-clamp-3 max-w-[34rem]">
              {{ heroSynopsis }}
            </p>

            <!-- Linha de Ações do Hero -->
            <div data-focus-row="hero-actions" class="flex items-center gap-3.5 pt-2 w-max">
              <button
                id="hero-play"
                type="button"
                class="tv-focusable h-[3.2rem] px-7 rounded-lg bg-white text-black font-bold text-tv-sm flex items-center gap-2.5 whitespace-nowrap"
                @click="handleHeroPlay"
              >
                <svg class="w-4 h-4 fill-black shrink-0" viewBox="0 0 24 24">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
                <span>{{ heroPlayButtonText }}</span>
              </button>

              <button
                id="hero-info"
                type="button"
                class="tv-focusable h-[3.2rem] px-6 rounded-lg tv-btn-glass font-medium text-tv-sm flex items-center gap-2.5 whitespace-nowrap"
                @click="handleHeroInfo"
              >
                <svg class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="16" x2="12" y2="12" />
                  <line x1="12" y1="8" x2="12.01" y2="8" />
                </svg>
                <span>{{ heroItem?.section === 'series' ? 'Episódios' : 'Mais informações' }}</span>
              </button>

              <button
                id="hero-mylist"
                type="button"
                class="tv-focusable h-[3.2rem] px-6 rounded-lg tv-btn-glass font-medium text-tv-sm flex items-center gap-2.5 whitespace-nowrap"
                @click="handleHeroBookmark"
              >
                <svg v-if="isHeroBookmarked" class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <svg v-else class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                <span>{{ isHeroBookmarked ? 'Na minha lista' : 'Minha lista' }}</span>
              </button>
            </div>
          </div>
        </div>

        <!-- Fileiras Deslizantes (Horizontais) -->
        <div class="pl-16 pr-24 space-y-7 -mt-4 pb-20 relative z-20">
          <!-- Falha ao carregar a lista -->
          <section v-if="homeError" data-focus-group="home-error" class="space-y-2" role="alert">
            <h2 class="text-tv-row font-bold text-white tracking-tight">Não foi possível carregar sua lista</h2>
            <p class="text-tv-sm text-neutral-400">{{ homeError }}</p>
            <button id="home-retry" type="button" class="tv-btn tv-btn-primary mt-2" @click="retryHome">
              Tentar novamente
            </button>
          </section>

          <!-- 1. Continuar assistindo -->
          <section
            v-if="player.watchHistory.length > 0"
            data-focus-group="continue-watching"
            class="space-y-3"
          >
            <div data-focus-row="header-history" class="flex items-center justify-between">
              <h2 class="text-tv-row font-bold text-white tracking-tight">Continuar assistindo</h2>
              <button
                id="btn-clear-history"
                type="button"
                class="tv-focusable text-tv-xs text-neutral-400 hover:text-white"
                @click="player.clearHistory()"
              >
                Limpar histórico
              </button>
            </div>

            <HorizontalRail
              :items="player.watchHistory"
              id-prefix="history-card"
              :item-key="(it) => `${it.stream_id}:${it.section}`"
              :gap="1"
              @select="onHistoryRailSelect"
            >
              <template #item="{ item }">
                <div class="w-[16rem] h-[9rem] rounded-xl bg-[#141418] border border-white/10 relative overflow-hidden group">
                  <img
                    v-if="item.stream_icon"
                    :src="item.stream_icon"
                    alt=""
                    loading="lazy"
                    decoding="async"
                    class="w-full h-full object-cover"
                    @error="$event.target.style.display = 'none'"
                  />
                  <div class="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent pointer-events-none" />

                  <!-- Selo -->
                  <span
                    v-if="item.section === 'live'"
                    class="tv-badge tv-badge-live"
                  >
                    AO VIVO
                  </span>
                  <span
                    v-else
                    class="tv-badge"
                  >
                    {{ getRemainingText(item) }}
                  </span>

                  <!-- Título sobre a imagem -->
                  <span class="absolute bottom-2.5 left-3 right-3 text-tv-sm font-black uppercase tracking-tight text-white truncate drop-shadow">
                    {{ item.name }}
                  </span>

                  <!-- Barra de Progresso vermelha -->
                  <div v-if="item.section !== 'live'" class="tv-progress">
                    <i :style="{ width: Math.min(100, item.progressPct || 0) + '%' }" />
                  </div>
                </div>
              </template>
            </HorizontalRail>
          </section>

          <!-- 2. Filmes da sua lista -->
          <section
            v-if="vodShowcase.length > 0"
            data-focus-group="home-vod-row"
            class="space-y-3"
          >
            <div data-focus-row="header-vod" class="flex items-center justify-between">
              <h2 class="text-tv-row font-bold text-white tracking-tight">Filmes da sua lista</h2>
              <button
                id="home-see-all-vod"
                type="button"
                tabindex="-1"
                class="text-tv-xs text-neutral-400 hover:text-white flex items-center gap-1"
                @click="activeTab = 'vod'"
              >
                <span>Ver todos</span>
                <span>›</span>
              </button>
            </div>

            <HorizontalRail
              :items="vodRailItems"
              id-prefix="vod-card"
              :item-key="(it, idx) => it.stream_id || `see-all-${idx}`"
              :gap="1"
              @select="onVodRailSelect"
            >
              <template #item="{ item }">
                <!-- Card "Ver todos" -->
                <div
                  v-if="item.isSeeAll"
                  class="w-[10.5rem] h-[15.75rem] rounded-xl bg-[#141418] border border-white/10 flex flex-col items-center justify-center p-4 text-center group"
                >
                  <div class="w-12 h-12 rounded-full tv-glass flex items-center justify-center text-white mb-3">
                    <svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </div>
                  <span class="text-tv-sm font-bold text-white leading-snug">Ver todos os filmes</span>
                </div>

                <!-- Card Pôster 2:3 -->
                <div
                  v-else
                  class="w-[10.5rem] h-[15.75rem] rounded-xl overflow-hidden bg-[#141418] border border-white/10 relative"
                >
                  <img
                    v-if="item.image"
                    :src="item.image"
                    alt=""
                    loading="lazy"
                    decoding="async"
                    class="w-full h-full object-cover"
                    @error="$event.target.style.display = 'none'"
                  />
                  <div class="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent pointer-events-none" />
                  <span class="absolute bottom-2.5 left-3 right-3 text-tv-sm font-black uppercase tracking-tight text-white truncate drop-shadow">
                    {{ item.name }}
                  </span>
                </div>
              </template>
            </HorizontalRail>
          </section>

          <!-- 3. Séries da sua lista -->
          <section
            v-if="seriesShowcase.length > 0"
            data-focus-group="home-series-row"
            class="space-y-3"
          >
            <div data-focus-row="header-series" class="flex items-center justify-between">
              <h2 class="text-tv-row font-bold text-white tracking-tight">Séries da sua lista</h2>
              <button
                id="home-see-all-series"
                type="button"
                tabindex="-1"
                class="text-tv-xs text-neutral-400 hover:text-white flex items-center gap-1"
                @click="activeTab = 'series'"
              >
                <span>Ver todos</span>
                <span>›</span>
              </button>
            </div>

            <HorizontalRail
              :items="seriesRailItems"
              id-prefix="series-card"
              :item-key="(it, idx) => it.stream_id || `see-all-s-${idx}`"
              :gap="1"
              @select="onSeriesRailSelect"
            >
              <template #item="{ item }">
                <!-- Card "Ver todos" -->
                <div
                  v-if="item.isSeeAll"
                  class="w-[10.5rem] h-[15.75rem] rounded-xl bg-[#141418] border border-white/10 flex flex-col items-center justify-center p-4 text-center group"
                >
                  <div class="w-12 h-12 rounded-full tv-glass flex items-center justify-center text-white mb-3">
                    <svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </div>
                  <span class="text-tv-sm font-bold text-white leading-snug">Ver todas as séries</span>
                </div>

                <!-- Card Pôster 2:3 -->
                <div
                  v-else
                  class="w-[10.5rem] h-[15.75rem] rounded-xl overflow-hidden bg-[#141418] border border-white/10 relative"
                >
                  <img
                    v-if="item.image"
                    :src="item.image"
                    alt=""
                    loading="lazy"
                    decoding="async"
                    class="w-full h-full object-cover"
                    @error="$event.target.style.display = 'none'"
                  />
                  <div class="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent pointer-events-none" />
                  <span class="absolute bottom-2.5 left-3 right-3 text-tv-sm font-black uppercase tracking-tight text-white truncate drop-shadow">
                    {{ item.name }}
                  </span>
                </div>
              </template>
            </HorizontalRail>
          </section>

          <!-- 4. Canais da sua lista -->
          <section
            v-if="liveShowcase.length > 0"
            data-focus-group="home-live-row"
            class="space-y-3"
          >
            <div data-focus-row="header-live" class="flex items-center justify-between">
              <div class="flex items-center gap-2.5">
                <svg class="w-5 h-5 text-tv-accent shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M4.93 19.07A10 10 0 0 1 19.07 4.93" />
                  <path d="M7.76 16.24a6 6 0 0 1 8.48-8.48" />
                  <circle cx="12" cy="12" r="2" />
                </svg>
                <h2 class="text-tv-row font-bold text-white tracking-tight">Canais da sua lista</h2>
              </div>
              <button
                id="home-see-all-live"
                type="button"
                tabindex="-1"
                class="text-tv-xs text-neutral-400 hover:text-white flex items-center gap-1"
                @click="activeTab = 'live'"
              >
                <span>Explorar canais</span>
                <span>›</span>
              </button>
            </div>

            <HorizontalRail
              :items="liveRailItems"
              id-prefix="live-card"
              :item-key="(it, idx) => it.stream_id || `see-all-l-${idx}`"
              :gap="1"
              @select="onLiveRailSelect"
            >
              <template #item="{ item }">
                <!-- Card "Ver todos" -->
                <div
                  v-if="item.isSeeAll"
                  class="w-[16rem] h-[9rem] rounded-xl bg-[#141418] border border-white/10 flex flex-col items-center justify-center p-4 text-center group"
                >
                  <div class="w-10 h-10 rounded-full tv-glass flex items-center justify-center text-white mb-2">
                    <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </div>
                  <span class="text-tv-sm font-bold text-white">Explorar canais</span>
                </div>

                <!-- Card 16:9 Canal -->
                <div
                  v-else
                  class="w-[16rem] h-[9rem] rounded-xl bg-[#141418] border border-white/10 p-4 flex flex-col justify-between text-left overflow-hidden relative group"
                >
                  <div class="flex items-center justify-between">
                    <span class="text-tv-sm font-black tracking-tight uppercase truncate mr-2 text-white">{{ item.name || 'Canal' }}</span>
                    <span class="tv-badge-live px-2 py-0.5 rounded text-tv-xs font-bold uppercase tracking-wider shrink-0">
                      AO VIVO
                    </span>
                  </div>

                  <div class="min-w-0">
                    <p class="text-tv-sm font-medium text-white truncate">{{ item.program }}</p>
                    <p class="text-tv-xs text-neutral-400 mt-0.5 truncate">{{ item.schedule }}</p>
                  </div>

                  <div class="w-full h-[2px] bg-white/10 rounded-full overflow-hidden">
                    <div class="h-full w-2/5 bg-tv-accent" />
                  </div>
                </div>
              </template>
            </HorizontalRail>
          </section>
        </div>
      </div>
    </main>

    <!-- Gerenciador de listas -->
    <ListManagerModal ref="listModal" @changed="onListChanged" @logged-out="onLoggedOut" />

    <!-- Tela de Detalhes (Filmes e Séries) -->
    <MediaDetailsModal
      v-if="homeDetails"
      :item="homeDetails.item"
      :section="homeDetails.section"
      :category-id="ALL_CATEGORIES"
      :index-in-category="homeDetails.index"
      @close="homeDetails = null"
    />

    <!-- Escolha de perfil -->
    <ProfileGate @selected="onProfileSelected" />
  </div>
</template>
