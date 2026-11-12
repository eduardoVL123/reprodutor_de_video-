<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useAuthStore } from '@/stores/authStore'
import { useCatalogStore } from '@/stores/catalogStore'
import { usePlayerStore } from '@/stores/playerStore'
import BrandMark from '@/components/BrandMark.vue'
import GridView from '@/components/GridView.vue'
import GridItem from '@/components/GridItem.vue'
import MediaDetailsModal from '@/components/MediaDetailsModal.vue'
import PinDialog from '@/components/PinDialog.vue'
import ParentalModal from '@/components/ParentalModal.vue'
import { useParentalStore } from '@/stores/parentalStore'
import { ALL_CATEGORIES, categoriesOf } from '@/services/catalogDb'
import { fetchVodInfo, fetchSeriesInfo, normalizeVodInfo } from '@/services/xtreamApi'
import { pickArtwork } from '@/utils/artwork'
import { focusFirstIn, registerKeyHandler } from '@/utils/spatialNavigation'
import { useFormFactor } from '@/composables/useFormFactor'

/**
 * Catálogo moderno 2.0:
 * - Categorias no topo em faixa fixa de botões arredondados (com destaque verde-limão).
 * - Fileiras que rolam para o lado estilo Netflix (por categoria, com setas no hover e deslize touch).
 * - Hero banner de destaque cinematográfico para Filmes e Séries.
 * - TV ao vivo com cards largos, badge vermelho ● AO VIVO, programação e barra de progresso.
 * - Totalmente compatível com controle remoto de Smart TV e navegação em celular.
 */
const props = defineProps({
  section: { type: String, required: true }, // 'live' | 'vod' | 'series'
})

const auth = useAuthStore()
const catalog = useCatalogStore()
const player = usePlayerStore()
const emit = defineEmits(['search'])
const { layout: formFactor, isPhonePortrait } = useFormFactor()
const handheld = computed(() => formFactor.value !== 'tv')
const parental = useParentalStore()
const parentalOpen = ref(false)
const pinFor = ref(null) // categoria bloqueada esperando o PIN
const NO_PIN_YET = 'Ainda não há PIN. Crie um no botão "Controle parental" desta aba para abrir esta categoria.'

const activeCategory = ref(ALL_CATEGORIES)
const detailsTarget = ref(null)

const isLive = computed(() => props.section === 'live')
const state = computed(() => catalog.status[props.section])
// Escondidas (controle parental) nem aparecem; bloqueadas aparecem com cadeado e pedem o PIN.
const categoryList = computed(() =>
  (catalog.categories[props.section] || []).filter((c) => parental.statusOf(props.section, c) !== 'hidden'),
)
const isLockedCategory = (cat) => cat.category_id !== ALL_CATEGORIES && parental.isLocked(props.section, cat)
const managedCategories = computed(() => (catalog.categories[props.section] || []).filter((c) => c.category_id !== ALL_CATEGORIES))

const sectionTitle = computed(() => {
  if (props.section === 'live') return 'TV ao vivo'
  if (props.section === 'vod') return 'Filmes'
  return 'Séries'
})

// Destaque (Hero Banner) para Filmes e Séries
const featuredRawItem = ref(null)
const featuredInfo = ref(normalizeVodInfo(null, null))
const featuredArtworkFailed = ref(false)

const featuredArtwork = computed(() => {
  if (featuredArtworkFailed.value) return { url: '', mode: 'none' }
  return pickArtwork(featuredRawItem.value, featuredInfo.value)
})

const featuredTitle = computed(() => {
  return featuredInfo.value?.name || featuredRawItem.value?.name || ''
})

const featuredRating = computed(() => {
  const r = featuredInfo.value?.rating || featuredRawItem.value?.rating
  if (!r || Number(r) === 0) return ''
  return `Nota ${r}`
})

const featuredYear = computed(() => {
  return featuredInfo.value?.year || featuredRawItem.value?.year || ''
})

const featuredDuration = computed(() => {
  if (props.section === 'series') return featuredInfo.value?.duration || 'Série'
  return featuredInfo.value?.duration || 'Filme'
})

const featuredGenre = computed(() => {
  return featuredInfo.value?.genre || featuredRawItem.value?.genre || ''
})

