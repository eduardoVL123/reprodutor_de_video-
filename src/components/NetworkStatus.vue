<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'

/**
 * Aviso global de conexão perdida (Samsung/LG testam a desconexão de rede durante o uso).
 * Não bloqueia a tela: o conteúdo em cache continua navegável.
 */
const isOffline = ref(typeof navigator !== 'undefined' && navigator.onLine === false)

const update = () => {
  isOffline.value = navigator.onLine === false
}

onMounted(() => {
  window.addEventListener('online', update)
  window.addEventListener('offline', update)
})

onBeforeUnmount(() => {
  window.removeEventListener('online', update)
  window.removeEventListener('offline', update)
})
</script>

<template>
  <div
    v-if="isOffline"
    class="fixed top-14 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-3 rounded-xl border border-amber-400/40 bg-[#1a1408]/95 px-6 py-3 text-tv-sm text-amber-200 shadow-2xl pointer-events-none"
    role="alert"
  >
    <svg class="w-6 h-6 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <line x1="1" y1="1" x2="23" y2="23" />
      <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
      <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
      <path d="M10.71 5.05A16 16 0 0 1 22.58 9" />
      <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
      <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
      <line x1="12" y1="20" x2="12.01" y2="20" />
    </svg>
    <span>Sem conexão com a internet. Verifique a rede do aparelho.</span>
  </div>
</template>
