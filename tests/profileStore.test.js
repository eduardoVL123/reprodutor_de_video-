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
      { id: 'p1', name: 'A', color: '#e50914' },
      { id: 'p2', name: 'B', color: '#2563eb' },
    ])

    await store.hydrate()

    expect(store.isProfileGateOpen).toBe(true)
  })

  it('com um único perfil, entra direto nele sem perguntar', async () => {
    const store = await setup([{ id: 'unico', name: 'Casa', color: '#e50914' }])

    await store.hydrate()

    expect(store.isProfileGateOpen).toBe(false)
    expect(store.activeProfileId).toBe('unico')
  })
})