const featuredSynopsis = computed(() => {
  if (featuredInfo.value?.plot && featuredInfo.value.plot !== 'Sem sinopse disponível.') {
    return featuredInfo.value.plot
  }
  return 'Explore os melhores títulos do catálogo diretamente da sua lista conectada.'
})

const isFeaturedBookmarked = computed(() => {
  if (!featuredRawItem.value) return false
  return player.isInCustomQueue(featuredRawItem.value, props.section)
})

function handleToggleBookmark() {
  if (!featuredRawItem.value) return
  if (player.isInCustomQueue(featuredRawItem.value, props.section)) {
    player.removeFromCustomQueue(featuredRawItem.value.stream_id, props.section)
  } else {
    player.enqueueItem(featuredRawItem.value, props.section)
  }
}

function handlePlayFeatured() {
  const item = featuredRawItem.value
  if (!item) return
  if (props.section === 'series') {
    detailsTarget.value = { item, index: 0, categoryId: activeCategory.value }
    return
  }
  player.playFromCatalog({
    section: props.section,
    categoryId: activeCategory.value,
    item,
    indexInCategory: 0,
  })
}

function handleInfoFeatured() {
  if (!featuredRawItem.value) return
  detailsTarget.value = { item: featuredRawItem.value, index: 0, categoryId: activeCategory.value }
}

// Fileiras por categoria
const categoryRows = ref([])
const railsRefs = ref({})

function setRailRef(el, catId) {
  if (el) {
    railsRefs.value[catId] = el
  }
}

function scrollRail(catId, direction) {
  const el = railsRefs.value[catId]
  if (el) {
    el.scrollBy({ left: direction * 500, behavior: 'smooth' })
  }
}

// Setas do mouse só para o lado em que ainda há o que rolar (senão a da esquerda cobre o 1º card).
const railEdges = ref({})
function updateRailEdges(catId) {
  const el = railsRefs.value[catId]
  if (!el) return
  railEdges.value = {
    ...railEdges.value,
    [catId]: { start: el.scrollLeft <= 1, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 1 },
  }
}

// Selo NOVO: só com a data do servidor (filme: `added`; série: `last_modified`, último episódio).
const NEW_FOR_DAYS = 7
function isRecent(item) {
  const secs = Number(props.section === 'series' ? item.last_modified : item.added) || 0
  return secs > 0 && Date.now() / 1000 - secs < NEW_FOR_DAYS * 86400
}

// Categoria escolhida ("Ver todos"): grade virtualizada com todos os itens, não só a primeira fileira.
// No celular em pé a aba já abre na grade (mockup da RFC-023): fileiras laterais não cabem numa tela estreita.
const showGrid = computed(() => activeCategory.value !== ALL_CATEGORIES || isPhonePortrait.value)
const itemCount = computed(() => catalog.countFor(props.section, activeCategory.value))
const gridKey = computed(() => `${auth.currentListId}:${props.section}:${activeCategory.value}`)
const layout = computed(() => {
  if (isPhonePortrait.value) {
    // Em pé: canais em lista de uma coluna; capas em 3 colunas no celular e 5 no tablet (600px ou mais).
    const tablet = window.innerWidth >= 600
    return isLive.value
      ? { columns: 1, rowHeight: 4.4, gap: 0.5, variant: 'channel' }
      : { columns: tablet ? 5 : 3, rowHeight: tablet ? 12 : 10, gap: 0.6, variant: 'poster' }
  }
  return isLive.value
    ? { columns: 3, rowHeight: 10, gap: 1.25, variant: 'channel' }
    : { columns: 5, rowHeight: 24, gap: 1.25, variant: 'poster' }
})
const loadItems = (start, count) => catalog.getItems(props.section, activeCategory.value, start, count)

