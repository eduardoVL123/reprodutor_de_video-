<script setup>
import { ref, shallowRef, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useAuthStore } from '@/stores/authStore'
import { useCatalogStore } from '@/stores/catalogStore'
import { usePlayerStore } from '@/stores/playerStore'
import { useProfileStore } from '@/stores/profileStore'
import { storage } from '@/services/storage'
import {
  searchCatalog,
  getSuggestions,
  highlightParts,
  normalizeText,
  MIN_QUERY_LENGTH,
  SEARCH_SECTIONS,
} from '@/services/catalogSearch'
import GridItem from '@/components/GridItem.vue'
import MediaDetailsModal from '@/components/MediaDetailsModal.vue'
import { registerBackHandler, registerKeyHandler, isEditingTextField, focusFirstIn } from '@/utils/spatialNavigation'

/**
 * Busca para TV (RFC-013): teclado na tela operado pelo D-Pad, sugestões e
 * resultados a partir da 3ª letra em Filmes, Séries e TV ao Vivo.
 */
const DEBOUNCE_MS = 300
const MAX_QUERY_LENGTH = 60
const RESULTS_PER_SECTION = 40 // limita o DOM da grade em TVs mais fracas
const RECENT_MAX = 8
const RESULT_COLUMNS = 4
const KEYBOARD_ROWS = [
  ['a', 'b', 'c', 'd', 'e', 'f'],
  ['g', 'h', 'i', 'j', 'k', 'l'],
  ['m', 'n', 'o', 'p', 'q', 'r'],
  ['s', 't', 'u', 'v', 'w', 'x'],
  ['y', 'z', '1', '2', '3', '4'],
  ['5', '6', '7', '8', '9', '0'],
]
const SECTION_BADGES = { vod: 'FILME', series: 'SÉRIE' }
const SECTION_NAMES = { vod: 'Filmes', series: 'Séries', live: 'TV ao vivo' }

const auth = useAuthStore()
const catalog = useCatalogStore()
const player = usePlayerStore()
const profileStore = useProfileStore()

const rootEl = ref(null)
const query = ref('')
const results = shallowRef([])
const counts = ref({})
const isSearching = ref(false)
const activeFilter = ref('all')
const recentSearches = ref([])
const detailsTarget = ref(null) // { item, section } aberto na tela de detalhes

let lastKeyId = 'kb-a'
let lastSuggestionId = ''
let debounceTimer = null
let searchSeq = 0
let cleanupBack = null
let cleanupKey = null

// Listas M3U só têm canais e filmes; pedir "series" baixaria a playlist inteira de novo.
const searchSections = computed(() =>
  auth.session && auth.session.type === 'm3u' ? ['vod', 'live'] : SEARCH_SECTIONS,
)
const readySections = computed(() => searchSections.value.filter((s) => catalog.status[s].state === 'ready'))
const loadingSections = computed(() => searchSections.value.filter((s) => catalog.status[s].state === 'loading'))
const loadingNotice = computed(() => loadingSections.value.map((s) => SECTION_NAMES[s]).join(', '))

const hasMinQuery = computed(() => normalizeText(query.value).length >= MIN_QUERY_LENGTH)
const suggestions = computed(() => getSuggestions(results.value))
// Só mostra filtros de tipos que têm resultado; "Tudo" apenas quando há mais de um tipo.
const filters = computed(() => {
  const withResults = searchSections.value.filter((s) => counts.value[s] > 0)
  if (withResults.length < 2) return []
  return [{ id: 'all', label: 'Tudo' }].concat(withResults.map((s) => ({ id: s, label: SECTION_NAMES[s] })))
})
// Filtro escolhido que deixou de ter resultado (nova busca) volta para "Tudo".
const effectiveFilter = computed(() =>
  filters.value.some((f) => f.id === activeFilter.value) ? activeFilter.value : 'all',
)
const visibleResults = computed(() =>
  effectiveFilter.value === 'all' ? results.value : results.value.filter((r) => r.section === effectiveFilter.value),
)

