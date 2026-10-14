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
  if (it.stream_icon) return it.stream_icon
  if (it.cover) return it.cover
  if (it.stream_id !== undefined && it.stream_id !== null && props.variant !== 'category') {
    return `https://picsum.photos/seed/tv-${it.stream_id}/400/600`
  }
  return ''
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
    class="tv-focusable block w-full h-full text-left rounded-xl border overflow-hidden
           bg-[#121215] transition-colors"
    :class="active ? 'border-[#e50914] bg-[#e50914]/15' : 'border-white/[0.08]'"
    :id="idPrefix ? `${idPrefix}-${index}` : undefined"
    :data-item-index="index"
    :data-grid-index="index"
    :data-focus-active="active ? 'true' : null"
    @click="emit('select', item, index)"
  >
    <!-- Categoria -->
    <div v-if="variant === 'category'" class="flex items-center justify-between h-full px-6">
      <span class="text-tv-base font-semibold truncate pr-4 text-white">{{ label }}</span>
      <span class="text-tv-sm text-neutral-400 shrink-0">{{ item && item.count }}</span>
    </div>

    <!-- Canal -->
    <div v-else-if="variant === 'channel'" class="relative w-full h-full flex items-center gap-4 px-4 overflow-hidden">
      <div
        class="relative shrink-0 w-[5.5rem] h-[5.5rem] rounded-lg overflow-hidden bg-[#1a1a20] border border-white/10"
      >
        <img
          v-if="showImage"
          :key="image"
          :src="image"
          alt=""
          loading="lazy"
          referrerpolicy="no-referrer"
          class="w-full h-full object-cover"
          @error="onImgError"
        />
        <div v-else class="w-full h-full flex items-center justify-center">
          <span class="text-tv-lg font-bold text-neutral-300">{{ initial }}</span>
        </div>
      </div>
      <div class="min-w-0 flex-1">
        <p class="text-tv-base font-semibold truncate text-white">{{ label }}</p>
        <p class="text-tv-xs text-neutral-400">Canal {{ item && item.num }}</p>
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
