import { describe, it, expect } from 'vitest'

describe('profileStore — perfis padrão', () => {
  it('não promete restrição infantil que o app não aplica', async () => {
    const { createPinia, setActivePinia } = await import('pinia')
    setActivePinia(createPinia())
    const { useProfileStore } = await import('@/stores/profileStore')

    const names = useProfileStore().profiles.map((p) => p.name.toLowerCase())

    expect(names).not.toContain('kids')
    expect(names).not.toContain('infantil')
  })
})

describe('profileStore — cores da marca Pulse', () => {
  it('o perfil Principal e a primeira cor da paleta são o verde-limão (sem o vermelho antigo)', async () => {
    const { createPinia, setActivePinia } = await import('pinia')
    setActivePinia(createPinia())
    const { useProfileStore, PROFILE_COLORS } = await import('@/stores/profileStore')

    expect(PROFILE_COLORS[0]).toBe('#B8F000')
    expect(PROFILE_COLORS).not.toContain('#e50914')
    expect(useProfileStore().profiles[0].color).toBe('#B8F000')
  })

  it('a inicial do avatar é grafite sobre o limão e branca nas cores escuras', async () => {
    const { avatarTextColor } = await import('@/stores/profileStore')

    expect(avatarTextColor('#B8F000')).toBe('#0B0F0C')
    expect(avatarTextColor('#b8f000')).toBe('#0B0F0C')
    expect(avatarTextColor('#2563eb')).toBe('#ffffff')
  })
})

describe('profileStore — escolha de perfil ao abrir o app', () => {
  async function setup(savedProfiles) {
    const { createPinia, setActivePinia } = await import('pinia')
    setActivePinia(createPinia())
    const { storage } = await import('@/services/storage')
    if (savedProfiles) await storage.set('app:profiles', savedProfiles)
    const { useProfileStore } = await import('@/stores/profileStore')
    return useProfileStore()
  }

  it('pergunta quem está assistindo quando há mais de um perfil', async () => {
    const store = await setup([
      { id: 'p1', name: 'A', color: '#2563eb' },
      { id: 'p2', name: 'B', color: '#2563eb' },
    ])

    await store.hydrate()

    expect(store.isProfileGateOpen).toBe(true)
  })

  it('com um único perfil, entra direto nele sem perguntar', async () => {
    const store = await setup([{ id: 'unico', name: 'Casa', color: '#2563eb' }])

    await store.hydrate()

    expect(store.isProfileGateOpen).toBe(false)
    expect(store.activeProfileId).toBe('unico')
  })
})