// ---------- Busca ----------
async function runSearch() {
  const my = ++searchSeq
  if (!hasMinQuery.value) {
    results.value = []
    counts.value = {}
    isSearching.value = false
    return
  }
  isSearching.value = true
  try {
    const res = await searchCatalog(query.value, { sections: readySections.value, limit: RESULTS_PER_SECTION })
    if (my !== searchSeq) return
    results.value = res.results
    counts.value = res.counts
  } catch (err) {
    console.warn('[search] Falha na busca:', err)
    if (my === searchSeq) {
      results.value = []
      counts.value = {}
    }
  } finally {
    if (my === searchSeq) isSearching.value = false
  }
}

function scheduleSearch() {
  if (debounceTimer) clearTimeout(debounceTimer)
  if (!hasMinQuery.value) {
    runSearch()
    return
  }
  isSearching.value = true
  debounceTimer = setTimeout(runSearch, DEBOUNCE_MS)
}

watch(() => normalizeText(query.value), scheduleSearch)
// Uma seção que termina de baixar entra na busca em andamento.
watch(
  () => readySections.value.join(','),
  () => {
    if (hasMinQuery.value) runSearch()
  },
)

// ---------- Teclado ----------
function typeText(text) {
  query.value = (query.value + text).slice(0, MAX_QUERY_LENGTH)
}

function typeSpace() {
  if (query.value && query.value.charAt(query.value.length - 1) !== ' ') typeText(' ')
}

function backspace() {
  query.value = query.value.slice(0, -1)
}

function clearQuery() {
  query.value = ''
}

function onKeyFocus(event) {
  lastKeyId = event.target.id
}

function focusById(id) {
  const el = id ? document.getElementById(id) : null
  if (!el) return false
  el.focus()
  return true
}

const focusLastKey = () => focusById(lastKeyId) || focusById('kb-a')

// ---------- Buscas recentes (por perfil) ----------
const recentKey = () => `search:recent:${profileStore.activeProfileId || 'default'}`

async function loadRecent() {
  try {
    const saved = await storage.get(recentKey())
    recentSearches.value = Array.isArray(saved) ? saved.slice(0, RECENT_MAX) : []
  } catch (err) {
    console.warn('[search] Falha ao ler buscas recentes:', err)
    recentSearches.value = []
  }
}

function rememberSearch() {
  const term = query.value.trim()
  const key = normalizeText(term)
  if (key.length < MIN_QUERY_LENGTH) return
  const list = [term].concat(recentSearches.value.filter((t) => normalizeText(t) !== key)).slice(0, RECENT_MAX)
  recentSearches.value = list
  storage.set(recentKey(), list).catch((err) => console.warn('[search] Falha ao salvar busca recente:', err))
}

watch(() => profileStore.activeProfileId, loadRecent)

function useRecent(term) {
  query.value = term
  nextTick(focusLastKey)
}

/** Preenche a busca com o título sugerido, busca na hora e leva o foco ao 1º resultado. */
async function useSuggestion(title) {
  query.value = title
  await nextTick()
  if (debounceTimer) clearTimeout(debounceTimer)
  await runSearch()
  await nextTick()
  focusFirstIn('[data-focus-group="search-results"]')
}

// ---------- Resultados ----------
function openResult(result) {
  rememberSearch()
  if (result.section === 'live') {
    player.playItem({ ...result.item, section: 'live' })
    return
  }
  detailsTarget.value = { item: result.item, section: result.section }
}

function onResultFocus(event) {
  try {
    event.target.scrollIntoView({ block: 'nearest' })
  } catch (_) {
    event.target.scrollIntoView(false)
  }
}

// ---------- D-Pad, Voltar e digitação ----------
const closestIn = (el, selector) => !!(el && el.closest && el.closest(selector))

