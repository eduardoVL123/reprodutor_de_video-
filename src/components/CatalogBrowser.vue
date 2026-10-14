<script setup>
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/authStore'
import { useCatalogStore } from '@/stores/catalogStore'
import { usePlayerStore } from '@/stores/playerStore'
import GridView from '@/components/GridView.vue'
import GridItem from '@/components/GridItem.vue'
import { ALL_CATEGORIES } from '@/services/catalogDb'
import { focusFirstIn } from '@/utils/spatialNavigation'

/**
 * Navegador de catálogo (categorias + grade virtualizada) usado por LiveTV e VOD.
 * Integração com Fases 4 (D-Pad, memória de foco entre painéis) e 5 (Player).
 */
const props = defineProps({
  section: { type: String, required: true }, // 'live' | 'vod' | 'series'
  title: { type: String, default: '' },
  embedded: { type: Boolean, default: false },
})

const emit = defineEmits(['select-item'])

const router = useRouter()
const auth = useAuthStore()
const catalog = useCatalogStore()
const player = usePlayerStore()

const activeCategory = ref(ALL_CATEGORIES)
const contentGridRef = ref(null)

const isLive = computed(() => props.section === 'live')
const state = computed(() => catalog.status[props.section])
const categoryList = computed(() => catalog.categories[props.section] || [])
const itemCount = computed(() => catalog.countFor(props.section, activeCategory.value))
const gridKey = computed(() => `${auth.currentListId}:${props.section}:${activeCategory.value}`)

// Layout: canais em lista (1 coluna); filmes e séries em matriz de 4 colunas (CT 3.2).
// Orçamento de DOM da tela inteira (categorias + grade) ≤ 20 elementos (CT 4.1).
const layout = computed(() =>
  isLive.value
    ? { columns: 1, rowHeight: 8.5, gap: 1, maxDomItems: 8, variant: 'channel' }
    : { columns: 4, rowHeight: 30, gap: 1.5, maxDomItems: 12, variant: 'poster' },
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
  if (props.section === 'series') {
    emit('select-item', { item, index, categoryId: activeCategory.value })
    return
  }
  player.playFromCatalog({
    section: props.section,
    categoryId: activeCategory.value,
    item,
    indexInCategory: index,
  })
}

function playQueue() {
  if (player.customQueue.length > 0) {
    player.playFromCustomQueue()
  }
}

const load = (force = false) => catalog.loadSection(props.section, { force })
const progressPct = computed(() => Math.round((state.value.progress || 0) * 100))
const fmt = (n) => Number(n || 0).toLocaleString('pt-BR')

// Foco Inicial Automático por Tela (CT 4.3 e Seção 2.2 D)
watch(
  () => state.value.state,
  (st) => {
    if (st === 'ready') {
      nextTick(() => {
        focusFirstIn('[data-focus-group="categories"]')
      })
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

onMounted(() => {
  player.hydrate()
  load()
})
</script>

<template>
  <section
    class="flex flex-col w-full h-full bg-[#0a0a0a]"
    :class="embedded ? 'px-8 py-3' : 'px-12 py-8'"
  >
    <header data-focus-group="header" class="flex items-center gap-6 shrink-0" :class="embedded ? 'h-[3.5rem] mb-2' : 'h-[5.5rem]'">
      <button
        v-if="!embedded"
        id="catalog-back"
        type="button"
        class="tv-btn !px-6 !py-2.5"
        @click="router.replace({ name: 'dashboard' })"
      >
        <svg class="w-4 h-4 mr-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        Voltar
      </button>
      <h1 v-if="!embedded && title" class="text-tv-xl font-bold text-white tracking-tight">{{ title }}</h1>
      <span v-if="state.state === 'ready'" class="text-tv-base text-neutral-400 font-medium">
        {{ fmt(itemCount) }} itens disponíveis
      </span>

      <div class="ml-auto flex items-center gap-4">
        <!-- Botão Minha Fila -->
        <button
          v-if="!embedded"
          id="catalog-queue"
          type="button"
          class="tv-btn !px-6 !py-2.5"
          :class="player.customQueue.length > 0 ? 'text-amber-400 border-amber-400/40' : 'text-neutral-500 opacity-60'"
          :disabled="player.customQueue.length === 0"
          @click="playQueue"
        >
          Minha Lista ({{ player.customQueue.length }})
        </button>

        <button
          v-if="state.state === 'ready'"
          id="catalog-refresh"
          type="button"
          class="tv-btn text-tv-sm flex items-center gap-2"
          :class="embedded ? '!px-4 !py-2' : '!px-6 !py-2.5'"
          @click="load(true)"
        >
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
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
      <svg class="w-16 h-16 animate-spin text-[#e50914]" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2.5" opacity="0.2" />
        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
      </svg>
      <p class="text-tv-base text-neutral-300 font-medium">{{ state.step || 'Carregando...' }}</p>
      <div v-if="progressPct > 0" class="w-[36rem] h-2 rounded-full bg-white/10 overflow-hidden">
        <div class="h-full bg-[#e50914] transition-all" :style="{ width: progressPct + '%' }"></div>
      </div>
    </div>

    <!-- Erro -->
    <div v-else-if="state.state === 'error'" class="flex flex-col items-center justify-center flex-1 gap-6">
      <p class="text-tv-base text-red-400 text-center max-w-[50rem]" role="alert">{{ state.error }}</p>
      <button id="catalog-retry" type="button" class="tv-btn tv-btn-primary !px-7 !py-3" @click="load(true)">
        Tentar novamente
      </button>
    </div>

    <!-- Pronto -->
    <div v-else class="flex flex-1 min-h-0 gap-8 mt-4">
      <aside data-focus-group="categories" class="w-[26rem] shrink-0" aria-label="Categorias">
        <GridView
          :count="categoryList.length"
          :load-items="loadCategories"
          :columns="1"
          :row-height="8.5"
          :gap="1.5"
          :max-dom-items="7"
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
  </section>
</template>