async function loadCategoryRows() {
  if (!categoryList.value.length || showGrid.value) return

  const rows = []

  // Para TV ao vivo: se houver canais nos Favoritos da Minha Lista, mostra no topo
  if (isLive.value) {
    // Canal de categoria escondida/bloqueada fica fora dos Favoritos também (auditoria RFC-025, item 9).
    const blocked = new Set(parental.blockedIds('live', catalog.categories.live))
    const favChannels = player.customQueue.filter((it) => it.section === 'live' && !categoriesOf(it).some((id) => blocked.has(id)))
    if (favChannels.length > 0) {
      rows.push({
        category_id: 'favorites',
        category_name: 'Favoritos',
        items: favChannels,
      })
    }
  }

  // "Todos": uma fileira por categoria principal
  const catsToLoad = categoryList.value.filter((c) => c.category_id !== ALL_CATEGORIES && !isLockedCategory(c)).slice(0, 12)
  for (const cat of catsToLoad) {
    const items = await catalog.getItems(props.section, cat.category_id, 0, 15)
    if (items && items.length > 0) {
      rows.push({
        category_id: cat.category_id,
        category_name: cat.category_name,
        items,
      })
    }
  }

  categoryRows.value = rows
  nextTick(() => rows.forEach((r) => updateRailEdges(r.category_id)))

  // Atualiza item em destaque se ainda não foi selecionado
  if (!isLive.value && rows.length > 0 && !featuredRawItem.value) {
    const firstRowWithItems = rows.find((r) => r.items && r.items.length > 0)
    if (firstRowWithItems) {
      featuredRawItem.value = firstRowWithItems.items[0]
      loadFeaturedInfo(featuredRawItem.value)
    }
  }
}

async function loadFeaturedInfo(it) {
  if (!it) return
  featuredArtworkFailed.value = false
  featuredInfo.value = normalizeVodInfo(null, it)

  if (it.directUrl || !auth.isAuthenticated) return

  try {
    let info = null
    if (props.section === 'series') {
      const data = await fetchSeriesInfo({
        apiBase: auth.apiBase,
        credentials: auth.credentials,
        seriesId: it.series_id || it.stream_id,
      })
      if (data && data.info) info = normalizeVodInfo({ info: data.info }, it)
    } else if (props.section === 'vod') {
      info = await fetchVodInfo({
        apiBase: auth.apiBase,
        credentials: auth.credentials,
        vodId: it.stream_id,
        item: it,
      })
    }
    if (info) featuredInfo.value = info
  } catch (err) {
    console.warn('[catalog] Falha ao ler detalhes do destaque:', err)
  }
}

async function unlockCategory(pin) {
  const cat = pinFor.value
  if (parental.needsPin()) return NO_PIN_YET
  if (!(await parental.unlock(props.section, cat, pin))) return parental.pinError()
  pinFor.value = null
  chooseCategory(cat)
  return true
}

async function chooseCategory(cat) {
  if (!cat) return
  if (isLockedCategory(cat)) {
    pinFor.value = cat
    return
  }
  activeCategory.value = cat.category_id
  await loadCategoryRows()
  await nextTick()
  // Rola até o topo da área de conteúdo
  const scrollArea = document.getElementById('catalog-content-area')
  if (scrollArea) scrollArea.scrollTop = 0
}

function handleSelectItem(item, index, categoryId) {
  if (!item) return
  if (!isLive.value) {
    detailsTarget.value = { item, index, categoryId }
    return
  }
  player.playFromCatalog({
    section: props.section,
    categoryId,
    item,
    indexInCategory: index,
  })
}

const load = (force = false) => catalog.loadSection(props.section, { force })
const progressPct = computed(() => Math.round((state.value.progress || 0) * 100))

async function focusActiveCategory() {
  await nextTick()
  const index = categoryList.value.findIndex((c) => c.category_id === activeCategory.value)
  const targetId = `cat-${Math.max(0, index)}`
  const el = document.getElementById(targetId) || document.getElementById('cat-0')
  if (el) el.focus()
}

// Mudou no controle parental (ou desbloqueou com PIN): as fileiras de "Todos" saem/entram na hora.
watch(
  () => [parental.settings, parental.unlocked],
  () => {
    if (state.value.state === 'ready') loadCategoryRows()
  },
)

watch(
  () => state.value.state,
  (st) => {
    if (st === 'ready') {
      focusActiveCategory()
      loadCategoryRows()
    } else if (st === 'error') {
      nextTick(() => focusFirstIn('#catalog-retry'))
    }
  },
  { immediate: true },
)

watch(
  () => auth.currentListId,
  (newId, oldId) => {
    if (newId && oldId && newId !== oldId) {
      activeCategory.value = ALL_CATEGORIES
      featuredRawItem.value = null
      load(true)
    }
  },
)

