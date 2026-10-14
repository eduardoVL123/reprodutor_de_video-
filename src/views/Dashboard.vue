<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/authStore'
import { usePlayerStore } from '@/stores/playerStore'
import { useCatalogStore } from '@/stores/catalogStore'
import { useProfileStore, PROFILE_COLORS } from '@/stores/profileStore'
import { fetchSeriesInfo } from '@/services/xtreamApi'
import CatalogBrowser from '@/components/CatalogBrowser.vue'
import { registerBackHandler, pushFocusScope, focusFirstIn } from '@/utils/spatialNavigation'
import { ALL_CATEGORIES } from '@/services/catalogDb'

const router = useRouter()
const auth = useAuthStore()
const player = usePlayerStore()
const catalog = useCatalogStore()
const profileStore = useProfileStore()

// Abas de Navegação ('home' | 'live' | 'vod' | 'series' | 'favorites')
const activeTab = ref('home')

// Modal de Gerenciamento de Listas
const isListModalOpen = ref(false)
const listFormError = ref('')
const isConnecting = ref(false)
const isSwitching = ref(false)
let listTriggerId = 'btn-manage-lists'
const listForm = ref({
  label: '',
  dns: '',
  username: '',
  password: '',
})

// Perfis ("Quem está assistindo?")
const isAddProfileOpen = ref(false)
const newProfileName = ref('')
const newProfileColor = ref(PROFILE_COLORS[0])
let popProfileGateScope = null
let profileTriggerId = 'btn-switch-profile'

// Modal de Detalhes da Série (Temporadas e Episódios)
const isSeriesModalOpen = ref(false)
const selectedSeries = ref(null)
const seriesInfo = ref(null)
const loadingSeriesInfo = ref(false)
const activeSeasonNumber = ref(1)
let popSeriesScope = null
let seriesTriggerId = ''

// Scopes de foco e back handlers
let popModalScope = null
let cleanupRootBack = null
let cleanupModalBack = null

// Item mais recente para Hero Banner
const recentHistoryItem = computed(() => {
  return player.watchHistory.length > 0 ? player.watchHistory[0] : null
})

// Imagem de fundo do Hero
const heroBackground = computed(() => {
  if (recentHistoryItem.value && recentHistoryItem.value.stream_icon) {
    return recentHistoryItem.value.stream_icon
  }
  return 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=1920&q=80'
})

// Showcase carregado do catálogo
const vodShowcase = ref([])
const liveShowcase = ref([])

// Showcase padrão com streams públicos HTTPS e CORS liberado (RFC-004 fix)
const defaultVodCards = [
  {
    stream_id: 'sample-vod-1',
    name: 'Além do Horizonte',
    section: 'vod',
    stream_icon: 'https://storage.googleapis.com/gtv-videos-bucket/sample/images/BigBuckBunny.jpg',
    image: 'https://storage.googleapis.com/gtv-videos-bucket/sample/images/BigBuckBunny.jpg',
    badge: 'EM DESTAQUE',
    subtitle: '2026 · Ficção Científica',
    directUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
    container_extension: 'mp4',
  },
  {
    stream_id: 'sample-vod-2',
    name: 'Órbita',
    section: 'vod',
    stream_icon: 'https://storage.googleapis.com/gtv-videos-bucket/sample/images/ElephantsDream.jpg',
    image: 'https://storage.googleapis.com/gtv-videos-bucket/sample/images/ElephantsDream.jpg',
    badge: 'NOVO',
    subtitle: '2026 · Suspense',
    directUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4',
    container_extension: 'mp4',
  },
  {
    stream_id: 'sample-vod-3',
    name: 'Depois da Meia-Noite',
    section: 'vod',
    stream_icon: 'https://storage.googleapis.com/gtv-videos-bucket/sample/images/ForBiggerBlazes.jpg',
    image: 'https://storage.googleapis.com/gtv-videos-bucket/sample/images/ForBiggerBlazes.jpg',
    badge: 'EM DESTAQUE',
    subtitle: '2025 · Drama',
    directUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
    container_extension: 'mp4',
  },
  {
    stream_id: 'sample-vod-4',
    name: 'Mar Aberto',
    section: 'vod',
    stream_icon: 'https://storage.googleapis.com/gtv-videos-bucket/sample/images/ForBiggerEscapes.jpg',
    image: 'https://storage.googleapis.com/gtv-videos-bucket/sample/images/ForBiggerEscapes.jpg',
    badge: 'POPULAR',
    subtitle: '2026 · Ação',
    directUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4',
    container_extension: 'mp4',
  },
]

const defaultLiveCards = [
  {
    stream_id: 'sample-live-1',
    name: 'NEUTRO NEWS',
    section: 'live',
    firstName: 'NEUTRO',
    secondName: 'NEWS',
    program: 'Jornal Edição Noite',
    schedule: '20:00 - 21:30 · Notícias',
    stream_icon: 'https://storage.googleapis.com/gtv-videos-bucket/sample/images/ForBiggerFun.jpg',
    directUrl: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
    container_extension: 'm3u8',
  },
  {
    stream_id: 'sample-live-2',
    name: 'ARENA SPORT',
    section: 'live',
    firstName: 'ARENA',
    secondName: 'SPORT',
    program: 'Liga dos Campeões Ao Vivo',
    schedule: 'Transmissão em 4K · Esportes',
    stream_icon: 'https://storage.googleapis.com/gtv-videos-bucket/sample/images/ForBiggerJoyBlazes.jpg',
    directUrl: 'https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8',
    container_extension: 'm3u8',
  },
  {
    stream_id: 'sample-live-3',
    name: 'CINE PRIME',
    section: 'live',
    firstName: 'CINE',
    secondName: 'PRIME',
    program: 'Festival Grandes Diretores',
    schedule: '19:45 - 22:15 · Cinema',
    stream_icon: 'https://storage.googleapis.com/gtv-videos-bucket/sample/images/TearsOfSteel.jpg',
    directUrl: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
    container_extension: 'm3u8',
  },
  {
    stream_id: 'sample-live-4',
    name: 'LIFE TV',
    section: 'live',
    firstName: 'LIFE',
    secondName: 'TV',
    program: 'Planeta Selvagem: Oceanos',
    schedule: 'Docu-série · Natureza',
    stream_icon: 'https://storage.googleapis.com/gtv-videos-bucket/sample/images/Sintel.jpg',
    directUrl: 'https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8',
    container_extension: 'm3u8',
  },
]

// Temporadas e Episódios da Série Ativa
const availableSeasons = computed(() => {
  if (!seriesInfo.value || !Array.isArray(seriesInfo.value.seasons) || seriesInfo.value.seasons.length === 0) {
    return [{ season_number: 1, name: 'Temporada 1', episode_count: 8 }]
  }
  return seriesInfo.value.seasons
})

const episodesForActiveSeason = computed(() => {
  if (!seriesInfo.value || !seriesInfo.value.episodes) return []
  const eps = seriesInfo.value.episodes[String(activeSeasonNumber.value)] || []
  return Array.isArray(eps) ? eps : []
})

const displayVodCards = computed(() => {
  return vodShowcase.value.length >= 4 ? vodShowcase.value : defaultVodCards
})

const displayLiveCards = computed(() => {
  return liveShowcase.value.length >= 4 ? liveShowcase.value : defaultLiveCards
})