/** Teclas só valem com o foco nesta tela (não em overlays por cima, como perfis ou listas). */
function ownsFocus() {
  if (player.isOpen || detailsTarget.value || !rootEl.value) return false
  return rootEl.value.contains(document.activeElement)
}

function onSearchKey(action, event) {
  if (!ownsFocus()) return false
  const el = document.activeElement

  // Backspace de teclado físico apaga uma letra (o Voltar do controle chega como Escape).
  if (action === 'back' && event && event.key === 'Backspace') {
    if (!query.value) return false
    backspace()
    return true
  }
  if (action === 'right' && el && el.getAttribute('data-kb-last-col') === 'true') {
    return focusFirstIn('[data-focus-group="search-suggestions"]') || focusFirstIn('[data-focus-group="search-results"]')
  }
  if (action === 'right' && closestIn(el, '[data-focus-group="search-suggestions"]')) {
    return focusFirstIn('[data-focus-group="search-results"]')
  }
  if (action === 'left' && closestIn(el, '[data-focus-group="search-suggestions"]')) {
    return focusLastKey()
  }
  if (action === 'left' && closestIn(el, '[data-focus-group="search-results"]')) {
    const index = parseInt(el.getAttribute('data-item-index') || '-1', 10)
    if (index >= 0 && index % RESULT_COLUMNS === 0) {
      return focusById(lastSuggestionId) || focusFirstIn('[data-focus-group="search-suggestions"]') || focusLastKey()
    }
  }
  return false
}

function onSearchBack() {
  if (!ownsFocus()) return false
  if (closestIn(document.activeElement, '[data-search-panel="results"]')) {
    focusLastKey()
    return true
  }
  if (query.value) {
    clearQuery()
    return true
  }
  return false
}

/** Letras/números de teclado físico ou do controle numérico entram direto na busca. */
function onTypingKey(event) {
  if (event.defaultPrevented || !ownsFocus()) return
  if (event.ctrlKey || event.altKey || event.metaKey) return
  if (isEditingTextField(document.activeElement)) return
  if (event.key === 'Backspace') {
    if (query.value) {
      event.preventDefault()
      backspace()
    }
    return
  }
  if (event.key === ' ') {
    event.preventDefault() // evita "clicar" o botão focado
    typeSpace()
    return
  }
  if (event.key && event.key.length === 1 && normalizeText(event.key)) {
    typeText(event.key.toLowerCase())
  }
}

onMounted(() => {
  searchSections.value.forEach((s) => {
    if (catalog.status[s].state === 'idle') catalog.loadSection(s)
  })
  loadRecent()
  cleanupBack = registerBackHandler(onSearchBack)
  cleanupKey = registerKeyHandler(onSearchKey)
  window.addEventListener('keydown', onTypingKey)
  nextTick(focusLastKey)
})

onBeforeUnmount(() => {
  if (debounceTimer) clearTimeout(debounceTimer)
  searchSeq++
  if (cleanupBack) cleanupBack()
  if (cleanupKey) cleanupKey()
  window.removeEventListener('keydown', onTypingKey)
})
</script>