// PC: a barra de categorias não mostra barra de rolagem e a roda comum é vertical, então nada a fazia andar para o
// lado. A roda vertical vira horizontal (como as fileiras, HorizontalRail.vue); gesto lateral do touchpad segue nativo.
function onCategoryWheel(event) {
  const bar = event.currentTarget
  if (Math.abs(event.deltaY) <= Math.abs(event.deltaX) || bar.scrollWidth <= bar.clientWidth) return
  event.preventDefault()
  // Instantâneo como a roda nativa: com o scroll-smooth da barra, cada giro reiniciava a animação e ela mal andava.
  bar.style.scrollBehavior = 'auto'
  bar.scrollLeft += event.deltaY
  bar.style.scrollBehavior = ''
}

let cleanupKeyHandler = null

onMounted(() => {
  player.hydrate()
  load()

  cleanupKeyHandler = registerKeyHandler((action) => {
    const current = document.activeElement
    if (!current) return false

    const inCategories = current.closest && current.closest('[data-focus-row="categories"]')
    if (inCategories && action === 'down') {
      const heroPlay = document.getElementById('catalog-hero-play')
      if (heroPlay) {
        heroPlay.focus()
        return true
      }
      const firstCard = document.querySelector('[data-focus-row^="rail-"] button, [data-focus-row^="rail-"] .tv-focusable')
      if (firstCard) {
        firstCard.focus()
        return true
      }
    }
    return false
  })
})

onBeforeUnmount(() => {
  if (cleanupKeyHandler) cleanupKeyHandler()
})
</script>

