<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/authStore'
import { usePlayerStore } from '@/stores/playerStore'
import { useCatalogStore } from '@/stores/catalogStore'
import { useProfileStore } from '@/stores/profileStore'
import SideMenu from '@/components/SideMenu.vue'
import BottomNav from '@/components/BottomNav.vue'
import { useFormFactor } from '@/composables/useFormFactor'
import { useParentalFilter } from '@/composables/useParentalFilter'
import { useParentalStore } from '@/stores/parentalStore'
import BrandMark from '@/components/BrandMark.vue'
import HorizontalRail from '@/components/ui/HorizontalRail.vue'
import CatalogBrowser from '@/components/CatalogBrowser.vue'
import ListManagerModal from '@/components/ListManagerModal.vue'
import SiteInboxPrompt from '@/components/SiteInboxPrompt.vue'
import MediaDetailsModal from '@/components/MediaDetailsModal.vue'
import ProfileGate from '@/components/ProfileGate.vue'
import SearchScreen from '@/components/SearchScreen.vue'
import AccountScreen from '@/components/AccountScreen.vue'
import { registerBackHandler, focusFirstIn } from '@/utils/spatialNavigation'
import { ALL_CATEGORIES } from '@/services/catalogDb'
import { formatTime } from '@/utils/formatTime'
import { pickArtwork } from '@/utils/artwork'
import { normalizeVodInfo, fetchVodInfo, fetchSeriesInfo } from '@/services/xtreamApi'
import { tabBackAction } from '@/utils/tabBack'
import { playHistoryItem } from '@/utils/seriesPlaylist'
import { useLicenseWatch } from '@/composables/useLicenseWatch'
import { useLicenseStore } from '@/stores/licenseStore'
import ActivationRequired from '@/views/ActivationRequired.vue'

const router = useRouter()
const auth = useAuthStore()
const license = useLicenseStore()
const player = usePlayerStore()
const catalog = useCatalogStore()
const parental = useParentalStore()

// Controle parental também em "Continuar assistindo" e "Minha lista" (auditoria RFC-025, item 9): item de categoria
// escondida ou bloqueada (sem PIN) não aparece nem toca por esses atalhos.
const blockedBySection = computed(() =>
  Object.fromEntries(['live', 'vod', 'series'].map((s) => [s, new Set(parental.blockedIds(s, catalog.categories[s]))])),
)
const allowedByParental = (it) => !blockedBySection.value[it.section]?.has(String(it.category_id))
const visibleHistory = computed(() => player.watchHistory.filter(allowedByParental))
const visibleQueue = computed(() => player.customQueue.filter(allowedByParental))
const profileStore = useProfileStore()
const { layout } = useFormFactor()
// Celular/tablet (em pé ou deitado): barra de baixo + busca flutuante no topo; a TV fica com o menu lateral.
const handheld = computed(() => layout.value !== 'tv')
useLicenseWatch(
  () => auth.session,
  () => ['live', 'vod', 'series'].some((s) => catalog.status[s].state === 'ready'),
)
// RFC-018: nunca interrompe um vídeo que já está tocando, nem a escolha de perfil (o foco iria para trás dela).
const showActivation = computed(
  () => !player.isOpen && !profileStore.isProfileGateOpen && license.shouldBlock(auth.session),
)

// Abas de Navegação ('home' | 'live' | 'vod' | 'series' | 'favorites' | 'search' | 'account')
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
  () => visibleHistory.value.find((it) => it.section !== 'live') || visibleHistory.value[0] || null,
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
  // Em maiúsculas só pelo CSS (TV); no celular em pé o selo aparece como frase (mockup da RFC-023).
  if (recentHistoryItem.value) return 'Continuar assistindo'
  const it = heroItem.value
  if (!it) return 'Da sua lista'
  if (it.section === 'series') return 'Série da sua lista'
  if (it.section === 'live') return 'Canal da sua lista'
  return 'Filme da sua lista'
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
  // Em pé os três botões dividem a largura: texto curto para caber no botão verde.
  if (layout.value === 'phone-portrait') return recentHistoryItem.value ? 'Continuar' : 'Assistir'
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

async function loadSectionsInOrder(sections) {
  for (const section of sections) await catalog.loadSection(section)
}

