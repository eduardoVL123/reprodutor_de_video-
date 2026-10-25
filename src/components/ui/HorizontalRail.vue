<script setup>
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { railOffset } from '@/utils/railOffset'
import { isPointerFocus } from '@/utils/spatialNavigation'

/**
 * Fileira deslizante (2.0): cada item é um botão focável com id `${idPrefix}-${índice}`; ao receber o
 * foco, a fileira desliza (translateX) para o item ficar na posição inicial, como nos streamings.
 * A navegação entre itens é a do spatialNavigation (mesma `data-focus-row`); no PC e no celular a fileira
 * também desliza ao arrastar com o mouse ou o dedo, com shift+roda e pelas setas ‹ › que aparecem com o mouse em cima. O visual de cada item
 * vem do slot `item`; para listas enormes use a grade virtualizada (GridView), não esta fileira.
 */
const props = defineProps({
  items: { type: Array, required: true },
  idPrefix: { type: String, required: true },
  itemKey: { type: Function, default: (item, index) => index },
  gap: { type: Number, default: 1 }, // rem
  activeIndex: { type: Number, default: -1 }, // item onde a navegação entra vindo de fora (ex.: E1 da temporada)
})
const emit = defineEmits(['select'])

const viewportEl = ref(null)
const trackEl = ref(null)
const offset = ref(0)
const dragging = ref(false)

const rootFontPx = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16

// Mouse e toque (celular/PC): arrastar ou shift+roda desliza a fileira, no mesmo `offset` do foco por teclado.
const DRAG_THRESHOLD_PX = 8
let drag = null // { x, start, moved }
let suppressClick = false // o arrasto não pode virar clique no card em que o dedo soltou

function clampOffset(value) {
  if (!viewportEl.value || !trackEl.value) return 0
  const overflow = Math.max(0, trackEl.value.scrollWidth - viewportEl.value.getBoundingClientRect().width)
  return Math.min(0, Math.max(-overflow, value))
}

// Setas ‹ › para quem tem mouse com roda comum (a roda vertical rola a página, não a fileira). Só aparecem com o mouse
// em cima e fora da navegação do controle remoto (tabindex -1).
const maxShift = ref(0)
const canGoBack = computed(() => offset.value < 0)
const canGoForward = computed(() => offset.value > -maxShift.value)

function measure() {
  if (!viewportEl.value || !trackEl.value) return
  maxShift.value = Math.max(0, trackEl.value.scrollWidth - viewportEl.value.getBoundingClientRect().width)
}

function page(direction) {
  measure()
  offset.value = clampOffset(offset.value - direction * viewportEl.value.getBoundingClientRect().width * 0.8)
}

onMounted(() => {
  measure()
  window.addEventListener('resize', measure)
})
onBeforeUnmount(() => window.removeEventListener('resize', measure))
watch(
  () => props.items.length,
  () => nextTick(measure),
)

function onWheel(event) {
  if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return // roda comum: a página rola na vertical
  event.preventDefault()
  offset.value = clampOffset(offset.value - event.deltaX)
}

function onPointerDown(event) {
  if (event.pointerType === 'mouse' && event.button !== 0) return
  drag = { x: event.clientX, start: offset.value, moved: false }
  suppressClick = false
}

function onPointerMove(event) {
  if (!drag) return
  const dx = event.clientX - drag.x
  if (!drag.moved) {
    if (Math.abs(dx) < DRAG_THRESHOLD_PX) return
    drag.moved = true
    dragging.value = true
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch (_) {}
  }
  offset.value = clampOffset(drag.start + dx)
}

function endDrag() {
  if (drag && drag.moved) suppressClick = true
  drag = null
  dragging.value = false
}

function onClickCapture(event) {
  if (!suppressClick) return
  suppressClick = false
  event.stopPropagation()
  event.preventDefault()
}

function onFocusIn(event) {
  const itemEl = event.target && event.target.closest ? event.target.closest('[data-rail-index]') : null
  if (!itemEl || !viewportEl.value || isPointerFocus()) return
  offset.value = railOffset({
    index: Number(itemEl.getAttribute('data-rail-index')),
    itemSize: itemEl.getBoundingClientRect().width,
    gap: props.gap * rootFontPx(),
    count: props.items.length,
    viewport: viewportEl.value.getBoundingClientRect().width,
  })
}
</script>

<template>
  <div
    ref="viewportEl"
    class="tv-rail"
    data-rail-viewport
    style="touch-action: pan-y"
    @focusin="onFocusIn"
    @wheel="onWheel"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="endDrag"
    @pointercancel="endDrag"
    @click.capture="onClickCapture"
  >
    <button
      v-if="canGoBack"
      type="button"
      tabindex="-1"
      aria-label="Anterior"
      class="tv-rail-arrow left-0 bg-gradient-to-r from-black/80 to-transparent"
      @mousedown.prevent
      @pointerdown.stop
      @click.stop="page(-1)"
    >
      <svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="15 18 9 12 15 6" />
      </svg>
    </button>
    <button
      v-if="canGoForward"
      type="button"
      tabindex="-1"
      aria-label="Próximo"
      class="tv-rail-arrow right-0 bg-gradient-to-l from-black/80 to-transparent"
      @mousedown.prevent
      @pointerdown.stop
      @click.stop="page(1)"
    >
      <svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="9 18 15 12 9 6" />
      </svg>
    </button>
    <div
      ref="trackEl"
      class="tv-rail-track"
      data-rail-track
      :data-focus-row="`rail-${idPrefix}`"
      :style="{ transform: `translateX(${offset}px)`, transition: dragging ? 'none' : undefined }"
    >
      <!-- Espaço por margem, não `gap`: flexbox gap não existe no Chromium < 84 das TVs. -->
      <button
        v-for="(item, index) in items"
        :id="`${idPrefix}-${index}`"
        :key="itemKey(item, index)"
        type="button"
        class="tv-focusable tv-rail-item"
        :style="{ marginRight: index < items.length - 1 ? `${gap}rem` : '0' }"
        :data-rail-index="index"
        :data-focus-active="index === activeIndex ? 'true' : null"
        @click="emit('select', item, index)"
      >
        <slot name="item" :item="item" :index="index" />
      </button>
    </div>
  </div>
</template>