<template>
  <section ref="rootEl" class="flex w-full h-full gap-10 px-16 pt-6 pb-4 bg-[#07070a] text-white" aria-label="Buscar">
    <!-- Consulta + teclado na tela -->
    <div class="w-[34rem] shrink-0 flex flex-col" data-focus-group="search-keyboard">
      <div data-focus-row="search-input-row">
        <input
          id="search-input"
          v-model="query"
          type="text"
          readonly="readonly"
          data-tv-editing="false"
          autocomplete="off"
          :maxlength="MAX_QUERY_LENGTH"
          class="tv-input !h-[4rem] !text-tv-lg"
          placeholder="Buscar filmes, séries e canais"
        />
      </div>
      <p class="mt-2 text-tv-sm text-neutral-500">Use as letras abaixo ou aperte OK no campo para abrir o teclado do aparelho</p>

      <div class="mt-5 space-y-2.5">
        <div
          v-for="(row, r) in KEYBOARD_ROWS"
          :key="'kb-row-' + r"
          :data-focus-row="'kb-row-' + r"
          class="grid grid-cols-6 gap-2.5"
        >
          <button
            v-for="(ch, c) in row"
            :id="'kb-' + ch"
            :key="ch"
            type="button"
            class="tv-focusable h-[4.5rem] rounded-lg bg-white/[0.06] border border-white/10 text-tv-base font-semibold text-white focus:bg-white focus:text-black"
            :data-kb-last-col="c === row.length - 1 ? 'true' : null"
            @focus="onKeyFocus"
            @click="typeText(ch)"
          >
            {{ ch }}
          </button>
        </div>

        <div data-focus-row="kb-actions" class="grid grid-cols-3 gap-2.5 pt-1">
          <button
            id="kb-space"
            type="button"
            class="tv-focusable h-[4.5rem] rounded-lg bg-white/[0.06] border border-white/10 text-tv-sm font-semibold text-white flex items-center justify-center gap-2.5 focus:bg-white focus:text-black"
            @focus="onKeyFocus"
            @click="typeSpace"
          >
            <svg class="w-6 h-6 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 10 3 15 21 15 21 10" />
            </svg>
            <span>Espaço</span>
          </button>
          <button
            id="kb-backspace"
            type="button"
            class="tv-focusable h-[4.5rem] rounded-lg bg-white/[0.06] border border-white/10 text-tv-sm font-semibold text-white flex items-center justify-center gap-2.5 focus:bg-white focus:text-black"
            @focus="onKeyFocus"
            @click="backspace"
          >
            <svg class="w-6 h-6 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z" />
              <line x1="18" y1="9" x2="12" y2="15" />
              <line x1="12" y1="9" x2="18" y2="15" />
            </svg>
            <span>Apagar</span>
          </button>
          <button
            id="kb-clear"
            type="button"
            class="tv-focusable h-[4.5rem] rounded-lg bg-white/[0.06] border border-white/10 text-tv-sm font-semibold text-white flex items-center justify-center focus:bg-white focus:text-black"
            data-kb-last-col="true"
            @focus="onKeyFocus"
            @click="clearQuery"
          >
            Limpar
          </button>
        </div>
      </div>
    </div>

    <!-- Sugestões + resultados -->
    <div class="flex-1 min-w-0 flex gap-8" data-search-panel="results">
      <!-- Menos de 3 letras: dica + buscas recentes -->
      <div v-if="!hasMinQuery" class="flex-1 pt-3">
        <p class="text-tv-base text-neutral-400">Digite pelo menos 3 letras para ver sugestões</p>
        <div v-if="recentSearches.length" class="mt-10" data-focus-group="search-recent">
          <h3 class="text-tv-sm font-bold text-neutral-300 uppercase tracking-[0.2em] mb-4">Buscas recentes</h3>
          <div class="flex flex-col items-start gap-3">
            <button
              v-for="(term, i) in recentSearches"
              :id="'search-recent-' + i"
              :key="term"
              type="button"
              class="tv-focusable h-[3.25rem] px-5 rounded-lg bg-white/[0.06] border border-white/10 text-tv-sm text-neutral-200 flex items-center gap-3"
              @click="useRecent(term)"
            >
              <svg class="w-5 h-5 shrink-0 text-neutral-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              <span class="truncate max-w-[28rem]">{{ term }}</span>
            </button>
          </div>
        </div>
      </div>

      <template v-else>
        <!-- Sugestões de títulos -->
        <div class="w-[22rem] shrink-0 pt-1" data-focus-group="search-suggestions">
          <h3 class="text-tv-sm font-bold text-neutral-300 uppercase tracking-[0.2em] mb-3 px-4">Sugestões</h3>
          <div class="flex flex-col gap-1">
            <button
              v-for="(title, i) in suggestions"
              :id="'search-sug-' + i"
              :key="title"
              type="button"
              class="tv-focusable w-full text-left px-4 py-2.5 rounded-lg text-tv-sm truncate focus:bg-white/[0.08]"
              @focus="lastSuggestionId = $event.target.id"
              @click="useSuggestion(title)"
            >
              <span
                v-for="(part, p) in highlightParts(title, query)"
                :key="p"
                :class="part.match ? 'text-white font-bold' : 'text-neutral-400'"
              >{{ part.text }}</span>
            </button>
          </div>
          <p v-if="!suggestions.length && !isSearching" class="px-4 text-tv-sm text-neutral-500">Sem sugestões</p>
        </div>

        <!-- Filtros + grade de resultados -->
        <div class="flex-1 min-w-0 flex flex-col">
          <div v-if="filters.length" data-focus-row="search-filters" class="flex items-center gap-3 shrink-0">
            <button
              v-for="f in filters"
              :id="'search-filter-' + f.id"
              :key="f.id"
              type="button"
              class="tv-focusable h-[3.25rem] px-5 rounded-lg border text-tv-sm font-semibold"
              :class="
                effectiveFilter === f.id
                  ? 'bg-[#e50914] border-[#e50914] text-white'
                  : 'bg-white/[0.04] border-white/10 text-neutral-300'
              "
              @click="activeFilter = f.id"
            >
              {{ f.label }}
            </button>
          </div>

          <p v-if="loadingNotice" class="mt-3 text-tv-sm text-neutral-500">Atualizando catálogo de {{ loadingNotice }}…</p>

          <!-- Buscando ou catálogo ainda baixando (sem resultados para mostrar) -->
          <div
            v-if="(isSearching || loadingNotice) && !visibleResults.length"
            class="grid grid-cols-4 gap-4 mt-5"
            aria-hidden="true"
          >
            <div v-for="i in 4" :key="'search-skel-' + i" class="h-[16.5rem] rounded-xl bg-white/[0.05] animate-pulse" />
          </div>

          <!-- Nenhum resultado -->
          <div v-else-if="!visibleResults.length" class="mt-12 text-center">
            <p class="text-tv-lg text-white font-semibold">Nenhum resultado para "{{ query.trim() }}"</p>
            <p class="text-tv-base text-neutral-400 mt-2">Confira a ortografia ou tente outro nome.</p>
          </div>

          <!-- Resultados -->
          <template v-else>
            <div class="flex-1 min-h-0 overflow-y-auto mt-4 px-1 pt-1 pb-6" data-focus-group="search-results">
              <div class="grid grid-cols-4 gap-4">
                <div
                  v-for="(r, i) in visibleResults"
                  :key="r.section + ':' + r.item.stream_id"
                  class="relative h-[16.5rem]"
                  @focusin="onResultFocus"
                >
                  <GridItem
                    :variant="r.section === 'live' ? 'channel' : 'poster'"
                    :item="r.item"
                    :index="i"
                    id-prefix="search-res"
                    @select="openResult(r)"
                  />
                  <!-- O card de canal já traz "AO VIVO" no próprio layout -->
                  <span
                    v-if="r.section !== 'live'"
                    class="absolute top-2.5 right-2.5 z-20 px-2 py-0.5 rounded text-tv-xs font-bold tracking-wider pointer-events-none bg-black/70 border border-white/20 text-white"
                  >
                    {{ SECTION_BADGES[r.section] }}
                  </span>
                </div>
              </div>
            </div>
          </template>
        </div>
      </template>
    </div>

    <MediaDetailsModal
      v-if="detailsTarget"
      :item="detailsTarget.item"
      :section="detailsTarget.section"
      @close="detailsTarget = null"
    />
  </section>
</template>