/**
 * Carrega as seções do catálogo e monta as fileiras do Início.
 */
let showcaseRequest = 0

async function loadCatalogShowcase({ reset = false } = {}) {
  // Trocar de lista no meio da leitura: só a leitura mais nova grava as fileiras (senão aparecem itens da lista antiga).
  const my = ++showcaseRequest
  const stale = () => my !== showcaseRequest
  if (reset) {
    vodShowcase.value = []
    seriesShowcase.value = []
    liveShowcase.value = []
  }

  // Uma seção por vez: três JSON de 50 mil itens juntos estouram a memória da TV e o limite de conexões do painel.
  await loadSectionsInOrder(['vod', 'series', 'live'].filter((s) => catalog.status[s].state === 'idle'))

  try {
    const vodItems = await catalog.getItems('vod', ALL_CATEGORIES, 0, 20)
    if (!stale() && vodItems && vodItems.length > 0) {
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
    if (!stale() && seriesItems && seriesItems.length > 0) {
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
    if (!stale() && liveItems && liveItems.length > 0) {
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

// Controle parental: categoria escondida/bloqueada some do Início assim que muda.
useParentalFilter(() => loadCatalogShowcase())

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
  player.playFromCustomQueue(item, allowedByParental)
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
  listModal.value?.close() // lista aceita pela pergunta global com o Gerenciador aberto
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

let unmounted = false

onMounted(async () => {
  await profileStore.hydrate()
  await player.hydrate()
  await auth.hydrate()
  await loadCatalogShowcase()
  // A tela pode ter saído durante as esperas (logout rápido): não registra "voltar" nem foca numa tela que já não existe.
  if (unmounted) return

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
  unmounted = true
  if (cleanupRootBack) cleanupRootBack()
})
</script>

<template>
  <div class="w-full h-full flex bg-tv-deep text-white overflow-hidden select-none relative">
    <!-- Celular/tablet: barra de baixo (busca dentro do destaque e no cabeçalho das abas). TV: menu lateral recolhido (Layout B). -->
    <BottomNav v-if="handheld" :active-tab="activeTab" @navigate="activeTab = $event" />
    <SideMenu
      v-if="!handheld"
      :active-tab="activeTab"
      :profile="profileStore.activeProfile"
      :list-label="auth.activeListLabel || auth.username || ''"
      @navigate="activeTab = $event"
      @manage-lists="openListModal"
      @switch-profile="openProfileGate"
    />

    <!-- Área de Conteúdo Principal (espaçada à esquerda pelo menu lateral recolhido de 7rem; no celular, acima do menu inferior) -->
    <main class="flex-1 min-w-0 h-full pl-[7rem] phone:pl-0 phone:pb-[calc(4.6rem+env(safe-area-inset-bottom))] flex flex-col overflow-hidden relative">
      <!-- Aba TV ao Vivo -->
      <div v-if="activeTab === 'live'" class="w-full h-full">
        <CatalogBrowser section="live" @search="activeTab = 'search'" />
      </div>

      <!-- Aba Filmes -->
      <div v-else-if="activeTab === 'vod'" class="w-full h-full">
        <CatalogBrowser section="vod" @search="activeTab = 'search'" />
      </div>

      <!-- Aba Séries -->
      <div v-else-if="activeTab === 'series'" class="w-full h-full">
        <CatalogBrowser section="series" @search="activeTab = 'search'" />
      </div>

      <!-- Aba Busca -->
      <div v-else-if="activeTab === 'search'" class="w-full h-full">
        <SearchScreen />
      </div>

      <!-- Aba Conta (só celular/tablet) -->
      <AccountScreen
        v-else-if="activeTab === 'account'"
        :profile="profileStore.activeProfile"
        :list-label="auth.activeListLabel || auth.username || ''"
        @navigate="activeTab = $event"
        @manage-lists="openListModal"
        @switch-profile="openProfileGate"
      />

      <!-- Aba Minha lista (Favoritos) -->
      <div
        v-else-if="activeTab === 'favorites'"
        class="flex flex-col h-full pl-16 pr-24 py-14 phone:px-4 phone:py-6 overflow-y-auto"
        data-focus-group="favorites-view"
      >
        <div class="flex items-center justify-between mb-8 phone:mb-5 phone-portrait:flex-col phone-portrait:items-start phone-portrait:gap-y-4">
          <div>
            <h1 class="text-tv-xl font-bold text-white tracking-tight">Favoritos</h1>
            <p class="text-tv-sm text-neutral-400 mt-1">Seus títulos favoritos, em um só lugar.</p>
          </div>
          <div v-if="visibleQueue.length > 0" class="flex items-center gap-4">
            <button
              id="fav-play-all"
              type="button"
              class="tv-btn tv-btn-primary !px-6 !py-2.5 text-tv-sm flex items-center gap-2 whitespace-nowrap"
              @click="player.playFromCustomQueue(null, allowedByParental)"
            >
              <svg class="w-4 h-4 fill-black" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              <span>Reproduzir Tudo</span>
            </button>
            <button
              id="fav-clear"
              type="button"
              class="tv-btn !px-5 !py-2.5 text-tv-sm text-neutral-400 hover:text-white whitespace-nowrap"
              @click="player.clearCustomQueue()"
            >
              Limpar Lista
            </button>
          </div>
        </div>

        <!-- Estado Vazio -->
        <div
          v-if="visibleQueue.length === 0"
          class="flex flex-col items-center justify-center flex-1 py-28 text-center"
        >
          <svg class="w-10 h-10 text-neutral-500 stroke-[1.5] mb-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path d="M12 20s-7-4.5-7-10a4 4 0 017-2.5A4 4 0 0119 10c0 5.5-7 10-7 10z" />
          </svg>
          <p class="text-tv-base font-medium text-neutral-200">Sua lista está vazia</p>
          <p class="text-tv-sm text-neutral-500 mt-1">Adicione filmes, séries e canais para assistir quando quiser.</p>
        </div>

        <!-- Grade de Cards da Minha Lista -->
        <div v-else class="grid grid-cols-4 phone-portrait:grid-cols-2 gap-5 phone:gap-3">
          <div
            v-for="item in visibleQueue"
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
        <div class="relative w-full min-h-[31rem] px-16 pt-10 pb-14 phone-portrait:min-h-[34rem] phone-portrait:px-5 phone-portrait:pt-0 phone-portrait:pb-4 flex flex-col justify-end overflow-hidden">
          <!-- Celular/tablet: busca dentro do destaque, rolando junto com ele -->
          <button
            v-if="handheld"
            id="phone-search"
            type="button"
            class="tv-focusable absolute z-10 left-4 right-4 top-3 max-w-xl mx-auto h-11 flex items-center px-4 rounded-full bg-black/45 border border-white/15 text-neutral-200 phone:text-[0.95rem]"
            @click="activeTab = 'search'"
          >
            <svg class="w-5 h-5 mr-2.5 stroke-current fill-none stroke-[2] shrink-0" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" />
            </svg>
            <span>Buscar filmes, séries e canais</span>
          </button>
          <!-- Arte de fundo com vinheta cinematográfica -->
          <div class="absolute inset-0 pointer-events-none overflow-hidden">
            <img
              v-if="heroArtwork.url"
              :key="heroArtwork.url"
              :src="heroArtwork.url"
              alt=""
              class="absolute right-0 top-0 w-[68%] phone-portrait:w-full h-full object-cover object-center pointer-events-none"
              :class="heroArtwork.mode === 'backdrop' ? 'opacity-65' : 'opacity-35 scale-105'"
              @error="heroArtworkFailed = true"
            />
            <div
              v-else
              class="absolute inset-0 bg-[radial-gradient(ellipse_at_70%_40%,#0e7490_0%,#164e63_25%,#0b1220_52%,#0b0f0c_78%)] opacity-80"
            />
            <!-- Vinheta 2.0 (fusão à esquerda e na base); em pé a imagem ocupa a largura e funde só na base -->
            <div class="absolute inset-0 tv-vignette phone-portrait:hidden pointer-events-none" />
            <div class="hidden phone-portrait:block absolute inset-0 bg-gradient-to-b from-tv-deep/50 via-transparent via-45% to-tv-deep pointer-events-none" />
          </div>

          <!-- Conteúdo do Hero -->
          <div class="relative z-10 max-w-[44rem] space-y-3.5 phone-portrait:space-y-2.5">
            <!-- Selo superior com o símbolo da marca -->
            <div class="flex items-center gap-2.5">
              <BrandMark :size="1.25" class="text-tv-accent" />
              <span class="text-tv-xs font-bold tracking-[0.22em] text-neutral-300 uppercase phone-portrait:text-[0.85rem] phone-portrait:font-semibold phone-portrait:tracking-normal phone-portrait:normal-case phone-portrait:text-neutral-400">
                {{ heroBadgeLabel }}
              </span>
            </div>

            <!-- Título Principal -->
            <h1 class="text-tv-hero font-black uppercase text-white line-clamp-2 phone-portrait:text-[2.2rem] phone-portrait:leading-[1.05] phone-portrait:normal-case">
              {{ heroTitle }}
            </h1>

            <!-- Linha de Metadados -->
            <div class="flex items-center gap-3 text-tv-xs text-tv-meta font-medium flex-wrap phone-portrait:text-[0.85rem]">
              <span v-if="heroRating" class="text-[#4ade80] font-bold">{{ heroRating }}</span>
              <span v-if="heroRating && (heroYear || heroDuration)" class="w-1 h-1 rounded-full bg-neutral-500" />
              <span v-if="heroYear">{{ heroYear }}</span>
              <span v-if="heroYear && heroDuration" class="w-1 h-1 rounded-full bg-neutral-500" />
              <span>{{ heroDuration }}</span>
              <span v-if="heroGenre" class="truncate">{{ heroGenre }}</span>
            </div>

            <!-- Sinopse -->
            <p class="text-tv-sm text-tv-meta leading-relaxed line-clamp-3 max-w-[34rem] phone-portrait:hidden">
              {{ heroSynopsis }}
            </p>

            <!-- Linha de Ações do Hero -->
            <div data-focus-row="hero-actions" class="flex items-center gap-3.5 pt-2 w-max phone-portrait:w-full phone-portrait:gap-2.5">
              <button
                id="hero-play"
                type="button"
                class="tv-focusable h-[3.2rem] px-7 rounded-lg bg-white text-black font-bold text-tv-sm flex items-center gap-2.5 whitespace-nowrap phone-portrait:flex-1 phone-portrait:justify-center phone-portrait:px-3 phone-portrait:rounded-xl phone-portrait:bg-tv-accent phone-portrait:text-tv-on-accent phone-portrait:text-[0.95rem]"
                @click="handleHeroPlay"
              >
                <svg class="w-4 h-4 fill-current shrink-0" viewBox="0 0 24 24">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
                <span>{{ heroPlayButtonText }}</span>
              </button>

              <button
                id="hero-info"
                type="button"
                class="tv-focusable h-[3.2rem] px-6 rounded-lg tv-btn-glass font-medium text-tv-sm flex items-center gap-2.5 whitespace-nowrap phone-portrait:flex-1 phone-portrait:justify-center phone-portrait:px-3 phone-portrait:rounded-xl phone-portrait:text-[0.95rem]"
                @click="handleHeroInfo"
              >
                <svg class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="16" x2="12" y2="12" />
                  <line x1="12" y1="8" x2="12.01" y2="8" />
                </svg>
                <span v-if="heroItem?.section === 'series'">Episódios</span>
                <template v-else>
                  <span class="phone-portrait:hidden">Mais informações</span>
                  <span class="hidden phone-portrait:inline">Detalhes</span>
                </template>
              </button>

              <button
                id="hero-mylist"
                type="button"
                class="tv-focusable h-[3.2rem] px-6 rounded-lg tv-btn-glass font-medium text-tv-sm flex items-center gap-2.5 whitespace-nowrap phone-portrait:w-[3.2rem] phone-portrait:px-0 phone-portrait:justify-center phone-portrait:rounded-xl"
                :aria-label="isHeroBookmarked ? 'Nos favoritos' : 'Favoritos'"
                @click="handleHeroBookmark"
              >
                <svg class="w-4 h-4 shrink-0" :class="isHeroBookmarked ? 'text-tv-accent' : ''" viewBox="0 0 24 24" :fill="isHeroBookmarked ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="2" stroke-linejoin="round">
                <path d="M12 20s-7-4.5-7-10a4 4 0 017-2.5A4 4 0 0119 10c0 5.5-7 10-7 10z" />
              </svg>
                <span class="phone-portrait:hidden">{{ isHeroBookmarked ? 'Nos favoritos' : 'Favoritos' }}</span>
              </button>
            </div>
          </div>
        </div>

        <!-- Fileiras Deslizantes (Horizontais) -->
        <div class="pl-16 pr-24 space-y-7 -mt-4 pb-20 phone-portrait:pl-5 phone-portrait:pr-0 phone-portrait:space-y-5 phone-portrait:mt-2 phone-portrait:pb-6 relative z-20">
          <!-- Falha ao carregar a lista -->
          <section v-if="homeError" data-focus-group="home-error" class="space-y-2" role="alert">
            <h2 class="text-tv-row font-bold text-white tracking-tight phone-portrait:text-[1.15rem] phone-portrait:font-extrabold">Não foi possível carregar sua lista</h2>
            <p class="text-tv-sm text-neutral-400">{{ homeError }}</p>
            <button id="home-retry" type="button" class="tv-btn tv-btn-primary mt-2" @click="retryHome">
              Tentar novamente
            </button>
          </section>

          <!-- 1. Continuar assistindo -->
          <section
            v-if="visibleHistory.length > 0"
            data-focus-group="continue-watching"
            class="space-y-3"
          >
            <div data-focus-row="header-history" class="flex items-center justify-between phone-portrait:pr-5">
              <h2 class="text-tv-row font-bold text-white tracking-tight phone-portrait:text-[1.15rem] phone-portrait:font-extrabold">Continuar assistindo</h2>
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
              :items="visibleHistory"
              id-prefix="history-card"
              :item-key="(it) => `${it.stream_id}:${it.section}`"
              :gap="1"
              @select="onHistoryRailSelect"
            >
              <template #item="{ item }">
                <div class="w-[16rem] h-[9rem] phone-portrait:w-[15rem] phone-portrait:h-[8.5rem] rounded-xl bg-[#141418] border border-white/10 relative overflow-hidden group">
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
                  <span class="absolute bottom-2.5 left-3 right-3 text-tv-sm font-black uppercase tracking-tight text-white truncate drop-shadow phone-portrait:text-[0.8rem] phone-portrait:normal-case phone-portrait:left-2.5 phone-portrait:right-2.5">
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
            <div data-focus-row="header-vod" class="flex items-center justify-between phone-portrait:pr-5">
              <h2 class="text-tv-row font-bold text-white tracking-tight phone-portrait:text-[1.15rem] phone-portrait:font-extrabold">Filmes da sua lista</h2>
              <button
                id="home-see-all-vod"
                type="button"
                tabindex="-1"
                class="text-tv-xs text-neutral-400 hover:text-white flex items-center gap-1 phone-portrait:text-[0.85rem]"
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
                  class="w-[10.5rem] h-[15.75rem] phone-portrait:w-[7.2rem] phone-portrait:h-[10.8rem] rounded-xl bg-[#141418] border border-white/10 flex flex-col items-center justify-center p-4 text-center group"
                >
                  <div class="w-12 h-12 rounded-full tv-glass flex items-center justify-center text-white mb-3">
                    <svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </div>
                  <span class="text-tv-sm font-bold text-white leading-snug phone-portrait:text-[0.85rem]">Ver todos os filmes</span>
                </div>

                <!-- Card Pôster 2:3 -->
                <div
                  v-else
                  class="w-[10.5rem] h-[15.75rem] phone-portrait:w-[7.2rem] phone-portrait:h-[10.8rem] rounded-xl overflow-hidden bg-[#141418] border border-white/10 relative"
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
                  <span class="absolute bottom-2.5 left-3 right-3 text-tv-sm font-black uppercase tracking-tight text-white truncate drop-shadow phone-portrait:text-[0.8rem] phone-portrait:normal-case phone-portrait:left-2.5 phone-portrait:right-2.5">
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
            <div data-focus-row="header-series" class="flex items-center justify-between phone-portrait:pr-5">
              <h2 class="text-tv-row font-bold text-white tracking-tight phone-portrait:text-[1.15rem] phone-portrait:font-extrabold">Séries da sua lista</h2>
              <button
                id="home-see-all-series"
                type="button"
                tabindex="-1"
                class="text-tv-xs text-neutral-400 hover:text-white flex items-center gap-1 phone-portrait:text-[0.85rem]"
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
                  class="w-[10.5rem] h-[15.75rem] phone-portrait:w-[7.2rem] phone-portrait:h-[10.8rem] rounded-xl bg-[#141418] border border-white/10 flex flex-col items-center justify-center p-4 text-center group"
                >
                  <div class="w-12 h-12 rounded-full tv-glass flex items-center justify-center text-white mb-3">
                    <svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </div>
                  <span class="text-tv-sm font-bold text-white leading-snug phone-portrait:text-[0.85rem]">Ver todas as séries</span>
                </div>

                <!-- Card Pôster 2:3 -->
                <div
                  v-else
                  class="w-[10.5rem] h-[15.75rem] phone-portrait:w-[7.2rem] phone-portrait:h-[10.8rem] rounded-xl overflow-hidden bg-[#141418] border border-white/10 relative"
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
                  <span class="absolute bottom-2.5 left-3 right-3 text-tv-sm font-black uppercase tracking-tight text-white truncate drop-shadow phone-portrait:text-[0.8rem] phone-portrait:normal-case phone-portrait:left-2.5 phone-portrait:right-2.5">
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
            <div data-focus-row="header-live" class="flex items-center justify-between phone-portrait:pr-5">
              <div class="flex items-center gap-2.5">
                <svg class="w-5 h-5 text-tv-accent shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M4.93 19.07A10 10 0 0 1 19.07 4.93" />
                  <path d="M7.76 16.24a6 6 0 0 1 8.48-8.48" />
                  <circle cx="12" cy="12" r="2" />
                </svg>
                <h2 class="text-tv-row font-bold text-white tracking-tight phone-portrait:text-[1.15rem] phone-portrait:font-extrabold">Canais da sua lista</h2>
              </div>
              <button
                id="home-see-all-live"
                type="button"
                tabindex="-1"
                class="text-tv-xs text-neutral-400 hover:text-white flex items-center gap-1 phone-portrait:text-[0.85rem]"
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
                  class="w-[16rem] h-[9rem] phone-portrait:w-[15rem] phone-portrait:h-[8.5rem] rounded-xl bg-[#141418] border border-white/10 flex flex-col items-center justify-center p-4 text-center group"
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
                  class="w-[16rem] h-[9rem] phone-portrait:w-[15rem] phone-portrait:h-[8.5rem] rounded-xl bg-[#141418] border border-white/10 p-4 flex flex-col justify-between text-left overflow-hidden relative group"
                >
                  <div class="flex items-center justify-between">
                    <span class="text-tv-sm font-black tracking-tight uppercase truncate mr-2 text-white phone-portrait:text-[0.9rem] phone-portrait:normal-case">{{ item.name || 'Canal' }}</span>
                    <span class="tv-badge-live px-2 py-0.5 rounded text-tv-xs font-bold uppercase tracking-wider shrink-0 phone-portrait:text-[0.68rem] phone-portrait:px-1.5">
                      AO VIVO
                    </span>
                  </div>

                  <div class="min-w-0">
                    <p class="text-tv-sm font-medium text-white truncate phone-portrait:text-[0.85rem]">{{ item.program }}</p>
                    <p class="text-tv-xs text-neutral-400 mt-0.5 truncate phone-portrait:text-[0.78rem]">{{ item.schedule }}</p>
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
    <ActivationRequired
      v-if="showActivation"
      :code="license.code"
      :reason="license.blockReason(auth.session)"
      @retry="license.refresh(auth.session)"
      @manage-lists="openListModal"
    />
    <ListManagerModal ref="listModal" @changed="onListChanged" @logged-out="onLoggedOut" />
    <!-- RFC-021/025: lista enviada pelo site (ou pela automação do sócio) aparece em qualquer tela, não só no Gerenciador -->
    <SiteInboxPrompt :hint="false" @done="onListChanged" />

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
