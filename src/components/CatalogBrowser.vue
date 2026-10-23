<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useAuthStore } from '@/stores/authStore'
import { useCatalogStore } from '@/stores/catalogStore'
import { usePlayerStore } from '@/stores/playerStore'
import GridView from '@/components/GridView.vue'
import GridItem from '@/components/GridItem.vue'
import MediaDetailsModal from '@/components/MediaDetailsModal.vue'
import { ALL_CATEGORIES } from '@/services/catalogDb'
import { focusFirstIn, registerKeyHandler, isNavigable } from '@/utils/spatialNavigation'

/**
 * Navegador de catálogo (categorias + grade virtualizada) das abas TV ao vivo, Filmes e Séries do Dashboard.
 * Integração com Fases 4 (D-Pad, memória de foco entre painéis) e 5 (Player).
 */
const props = defineProps({
  section: { type: String, required: true }, // 'live' | 'vod' | 'series'
})

const auth = useAuthStore()
const catalog = useCatalogStore()
const player = usePlayerStore()

const activeCategory = ref(ALL_CATEGORIES)
const categoriesGridRef = ref(null)
const contentGridRef = ref(null)
/** Filme/série aberto na tela de detalhes: { item, index, categoryId } | null. */
const detailsTarget = ref(null)

const isLive = computed(() => props.section === 'live')
const state = computed(() => catalog.status[props.section])
const categoryList = computed(() => catalog.categories[props.section] || [])
const itemCount = computed(() => catalog.countFor(props.section, activeCategory.value))
const gridKey = computed(() => `${auth.currentListId}:${props.section}:${activeCategory.value}`)

const layout = computed(() =>
  isLive.value
    ? { columns: 3, rowHeight: 10, gap: 1.25, maxDomItems: 12, variant: 'channel' }
    : { columns: 4, rowHeight: 24, gap: 1.25, maxDomItems: 12, variant: 'poster' },
)

const loadItems = (start, count) =>
  catalog.getItems(props.section, activeCategory.value, start, count)
const loadCategories = (start, count) =>
  Promise.resolve(categoryList.value.slice(start, start + count))

async function chooseCategory(cat) {
  if (!cat) return
  activeCategory.value = cat.category_id
  await nextTick()
  if (contentGridRef.value) {
    const ok = await contentGridRef.value.focusIndex(0)
    if (!ok) focusFirstIn('[data-focus-group="content"]')
  }
}

function handleSelectItem(item, index) {
  if (!item) return
  // Filmes e séries abrem a tela de detalhes; só a TV ao Vivo toca direto.
  if (!isLive.value) {
    detailsTarget.value = { item, index, categoryId: activeCategory.value }
    return
  }
  player.playFromCatalog({
    section: props.section,
    categoryId: activeCategory.value,
    item,
    indexInCategory: index,
  })
}

const load = (force = false) => catalog.loadSection(props.section, { force })
const progressPct = computed(() => Math.round((state.value.progress || 0) * 100))

/** A grade de categorias lê os itens de forma assíncrona: focusIndex espera os botões existirem. */
async function focusActiveCategory() {
  await nextTick()
  if (!categoriesGridRef.value) return
  const index = categoryList.value.findIndex((c) => c.category_id === activeCategory.value)
  categoriesGridRef.value.focusIndex(Math.max(0, index))
}

// Foco Inicial Automático por Tela (CT 4.3 e Seção 2.2 D)
watch(
  () => state.value.state,
  (st) => {
    if (st === 'ready') {
      focusActiveCategory()
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
      load(true)
    }
  },
)

let cleanupKeyHandler = null

