<script setup>
import { ref } from 'vue'
import { railOffset } from '@/utils/railOffset'

/**
 * Fileira deslizante (2.0): cada item é um botão focável com id `${idPrefix}-${índice}`; ao receber o
 * foco, a fileira desliza (translateX) para o item ficar na posição inicial, como nos streamings.
 * A navegação entre itens é a do spatialNavigation (mesma `data-focus-row`). O visual de cada item
 * vem do slot `item`; para listas enormes use a grade virtualizada (GridView), não esta fileira.
 */
const props = defineProps({
  items: { type: Array, required: true },
  idPrefix: { type: String, required: true },
  itemKey: { type: Function, default: (item, index) => index },
  gap: { type: Number, default: 1 }, // rem
})
const emit = defineEmits(['select'])

const viewportEl = ref(null)
const offset = ref(0)

const rootFontPx = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16

function onFocusIn(event) {
  const itemEl = event.target && event.target.closest ? event.target.closest('[data-rail-index]') : null
  if (!itemEl || !viewportEl.value) return
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
  <div ref="viewportEl" class="tv-rail" data-rail-viewport @focusin="onFocusIn">
    <div
      class="tv-rail-track"
      data-rail-track
      :data-focus-row="`rail-${idPrefix}`"
      :style="{ transform: `translateX(${offset}px)` }"
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
        @click="emit('select', item, index)"
      >
        <slot name="item" :item="item" :index="index" />
      </button>
    </div>
  </div>
</template>