<template>
  <section class="flex flex-col h-full pl-10 phone:pl-0 pr-24 phone:pr-4 py-14 phone:py-4 phone-portrait:pr-0 phone-portrait:pt-2 phone-portrait:pb-0 overflow-hidden relative">
    <!-- Topo Fixo com Categorias Arredondadas -->
    <!-- z-20: abaixo do menu lateral (z-30), senão o título passa por cima do menu aberto -->
    <!-- Em pé o bloco da esquerda vira `contents`: título e botões dividem a 1ª linha e as categorias ganham a 2ª inteira. -->
    <header class="sticky top-0 z-20 bg-[#0b0f0c]/90 py-3 px-6 phone:px-4 phone-portrait:flex-wrap phone-portrait:gap-y-2 phone-portrait:pb-1 flex items-center justify-between gap-4 border-b border-white/[0.06] shrink-0">
      <div class="flex items-center gap-8 phone:gap-4 phone-portrait:contents min-w-0 flex-1">
        <!-- Margem no próprio logo (não gap): escondido na TV, ele não deixa espaço sobrando nas TVs sem flex-gap -->
        <h1 class="shrink-0 phone-portrait:flex-1 text-2xl phone:text-xl font-black tracking-tight text-white flex items-center">
          <BrandMark :size="1.4" class="text-tv-accent hidden phone:inline mr-2" />
          <span>{{ sectionTitle }}</span>
        </h1>

        <!-- Faixa de Botões Arredondados de Categoria (Pills) -->
        <!-- Máscara na TV: a última categoria some em degradê em vez de aparecer cortada no meio da palavra -->
        <div
          v-if="categoryList.length > 0"
          data-focus-row="categories"
          data-scroll-x
          @wheel="onCategoryWheel"
          class="flex items-center gap-2 overflow-x-auto no-scrollbar scroll-smooth flex-1 min-w-0 py-2 px-2 pr-10 [-webkit-mask-image:linear-gradient(to_right,#000_calc(100%-2.5rem),transparent)] phone:pr-2 phone:[-webkit-mask-image:none] phone-portrait:basis-full phone-portrait:order-last phone-portrait:px-0"
        >
          <button
            v-for="(cat, index) in categoryList"
            :id="`cat-${index}`"
            :key="cat.category_id"
            type="button"
            class="tv-focusable shrink-0 rounded-full px-4 py-1.5 text-sm phone:text-xs phone-portrait:text-[0.85rem] font-medium transition-colors"
            :class="[
              activeCategory === cat.category_id
                ? 'bg-tv-accent text-tv-on-accent font-bold shadow-md scale-[1.02]'
                : 'bg-white/[0.08] text-neutral-300 hover:text-white hover:bg-white/15 border border-white/10'
            ]"
            :data-grid-index="index"
            :data-focus-active="activeCategory === cat.category_id ? 'true' : null"
            :aria-label="isLockedCategory(cat) ? `${cat.category_name} (bloqueada)` : null"
            @click="chooseCategory(cat)"
          >
            <span v-if="isLockedCategory(cat)" aria-hidden="true" class="mr-1.5">&#128274;</span>
            <span>{{ cat.category_name }}</span>
          </button>
        </div>
      </div>

      <!-- Celular/tablet: a busca mora aqui (a TV tem a Busca no menu lateral) -->
      <button
        v-if="handheld"
        id="catalog-search"
        type="button"
        class="tv-focusable shrink-0 flex items-center px-3 py-2 rounded-lg bg-white/[0.06] border border-white/10 text-neutral-300"
        title="Buscar"
        aria-label="Buscar"
        @click="emit('search')"
      >
        <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" />
        </svg>
      </button>

      <!-- Controle parental: bloquear (PIN) ou esconder categorias desta aba -->
      <button
        v-if="state.state === 'ready'"
        id="catalog-parental"
        type="button"
        class="tv-focusable shrink-0 flex items-center gap-2 px-4 phone:px-3 py-2 rounded-lg bg-white/[0.06] hover:bg-white/15 border border-white/10 text-neutral-300 hover:text-white text-sm phone:text-xs font-medium transition-colors"
        title="Controle parental"
        @click="parentalOpen = true"
      >
        <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="5" y="11" width="14" height="10" rx="2" />
          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </svg>
        <span class="inline phone-portrait:hidden">Controle parental</span>
      </button>

      <!-- Botão Atualizar Lista -->
      <button
        v-if="state.state === 'ready'"
        id="catalog-refresh"
        type="button"
        class="tv-focusable shrink-0 flex items-center gap-2 px-4 phone:px-3 py-2 rounded-lg bg-white/[0.06] hover:bg-white/15 border border-white/10 text-neutral-300 hover:text-white text-sm phone:text-xs font-medium transition-colors"
        title="Atualizar lista"
        @click="load(true)"
      >
        <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="23 4 23 10 17 10" />
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
        </svg>
        <span class="inline phone-portrait:hidden">Atualizar lista</span>
      </button>
    </header>

    <!-- Estado: Carregando / Baixando -->
    <div
      v-if="state.state === 'loading' || state.state === 'idle'"
      class="flex flex-col items-center justify-center flex-1 gap-6 phone:px-6"
      role="status"
    >
      <svg class="w-16 h-16 animate-spin text-tv-accent" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2.5" opacity="0.2" />
        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
      </svg>
      <p class="text-tv-base text-neutral-300 font-medium text-center">{{ state.step || 'Carregando catálogo...' }}</p>
      <div v-if="progressPct > 0" class="w-[30rem] max-w-[80vw] h-2 rounded-full bg-white/10 overflow-hidden">
        <div class="h-full bg-tv-accent" :style="{ width: progressPct + '%' }" />
      </div>
    </div>

    <!-- Estado: Erro -->
    <div
      v-else-if="state.state === 'error'"
      class="flex flex-col items-center justify-center flex-1 gap-4 max-w-[50rem] mx-auto text-center px-4"
    >
      <div class="w-16 h-16 rounded-full bg-red-500/15 flex items-center justify-center text-red-400 mb-2">
        <svg class="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </div>
      <p class="text-tv-lg text-white font-bold" role="alert">{{ state.error }}</p>
      <button id="catalog-retry" type="button" class="tv-btn tv-btn-primary !px-7 !py-3 mt-2" @click="load(true)">
        Tentar novamente
      </button>
    </div>

    <!-- Estado: Pronto (Conteúdo Principal com Rolagem) -->
    <div
      v-else
      id="catalog-content-area"
      class="flex-1 overflow-y-auto overflow-x-hidden relative"
      data-focus-group="catalog-content"
    >
      <!-- Hero Banner Destaque (Apenas para Filmes e Séries) -->
      <section
        v-if="!isLive && featuredRawItem && !showGrid"
        class="relative w-full min-h-[28rem] phone:min-h-[22rem] px-8 phone:px-4 pt-6 pb-10 flex flex-col justify-end overflow-hidden mb-4"
      >
        <!-- Fundo com Imagem e Vinhetas -->
        <div class="absolute inset-0 pointer-events-none overflow-hidden">
          <img
            v-if="featuredArtwork.url"
            :src="featuredArtwork.url"
            alt=""
            class="absolute right-0 top-0 w-[70%] phone:w-full h-full object-cover object-center opacity-45 pointer-events-none"
            @error="featuredArtworkFailed = true"
          />
          <div
            v-else
            class="absolute inset-0 bg-[radial-gradient(ellipse_at_70%_40%,#0e7490_0%,#164e63_25%,#0b1220_52%,#0b0f0c_78%)] opacity-70"
          />
          <div class="absolute inset-0 bg-gradient-to-r from-[#0b0f0c] via-[#0b0f0c]/85 to-transparent pointer-events-none" />
          <div class="absolute inset-0 bg-gradient-to-t from-[#0b0f0c] via-[#0b0f0c]/30 to-transparent pointer-events-none" />
        </div>

        <!-- Conteúdo do Hero -->
        <div class="relative z-10 max-w-2xl space-y-3">
          <div class="flex items-center gap-2">
            <BrandMark :size="1" class="text-tv-accent" />
            <span class="text-xs font-bold tracking-[0.25em] text-tv-accent uppercase">
              {{ section === 'vod' ? 'FILME DA SUA LISTA' : 'SÉRIE DA SUA LISTA' }}
            </span>
          </div>

          <h2 class="text-5xl phone:text-3xl font-black uppercase text-white line-clamp-2 leading-tight">
            {{ featuredTitle }}
          </h2>

          <div class="flex items-center gap-2.5 text-sm phone:text-xs text-neutral-300 font-medium flex-wrap">
            <span v-if="featuredRating" class="text-tv-accent font-bold">{{ featuredRating }}</span>
            <span v-if="featuredRating && featuredYear" class="w-1 h-1 rounded-full bg-neutral-500" />
            <span v-if="featuredYear">{{ featuredYear }}</span>
            <span v-if="featuredYear && featuredDuration" class="w-1 h-1 rounded-full bg-neutral-500" />
            <span>{{ featuredDuration }}</span>
            <span v-if="featuredGenre" class="w-1 h-1 rounded-full bg-neutral-500" />
            <span v-if="featuredGenre" class="truncate max-w-[15rem]">{{ featuredGenre }}</span>
          </div>

          <p class="text-sm phone:text-xs text-neutral-300 leading-relaxed line-clamp-3 max-w-xl">
            {{ featuredSynopsis }}
          </p>

          <!-- Ações do Hero -->
          <div data-focus-row="catalog-hero-actions" class="flex items-center gap-3 pt-2">
            <button
              id="catalog-hero-play"
              type="button"
              class="tv-focusable h-11 px-6 rounded-lg bg-white text-black font-bold text-sm flex items-center justify-center gap-2 shadow hover:bg-neutral-200 transition-colors"
              @click="handlePlayFeatured"
            >
              <svg class="w-4 h-4 fill-black shrink-0" viewBox="0 0 24 24">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              <span>Assistir</span>
            </button>

            <button
              id="catalog-hero-info"
              type="button"
              class="tv-focusable h-11 px-5 rounded-lg bg-white/10 hover:bg-white/20 text-white font-medium text-sm flex items-center justify-center gap-2 border border-white/10 transition-colors"
              @click="handleInfoFeatured"
            >
              <svg class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="16" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
              <span>Mais informações</span>
            </button>

            <button
              id="catalog-hero-mylist"
              type="button"
              class="tv-focusable h-11 w-11 rounded-lg bg-white/10 hover:bg-white/20 text-white flex items-center justify-center border border-white/10 transition-colors"
              :title="isFeaturedBookmarked ? 'Nos favoritos' : 'Adicionar aos favoritos'"
              @click="handleToggleBookmark"
            >
              <svg class="w-4 h-4" :class="isFeaturedBookmarked ? 'text-tv-accent' : ''" viewBox="0 0 24 24" :fill="isFeaturedBookmarked ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="2" stroke-linejoin="round">
                <path d="M12 20s-7-4.5-7-10a4 4 0 017-2.5A4 4 0 0119 10c0 5.5-7 10-7 10z" />
              </svg>
            </button>
          </div>
        </div>
      </section>

      <!-- Categoria escolhida: todos os itens em grade virtualizada -->
      <div v-if="showGrid && itemCount > 0" class="h-full px-6 phone:px-4 phone-portrait:px-3" data-focus-group="content" data-grid="content">
        <GridView
          :count="itemCount"
          :load-items="loadItems"
          :columns="layout.columns"
          :row-height="layout.rowHeight"
          :gap="layout.gap"
          :reset-key="gridKey"
          @select="(item, index) => handleSelectItem(item, index, activeCategory)"
        >
          <template #item="{ item, index, select }">
            <GridItem :variant="layout.variant" :item="item" :index="index" id-prefix="item" @select="select" />
          </template>
        </GridView>
      </div>

      <!-- Mensagem quando não há itens -->
      <div v-else-if="showGrid || categoryRows.length === 0" class="py-20 text-center text-neutral-400">
        <template v-if="section === 'series' && auth.session?.type === 'm3u' && activeCategory === ALL_CATEGORIES">
          <p class="text-tv-lg font-medium">Esta lista não tem séries.</p>
          <p class="mt-3 px-6 text-tv-sm">Listas no formato M3U trazem canais e filmes. As séries aparecem quando o servidor da lista oferece esse catálogo.</p>
        </template>
        <p v-else class="text-tv-lg font-medium">Nenhum item encontrado nesta categoria.</p>
        <button
          v-if="activeCategory !== ALL_CATEGORIES"
          type="button"
          class="tv-btn tv-btn-primary mt-4"
          @click="chooseCategory({ category_id: ALL_CATEGORIES })"
        >
          Ver todas as categorias
        </button>
      </div>

      <!-- Fileiras Deslizantes por Categoria (Estilo Netflix) -->
      <div v-else class="space-y-8 px-6 phone:px-4 pb-24">
        <div
          v-for="row in categoryRows"
          :key="row.category_id"
          class="group/row relative"
          :data-focus-group="`rail-${row.category_id}`"
        >
          <!-- Cabeçalho da Fileira -->
          <div class="flex items-center justify-between mb-3 px-1">
            <h3 class="text-xl phone:text-lg font-bold text-white tracking-tight flex items-center gap-2">
              <span>{{ row.category_name }}</span>
            </h3>
            <button
              v-if="row.category_id !== 'favorites'"
              :id="`see-all-${row.category_id}`"
              type="button"
              class="tv-focusable rounded px-3 py-3 -my-3 text-tv-xs phone:text-xs text-neutral-400 hover:text-tv-accent transition-colors"
              @click="chooseCategory({ category_id: row.category_id })"
            >
              Ver todos ›
            </button>
          </div>

          <!-- Botões de Seta (< e >) no Hover para Computador -->
          <button
            type="button"
            tabindex="-1"
            aria-label="Rolar para esquerda"
            v-show="railEdges[row.category_id] && !railEdges[row.category_id].start"
            class="flex phone:hidden absolute left-0 top-[55%] -translate-y-1/2 z-20 w-10 h-14 bg-black/80 hover:bg-black text-white items-center justify-center rounded-r-lg opacity-0 group-hover/row:opacity-100 transition-opacity shadow-lg"
            @click="scrollRail(row.category_id, -1)"
          >
            <svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>

          <button
            type="button"
            tabindex="-1"
            aria-label="Rolar para direita"
            v-show="railEdges[row.category_id] && !railEdges[row.category_id].end"
            class="flex phone:hidden absolute right-0 top-[55%] -translate-y-1/2 z-20 w-10 h-14 bg-black/80 hover:bg-black text-white items-center justify-center rounded-l-lg opacity-0 group-hover/row:opacity-100 transition-opacity shadow-lg"
            @click="scrollRail(row.category_id, 1)"
          >
            <svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>

          <!-- Trilho Horizontal Deslizante -->
          <div
            :ref="(el) => setRailRef(el, row.category_id)"
            class="flex gap-4 phone:gap-3 overflow-x-auto no-scrollbar scroll-smooth snap-x scroll-px-3 py-3 px-3"
            :data-focus-row="`rail-${row.category_id}`"
            data-scroll-x
            @scroll.passive="updateRailEdges(row.category_id)"
          >
            <!-- 1. Cards de TV ao Vivo (Cartões Largos) -->
            <template v-if="isLive">
              <button
                v-for="(item, itemIdx) in row.items"
                :id="`item-${row.category_id}-${itemIdx}`"
                :key="item.stream_id || itemIdx"
                type="button"
                class="tv-focusable shrink-0 snap-start w-72 phone:w-64 rounded-xl overflow-hidden bg-[#141418] border border-white/[0.08] transition-transform duration-300 hover:scale-[1.03] hover:ring-2 hover:ring-tv-accent focus:ring-2 focus:ring-tv-accent text-left group cursor-pointer"
                :data-rail-index="itemIdx"
                @click="handleSelectItem(item, itemIdx, row.category_id)"
              >
                <!-- Thumbnail / Backdrop Superior -->
                <div class="relative h-[10.125rem] phone:h-36 w-full overflow-hidden bg-[#1a1a20]">
                  <img
                    v-if="item.stream_icon"
                    :src="item.stream_icon"
                    alt=""
                    loading="lazy"
                    class="w-full h-full object-cover object-top"
                  />
                  <div v-else class="w-full h-full flex items-center justify-center bg-gradient-to-br from-[#1c2420] to-[#0e1410]">
                    <BrandMark :size="2.5" class="text-tv-accent opacity-40" />
                  </div>
                  <div class="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent pointer-events-none" />

                  <!-- Selo Vermelho ● AO VIVO -->
                  <span class="absolute top-2 left-2 flex items-center gap-1 rounded bg-[#ef4444] px-1.5 py-0.5 text-[10px] font-black text-white shadow-sm">
                    ● AO VIVO
                  </span>
                </div>

                <!-- Detalhes Inferiores -->
                <div class="p-3">
                  <p class="truncate text-sm font-bold text-white group-hover:text-tv-accent transition-colors">
                    {{ item.name || 'Ao vivo' }}
                  </p>
                </div>
              </button>
            </template>

            <!-- 2. Cards de Filmes e Séries (Pôsteres Verticais) -->
            <template v-else>
              <button
                v-for="(item, itemIdx) in row.items"
                :id="`item-${row.category_id}-${itemIdx}`"
                :key="item.stream_id || item.series_id || itemIdx"
                type="button"
                class="tv-focusable shrink-0 snap-start w-44 phone:w-40 h-[16.5rem] phone:h-60 rounded-xl overflow-hidden bg-[#141418] relative transition-transform duration-300 hover:scale-105 hover:ring-2 hover:ring-tv-accent focus:ring-2 focus:ring-tv-accent group text-left cursor-pointer border border-white/5"
                :data-rail-index="itemIdx"
                @click="handleSelectItem(item, itemIdx, row.category_id)"
              >
                <!-- Capa -->
                <img
                  v-if="item.stream_icon || item.cover"
                  :src="item.stream_icon || item.cover"
                  :alt="item.name"
                  loading="lazy"
                  class="w-full h-full object-cover"
                />
                <div v-else class="w-full h-full flex items-center justify-center bg-[#1a1a20]">
                  <span class="text-2xl font-bold text-neutral-500">{{ (item.name || '?').charAt(0) }}</span>
                </div>

                <!-- Selo NOVO / NOVO EP -->
                <span v-if="isRecent(item)" class="absolute top-2 left-2 z-10 rounded bg-tv-accent px-1.5 py-0.5 text-[10px] font-black text-tv-on-accent uppercase tracking-wider shadow-sm">
                  {{ section === 'vod' ? 'NOVO' : 'NOVO EP' }}
                </span>

                <!-- Faixa Escura Inferior com Título -->
                <div class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/60 to-transparent p-2.5 pt-6">
                  <p class="text-sm phone:text-xs font-semibold text-white truncate drop-shadow">
                    {{ item.name }}
                  </p>
                </div>
              </button>
            </template>
          </div>
        </div>
      </div>
    </div>

    <PinDialog
      v-if="pinFor"
      title="Categoria bloqueada"
      :hint="parental.needsPin() ? NO_PIN_YET : `Digite o PIN para abrir ${pinFor.category_name}.`"
      :submit="unlockCategory"
      @cancel="pinFor = null"
    />
    <ParentalModal v-if="parentalOpen" :section="section" :categories="managedCategories" @close="parentalOpen = false" />

    <!-- Modal de Detalhes da Mídia -->
    <MediaDetailsModal
      v-if="detailsTarget"
      :item="detailsTarget.item"
      :section="section"
      :category-id="detailsTarget.categoryId"
      :index-in-category="detailsTarget.index"
      @close="detailsTarget = null"
    />
  </section>
</template>