onMounted(() => {
  player.hydrate()
  load()

  cleanupKeyHandler = registerKeyHandler((action) => {
    const current = document.activeElement
    if (!current) return false

    const inCategories = current.closest && current.closest('[data-focus-group="categories"]')
    const inContent = current.closest && current.closest('[data-focus-group="content"]')

    if (inCategories) {
      if (action === 'right') {
        if (contentGridRef.value) {
          contentGridRef.value.focusIndex(0)
          return true
        }
        if (focusFirstIn('[data-focus-group="content"]')) {
          return true
        }
      }
      if (action === 'up') {
        const idx = parseInt(current.getAttribute('data-grid-index') || '0', 10)
        if (idx === 0) {
          const btn =
            document.getElementById('catalog-refresh') ||
            document.querySelector('[data-focus-row="navbar"] [data-focus-active="true"], #nav-home')
          if (btn && isNavigable(btn)) {
            btn.focus()
            return true
          }
        }
      }
    }

    if (inContent) {
      const idxRaw = current.getAttribute('data-grid-index')
      const idx = idxRaw !== null ? parseInt(idxRaw, 10) : -1
      const cols = layout.value.columns

      if (action === 'left') {
        // Se estiver na coluna 0 (index % columns === 0)
        if (idx >= 0 && idx % cols === 0) {
          const catActive = document.querySelector('[data-focus-group="categories"] [data-focus-active="true"]')
          if (catActive && isNavigable(catActive)) {
            catActive.focus()
            return true
          }
          if (focusFirstIn('[data-focus-group="categories"]')) {
            return true
          }
        }
      }

      if (action === 'up') {
        // Se estiver na linha 0 (index < columns)
        if (idx >= 0 && idx < cols) {
          const btn =
            document.getElementById('catalog-refresh') ||
            document.querySelector('[data-focus-row="navbar"] [data-focus-active="true"], #nav-home')
          if (btn && isNavigable(btn)) {
            btn.focus()
            return true
          }
        }
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
  <section class="flex flex-col w-full h-full bg-tv-deep pl-16 pr-24 py-14">
    <header data-focus-group="header" data-focus-row="catalog-header" class="flex items-center gap-6 shrink-0 h-[4.5rem] mb-2">
      <div class="ml-auto flex items-center gap-4">
        <button
          v-if="state.state === 'ready'"
          id="catalog-refresh"
          type="button"
          class="tv-btn text-tv-sm flex items-center gap-2 !px-6 !py-3"
          @click="load(true)"
        >
          <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
          <span>Atualizar lista</span>
        </button>
      </div>
    </header>

    <!-- Carregando / baixando -->
    <div
      v-if="state.state === 'loading' || state.state === 'idle'"
      class="flex flex-col items-center justify-center flex-1 gap-6"
      role="status"
    >
      <svg class="w-16 h-16 animate-spin text-tv-accent" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2.5" opacity="0.2" />
        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
      </svg>
      <p class="text-tv-base text-neutral-300 font-medium">{{ state.step || 'Carregando...' }}</p>
      <div v-if="progressPct > 0" class="w-[36rem] h-2 rounded-full bg-white/10 overflow-hidden">
        <div class="h-full bg-tv-accent transition-all" :style="{ width: progressPct + '%' }"></div>
      </div>
    </div>

    <!-- Erro -->
    <div v-else-if="state.state === 'error'" class="flex flex-col items-center justify-center flex-1 gap-4 max-w-[50rem] mx-auto text-center px-4">
      <div class="w-16 h-16 rounded-full bg-red-500/15 flex items-center justify-center text-red-400 mb-2">
        <svg class="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </div>
      <p class="text-tv-lg text-white font-bold" role="alert">{{ state.error }}</p>
      <div
        v-if="state.errorDetail"
        class="font-mono text-tv-xs text-red-300/90 bg-black/60 border border-red-500/20 rounded p-3 break-all text-left w-full max-h-40 overflow-y-auto"
      >
        <span class="text-neutral-400 font-semibold block mb-1">Diagnóstico técnico:</span>
        {{ state.errorDetail }}
      </div>
      <button id="catalog-retry" type="button" class="tv-btn tv-btn-primary !px-7 !py-3 mt-2" @click="load(true)">
        Tentar novamente
      </button>
    </div>

    <!-- Pronto -->
    <div v-else class="flex flex-1 min-h-0 gap-8 mt-4">
      <aside data-focus-group="categories" class="w-[20rem] shrink-0" aria-label="Categorias">
        <GridView
          ref="categoriesGridRef"
          :count="categoryList.length"
          :load-items="loadCategories"
          :columns="1"
          :row-height="4.2"
          :gap="0.6"
          :max-dom-items="10"
          :reset-key="section"
          data-grid="categories"
          @select="chooseCategory"
        >
          <template #item="{ item, index, select }">
            <GridItem
              variant="category"
              :item="item"
              :index="index"
              id-prefix="cat"
              :active="item.category_id === activeCategory"
              @select="select"
            />
          </template>
        </GridView>
      </aside>

      <div data-focus-group="content" class="flex-1 min-w-0" data-grid="content">
        <p v-if="!itemCount" class="mt-16 text-center text-tv-lg text-tv-muted">Nenhum item encontrado.</p>
        <GridView
          v-else
          ref="contentGridRef"
          :count="itemCount"
          :load-items="loadItems"
          :columns="layout.columns"
          :row-height="layout.rowHeight"
          :gap="layout.gap"
          :max-dom-items="layout.maxDomItems"
          :reset-key="gridKey"
          @select="handleSelectItem"
        >
          <template #item="{ item, index, select }">
            <GridItem
              :variant="layout.variant"
              :item="item"
              :index="index"
              id-prefix="item"
              @select="select"
            />
          </template>
        </GridView>
      </div>
    </div>

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
