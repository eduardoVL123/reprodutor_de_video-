<script setup>
import { ref, shallowRef, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { registerGrid } from '@/utils/spatialNavigation'

/**
 * Grade virtualizada com reciclagem de DOM.
 *
 * - O contêiner rola de verdade (overflow-y com scrollbar oculta), mas só as linhas
 *   que intersectam a viewport (+1 de folga) existem no DOM.
 * - Cada "slot" tem chave = (linha % linhasDoPool) * colunas + coluna. Ao rolar, o
 *   Vue reaproveita o MESMO elemento DOM e só troca os dados (reciclagem).
 * - Os dados vêm de `loadItems(start, count)` sob demanda (IndexedDB); nada de
 *   array com 50.000 itens aqui.
 * - Todas as medidas de layout estão em rem (a raiz escala com a largura da TV).
 * - Fase 4: registra-se em `spatialNavigation` (`data-grid-root`). As setas viram
 *   navegação por índice lógico e `focusIndex` rola + aguarda a janela + foca o
 *   slot reciclado que passou a exibir aquele índice (`data-grid-index`).
 */
const props = defineProps({
  count: { type: Number, required: true },
  loadItems: { type: Function, required: true }, // (start, count) => Promise<Item[]>
  columns: { type: Number, default: 4 },
  rowHeight: { type: Number, default: 20 }, // rem
  gap: { type: Number, default: 1.5 }, // rem
  maxDomItems: { type: Number, default: 20 },
  resetKey: { type: [String, Number], default: '' }, // mudou => volta ao topo e recarrega
})
const emit = defineEmits(['select'])

const PAD = 1 // rem de respiro (evita cortar o anel de foco/escala)

const viewportEl = ref(null)
const slots = shallowRef([])
const viewportPx = ref(0)
const rootPx = ref(16)

const pitch = computed(() => props.rowHeight + props.gap) // rem
const pitchPx = computed(() => pitch.value * rootPx.value)
const totalRows = computed(() => Math.ceil(props.count / props.columns))
const contentHeight = computed(() =>
  totalRows.value ? totalRows.value * pitch.value - props.gap + PAD * 2 : 0,
)

// Máximo de linhas que podem intersectar a viewport + 1 linha de folga (respeitando estritamente o cap de DOM).
const poolRows = computed(() => {
  const visibleRows = Math.ceil(viewportPx.value / Math.max(pitchPx.value, 1))
  const cap = Math.max(1, Math.floor(props.maxDomItems / props.columns))
  return Math.max(1, Math.min(visibleRows + 1, cap))
})

let renderToken = 0
let lastFirst = -1
let lastLast = -1
let ticking = false
let frame = 0
let pending = Promise.resolve() // leitura da janela atual (reaproveitada por focusIndex)
let focusToken = 0
let pendingFocus = -1
let unregisterGrid = null

const clamp = (v, min, max) => Math.min(Math.max(v, min), max)

/** @returns {Promise<void>} resolve quando a janela visível estiver carregada. */
function refresh(force = false) {
  const el = viewportEl.value
  if (!el || !props.count) {
    renderToken++
    slots.value = []
    lastFirst = lastLast = -1
    pending = Promise.resolve()
    return pending
  }
  const padPx = PAD * rootPx.value
  const rawFirst = Math.floor(Math.max(0, el.scrollTop - padPx) / pitchPx.value)
  const first = clamp(rawFirst, 0, Math.max(0, totalRows.value - poolRows.value))
  const last = Math.min(totalRows.value - 1, first + poolRows.value - 1)

  if (!force && first === lastFirst && last === lastLast) return pending
  lastFirst = first
  lastLast = last

  const start = first * props.columns
  const end = Math.min(props.count, (last + 1) * props.columns)
  const token = ++renderToken

  pending = (async () => {
    let items = []
    try {
      items = await props.loadItems(start, end - start)
    } catch (err) {
      console.warn('[GridView] Falha ao ler janela de itens:', err)
    }
    if (token !== renderToken) return // chegou uma rolagem mais nova; descarta esta

    slots.value = items.map((item, k) => {
      const index = start + k
      const row = Math.floor(index / props.columns)
      const col = index % props.columns
      return { key: (row % poolRows.value) * props.columns + col, index, row, col, item }
    })
  })()
  return pending
}

function measure() {
  const el = viewportEl.value
  if (!el) return
  rootPx.value = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
  viewportPx.value = el.clientHeight
  refresh(true)
}

function onScroll() {
  if (ticking) return
  ticking = true
  frame = requestAnimationFrame(() => {
    ticking = false
    refresh()
  })
}

/** Rola o mínimo necessário para que a linha do item fique totalmente visível. */
function scrollToIndex(index) {
  const el = viewportEl.value
  if (!el || index < 0 || index >= props.count) return
  const row = Math.floor(index / props.columns)
  const top = (PAD + row * pitch.value) * rootPx.value
  const bottom = top + props.rowHeight * rootPx.value
  const margin = PAD * rootPx.value
  if (top - margin < el.scrollTop) el.scrollTop = Math.max(0, top - margin)
  else if (bottom + margin > el.scrollTop + el.clientHeight) el.scrollTop = bottom + margin - el.clientHeight
}

/**
 * Enquadra o índice, espera a janela correspondente (IndexedDB) e foca o slot
 * reciclado com `data-grid-index === index`. Chamadas mais novas cancelam as antigas.
 * @returns {Promise<boolean>}
 */
async function focusIndex(index) {
  if (!viewportEl.value || index < 0 || index >= props.count) return false
  const token = ++focusToken
  pendingFocus = index
  scrollToIndex(index)
  await refresh()
  await nextTick()
  if (token !== focusToken) return false
  pendingFocus = -1
  const el = viewportEl.value && viewportEl.value.querySelector(`[data-grid-index="${index}"]`)
  if (!el) return false
  try {
    el.focus({ preventScroll: true })
  } catch (_) {
    el.focus()
  }
  return true
}

/** Índice lógico atual: o alvo pendente ou o do elemento focado dentro da grade. */
function currentIndex() {
  if (pendingFocus >= 0) return pendingFocus
  const el = document.activeElement
  if (!el || !viewportEl.value || !viewportEl.value.contains(el)) return -1
  const raw = el.getAttribute('data-grid-index')
  const n = raw === null ? NaN : parseInt(raw, 10)
  return isNaN(n) ? -1 : n
}

const slotStyle = (s) => {
  const gapsTotal = props.gap * (props.columns - 1)
  return {
    top: `${PAD + s.row * pitch.value}rem`,
    left: `calc(${PAD}rem + ${s.col} * ((100% - ${PAD * 2 + gapsTotal}rem) / ${props.columns} + ${props.gap}rem))`,
    width: `calc((100% - ${PAD * 2 + gapsTotal}rem) / ${props.columns})`,
    height: `${props.rowHeight}rem`,
  }
}

watch(
  () => [props.count, props.resetKey],
  () => {
    if (viewportEl.value) viewportEl.value.scrollTop = 0
    refresh(true)
  },
)
watch(() => [props.columns, props.rowHeight, props.gap, props.maxDomItems], measure)

onMounted(() => {
  measure()
  window.addEventListener('resize', measure)
  unregisterGrid = registerGrid(viewportEl.value, {
    columns: () => props.columns,
    count: () => props.count,
    currentIndex,
    isPending: () => pendingFocus >= 0,
    focusIndex,
  })
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', measure)
  cancelAnimationFrame(frame)
  renderToken++ // invalida leituras em voo
  focusToken++
  if (unregisterGrid) unregisterGrid()
})

defineExpose({ scrollToIndex, refresh, measure, focusIndex })
</script>

<template>
  <div
    ref="viewportEl"
    class="w-full h-full overflow-y-auto overflow-x-hidden"
    role="grid"
    data-grid-root
    :data-grid-total="count"
    @scroll.passive="onScroll"
  >
    <div class="relative w-full" :style="{ height: contentHeight + 'rem' }">
      <div
        v-for="s in slots"
        :key="s.key"
        class="absolute"
        data-grid-slot
        :style="slotStyle(s)"
      >
        <slot
          name="item"
          :item="s.item"
          :index="s.index"
          :select="(it, i) => emit('select', it !== undefined ? it : s.item, i !== undefined ? i : s.index)"
        />
      </div>
    </div>
  </div>
</template>
