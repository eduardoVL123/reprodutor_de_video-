<script setup>
import { ref, watch, nextTick, onBeforeUnmount } from 'vue'
import { useProfileStore, PROFILE_COLORS, avatarTextColor } from '@/stores/profileStore'
import { registerBackHandler, pushFocusScope, focusFirstIn } from '@/utils/spatialNavigation'

/**
 * Tela de escolha de perfil. Aparece quando `profileStore.isProfileGateOpen` é verdadeiro
 * (a cada abertura do app e pelo botão de perfil do Dashboard). Cuida do próprio foco,
 * do escopo de navegação e da tecla Voltar; avisa o pai quando um perfil é escolhido.
 */
const emit = defineEmits(['selected'])

const profileStore = useProfileStore()

const isAddOpen = ref(false)
const newName = ref('')
const newColor = ref(PROFILE_COLORS[0])

let triggerId = 'btn-switch-profile'
let popScope = null
let cleanupBack = null

function release() {
  if (popScope) {
    popScope()
    popScope = null
  }
  if (cleanupBack) {
    cleanupBack()
    cleanupBack = null
  }
}

function handleBack() {
  if (!profileStore.isProfileGateOpen) return false
  if (isAddOpen.value) {
    closeAdd()
    return true
  }
  profileStore.closeProfileGate()
  nextTick(() => {
    document.getElementById(triggerId)?.focus()
  })
  return true
}

watch(
  () => profileStore.isProfileGateOpen,
  (open) => {
    release()
    if (!open) return
    triggerId = document.activeElement?.id || 'btn-switch-profile'
    cleanupBack = registerBackHandler(handleBack)
    nextTick(() => {
      const el = document.getElementById('profile-gate-overlay')
      if (el) {
        popScope = pushFocusScope(el)
        focusFirstIn(el)
      }
    })
  },
  { immediate: true },
)

async function select(profileId) {
  await profileStore.selectProfile(profileId)
  emit('selected')
}

function openAdd() {
  newName.value = ''
  newColor.value = PROFILE_COLORS[profileStore.profiles.length % PROFILE_COLORS.length]
  isAddOpen.value = true
  nextTick(() => {
    document.getElementById('input-profile-name')?.focus()
  })
}

function closeAdd() {
  isAddOpen.value = false
  nextTick(() => {
    document.getElementById('btn-add-profile-card')?.focus()
  })
}

async function create() {
  const name = newName.value.trim()
  if (!name) return
  const created = await profileStore.addProfile({ name, color: newColor.value })
  isAddOpen.value = false
  if (created) await select(created.id)
}

onBeforeUnmount(release)
</script>

<template>
  <div
    v-if="profileStore.isProfileGateOpen"
    id="profile-gate-overlay"
    class="fixed inset-0 z-40 bg-tv-deep flex flex-col items-center justify-center select-none"
    role="dialog"
    aria-modal="true"
    data-focus-group="profile-gate"
  >
    <h1 class="text-[2.8rem] font-semibold text-white tracking-tight mb-12">Escolha o perfil</h1>

    <div class="flex items-center gap-8">
      <!-- Cards dos perfis -->
      <button
        v-for="p in profileStore.profiles"
        :id="'profile-card-' + p.id"
        :key="p.id"
        type="button"
        class="tv-focusable group flex flex-col items-center gap-4 cursor-pointer outline-none"
        @click="select(p.id)"
      >
        <div
          class="w-[9.5rem] h-[9.5rem] rounded-xl flex items-center justify-center border-2 border-transparent group-focus:border-white transition-all shadow-2xl relative overflow-hidden"
          :style="{ backgroundColor: p.color, color: avatarTextColor(p.color) }"
        >
          <span class="text-5xl font-black select-none">
            {{ p.name.charAt(0).toUpperCase() }}
          </span>
        </div>
        <span class="text-tv-base text-neutral-400 group-focus:text-white font-medium transition-colors">
          {{ p.name }}
        </span>
      </button>

      <!-- Botão + Adicionar Perfil (se < 5 perfis) -->
      <button
        v-if="profileStore.canAddProfile"
        id="btn-add-profile-card"
        type="button"
        class="tv-focusable group flex flex-col items-center gap-4 cursor-pointer outline-none"
        @click="openAdd"
      >
        <div class="w-[9.5rem] h-[9.5rem] rounded-xl flex items-center justify-center border-2 border-dashed border-white/20 group-focus:border-white transition-all bg-white/[0.03]">
          <svg class="w-12 h-12 text-neutral-400 group-focus:text-white transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </div>
        <span class="text-tv-base text-neutral-400 group-focus:text-white font-medium transition-colors">
          Adicionar Perfil
        </span>
      </button>
    </div>

    <!-- Mini modal para adicionar perfil -->
    <div
      v-if="isAddOpen"
      class="absolute inset-0 bg-black/85 flex items-center justify-center p-8 z-50"
    >
      <div class="w-full max-w-[32rem] bg-[#121215] border border-white/10 rounded-2xl p-8 flex flex-col shadow-2xl">
        <h2 class="text-tv-lg font-bold text-white mb-4">Novo Perfil</h2>
        <div class="space-y-4">
          <div>
            <label for="input-profile-name" class="block text-tv-xs text-neutral-400 mb-1">Nome do Perfil</label>
            <input
              id="input-profile-name"
              v-model="newName"
              type="text"
              readonly="readonly"
              data-tv-editing="false"
              class="tv-input w-full"
              placeholder="Ex: Quarto, Família"
              @keyup.enter="create"
            />
          </div>
          <div>
            <label class="block text-tv-xs text-neutral-400 mb-2">Cor do Perfil</label>
            <div class="flex items-center gap-3">
              <button
                v-for="c in PROFILE_COLORS"
                :key="c"
                type="button"
                class="w-8 h-8 rounded-full border-2 transition-transform"
                :class="newColor === c ? 'border-white scale-110' : 'border-transparent'"
                :style="{ backgroundColor: c }"
                @click="newColor = c"
              />
            </div>
          </div>
        </div>
        <div class="flex items-center justify-end gap-4 mt-8">
          <button
            type="button"
            class="tv-btn !px-5 !py-2 text-tv-sm text-neutral-400 hover:text-white"
            @click="closeAdd"
          >
            Cancelar
          </button>
          <button
            id="btn-save-new-profile"
            type="button"
            class="tv-btn tv-btn-primary !px-6 !py-2 text-tv-sm font-semibold"
            :disabled="!newName.trim()"
            @click="create"
          >
            Criar Perfil
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