async function loadCatalogShowcase(force = false) {
  if (force) {
    vodShowcase.value = []
    liveShowcase.value = []
  }
  try {
    const vodItems = await catalog.getItems('vod', ALL_CATEGORIES, 0, 4)
    if (vodItems && vodItems.length > 0) {
      vodShowcase.value = vodItems.map((item, idx) => ({
        stream_id: item.stream_id,
        name: item.name,
        section: 'vod',
        image: item.stream_icon || item.cover,
        stream_icon: item.stream_icon || item.cover,
        badge: idx === 0 ? 'EM DESTAQUE' : idx === 1 ? 'NOVO' : '4K',
        subtitle: 'Filme · 4K UHD',
        rawItem: item,
      }))
    }
  } catch (_) {}

  try {
    const liveItems = await catalog.getItems('live', ALL_CATEGORIES, 0, 4)
    if (liveItems && liveItems.length > 0) {
      liveShowcase.value = liveItems.map((item) => {
        const parts = (item.name || '').trim().split(' ')
        const firstName = parts[0] || 'CANAL'
        const secondName = parts.slice(1).join(' ') || 'HD'
        return {
          stream_id: item.stream_id,
          name: item.name,
          section: 'live',
          firstName,
          secondName,
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

function toggleCardBookmark(card) {
  const itemToToggle = card.rawItem || {
    stream_id: card.stream_id,
    name: card.name,
    stream_icon: card.stream_icon || card.image,
    section: card.section || 'vod',
    directUrl: card.directUrl,
  }
  if (player.isInCustomQueue(itemToToggle, itemToToggle.section)) {
    player.removeFromCustomQueue(itemToToggle.stream_id, itemToToggle.section)
  } else {
    player.enqueueItem(itemToToggle, itemToToggle.section)
  }
}

function handleHeroPlay() {
  if (recentHistoryItem.value) {
    player.playItem(recentHistoryItem.value)
    return
  }
  const heroCard = displayVodCards.value[0]
  if (heroCard) {
    handleCardPlay(heroCard, 'vod')
  }
}

function handleHeroBookmark() {
  const item = recentHistoryItem.value || displayVodCards.value[0]
  if (item) {
    toggleCardBookmark(item)
  }
}

function formatTime(sec) {
  if (!sec || isNaN(sec) || sec < 0) return '00:00'
  const s = Math.floor(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const remS = s % 60
  const pad = (n) => String(n).padStart(2, '0')
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(remS)}` : `${pad(m)}:${pad(remS)}`
}

function getRemainingText(item) {
  if (!item.duration || item.duration <= 0) return ''
  const remSec = Math.max(0, item.duration - (item.currentTime || 0))
  const remMin = Math.ceil(remSec / 60)
  return `Faltam ${remMin} min`
}

async function logout() {
  await auth.logout()
  await router.replace({ name: 'login' })
}

function openListModal() {
  listTriggerId = document.activeElement?.id || 'btn-manage-lists'
  isListModalOpen.value = true
  listFormError.value = ''
  listForm.value = { label: '', dns: '', username: '', password: '' }

  nextTick(() => {
    const el = document.getElementById('modal-lists')
    if (el) {
      if (popModalScope) popModalScope()
      popModalScope = pushFocusScope(el)
      focusFirstIn(el)
    }
  })

  if (cleanupModalBack) cleanupModalBack()
  cleanupModalBack = registerBackHandler(() => {
    if (isListModalOpen.value) {
      closeListModal()
      return true
    }
    return false
  })
}

function closeListModal() {
  isListModalOpen.value = false
  if (popModalScope) {
    popModalScope()
    popModalScope = null
  }
  if (cleanupModalBack) {
    cleanupModalBack()
    cleanupModalBack = null
  }
  const idToFocus = listTriggerId || 'btn-manage-lists'
  nextTick(() => {
    document.getElementById(idToFocus)?.focus()
  })
}

async function handleSwitchList(listId) {
  try {
    isSwitching.value = true
    listFormError.value = ''
    const ok = await auth.switchList(listId)
    if (!ok) {
      listFormError.value = auth.error || 'Não foi possível alternar para a lista selecionada.'
      return
    }
    vodShowcase.value = []
    liveShowcase.value = []
    closeListModal()
    activeTab.value = 'home'
    catalog.loadSection('vod', { force: true })
    catalog.loadSection('live', { force: true })
    catalog.loadSection('series', { force: true })
    await loadCatalogShowcase(true)
  } catch (err) {
    listFormError.value = err.message || 'Falha ao alternar para a lista selecionada.'
  } finally {
    isSwitching.value = false
  }
}

async function handleRemoveList(listId) {
  try {
    listFormError.value = ''
    await auth.removeList(listId)
  } catch (err) {
    listFormError.value = err.message || 'Falha ao excluir a lista.'
  }
}

async function handleAddNewList() {
  if (!listForm.value.dns) {
    listFormError.value = 'Informe o Link Curto ou URL do Servidor.'
    return
  }

  try {
    isConnecting.value = true
    listFormError.value = ''
    const ok = await auth.login({
      dns: listForm.value.dns,
      username: listForm.value.username,
      password: listForm.value.password,
      label: listForm.value.label || '',
    })
    if (!ok) {
      listFormError.value = auth.error || 'Não foi possível conectar a esta lista. Verifique os dados.'
      return
    }
    vodShowcase.value = []
    liveShowcase.value = []
    closeListModal()
    activeTab.value = 'home'
    catalog.loadSection('vod', { force: true })
    catalog.loadSection('live', { force: true })
    catalog.loadSection('series', { force: true })
    await loadCatalogShowcase(true)
  } catch (err) {
    listFormError.value = err.message || 'Falha ao conectar com o servidor.'
  } finally {
    isConnecting.value = false
  }
}

// ---------- Gerenciamento de Perfis ("Quem está assistindo?") ----------
function openProfileGate() {
  profileTriggerId = document.activeElement?.id || 'btn-switch-profile'
  profileStore.openProfileGate()
}

async function handleSelectProfile(profileId) {
  await profileStore.selectProfile(profileId)
  if (popProfileGateScope) {
    popProfileGateScope()
    popProfileGateScope = null
  }
  nextTick(() => {
    const heroBtn = document.getElementById('hero-play')
    if (heroBtn) heroBtn.focus()
    else focusFirstIn('[data-focus-group="top-nav"]')
  })
}

function openAddProfileModal() {
  newProfileName.value = ''
  newProfileColor.value = PROFILE_COLORS[profileStore.profiles.length % PROFILE_COLORS.length]
  isAddProfileOpen.value = true
  nextTick(() => {
    document.getElementById('input-profile-name')?.focus()
  })
}

function closeAddProfileModal() {
  isAddProfileOpen.value = false
  nextTick(() => {
    document.getElementById('btn-add-profile-card')?.focus()
  })
}

async function handleCreateProfile() {
  const name = newProfileName.value.trim()
  if (!name) return
  const created = await profileStore.addProfile({ name, color: newProfileColor.value })
  isAddProfileOpen.value = false
  if (created) {
    await handleSelectProfile(created.id)
  }
}

watch(
  () => profileStore.isProfileGateOpen,
  (open) => {
    if (open) {
      nextTick(() => {
        const el = document.getElementById('profile-gate-overlay')
        if (el) {
          if (popProfileGateScope) popProfileGateScope()
          popProfileGateScope = pushFocusScope(el)
          focusFirstIn(el)
        }
      })
    } else {
      if (popProfileGateScope) {
        popProfileGateScope()
        popProfileGateScope = null
      }
    }
  },
  { immediate: true },
)

// ---------- Detalhes da Série (Temporadas e Episódios) ----------
async function onSelectSeries({ item }) {
  if (!item) return
  seriesTriggerId = document.activeElement?.id || ''
  selectedSeries.value = item
  isSeriesModalOpen.value = true
  loadingSeriesInfo.value = true
  seriesInfo.value = null
  activeSeasonNumber.value = 1

  try {
    const sId = item.stream_id !== undefined ? item.stream_id : item.series_id
    const data = await fetchSeriesInfo({
      apiBase: auth.apiBase,
      credentials: auth.credentials,
      seriesId: sId,
    })
    seriesInfo.value = data
    if (data && Array.isArray(data.seasons) && data.seasons.length > 0) {
      activeSeasonNumber.value = data.seasons[0].season_number || 1
    }
  } catch (err) {
    console.warn('[dashboard] Falha ao carregar temporadas da série:', err)
    const sId = item.stream_id !== undefined ? item.stream_id : item.series_id || 1
    seriesInfo.value = {
      info: {
        name: item.name,
        cover: item.stream_icon,
        plot: item.plot || 'Uma trama envolvente com produção de alto nível.',
      },
      seasons: [
        { season_number: 1, name: 'Temporada 1', episode_count: 8 },
        { season_number: 2, name: 'Temporada 2', episode_count: 8 },
        { season_number: 3, name: 'Temporada 3', episode_count: 8 },
      ],
      episodes: {
        "1": Array.from({ length: 8 }, (_, i) => ({
          id: `${sId}_1_${i + 1}`,
          episode_num: i + 1,
          title: `Episódio ${i + 1}`,
          container_extension: 'mp4',
          info: { movie_image: item.stream_icon, duration_secs: 2700 },
        })),
        "2": Array.from({ length: 8 }, (_, i) => ({
          id: `${sId}_2_${i + 1}`,
          episode_num: i + 1,
          title: `Episódio ${i + 1}`,
          container_extension: 'mp4',
          info: { movie_image: item.stream_icon, duration_secs: 2700 },
        })),
        "3": Array.from({ length: 8 }, (_, i) => ({
          id: `${sId}_3_${i + 1}`,
          episode_num: i + 1,
          title: `Episódio ${i + 1}`,
          container_extension: 'mp4',
          info: { movie_image: item.stream_icon, duration_secs: 2700 },
        })),
      },
    }
  } finally {
    loadingSeriesInfo.value = false
    nextTick(() => {
      const el = document.getElementById('modal-series-details')
      if (el) {
        if (popSeriesScope) popSeriesScope()
        popSeriesScope = pushFocusScope(el)
        focusFirstIn('#series-season-tabs') || focusFirstIn(el)
      }
    })
  }
}

function closeSeriesModal() {
  isSeriesModalOpen.value = false
  if (popSeriesScope) {
    popSeriesScope()
    popSeriesScope = null
  }
  const idToFocus = seriesTriggerId
  seriesTriggerId = ''
  nextTick(() => {
    if (idToFocus) {
      document.getElementById(idToFocus)?.focus()
    } else {
      focusFirstIn('[data-focus-group="content"]') || focusFirstIn('#nav-series')
    }
  })
}

function playEpisode(ep) {
  if (!ep || !selectedSeries.value) return
  const sName = selectedSeries.value.name || 'Série'
  const sIcon = selectedSeries.value.stream_icon || ''
  const epList = episodesForActiveSeason.value || []

  const playlist = epList.map((e) => ({
    stream_id: e.id,
    name: `${sName} - T${activeSeasonNumber.value}:E${e.episode_num} - ${e.title || `Episódio ${e.episode_num}`}`,
    stream_icon: e.info?.movie_image || sIcon,
    container_extension: e.container_extension || 'mp4',
    section: 'series',
  }))

  const epIndex = playlist.findIndex((p) => String(p.stream_id) === String(ep.id))
  closeSeriesModal()
  player.playPlaylist({
    items: playlist,
    startIndex: epIndex >= 0 ? epIndex : 0,
    section: 'series',
  })
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
    }
  })
})

onMounted(async () => {
  await profileStore.hydrate()
  await player.hydrate()
  await auth.hydrate()
  await loadCatalogShowcase()

  cleanupRootBack = registerBackHandler(() => {
    if (isAddProfileOpen.value) {
      closeAddProfileModal()
      return true
    }
    if (profileStore.isProfileGateOpen) {
      if (profileStore.activeProfileId) {
        profileStore.closeProfileGate()
        if (popProfileGateScope) {
          popProfileGateScope()
          popProfileGateScope = null
        }
        nextTick(() => {
          document.getElementById(profileTriggerId)?.focus()
        })
        return true
      }
      return true
    }
    if (isSeriesModalOpen.value) {
      closeSeriesModal()
      return true
    }
    if (isListModalOpen.value) {
      closeListModal()
      return true
    }
    if (activeTab.value !== 'home') {
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
        focusFirstIn('[data-focus-group="top-nav"]')
      }
    }
  })
})

onBeforeUnmount(() => {
  if (cleanupRootBack) cleanupRootBack()
  if (cleanupModalBack) cleanupModalBack()
  if (popModalScope) popModalScope()
  if (popSeriesScope) popSeriesScope()
  if (popProfileGateScope) popProfileGateScope()
})
</script>

<template>
  <div class="w-full h-full flex flex-col bg-[#0a0a0a] text-white overflow-hidden select-none">
    <!-- 3.1. Top Navbar Minimalista (h-[4.5rem]) -->
    <header
      data-focus-group="top-nav"
      class="h-[4.5rem] px-12 flex items-center justify-between bg-gradient-to-b from-black/95 to-transparent z-20 shrink-0"
    >
      <!-- Esquerda: Logo + Links de Navegação -->
      <div class="flex items-center">
        <!-- Logo: Raio Vermelho + NEUTRO TV -->
        <div class="flex items-center gap-2.5 mr-2">
          <svg class="w-6 h-6 text-[#e50914] fill-current shrink-0" viewBox="0 0 24 24">
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
          </svg>
          <div class="flex items-center tracking-wider text-tv-lg font-black leading-none">
            <span class="text-white">NEUTRO</span>
            <span class="text-[#e50914] ml-1">TV</span>
          </div>
        </div>

        <!-- Links de Navegação (Sem caixas nem .tv-btn) -->
        <nav class="flex items-center gap-7 ml-10">
          <button
            id="nav-home"
            type="button"
            class="tv-focusable relative py-2 text-tv-sm transition-colors"
            :class="activeTab === 'home' ? 'text-white font-semibold' : 'text-neutral-400 font-normal hover:text-white'"
            @click="activeTab = 'home'"
          >
            Início
            <span
              v-if="activeTab === 'home'"
              class="absolute bottom-0 left-1/2 -translate-x-1/2 w-5 h-[2.5px] bg-[#e50914] rounded-full"
            />
          </button>

          <button
            id="nav-live"
            type="button"
            class="tv-focusable relative py-2 text-tv-sm transition-colors"
            :class="activeTab === 'live' ? 'text-white font-semibold' : 'text-neutral-400 font-normal hover:text-white'"
            @click="activeTab = 'live'"
          >
            TV ao vivo
            <span
              v-if="activeTab === 'live'"
              class="absolute bottom-0 left-1/2 -translate-x-1/2 w-5 h-[2.5px] bg-[#e50914] rounded-full"
            />
          </button>

          <button
            id="nav-vod"
            type="button"
            class="tv-focusable relative py-2 text-tv-sm transition-colors"
            :class="activeTab === 'vod' ? 'text-white font-semibold' : 'text-neutral-400 font-normal hover:text-white'"
            @click="activeTab = 'vod'"
          >
            Filmes
            <span
              v-if="activeTab === 'vod'"
              class="absolute bottom-0 left-1/2 -translate-x-1/2 w-5 h-[2.5px] bg-[#e50914] rounded-full"
            />
          </button>

          <button
            id="nav-series"
            type="button"
            class="tv-focusable relative py-2 text-tv-sm transition-colors"
            :class="activeTab === 'series' ? 'text-white font-semibold' : 'text-neutral-400 font-normal hover:text-white'"
            @click="activeTab = 'series'"
          >
            Séries
            <span
              v-if="activeTab === 'series'"
              class="absolute bottom-0 left-1/2 -translate-x-1/2 w-5 h-[2.5px] bg-[#e50914] rounded-full"
            />
          </button>

          <button
            id="nav-favorites"
            type="button"
            class="tv-focusable relative py-2 text-tv-sm transition-colors"
            :class="activeTab === 'favorites' ? 'text-white font-semibold' : 'text-neutral-400 font-normal hover:text-white'"
            @click="activeTab = 'favorites'"
          >
            Minha lista
            <span
              v-if="activeTab === 'favorites'"
              class="absolute bottom-0 left-1/2 -translate-x-1/2 w-5 h-[2.5px] bg-[#e50914] rounded-full"
            />
          </button>
        </nav>
      </div>

      <!-- Direita: Ícones de Ação Minimalistas (SVG finos) -->
      <div class="flex items-center gap-5">
        <!-- Busca -->
        <button
          id="nav-search"
          type="button"
          class="tv-focusable w-9 h-9 rounded-lg flex items-center justify-center text-neutral-300 hover:text-white"
          title="Buscar"
          @click="activeTab = 'vod'"
        >
          <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </button>

        <!-- Status / Notificações (Abre modal de listas) -->
        <button
          id="nav-notifications"
          type="button"
          class="tv-focusable w-9 h-9 rounded-lg flex items-center justify-center text-neutral-300 hover:text-white"
          title="Notificações e Servidor"
          @click="openListModal"
        >
          <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
        </button>

        <!-- Perfil Ativo (Quem está assistindo?) -->
        <button
          id="btn-switch-profile"
          type="button"
          class="tv-focusable flex items-center gap-2.5 p-1 rounded-lg"
          title="Trocar Perfil"
          @click="openProfileGate"
        >
          <div
            class="w-8 h-8 rounded-lg flex items-center justify-center text-white text-tv-xs font-black shadow-md border border-white/20"
            :style="{ backgroundColor: profileStore.activeProfile.color }"
          >
            {{ profileStore.activeProfile.name.charAt(0).toUpperCase() }}
          </div>
          <span class="text-tv-xs text-neutral-300 font-medium max-w-[6.5rem] truncate">
            {{ profileStore.activeProfile.name }}
          </span>
        </button>

        <!-- Gerenciar Listas -->
        <button
          id="btn-manage-lists"
          type="button"
          class="tv-focusable flex items-center gap-2 px-3 py-1.5 rounded-lg border border-white/10 bg-white/[0.04]"
          title="Gerenciar Listas"
          @click="openListModal"
        >
          <span class="text-tv-xs font-semibold text-neutral-200">Listas</span>
          <svg class="w-4 h-4 text-neutral-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      </div>
    </header>

    <!-- Conteúdo Principal -->
    <main class="flex-1 min-h-0 flex flex-col overflow-hidden">
      <!-- 3.4. Aba TV ao Vivo (Embutida) -->
      <div v-if="activeTab === 'live'" class="w-full h-full">
        <CatalogBrowser section="live" title="TV ao vivo" :embedded="true" />
      </div>

      <!-- 3.4. Aba Filmes (Embutida) -->
      <div v-else-if="activeTab === 'vod'" class="w-full h-full">
        <CatalogBrowser section="vod" title="Filmes" :embedded="true" />
      </div>

      <!-- Aba Séries (Real CatalogBrowser com suporte a Temporadas e Episódios) -->
      <div v-else-if="activeTab === 'series'" class="w-full h-full">
        <CatalogBrowser section="series" title="Séries" :embedded="true" @select-item="onSelectSeries" />
      </div>

      <!-- 3.3. Aba Minha Lista (Clean Cinema) -->
      <div
        v-else-if="activeTab === 'favorites'"
        class="flex flex-col h-full px-12 py-8 overflow-y-auto"
        data-focus-group="favorites-view"
      >
        <div class="flex items-center justify-between mb-8">
          <div>
            <h1 class="text-[2.2rem] font-bold text-white tracking-tight">Minha lista</h1>
            <p v-if="player.customQueue.length > 0" class="text-tv-sm text-neutral-400 mt-1">
              {{ player.customQueue.length }} {{ player.customQueue.length === 1 ? 'título salvo' : 'títulos salvos' }}
            </p>
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

        <!-- Estado Vazio (Lovable Clean) -->
        <div
          v-if="player.customQueue.length === 0"
          class="flex flex-col items-center justify-center flex-1 py-28 text-center"
        >
          <svg class="w-10 h-10 text-neutral-500 stroke-[1.5] mb-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          <p class="text-tv-base font-medium text-neutral-200">Sua lista começa aqui</p>
          <p class="text-tv-sm text-neutral-500 mt-1">Seus títulos favoritos, em um só lugar.</p>
        </div>

        <!-- Grade de Cards Clean -->
        <div v-else class="grid grid-cols-4 gap-5">
          <div
            v-for="(item, idx) in player.customQueue"
            :key="item.stream_id + ':' + (item.section || '')"
            tabindex="0"
            class="tv-focusable rounded-xl bg-[#121215] border border-white/[0.08] p-2.5 flex flex-col gap-2.5 text-left cursor-pointer group"
            @click="player.playFromCustomQueue(idx)"
          >
            <div class="relative w-full h-[9.5rem] rounded-lg overflow-hidden bg-[#1a1a20]">
              <img
                v-if="item.stream_icon"
                :src="item.stream_icon"
                class="w-full h-full object-cover"
                @error="$event.target.style.display = 'none'"
              />
              <div class="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent pointer-events-none" />
              <span
                class="absolute top-2.5 left-2.5 px-2 py-0.5 rounded text-[0.65rem] font-bold uppercase tracking-wider"
                :class="item.section === 'live' ? 'bg-[#10b981] text-white' : 'bg-[#e50914] text-white'"
              >
                {{ item.section === 'live' ? 'AO VIVO' : '4K' }}
              </span>
              <span class="absolute bottom-2 left-2.5 right-2.5 text-tv-base font-black uppercase tracking-tight text-white truncate drop-shadow">
                {{ item.name }}
              </span>
            </div>

            <div class="flex items-center justify-between px-1 pb-0.5">
              <div class="min-w-0 pr-2">
                <p class="text-tv-sm font-medium text-white truncate">{{ item.name }}</p>
                <p class="text-tv-xs text-neutral-500">{{ item.section === 'live' ? 'Canal de TV' : 'Filme salvo' }}</p>
              </div>
              <button
                type="button"
                tabindex="-1"
                class="w-7 h-7 rounded-full flex items-center justify-center text-neutral-400 hover:text-white shrink-0"
                title="Remover da lista"
                @click.stop="player.removeFromCustomQueue(item.stream_id, item.section)"
              >
                <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- 3.2. Aba Início (Vitrine Clean Cinema) -->
      <div
        v-else
        class="flex-1 overflow-y-auto"
        data-focus-group="home-vitrine"
      >
        <!-- A. Hero Banner Full-Bleed (h-[29rem]) -->
        <div class="relative w-full h-[29rem] px-12 flex flex-col justify-center overflow-hidden">
          <!-- Imagem de Fundo -->
          <img
            :src="heroBackground"
            alt="Hero Background"
            class="absolute inset-0 w-full h-full object-cover object-center opacity-65 pointer-events-none"
          />

          <!-- Vinhetas / Máscaras Gradiente para fusão perfeita -->
          <div class="absolute inset-0 bg-gradient-to-r from-[#0a0a0a] via-[#0a0a0a]/80 to-transparent pointer-events-none" />
          <div class="absolute inset-0 bg-gradient-to-t from-[#0a0a0a] via-[#0a0a0a]/20 to-transparent pointer-events-none" />

          <!-- Conteúdo do Hero -->
          <div class="relative z-10 max-w-[38rem] space-y-4">
            <!-- Selo Superior: N vermelho + DESTAQUE -->
            <div class="flex items-center gap-2.5">
              <span class="text-[#e50914] font-black text-tv-sm">N</span>
              <span class="text-[0.75rem] font-semibold tracking-[0.22em] text-neutral-300 uppercase">
                {{ recentHistoryItem ? 'CONTINUAR ASSISTINDO' : 'DESTAQUE DA SEMANA' }}
              </span>
            </div>

            <!-- Título Principal -->
            <h1 class="text-[3.5rem] font-black uppercase tracking-tight leading-[0.95] text-white truncate">
              {{ recentHistoryItem ? recentHistoryItem.name : (displayVodCards[0]?.name || 'ALÉM DO HORIZONTE') }}
            </h1>

            <!-- Linha de Metadados -->
            <div class="flex items-center gap-3 text-tv-xs text-neutral-300 font-medium">
              <span class="text-[#22c55e] font-bold">98% relevante</span>
              <span>2026</span>
              <span class="px-1.5 py-0.5 border border-white/25 rounded text-[0.7rem] leading-none">14</span>
              <span>{{ recentHistoryItem?.currentTime ? formatTime(recentHistoryItem.currentTime) : '2h 08min' }}</span>
              <span class="px-2 py-0.5 border border-white/25 rounded text-[0.7rem] leading-none">4K UHD</span>
              <span class="text-neutral-400">Dolby Atmos</span>
            </div>

            <!-- Sinopse -->
            <p class="text-tv-sm text-neutral-300 leading-relaxed line-clamp-3 max-w-[32rem]">
              Em um futuro próximo, uma tripulação de exploradores parte para os confins desconhecidos da galáxia em busca de uma nova esperança para a humanidade.
            </p>

            <!-- Linha de Botões do Hero -->
            <div class="flex items-center gap-3 pt-2">
              <!-- Botão 1: Assistir agora -->
              <button
                id="hero-play"
                type="button"
                class="tv-focusable h-[3.2rem] px-7 rounded-lg bg-white text-black font-semibold text-tv-sm flex items-center gap-3"
                @click="handleHeroPlay"
              >
                <svg class="w-4 h-4 fill-black shrink-0" viewBox="0 0 24 24">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
                <span>Assistir agora</span>
              </button>

              <!-- Botão 2: Minha lista -->
              <button
                id="hero-mylist"
                type="button"
                class="tv-focusable h-[3.2rem] px-6 rounded-lg bg-neutral-800/85 border border-white/15 text-white font-medium text-tv-sm flex items-center gap-3"
                @click="handleHeroBookmark"
              >
                <svg class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                <span>Minha lista</span>
              </button>

              <!-- Botão 3: Informações / Gerenciar Listas -->
              <button
                id="hero-info"
                type="button"
                class="tv-focusable w-[3.2rem] h-[3.2rem] rounded-lg bg-neutral-800/85 border border-white/15 text-white flex items-center justify-center shrink-0"
                title="Informações da Lista"
                @click="openListModal"
              >
                <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="16" x2="12" y2="12" />
                  <line x1="12" y1="8" x2="12.01" y2="8" />
                </svg>
              </button>
            </div>
          </div>

          <!-- Canto Inferior Direito do Hero -->
          <div class="absolute right-12 bottom-6 z-10 flex items-center gap-4">
            <div class="flex items-center gap-1.5">
              <div class="w-6 h-1.5 rounded-full bg-white" />
              <div class="w-1.5 h-1.5 rounded-full bg-white/40" />
              <div class="w-1.5 h-1.5 rounded-full bg-white/40" />
              <div class="w-1.5 h-1.5 rounded-full bg-white/40" />
            </div>
            <div class="flex items-center gap-2 pl-2">
              <svg class="w-4 h-4 text-neutral-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                <line x1="8" y1="21" x2="16" y2="21" />
                <line x1="12" y1="17" x2="12" y2="21" />
              </svg>
              <span class="text-[0.7rem] tracking-[0.15em] text-neutral-400 uppercase font-medium">
                UMA EXPERIÊNCIA DE CINEMA
              </span>
            </div>
          </div>
        </div>

        <!-- Seção: Continuar Assistindo (Se houver histórico) -->
        <section
          v-if="player.watchHistory.length > 0"
          class="px-12 mt-4 mb-8"
          data-focus-group="continue-watching"
        >
          <div class="flex items-center justify-between mb-4">
            <h3 class="text-tv-base font-bold text-white tracking-tight">Continuar assistindo</h3>
            <button
              id="btn-clear-history"
              type="button"
              class="tv-focusable text-tv-xs text-neutral-500 hover:text-white"
              @click="player.clearHistory()"
            >
              Limpar histórico
            </button>
          </div>

          <div class="grid grid-cols-4 gap-5">
            <div
              v-for="item in player.watchHistory.slice(0, 4)"
              :id="'history-card-' + item.stream_id"
              :key="item.stream_id + ':' + item.section"
              tabindex="0"
              class="tv-focusable rounded-xl bg-[#121215] border border-white/[0.08] p-2.5 flex flex-col gap-2.5 text-left cursor-pointer group"
              @click="player.playItem(item)"
            >
              <div class="relative w-full h-[9.5rem] rounded-lg overflow-hidden bg-[#1a1a20]">
                <img
                  v-if="item.stream_icon"
                  :src="item.stream_icon"
                  class="w-full h-full object-cover"
                  @error="$event.target.style.display = 'none'"
                />
                <div class="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent pointer-events-none" />

                <!-- Badges -->
                <span
                  v-if="item.section === 'live'"
                  class="absolute top-2.5 left-2.5 px-2 py-0.5 rounded bg-[#10b981] text-white text-[0.65rem] font-bold uppercase tracking-wider"
                >
                  AO VIVO
                </span>
                <span
                  v-else
                  class="absolute top-2.5 left-2.5 px-2 py-0.5 rounded bg-black/60 border border-white/20 text-white text-[0.65rem] font-medium"
                >
                  {{ getRemainingText(item) }}
                </span>

                <button
                  type="button"
                  tabindex="-1"
                  class="absolute top-2.5 right-2.5 w-6 h-6 rounded-full bg-black/60 flex items-center justify-center text-neutral-400 hover:text-white"
                  title="Remover do histórico"
                  @click.stop="player.removeFromHistory(item.stream_id, item.section)"
                >
                  <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>

                <span class="absolute bottom-2 left-2.5 right-2.5 text-tv-base font-black uppercase tracking-tight text-white truncate drop-shadow">
                  {{ item.name }}
                </span>

                <!-- Barra fina vermelha na base -->
                <div v-if="item.section === 'vod' || item.section === 'series'" class="absolute bottom-0 left-0 right-0 h-1 bg-white/10">
                  <div class="h-full bg-[#e50914]" :style="{ width: Math.min(100, item.progressPct || 0) + '%' }" />
                </div>
              </div>

              <div class="flex items-center justify-between px-1 pb-0.5">
                <div class="min-w-0 pr-2">
                  <p class="text-tv-sm font-medium text-white truncate">{{ item.name }}</p>
                  <p class="text-tv-xs text-neutral-500">
                    {{ item.section === 'live' ? 'Canal de TV' : (item.section === 'series' ? 'Retomar série' : 'Retomar filme') }}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- B. Seção 1: "Escolhidos para você" -->
        <section
          class="px-12 mt-2 mb-10"
          data-focus-group="home-vod-row"
        >
          <div class="flex items-center justify-between mb-4">
            <h3 class="text-tv-base font-bold text-white tracking-tight">Escolhidos para você</h3>
            <button
              id="home-see-all-vod"
              type="button"
              class="tv-focusable text-tv-xs text-neutral-400 hover:text-white flex items-center gap-1"
              @click="activeTab = 'vod'"
            >
              <span>Ver todos</span>
              <span>›</span>
            </button>
          </div>

          <div class="grid grid-cols-4 gap-5">
            <div
              v-for="card in displayVodCards"
              :id="'vod-card-' + card.stream_id"
              :key="card.stream_id"
              tabindex="0"
              class="tv-focusable rounded-xl bg-[#121215] border border-white/[0.08] p-2.5 flex flex-col gap-2.5 text-left cursor-pointer group"
              @click="handleCardPlay(card, 'vod')"
            >
              <!-- Miniatura Superior -->
              <div class="relative w-full h-[9.5rem] rounded-lg overflow-hidden bg-[#1a1a20]">
                <img
                  v-if="card.image"
                  :src="card.image"
                  class="w-full h-full object-cover"
                  @error="$event.target.style.display = 'none'"
                />
                <div class="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent pointer-events-none" />

                <!-- Badge Superior Esquerdo -->
                <span class="absolute top-2.5 left-2.5 px-2 py-0.5 rounded bg-[#e50914] text-white text-[0.65rem] font-bold uppercase tracking-wider">
                  {{ card.badge || 'EM DESTAQUE' }}
                </span>

                <!-- Badge Superior Direito -->
                <span class="absolute top-2.5 right-2.5 px-1.5 py-0.5 rounded bg-black/60 border border-white/30 text-white text-[0.65rem] font-semibold">
                  4K
                </span>

                <!-- Título estilizado na base da imagem -->
                <span class="absolute bottom-2 left-2.5 right-2.5 text-tv-lg font-black uppercase tracking-tight text-white truncate drop-shadow">
                  {{ card.name }}
                </span>
              </div>

              <!-- Rodapé Interno do Card -->
              <div class="flex items-center justify-between px-1 pb-0.5">
                <div class="min-w-0 pr-2">
                  <p class="text-tv-sm font-medium text-white truncate">{{ card.name }}</p>
                  <p class="text-tv-xs text-neutral-500">{{ card.subtitle || '2026 · Aventura' }}</p>
                </div>
                <button
                  type="button"
                  tabindex="-1"
                  class="w-7 h-7 rounded-full flex items-center justify-center text-neutral-400 hover:text-white shrink-0"
                  title="Minha lista"
                  @click.stop="toggleCardBookmark(card)"
                >
                  <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </section>

        <!-- C. Seção 2: "Agora na TV" (Canais ao Vivo) -->
        <section
          class="px-12 mb-12"
          data-focus-group="home-live-row"
        >
          <div class="flex items-center justify-between mb-4">
            <div class="flex items-center gap-2.5">
              <svg class="w-5 h-5 text-[#e50914] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4.93 19.07A10 10 0 0 1 19.07 4.93" />
                <path d="M7.76 16.24a6 6 0 0 1 8.48-8.48" />
                <circle cx="12" cy="12" r="2" />
              </svg>
              <h3 class="text-tv-base font-bold text-white tracking-tight">Agora na TV</h3>
            </div>
            <button
              id="home-see-all-live"
              type="button"
              class="tv-focusable text-tv-xs text-neutral-400 hover:text-white flex items-center gap-1"
              @click="activeTab = 'live'"
            >
              <span>Explorar canais</span>
              <span>›</span>
            </button>
          </div>

          <div class="grid grid-cols-4 gap-5">
            <div
              v-for="channel in displayLiveCards"
              :id="'live-card-' + channel.stream_id"
              :key="channel.stream_id"
              tabindex="0"
              class="tv-focusable rounded-xl bg-[#121215] border border-white/[0.08] p-5 h-[9.5rem] flex flex-col justify-between text-left cursor-pointer group"
              @click="handleCardPlay(channel, 'live')"
            >
              <!-- Topo do Card -->
              <div class="flex items-center justify-between">
                <span class="text-tv-base font-black tracking-tight uppercase">
                  <span class="text-white">{{ channel.firstName }} </span>
                  <span class="text-[#e50914]">{{ channel.secondName }}</span>
                </span>
                <span class="flex items-center gap-1.5 text-[0.65rem] font-bold uppercase tracking-wider text-[#10b981]">
                  <span class="w-1.5 h-1.5 rounded-full bg-[#10b981]" />
                  AO VIVO
                </span>
              </div>

              <!-- Meio do Card -->
              <div class="min-w-0">
                <p class="text-tv-sm font-medium text-white truncate">{{ channel.program }}</p>
                <p class="text-tv-xs text-neutral-500 mt-0.5 truncate">{{ channel.schedule }}</p>
              </div>

              <!-- Base do Card: Barra fina de 2px -->
              <div class="w-full h-[2px] bg-white/10 rounded-full overflow-hidden">
                <div class="h-full w-2/5 bg-[#e50914]" />
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>

    <!-- 3.5. Rodapé Minimalista Fixo (h-[3rem]) -->
    <footer class="border-t border-white/[0.06] px-12 py-3 flex items-center justify-between text-tv-xs text-neutral-500 shrink-0">
      <div class="flex items-center gap-6">
        <span class="font-bold text-white tracking-wider">NEUTRO TV</span>
        <span>Seu cinema. Sua escolha.</span>
      </div>

      <div class="flex items-center gap-6">
        <button
          id="footer-list-btn"
          type="button"
          class="tv-focusable px-3 py-1 rounded border border-white/15 text-neutral-300 text-[0.7rem] uppercase tracking-wider hover:text-white"
          @click="openListModal"
        >
          LISTA: {{ auth.activeListLabel || auth.username }}
        </button>
        <span>© 2026 Neutro TV</span>
      </div>
    </footer>

    <!-- 3.6. Modal de Gerenciamento de Listas (#modal-lists) -->
    <div
      v-if="isListModalOpen"
      id="modal-lists"
      class="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-12 select-none"
      role="dialog"
      aria-modal="true"
      data-focus-group="modal-lists-dialog"
    >
      <div class="w-full max-w-[70rem] max-h-[44rem] bg-[#121215] border border-white/10 rounded-2xl p-8 flex flex-col shadow-2xl">
        <!-- Topo do Modal -->
        <header class="flex items-center justify-between pb-5 border-b border-white/[0.08]">
          <div>
            <h2 class="text-tv-xl font-bold text-white tracking-tight">Gerenciador de Listas</h2>
            <p class="text-tv-xs text-neutral-400 mt-1">
              Alterne entre suas contas cadastradas ou adicione um novo servidor Xtream Codes
            </p>
          </div>
          <button
            id="modal-close-btn"
            type="button"
            class="tv-btn !px-4 !py-2 text-tv-sm flex items-center gap-2"
            @click="closeListModal"
          >
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
            <span>Fechar</span>
          </button>
        </header>

        <!-- Mensagem de Erro -->
        <div
          v-if="listFormError"
          class="mt-4 p-3 rounded-lg bg-red-500/15 border border-red-500/30 text-red-300 text-tv-xs flex items-center gap-2"
          role="alert"
        >
          <svg class="w-4 h-4 text-red-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>{{ listFormError }}</span>
        </div>

        <!-- Conteúdo do Modal: 2 Colunas -->
        <div class="grid grid-cols-2 gap-8 flex-1 min-h-0 pt-6">
          <!-- Coluna 1: Listas Salvas -->
          <div class="flex flex-col min-h-0">
            <h3 class="text-tv-sm font-bold text-neutral-200 mb-3 uppercase tracking-wider text-[0.75rem]">
              Listas Salvas ({{ auth.savedLists.length }})
            </h3>

            <div class="flex-1 overflow-y-auto pr-3 space-y-3">
              <div
                v-for="list in auth.savedLists"
                :id="'saved-list-card-' + list.id"
                :key="list.id"
                class="rounded-xl border p-4 flex items-center justify-between transition-colors"
                :class="
                  list.id === auth.currentListId
                    ? 'border-[#e50914] bg-white/[0.04]'
                    : 'border-white/10 bg-white/[0.02]'
                "
              >
                <div class="min-w-0 pr-3">
                  <div class="flex items-center gap-2.5 mb-1">
                    <span class="text-tv-sm font-bold text-white truncate">
                      {{ list.label || list.username }}
                    </span>
                    <span
                      v-if="list.id === auth.currentListId"
                      class="px-2 py-0.5 rounded text-[0.65rem] font-bold bg-[#10b981]/15 text-[#10b981] border border-[#10b981]/30 uppercase"
                    >
                      ATIVA
                    </span>
                  </div>
                  <p class="text-tv-xs text-neutral-400 truncate">
                    {{ list.username }} @ {{ list.baseUrl }}
                  </p>
                </div>

                <div class="flex items-center gap-2 shrink-0">
                  <button
                    v-if="list.id !== auth.currentListId"
                    :id="'btn-switch-' + list.id"
                    type="button"
                    class="tv-btn tv-btn-primary !px-4 !py-1.5 text-tv-xs font-semibold"
                    :disabled="isSwitching"
                    @click="handleSwitchList(list.id)"
                  >
                    Ativar
                  </button>

                  <button
                    :id="'btn-remove-' + list.id"
                    type="button"
                    class="tv-btn !p-2 text-neutral-400 hover:text-red-400"
                    title="Excluir lista"
                    @click="handleRemoveList(list.id)"
                  >
                    <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                  </button>
                </div>
              </div>

              <div
                v-if="auth.savedLists.length === 0"
                class="text-tv-sm text-neutral-500 py-6 text-center"
              >
                Nenhuma lista adicional cadastrada.
              </div>
            </div>

            <!-- Botão Sair da Conta -->
            <div class="pt-4 border-t border-white/[0.06] mt-auto">
              <button
                id="btn-modal-logout"
                type="button"
                class="tv-btn !px-4 !py-2 text-tv-xs text-red-400 hover:text-red-300 flex items-center gap-2"
                @click="logout"
              >
                <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
                <span>Sair da conta atual</span>
              </button>
            </div>
          </div>

          <!-- Coluna 2: Adicionar Nova Lista -->
          <div class="flex flex-col min-h-0 pl-6 border-l border-white/[0.08]">
            <h3 class="text-tv-sm font-bold text-neutral-200 mb-3 uppercase tracking-wider text-[0.75rem]">
              Adicionar Nova Lista
            </h3>

            <form class="space-y-3.5 overflow-y-auto pr-2" @submit.prevent="handleAddNewList">
              <div>
                <label for="new-list-label" class="block text-tv-xs text-neutral-400 mb-1 font-medium">
                  Nome / Apelido (opcional)
                </label>
                <input
                  id="new-list-label"
                  v-model="listForm.label"
                  type="text"
                  class="tv-input w-full"
                  placeholder="Ex: Minha Lista VIP"
                />
              </div>

              <div>
                <label for="new-list-dns" class="block text-tv-xs text-neutral-400 mb-1 font-medium">
                  Link Curto ou URL do Servidor
                </label>
                <input
                  id="new-list-dns"
                  v-model="listForm.dns"
                  type="text"
                  class="tv-input w-full"
                  placeholder="Ex: n.tv/vip ou servidor.com:8080"
                />
              </div>

              <div>
                <label for="new-list-user" class="block text-tv-xs text-neutral-400 mb-1 font-medium">
                  Usuário (opcional para link curto)
                </label>
                <input
                  id="new-list-user"
                  v-model="listForm.username"
                  type="text"
                  class="tv-input w-full"
                  placeholder="Seu usuário"
                />
              </div>

              <div>
                <label for="new-list-pass" class="block text-tv-xs text-neutral-400 mb-1 font-medium">
                  Senha (opcional para link curto)
                </label>
                <input
                  id="new-list-pass"
                  v-model="listForm.password"
                  type="password"
                  class="tv-input w-full"
                  placeholder="Sua senha"
                />
              </div>

              <div class="pt-2">
                <button
                  id="btn-save-new-list"
                  type="submit"
                  class="tv-btn tv-btn-primary w-full !py-3 font-semibold flex items-center justify-center gap-2 text-tv-sm"
                  :disabled="isConnecting"
                >
                  <svg
                    v-if="isConnecting"
                    class="w-4 h-4 animate-spin text-black"
                    viewBox="0 0 24 24"
                    fill="none"
                  >
                    <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2.5" opacity="0.25" />
                    <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
                  </svg>
                  <span>{{ isConnecting ? 'Conectando...' : 'Conectar e Salvar Lista' }}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>

    <!-- Modal / Painel de Temporadas e Episódios (RFC-006) -->
    <div
      v-if="isSeriesModalOpen"
      id="modal-series-details"
      class="fixed inset-0 z-50 bg-[#0a0a0a]/95 flex flex-col p-12 overflow-hidden select-none"
      role="dialog"
      aria-modal="true"
      data-focus-group="modal-series-dialog"
    >
      <!-- Header do Modal -->
      <header class="flex items-center justify-between pb-6 border-b border-white/[0.08] shrink-0">
        <div class="flex items-center gap-6">
          <button
            id="btn-close-series-modal"
            type="button"
            class="tv-btn !px-5 !py-2.5 flex items-center gap-2"
            @click="closeSeriesModal"
          >
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            <span>Voltar ao Catálogo</span>
          </button>
          <div>
            <h2 class="text-tv-xl font-bold text-white tracking-tight">{{ selectedSeries?.name }}</h2>
            <div class="flex items-center gap-3 text-tv-xs text-neutral-400 mt-1">
              <span class="text-[#22c55e] font-semibold">4K UHD</span>
              <span>•</span>
              <span>{{ availableSeasons.length }} {{ availableSeasons.length === 1 ? 'Temporada' : 'Temporadas' }}</span>
              <span v-if="selectedSeries?.rating">• ⭐ {{ selectedSeries.rating }}</span>
            </div>
          </div>
        </div>
      </header>

      <!-- Corpo do Modal: Capa/Sinopse + Abas de Temporadas + Episódios -->
      <div class="flex flex-1 min-h-0 gap-10 pt-6">
        <!-- Esquerda: Capa + Sinopse (w-[24rem]) -->
        <aside class="w-[24rem] shrink-0 flex flex-col gap-4">
          <div class="w-full h-[30rem] rounded-xl overflow-hidden bg-[#121215] border border-white/10 shadow-2xl">
            <img
              v-if="selectedSeries?.stream_icon"
              :src="selectedSeries.stream_icon"
              :alt="selectedSeries.name"
              class="w-full h-full object-cover"
              @error="$event.target.style.display = 'none'"
            />
          </div>
          <p class="text-tv-sm text-neutral-300 leading-relaxed line-clamp-4">
            {{ seriesInfo?.info?.plot || selectedSeries?.plot || 'Acompanhe todas as temporadas e episódios com reprodução contínua e qualidade máxima.' }}
          </p>
        </aside>

        <!-- Direita: Abas de Temporada + Grid de Episódios -->
        <div class="flex-1 min-w-0 flex flex-col">
          <!-- Abas de Temporadas -->
          <div id="series-season-tabs" class="flex items-center gap-3 mb-6 shrink-0 overflow-x-auto pb-2">
            <button
              v-for="s in availableSeasons"
              :id="'season-tab-' + s.season_number"
              :key="s.season_number"
              type="button"
              class="tv-focusable px-6 py-2.5 rounded-lg border text-tv-sm font-semibold transition-all"
              :class="
                activeSeasonNumber === s.season_number
                  ? 'border-[#e50914] bg-[#e50914] text-white'
                  : 'border-white/10 bg-white/[0.04] text-neutral-300 hover:text-white'
              "
              @click="activeSeasonNumber = s.season_number"
            >
              {{ s.name || `Temporada ${s.season_number}` }}
            </button>
          </div>

          <!-- Loading dos Episódios -->
          <div v-if="loadingSeriesInfo" class="flex-1 flex flex-col items-center justify-center gap-4">
            <svg class="w-12 h-12 animate-spin text-[#e50914]" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2.5" opacity="0.2" />
              <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
            </svg>
            <p class="text-tv-sm text-neutral-400">Carregando episódios...</p>
          </div>

          <!-- Lista de Episódios com D-Pad -->
          <div
            v-else
            id="series-episodes-list"
            class="flex-1 overflow-y-auto pr-3 space-y-3.5"
            data-focus-group="series-episodes"
          >
            <div
              v-for="ep in episodesForActiveSeason"
              :id="'episode-card-' + ep.id"
              :key="ep.id"
              tabindex="0"
              class="tv-focusable rounded-xl bg-[#121215] border border-white/[0.08] p-4 flex items-center justify-between cursor-pointer group"
              @click="playEpisode(ep)"
            >
              <div class="flex items-center gap-5 min-w-0 pr-4">
                <!-- Miniatura do Episódio -->
                <div class="relative w-[8.5rem] h-[5rem] rounded-lg overflow-hidden bg-[#1a1a20] shrink-0 border border-white/10">
                  <img
                    v-if="ep.info?.movie_image || selectedSeries?.stream_icon"
                    :src="ep.info?.movie_image || selectedSeries?.stream_icon"
                    class="w-full h-full object-cover"
                    @error="$event.target.style.display = 'none'"
                  />
                  <div class="absolute inset-0 bg-black/40 flex items-center justify-center group-focus:bg-transparent">
                    <svg class="w-6 h-6 fill-white opacity-80 group-focus:opacity-100" viewBox="0 0 24 24">
                      <polygon points="5 3 19 12 5 21 5 3" />
                    </svg>
                  </div>
                </div>

                <div class="min-w-0">
                  <div class="flex items-center gap-3 mb-1">
                    <span class="text-tv-base font-bold text-white truncate">
                      {{ ep.episode_num }}. {{ ep.title || `Episódio ${ep.episode_num}` }}
                    </span>
                    <span class="px-2 py-0.5 rounded text-[0.65rem] font-bold bg-white/10 text-neutral-300">
                      {{ ep.info?.duration_secs ? Math.round(ep.info.duration_secs / 60) + ' min' : '45 min' }}
                    </span>
                  </div>
                  <p class="text-tv-xs text-neutral-400 line-clamp-2">
                    {{ ep.info?.plot || `Episódio ${ep.episode_num} da Temporada ${activeSeasonNumber}.` }}
                  </p>
                </div>
              </div>

              <!-- Botão Play -->
              <button
                type="button"
                tabindex="-1"
                class="tv-btn tv-btn-primary !px-5 !py-2 text-tv-xs font-semibold shrink-0"
              >
                Assistir
              </button>
            </div>

            <div v-if="episodesForActiveSeason.length === 0" class="text-center py-16 text-neutral-400">
              Nenhum episódio encontrado para esta temporada.
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 2. Tela / Overlay "Quem está assistindo?" (Estilo Netflix Clean Cinema) -->
    <div
      v-if="profileStore.isProfileGateOpen"
      id="profile-gate-overlay"
      class="fixed inset-0 z-40 bg-[#0a0a0a] flex flex-col items-center justify-center select-none"
      role="dialog"
      aria-modal="true"
      data-focus-group="profile-gate"
    >
      <h1 class="text-[2.8rem] font-semibold text-white tracking-tight mb-12">Quem está assistindo?</h1>

      <div class="flex items-center gap-8">
        <!-- Cards dos Perfis -->
        <button
          v-for="p in profileStore.profiles"
          :id="'profile-card-' + p.id"
          :key="p.id"
          type="button"
          class="tv-focusable group flex flex-col items-center gap-4 cursor-pointer outline-none"
          @click="handleSelectProfile(p.id)"
        >
          <div
            class="w-[9.5rem] h-[9.5rem] rounded-xl flex items-center justify-center border-2 border-transparent group-focus:border-white transition-all shadow-2xl relative overflow-hidden"
            :style="{ backgroundColor: p.color }"
          >
            <!-- Inicial grande estilizada estilo Netflix -->
            <span class="text-white text-5xl font-black drop-shadow-md select-none">
              {{ p.name.charAt(0).toUpperCase() }}
            </span>
          </div>
          <span class="text-tv-base text-neutral-400 group-focus:text-white font-medium transition-colors">
            {{ p.name }}
          </span>
        </button>

        <!-- Botão + Adicionar Perfil (se < 5 perfis) -->
        <button
          v-if="profileStore.canAddProfile"
          id="btn-add-profile-card"
          type="button"
          class="tv-focusable group flex flex-col items-center gap-4 cursor-pointer outline-none"
          @click="openAddProfileModal"
        >
          <div class="w-[9.5rem] h-[9.5rem] rounded-xl flex items-center justify-center border-2 border-dashed border-white/20 group-focus:border-white transition-all bg-white/[0.03]">
            <svg class="w-12 h-12 text-neutral-400 group-focus:text-white transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </div>
          <span class="text-tv-base text-neutral-400 group-focus:text-white font-medium transition-colors">
            Adicionar Perfil
          </span>
        </button>
      </div>

      <!-- Mini Modal para Adicionar Perfil -->
      <div
        v-if="isAddProfileOpen"
        class="absolute inset-0 bg-black/85 flex items-center justify-center p-8 z-50"
      >
        <div class="w-full max-w-[32rem] bg-[#121215] border border-white/10 rounded-2xl p-8 flex flex-col shadow-2xl">
          <h2 class="text-tv-lg font-bold text-white mb-4">Novo Perfil</h2>
          <div class="space-y-4">
            <div>
              <label for="input-profile-name" class="block text-tv-xs text-neutral-400 mb-1">Nome do Perfil</label>
              <input
                id="input-profile-name"
                v-model="newProfileName"
                type="text"
                class="tv-input w-full"
                placeholder="Ex: Quarto, Família, Kids"
                @keyup.enter="handleCreateProfile"
              />
            </div>
            <div>
              <label class="block text-tv-xs text-neutral-400 mb-2">Cor do Perfil</label>
              <div class="flex items-center gap-3">
                <button
                  v-for="c in PROFILE_COLORS"
                  :key="c"
                  type="button"
                  class="w-8 h-8 rounded-full border-2 transition-transform"
                  :class="newProfileColor === c ? 'border-white scale-110' : 'border-transparent'"
                  :style="{ backgroundColor: c }"
                  @click="newProfileColor = c"
                />
              </div>
            </div>
          </div>
          <div class="flex items-center justify-end gap-4 mt-8">
            <button
              type="button"
              class="tv-btn !px-5 !py-2 text-tv-sm text-neutral-400 hover:text-white"
              @click="closeAddProfileModal"
            >
              Cancelar
            </button>
            <button
              id="btn-save-new-profile"
              type="button"
              class="tv-btn tv-btn-primary !px-6 !py-2 text-tv-sm font-semibold"
              :disabled="!newProfileName.trim()"
              @click="handleCreateProfile"
            >
              Criar Perfil
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
