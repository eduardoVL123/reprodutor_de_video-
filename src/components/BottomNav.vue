<script setup>
import { ref, computed, onBeforeUnmount } from 'vue'
import { PROFILE_COLORS, avatarTextColor } from '@/stores/profileStore'
import { useLicenseStore } from '@/stores/licenseStore'
import { sendListPageUrl } from '@/services/licenseApi'
import { canExitApp, exitApp, openExternal } from '@/services/platform'
import { registerBackHandler } from '@/utils/spatialNavigation'

/**
 * Barra de baixo do celular/tablet em pé (RFC-023, opção B): Início · Filmes · Séries · Busca · Mais.
 * Emite o mesmo `navigate(tab)` do SideMenu, que continua na TV e no celular deitado. "Mais" abre uma folha por
 * cima com o que fica no rodapé do menu da TV, mais Canais ao vivo e Minha lista. A aba ativa ganha o pulso da marca.
 */
const props = defineProps({
  activeTab: { type: String, required: true },
  profile: { type: Object, default: () => ({ name: 'Perfil', color: PROFILE_COLORS[0] }) },
  listLabel: { type: String, default: '' },
})

const emit = defineEmits(['navigate', 'manage-lists', 'switch-profile'])

const license = useLicenseStore()
const sheetOpen = ref(false)
let releaseBack = null

const TABS = [
  { id: 'home', label: 'Início' },
  { id: 'vod', label: 'Filmes' },
  { id: 'series', label: 'Séries' },
  { id: 'search', label: 'Busca' },
]
// Abas que vivem dentro do Mais: com uma delas aberta, o Mais fica marcado.
const MORE_TABS = ['live', 'favorites']

const moreActive = computed(() => sheetOpen.value || MORE_TABS.includes(props.activeTab))
const siteUrl = computed(() => sendListPageUrl(license.code))
const showExit = canExitApp()
const profileColor = computed(() => props.profile.color || PROFILE_COLORS[0])

function openSheet() {
  sheetOpen.value = true
  // Sem mover o foco: no toque ele só desenharia o contorno de foco da TV em "Canais ao vivo".
  releaseBack = registerBackHandler(() => {
    closeSheet()
    return true
  })
}

function closeSheet() {
  sheetOpen.value = false
  if (releaseBack) releaseBack()
  releaseBack = null
}

function pick(action) {
  closeSheet()
  action()
}

onBeforeUnmount(closeSheet)
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
      :class="activeTab === tab.id ? 'text-white' : 'text-neutral-500'"
      :aria-current="activeTab === tab.id ? 'page' : null"
      @click="emit('navigate', tab.id)"
    >
      <svg v-if="activeTab === tab.id" class="bnav-pulse" viewBox="0 0 40 10" aria-hidden="true">
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
        <template v-else>
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" />
        </template>
      </svg>
      <span class="mt-0.5">{{ tab.label }}</span>
    </button>

    <button
      id="bnav-more"
      type="button"
      class="tv-focusable relative flex-1 flex flex-col items-center pt-2.5 pb-1 text-[0.72rem] font-semibold transition-colors"
      :class="moreActive ? 'text-white' : 'text-neutral-500'"
      :aria-expanded="sheetOpen ? 'true' : 'false'"
      @click="sheetOpen ? closeSheet() : openSheet()"
    >
      <svg v-if="moreActive" class="bnav-pulse" viewBox="0 0 40 10" aria-hidden="true">
        <path d="M1 6 H13 L16 2 L21 9 L24 6 H39" />
      </svg>
      <svg class="w-6 h-6 stroke-current fill-none stroke-[1.9]" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 7h16M4 12h16M4 17h16" />
      </svg>
      <span class="mt-0.5">Mais</span>
    </button>
  </nav>

  <!-- Folha "Mais": por cima da tela, sem trocar de aba. Tocar fora ou Voltar fecha. -->
  <div v-if="sheetOpen" id="more-sheet" class="fixed inset-0 z-40" aria-label="Mais opções">
    <div class="absolute inset-0 bg-black/60" @click="closeSheet" />
    <div
      data-focus-group="more-sheet"
      class="absolute left-0 right-0 bottom-0 rounded-t-[1.4rem] bg-[#141a15] pt-2.5 pb-[calc(1.5rem+env(safe-area-inset-bottom))]"
    >
      <div class="w-10 h-1.5 rounded-full bg-white/25 mx-auto mb-3.5" />
      <div class="flex items-center gap-3.5 px-6 pb-3.5">
        <span
          class="w-11 h-11 rounded-xl flex items-center justify-center text-lg font-black shrink-0"
          :style="{ backgroundColor: profileColor, color: avatarTextColor(profileColor) }"
        >{{ (profile.name || 'P').charAt(0).toUpperCase() }}</span>
        <div class="min-w-0">
          <div class="font-extrabold text-[1.05rem] truncate">{{ profile.name }}</div>
          <div v-if="listLabel" class="text-[0.82rem] text-neutral-400 truncate">Lista: {{ listLabel }}</div>
        </div>
      </div>
      <div class="h-px bg-white/[0.09] mx-6 my-2" />

      <button id="more-live" type="button" class="more-row tv-focusable" @click="pick(() => emit('navigate', 'live'))">
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M8 2l4 4 4-4" /></svg>
        <span>Canais ao vivo</span>
      </button>
      <button id="more-favorites" type="button" class="more-row tv-focusable" @click="pick(() => emit('navigate', 'favorites'))">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.5-7-10a4 4 0 017-2.5A4 4 0 0119 10c0 5.5-7 10-7 10z" /></svg>
        <span>Minha lista</span>
      </button>
      <button id="more-lists" type="button" class="more-row tv-focusable" @click="pick(() => emit('manage-lists'))">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13" /><circle cx="4" cy="6" r="1" /><circle cx="4" cy="12" r="1" /><circle cx="4" cy="18" r="1" /></svg>
        <span>Minhas listas</span>
      </button>
      <button v-if="siteUrl" id="more-site" type="button" class="more-row tv-focusable" @click="pick(() => openExternal(siteUrl))">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" /></svg>
        <span>Enviar lista pelo site</span>
        <span class="ml-auto text-[0.82rem] font-medium text-neutral-400">abre o navegador</span>
      </button>
      <button id="more-profile" type="button" class="more-row tv-focusable" @click="pick(() => emit('switch-profile'))">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>
        <span>Trocar perfil</span>
      </button>
      <template v-if="showExit">
        <div class="h-px bg-white/[0.09] mx-6 my-2" />
        <button id="more-exit" type="button" class="more-row tv-focusable text-[#ff5a4e]" @click="pick(exitApp)">
          <svg viewBox="0 0 24 24" aria-hidden="true" class="!stroke-[#ff5a4e]"><path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l5-5-5-5M15 12H3" /></svg>
          <span>Sair do app</span>
        </button>
      </template>
    </div>
  </div>
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
.more-row {
  display: flex;
  align-items: center;
  width: 100%;
  height: 3.6rem;
  padding: 0 1.5rem;
  font-size: 1rem;
  font-weight: 600;
  text-align: left;
}
.more-row > span + span {
  margin-left: auto;
}
.more-row svg {
  width: 1.4rem;
  height: 1.4rem;
  margin-right: 1rem;
  flex-shrink: 0;
  fill: none;
  stroke: #9ba49c;
  stroke-width: 1.9;
}
</style>
