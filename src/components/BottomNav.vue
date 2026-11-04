<script setup>
/**
 * Barra de baixo do celular/tablet, em pé ou deitado: Início · Filmes · Séries · TV · Conta. A busca fica na barra
 * flutuante do topo (Dashboard) e o resto do antigo "Mais" vive na tela Conta. A aba ativa ganha o pulso da marca.
 */
const props = defineProps({
  activeTab: { type: String, required: true },
})

const emit = defineEmits(['navigate'])

const TABS = [
  { id: 'home', label: 'Início' },
  { id: 'vod', label: 'Filmes' },
  { id: 'series', label: 'Séries' },
  { id: 'live', label: 'TV' },
  { id: 'account', label: 'Conta' },
]
// Favoritos abre pela Conta: com ele aberto, a Conta fica marcada.
const isActive = (id) => props.activeTab === id || (id === 'account' && props.activeTab === 'favorites')
</script>

<template>
  <nav
    data-focus-group="bottom-nav"
    aria-label="Navegação principal"
    class="fixed left-0 right-0 bottom-0 z-30 flex bg-tv-deep/95 border-t border-white/10 px-1.5 pt-1.5 pb-[calc(0.5rem+env(safe-area-inset-bottom))] select-none"
  >
    <button
      v-for="tab in TABS"
      :id="`bnav-${tab.id}`"
      :key="tab.id"
      type="button"
      class="tv-focusable relative flex-1 flex flex-col items-center pt-2.5 pb-1 text-[0.72rem] font-semibold transition-colors"
      :class="isActive(tab.id) ? 'text-white' : 'text-neutral-500'"
      :aria-current="isActive(tab.id) ? 'page' : null"
      @click="emit('navigate', tab.id)"
    >
      <svg v-if="isActive(tab.id)" class="bnav-pulse" viewBox="0 0 40 10" aria-hidden="true">
        <path d="M1 6 H13 L16 2 L21 9 L24 6 H39" />
      </svg>
      <svg class="w-6 h-6 stroke-current fill-none stroke-[1.9]" viewBox="0 0 24 24" aria-hidden="true">
        <path v-if="tab.id === 'home'" d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />
        <template v-else-if="tab.id === 'vod'">
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" />
        </template>
        <template v-else-if="tab.id === 'series'">
          <rect x="3" y="7" width="18" height="13" rx="2" />
          <path d="M7 3h10M5 5h14" />
        </template>
        <template v-else-if="tab.id === 'live'">
          <rect x="3" y="6" width="18" height="13" rx="2" />
          <path d="M8 2l4 4 4-4" />
        </template>
        <template v-else>
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21a8 8 0 0 1 16 0" />
        </template>
      </svg>
      <span class="mt-0.5">{{ tab.label }}</span>
    </button>
  </nav>
</template>

<style scoped>
/* Pulso da marca (símbolo do Pulse Player) marcando a aba ativa. */
.bnav-pulse {
  position: absolute;
  top: -0.4rem;
  width: 2.6rem;
  height: 0.65rem;
  fill: none;
  stroke: #b8f000;
  stroke-width: 2.4;
  stroke-linecap: round;
  stroke-linejoin: round;
}
</style>
