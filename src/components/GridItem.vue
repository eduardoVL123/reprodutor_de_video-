<script setup>
import { computed, ref, watch } from 'vue'

/**
 * Item visual reutilizável (reciclado pelo GridView: recebe novos `item` o tempo todo).
 * variant: 'poster' (filmes/séries) | 'channel' (canais) | 'category' (lista lateral)
 */
const props = defineProps({
  item: { type: Object, default: null },
  variant: { type: String, default: 'poster' },
  index: { type: Number, default: -1 },
  active: { type: Boolean, default: false },
  // Gera id único e estável por índice (ex.: "cat-live-4"); usado pela memória de foco.
  idPrefix: { type: String, default: '' },
})
const emit = defineEmits(['select'])

const imgFailed = ref(false)
const image = computed(() => {
  const it = props.item
  if (!it) return ''
  return it.stream_icon || it.cover || ''
})

watch(image, () => {
  imgFailed.value = false
})

function onImgError() {
  imgFailed.value = true
}

const label = computed(() => {
  const it = props.item
  if (!it) return ''
  return props.variant === 'category' ? it.category_name : it.name
})


const initial = computed(() => (label.value || '?').trim().charAt(0).toUpperCase())
const showImage = computed(() => !!image.value && !imgFailed.value)
</script>

<template>
  <button
    type="button"
    class="tv-focusable block w-full h-full text-left rounded-xl border overflow-hidden transition-colors"
    :class="[
      variant === 'category'
        ? (active ? 'border-tv-accent bg-tv-accent/15 text-white font-bold' : 'border-white/[0.06] bg-[#121215]/80 text-neutral-300')
        : (active ? 'border-tv-accent bg-tv-accent/15 bg-[#121215]' : 'border-white/[0.08] bg-[#121215]')
    ]"
    :id="idPrefix ? `${idPrefix}-${index}` : undefined"
    :data-item-index="index"
    :data-grid-index="index"
    :data-focus-active="active ? 'true' : null"
    @click="emit('select', item, index)"
  >
    <!-- Categoria -->
    <div v-if="variant === 'category'" class="flex items-center justify-between h-full px-4">
      <span class="text-tv-sm font-medium truncate pr-3" :class="active ? 'text-white font-bold' : 'text-neutral-300'">
        {{ label }}
      </span>
    </div>

    <!-- Canal -->
    <div v-else-if="variant === 'channel'" class="relative w-full h-full p-5 flex flex-col justify-between text-left overflow-hidden bg-[#121215]">
      <!-- Topo do Card -->
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-2.5 min-w-0 pr-2">
          <img
            v-if="showImage"
            :key="image"
            :src="image"
            alt=""
            loading="lazy"
            referrerpolicy="no-referrer"
            class="w-8 h-8 rounded bg-black/40 object-contain p-0.5 shrink-0 border border-white/5"
            @error="onImgError"
          />
          <span class="text-tv-base font-black tracking-tight uppercase truncate text-white">{{ label || 'Canal' }}</span>
        </div>
        <span class="flex items-center gap-1.5 text-tv-xs font-bold uppercase tracking-wider text-[#10b981] shrink-0">
          <span class="w-1.5 h-1.5 rounded-full bg-[#10b981]" />
          <span>AO VIVO</span>
        </span>
      </div>

      <!-- Meio do Card -->
      <div class="min-w-0">
        <p class="text-tv-sm font-medium text-white truncate">{{ label || 'Transmissão contínua' }}</p>
        <p class="text-tv-xs text-neutral-500 mt-0.5 truncate">Canal {{ item?.num || index + 1 }} · Ao vivo</p>
      </div>
    </div>

    <!-- Poster (filme/série) ocupando o card com faixa escura na base -->
    <div v-else class="relative w-full h-full overflow-hidden flex flex-col justify-end bg-[#1a1a20]">
      <!-- Imagem ocupando todo o card -->
      <img
        v-if="showImage"
        :key="image"
        :src="image"
        alt=""
        loading="lazy"
        referrerpolicy="no-referrer"
        class="absolute inset-0 w-full h-full object-cover"
        @error="onImgError"
      />
      <!-- Fallback se não houver imagem ou se falhar -->
      <div
        v-else
        class="absolute inset-0 flex items-center justify-center bg-[#1a1a20]"
      >
        <span class="text-tv-2xl font-bold text-neutral-400">{{ initial }}</span>
      </div>

      <!-- Faixa escura na base com título sobreposto -->
      <div class="relative z-10 w-full bg-gradient-to-t from-black/95 via-black/70 to-transparent p-3 pt-8">
        <p class="text-tv-sm font-semibold text-white line-clamp-2 leading-tight drop-shadow">
          {{ label }}
        </p>
      </div>
    </div>
  </button>
</template>
