import { describe, it, expect, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

async function setup() {
  vi.doMock('@/services/platform', () => ({ exitApp: vi.fn() }))
  const { createPinia, setActivePinia } = await import('pinia')
  const pinia = createPinia()
  setActivePinia(pinia)
  const nav = await import('@/utils/spatialNavigation')
  nav.initSpatialNavigation()
  const { default: ProfileGate } = await import('@/components/ProfileGate.vue')
  const { useProfileStore } = await import('@/stores/profileStore')
  const profileStore = useProfileStore()
  const wrapper = mount(ProfileGate, { global: { plugins: [pinia] }, attachTo: document.body })
  await flushPromises()
  return { wrapper, profileStore, nav }
}

const pressBack = () =>
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true, cancelable: true }))

describe('ProfileGate', () => {
  it('mostra os perfis e o botão de adicionar enquanto a escolha está aberta', async () => {
    const { wrapper, profileStore } = await setup()

    expect(wrapper.find('#profile-gate-overlay').exists()).toBe(true)
    expect(wrapper.findAll('[id^="profile-card-"]')).toHaveLength(profileStore.profiles.length)
    expect(wrapper.find('#btn-add-profile-card').exists()).toBe(true)
    wrapper.unmount()
  })

  it('escolher um perfil ativa o perfil, fecha a tela e avisa o pai', async () => {
    const { wrapper, profileStore } = await setup()

    await wrapper.find('#profile-card-p2').trigger('click')

    await vi.waitFor(() => expect(wrapper.emitted('selected')).toHaveLength(1))
    expect(profileStore.activeProfileId).toBe('p2')
    expect(profileStore.isProfileGateOpen).toBe(false)
    await flushPromises()
    expect(wrapper.find('#profile-gate-overlay').exists()).toBe(false)
    wrapper.unmount()
  })

  it('criar um perfil novo seleciona o perfil criado', async () => {
    const { wrapper, profileStore } = await setup()
    const before = profileStore.profiles.length

    await wrapper.find('#btn-add-profile-card').trigger('click')
    await wrapper.find('#input-profile-name').setValue('Quarto')
    await wrapper.find('#btn-save-new-profile').trigger('click')

    await vi.waitFor(() => expect(wrapper.emitted('selected')).toHaveLength(1))
    expect(profileStore.profiles).toHaveLength(before + 1)
    expect(profileStore.activeProfile.name).toBe('Quarto')
    wrapper.unmount()
  })

  it('Voltar fecha primeiro o formulário de novo perfil e depois a escolha de perfil', async () => {
    const { wrapper, profileStore } = await setup()
    await wrapper.find('#btn-add-profile-card').trigger('click')
    expect(wrapper.find('#input-profile-name').exists()).toBe(true)

    pressBack()
    await flushPromises()
    expect(wrapper.find('#input-profile-name').exists()).toBe(false)
    expect(profileStore.isProfileGateOpen).toBe(true)

    pressBack()
    await flushPromises()
    expect(profileStore.isProfileGateOpen).toBe(false)
    wrapper.unmount()
  })

  it('Voltar não fecha a tela depois de desmontada', async () => {
    const { wrapper, profileStore } = await setup()
    wrapper.unmount()

    pressBack()

    expect(profileStore.isProfileGateOpen).toBe(true)
  })
})
