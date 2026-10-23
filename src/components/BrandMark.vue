<script setup>
import { computed } from 'vue'

/**
 * Símbolo do Pulse Player (play cortado pelo pulso), em SVG inline: sem imagem externa, sem `aspect-ratio`.
 * Caminhos de ../logo/kit/pulse-symbol.svg e pulse-symbol-small.svg (corte mais grosso, legível em tamanho pequeno).
 * `size` é a altura em rem (o app escala o rem com a resolução da TV: 2rem = 32 px em 1080p).
 */
const props = defineProps({
  size: { type: Number, default: 1.75 }, // rem
  color: { type: String, default: 'currentColor' },
})

const SMALL_BELOW_REM = 2 // guia da marca: abaixo de 32 px usar o símbolo "small"
const VIEW_BOX = { x: 52, y: 48, width: 152, height: 160 } // recorte do símbolo dentro do quadro 256x256 do kit

const LARGE_PATHS = [
  'M56.00 122.00 L56.00 64.25 A14 14 0 0 1 77.00 52.12 L198.03 122.00 L146.58 122.00 L137.34 138.00 L107.32 86.00 L86.54 122.00 Z',
  'M56.00 134.00 L93.46 134.00 L107.32 110.00 L137.34 162.00 L153.50 134.00 L198.03 134.00 L77.00 203.88 A14 14 0 0 1 56.00 191.75 Z',
]
const SMALL_PATHS = [
  'M56.00 118.00 L56.00 67.71 A16 16 0 0 1 80.00 53.86 L191.10 118.00 L130.42 118.00 L126.95 124.00 L103.86 84.00 L84.23 118.00 Z',
  'M56.00 138.00 L95.77 138.00 L103.86 124.00 L126.95 164.00 L141.96 138.00 L191.10 138.00 L80.00 202.14 A16 16 0 0 1 56.00 188.29 Z',
]

const paths = computed(() => (props.size < SMALL_BELOW_REM ? SMALL_PATHS : LARGE_PATHS))
const viewBox = `${VIEW_BOX.x} ${VIEW_BOX.y} ${VIEW_BOX.width} ${VIEW_BOX.height}`
const style = computed(() => ({
  height: `${props.size}rem`,
  width: `${(props.size * VIEW_BOX.width) / VIEW_BOX.height}rem`,
}))
</script>

<template>
  <svg :viewBox="viewBox" :style="style" :fill="color" class="shrink-0" aria-hidden="true" focusable="false">
    <path v-for="d in paths" :key="d" :d="d" />
  </svg>
</template>
