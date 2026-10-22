import { ref, shallowRef, computed } from 'vue'
import { defineStore } from 'pinia'
import { storage } from '@/services/storage'
import { usePlayerStore } from '@/stores/playerStore'

const PROFILES_KEY = 'app:profiles'
const ACTIVE_PROFILE_KEY = 'app:activeProfileId'
const MAX_PROFILES = 5

export const PROFILE_COLORS = [
  '#e50914', // Vermelho
  '#2563eb', // Azul
  '#10b981', // Verde esmeralda
  '#f59e0b', // Âmbar
  '#8b5cf6', // Roxo
  '#ec4899', // Rosa
]

const DEFAULT_PROFILES = [
  { id: 'p1', name: 'Principal', color: '#e50914' },
  { id: 'p2', name: 'Família', color: '#2563eb' },
  { id: 'p3', name: 'Convidado', color: '#10b981' },
]

export const useProfileStore = defineStore('profile', () => {
  const profiles = shallowRef([...DEFAULT_PROFILES])
  const activeProfileId = ref('p1')
  const isProfileGateOpen = ref(true)
  const hydrated = ref(false)

  const activeProfile = computed(() => {
    return profiles.value.find((p) => p.id === activeProfileId.value) || profiles.value[0] || DEFAULT_PROFILES[0]
  })

  const canAddProfile = computed(() => profiles.value.length < MAX_PROFILES)

  async function hydrate() {
    if (hydrated.value) return
    try {
      const savedProfiles = await storage.get(PROFILES_KEY)
      if (Array.isArray(savedProfiles) && savedProfiles.length > 0) {
        profiles.value = savedProfiles
      } else {
        profiles.value = [...DEFAULT_PROFILES]
        await storage.set(PROFILES_KEY, profiles.value)
      }

      const savedActiveId = await storage.get(ACTIVE_PROFILE_KEY)
      if (savedActiveId && profiles.value.some((p) => p.id === savedActiveId)) {
        activeProfileId.value = savedActiveId
      } else if (profiles.value.length > 0) {
        activeProfileId.value = profiles.value[0].id
        await storage.set(ACTIVE_PROFILE_KEY, activeProfileId.value)
      }

      // Só faz sentido perguntar "quem está assistindo" quando há escolha.
      if (profiles.value.length === 1) {
        activeProfileId.value = profiles.value[0].id
        isProfileGateOpen.value = false
      }
    } catch (err) {
      console.warn('[profile] Falha ao hidratar perfis:', err)
    } finally {
      hydrated.value = true
    }
  }

  async function selectProfile(id) {
    const target = profiles.value.find((p) => p.id === id)
    if (!target) return
    activeProfileId.value = id
    isProfileGateOpen.value = false
    try {
      await storage.set(ACTIVE_PROFILE_KEY, id)
    } catch (err) {
      console.warn('[profile] Falha ao salvar perfil ativo:', err)
    }

    try {
      const player = usePlayerStore()
      await player.hydrate(true)
    } catch (_) {}
  }

  async function addProfile({ name, color }) {
    if (!canAddProfile.value) return null
    const cleanName = String(name || '').trim() || `Perfil ${profiles.value.length + 1}`
    const usedColors = profiles.value.map((p) => p.color)
    const availableColor = color || PROFILE_COLORS.find((c) => !usedColors.includes(c)) || PROFILE_COLORS[profiles.value.length % PROFILE_COLORS.length]

    const newProfile = {
      id: `p_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      name: cleanName,
      color: availableColor,
    }

    const updated = [...profiles.value, newProfile]
    profiles.value = updated
    try {
      await storage.set(PROFILES_KEY, updated)
    } catch (err) {
      console.warn('[profile] Falha ao salvar perfis:', err)
    }
    return newProfile
  }

  async function removeProfile(id) {
    if (profiles.value.length <= 1) return false
    const updated = profiles.value.filter((p) => p.id !== id)
    profiles.value = updated
    try {
      await storage.set(PROFILES_KEY, updated)
    } catch (err) {
      console.warn('[profile] Falha ao salvar perfis após remoção:', err)
    }

    if (activeProfileId.value === id) {
      await selectProfile(updated[0].id)
    }
    return true
  }

  function openProfileGate() {
    isProfileGateOpen.value = true
  }

  function closeProfileGate() {
    isProfileGateOpen.value = false
  }

  return {
    profiles,
    activeProfileId,
    activeProfile,
    isProfileGateOpen,
    canAddProfile,
    hydrate,
    selectProfile,
    addProfile,
    removeProfile,
    openProfileGate,
    closeProfileGate,
  }
})
