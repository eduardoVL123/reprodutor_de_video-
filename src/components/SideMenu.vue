<script setup>
import { ref } from 'vue'
import BrandMark from '@/components/BrandMark.vue'
import { PROFILE_COLORS, avatarTextColor } from '@/stores/profileStore'

defineProps({
  activeTab: { type: String, required: true },
  profile: { type: Object, default: () => ({ name: 'Perfil', color: PROFILE_COLORS[0] }) },
  listLabel: { type: String, default: '' },
})

const emit = defineEmits(['navigate', 'manage-lists', 'switch-profile'])

const isOpen = ref(false)

function onFocusIn() {
  isOpen.value = true
}

function onFocusOut(event) {
  const nextTarget = event.relatedTarget
  const currentNav = event.currentTarget
  if (!currentNav || !nextTarget || !currentNav.contains(nextTarget)) {
    isOpen.value = false
  }
}

function onSelectTab(tab) {
  emit('navigate', tab)
}
</script>

<template>
  <!-- Coluna fixa à esquerda que expande no foco sobrepondo o conteúdo. A largura muda sem animação:
       animar width refaz o layout a cada quadro e engasga nas TVs; só os rótulos fazem fade. -->
  <nav
    data-focus-group="side-menu"
    :data-open="isOpen ? 'true' : 'false'"
    class="fixed top-0 bottom-0 left-0 z-30 flex flex-col justify-between py-14 phone:py-0 phone:top-auto phone:bottom-0 phone:right-0 phone:w-full phone:h-16 phone:flex-row phone:items-center phone:justify-around phone:px-2 phone:bg-[#0b0f0c]/95 phone:border-t phone:border-white/10 phone:border-r-0 phone:shadow-none select-none"
    :class="[
      isOpen
        ? 'w-[19rem] px-6 bg-tv-deep/95 shadow-[12px_0_40px_rgba(0,0,0,0.85)] border-r border-white/10'
        : 'w-[7rem] px-3 bg-gradient-to-r from-black/85 via-black/40 to-transparent phone:bg-[#0b0f0c]/95'
    ]"
    @focusin="onFocusIn"
    @focusout="onFocusOut"
  >
    <!-- Topo: símbolo do Pulse Player -->
    <div class="flex flex-col phone:flex-row phone:items-center phone:justify-around phone:w-full gap-6 phone:gap-0">
      <div class="flex phone:hidden items-center gap-3 h-[3.5rem] px-3 overflow-hidden">
        <BrandMark :size="2" class="text-tv-accent" />
        <span
          class="text-tv-base font-black whitespace-nowrap transition-opacity duration-150 leading-none"
          :class="isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'"
        >
          <span class="text-[#F4F7EE]">PULSE</span>
          <span class="text-tv-accent ml-1">PLAYER</span>
        </span>
      </div>

      <!-- Links Principais -->
      <div class="flex flex-col phone:flex-row phone:items-center phone:justify-around phone:w-full gap-2 phone:gap-0">
        <!-- 1. Busca -->
        <button
          id="nav-search"
          type="button"
          class="tv-focusable flex items-center phone:justify-center h-[3.5rem] phone:h-12 phone:w-12 phone:px-0 rounded-xl px-3 transition-colors text-left"
          :class="[
            activeTab === 'search'
              ? 'bg-white/15 text-white font-bold'
              : 'text-neutral-400 hover:text-white hover:bg-white/[0.05]'
          ]"
          :data-focus-active="activeTab === 'search' ? 'true' : null"
          title="Busca"
          @click="onSelectTab('search')"
        >
          <div class="w-8 h-8 flex items-center justify-center shrink-0">
            <svg class="w-6 h-6 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" />
            </svg>
          </div>
          <span
            class="phone:hidden ml-4 text-tv-sm whitespace-nowrap transition-opacity duration-150"
            :class="isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'"
          >
            Busca
          </span>
        </button>

        <!-- 2. Início -->
        <button
          id="nav-home"
          type="button"
          class="tv-focusable flex items-center phone:justify-center h-[3.5rem] phone:h-12 phone:w-12 phone:px-0 rounded-xl px-3 transition-colors text-left"
          :class="[
            activeTab === 'home'
              ? 'bg-white/15 text-white font-bold'
              : 'text-neutral-400 hover:text-white hover:bg-white/[0.05]'
          ]"
          :data-focus-active="activeTab === 'home' ? 'true' : null"
          title="Início"
          @click="onSelectTab('home')"
        >
          <div class="w-8 h-8 flex items-center justify-center shrink-0">
            <svg class="w-6 h-6 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
              <path d="M3 10l9-7 9 7v10H3z" />
            </svg>
          </div>
          <span
            class="phone:hidden ml-4 text-tv-sm whitespace-nowrap transition-opacity duration-150"
            :class="isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'"
          >
            Início
          </span>
        </button>

        <!-- 3. TV ao vivo -->
        <button
          id="nav-live"
          type="button"
          class="tv-focusable flex items-center phone:justify-center h-[3.5rem] phone:h-12 phone:w-12 phone:px-0 rounded-xl px-3 transition-colors text-left"
          :class="[
            activeTab === 'live'
              ? 'bg-white/15 text-white font-bold'
              : 'text-neutral-400 hover:text-white hover:bg-white/[0.05]'
          ]"
          :data-focus-active="activeTab === 'live' ? 'true' : null"
          title="TV ao vivo"
          @click="onSelectTab('live')"
        >
          <div class="w-8 h-8 flex items-center justify-center shrink-0">
            <svg class="w-6 h-6 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
              <rect x="3" y="6" width="18" height="12" rx="2" />
              <path d="M8 3l4 3 4-3" />
            </svg>
          </div>
          <span
            class="phone:hidden ml-4 text-tv-sm whitespace-nowrap transition-opacity duration-150"
            :class="isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'"
          >
            TV ao vivo
          </span>
        </button>

        <!-- 4. Filmes -->
        <button
          id="nav-vod"
          type="button"
          class="tv-focusable flex items-center phone:justify-center h-[3.5rem] phone:h-12 phone:w-12 phone:px-0 rounded-xl px-3 transition-colors text-left"
          :class="[
            activeTab === 'vod'
              ? 'bg-white/15 text-white font-bold'
              : 'text-neutral-400 hover:text-white hover:bg-white/[0.05]'
          ]"
          :data-focus-active="activeTab === 'vod' ? 'true' : null"
          title="Filmes"
          @click="onSelectTab('vod')"
        >
          <div class="w-8 h-8 flex items-center justify-center shrink-0">
            <svg class="w-6 h-6 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
              <rect x="4" y="3" width="16" height="18" rx="2" />
              <path d="M4 8h16M4 16h16" />
            </svg>
          </div>
          <span
            class="phone:hidden ml-4 text-tv-sm whitespace-nowrap transition-opacity duration-150"
            :class="isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'"
          >
            Filmes
          </span>
        </button>

        <!-- 5. Séries -->
        <button
          id="nav-series"
          type="button"
          class="tv-focusable flex items-center phone:justify-center h-[3.5rem] phone:h-12 phone:w-12 phone:px-0 rounded-xl px-3 transition-colors text-left"
          :class="[
            activeTab === 'series'
              ? 'bg-white/15 text-white font-bold'
              : 'text-neutral-400 hover:text-white hover:bg-white/[0.05]'
          ]"
          :data-focus-active="activeTab === 'series' ? 'true' : null"
          title="Séries"
          @click="onSelectTab('series')"
        >
          <div class="w-8 h-8 flex items-center justify-center shrink-0">
            <svg class="w-6 h-6 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
              <rect x="3" y="5" width="18" height="12" rx="2" />
              <path d="M8 21h8" />
            </svg>
          </div>
          <span
            class="phone:hidden ml-4 text-tv-sm whitespace-nowrap transition-opacity duration-150"
            :class="isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'"
          >
            Séries
          </span>
        </button>

        <!-- 6. Minha lista (Favoritos) -->
        <button
          id="nav-favorites"
          type="button"
          class="tv-focusable flex items-center phone:justify-center h-[3.5rem] phone:h-12 phone:w-12 phone:px-0 rounded-xl px-3 transition-colors text-left"
          :class="[
            activeTab === 'favorites'
              ? 'bg-white/15 text-white font-bold'
              : 'text-neutral-400 hover:text-white hover:bg-white/[0.05]'
          ]"
          :data-focus-active="activeTab === 'favorites' ? 'true' : null"
          title="Minha lista"
          @click="onSelectTab('favorites')"
        >
          <div class="w-8 h-8 flex items-center justify-center shrink-0">
            <svg class="w-6 h-6 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
              <path d="M12 20s-7-4.5-7-10a4 4 0 017-2.5A4 4 0 0119 10c0 5.5-7 10-7 10z" />
            </svg>
          </div>
          <span
            class="phone:hidden ml-4 text-tv-sm whitespace-nowrap transition-opacity duration-150"
            :class="isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'"
          >
            Minha lista
          </span>
        </button>
      </div>
    </div>

    <!-- Base: Gerenciar Listas e Trocar Perfil -->
    <div class="flex flex-col phone:flex-row phone:items-center phone:gap-0 phone:pt-0 phone:border-t-0 gap-2 pt-4 border-t border-white/[0.08]">
      <!-- 7. Listas -->
      <button
        id="btn-manage-lists"
        type="button"
        class="tv-focusable flex items-center phone:justify-center h-[3.5rem] phone:h-12 phone:w-12 phone:px-0 rounded-xl px-3 transition-colors text-left text-neutral-400 hover:text-white hover:bg-white/[0.05]"
        title="Gerenciar Listas"
        @click="emit('manage-lists')"
      >
        <div class="w-8 h-8 flex items-center justify-center shrink-0">
          <svg class="w-6 h-6 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
            <line x1="8" y1="6" x2="21" y2="6" />
            <line x1="8" y1="12" x2="21" y2="12" />
            <line x1="8" y1="18" x2="21" y2="18" />
            <circle cx="3" cy="6" r="1.5" fill="currentColor" />
            <circle cx="3" cy="12" r="1.5" fill="currentColor" />
            <circle cx="3" cy="18" r="1.5" fill="currentColor" />
          </svg>
        </div>
        <div
          class="phone:hidden ml-4 min-w-0 transition-opacity duration-150"
          :class="isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'"
        >
          <div class="text-tv-sm text-white font-medium truncate">Listas</div>
          <div v-if="listLabel" class="text-tv-xs text-neutral-400 truncate">{{ listLabel }}</div>
        </div>
      </button>

      <!-- 8. Perfil -->
      <button
        id="btn-switch-profile"
        type="button"
        class="tv-focusable flex items-center phone:justify-center h-[3.5rem] phone:h-12 phone:w-12 phone:px-0 rounded-xl px-3 transition-colors text-left text-neutral-400 hover:text-white hover:bg-white/[0.05]"
        title="Trocar Perfil"
        @click="emit('switch-profile')"
      >
        <div
          class="w-8 h-8 rounded-lg flex items-center justify-center text-tv-xs font-black shrink-0 shadow-md border border-white/20"
          :style="{ backgroundColor: profile.color || PROFILE_COLORS[0], color: avatarTextColor(profile.color || PROFILE_COLORS[0]) }"
        >
          {{ (profile.name || 'P').charAt(0).toUpperCase() }}
        </div>
        <div
          class="phone:hidden ml-4 min-w-0 transition-opacity duration-150"
          :class="isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'"
        >
          <div class="text-tv-sm text-white font-medium truncate">{{ profile.name }}</div>
          <div class="text-tv-xs text-neutral-400">Trocar perfil</div>
        </div>
      </button>
    </div>
  </nav>
</template>
