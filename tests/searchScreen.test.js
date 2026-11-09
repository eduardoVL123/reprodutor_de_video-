import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

/** Busca no celular em pé (RFC-023): sem teclado na tela, então abrir a aba já sobe o teclado do aparelho. */

let wrapper
afterEach(() => {
  if (wrapper) wrapper.unmount()
  wrapper = null
  document.body.innerHTML = ''
  vi.doUnmock('@/composables/useFormFactor')
})

async function mountSearch(portrait) {
  const { computed } = await import('vue')
  vi.doMock('@/composables/useFormFactor', () => ({ useFormFactor: () => ({ isPhonePortrait: computed(() => portrait) }) }))
  const { createPinia, setActivePinia } = await import('pinia')
  const pinia = createPinia()
  setActivePinia(pinia)
  const { useCatalogStore } = await import('@/stores/catalogStore')
  useCatalogStore().loadSection = vi.fn(async () => {})
  const { default: SearchScreen } = await import('@/components/SearchScreen.vue')
  wrapper = mount(SearchScreen, { global: { plugins: [pinia] }, attachTo: document.body })
  await flushPromises()
}

describe('SearchScreen — celular em pé', () => {
  it('em pé: o campo abre em modo de digitação (teclado do aparelho)', async () => {
    await mountSearch(true)
    expect(document.activeElement.id).toBe('search-input')
    expect(document.getElementById('search-input').getAttribute('data-tv-editing')).toBe('true')
  })

  it('TV: o foco vai para o teclado na tela e o campo continua fechado', async () => {
    await mountSearch(false)
    expect(document.activeElement.id).toBe('kb-a')
    expect(document.getElementById('search-input').getAttribute('data-tv-editing')).toBe('false')
  })
})

describe('SearchScreen — busca que falha', () => {
  it('avisa o erro com "Tentar novamente" em vez de dizer que não há resultado', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    Element.prototype.scrollIntoView = Element.prototype.scrollIntoView || (() => {}) // jsdom não tem
    vi.doMock('@/services/catalogSearch', async (importOriginal) => ({
      ...(await importOriginal()),
      searchCatalog: vi.fn(async () => { throw new Error('IndexedDB fora') }),
    }))
    await mountSearch(true)
    await wrapper.find('input').setValue('filme')
    await new Promise((r) => setTimeout(r, 400))
    await flushPromises()

    expect(wrapper.text()).not.toContain('Nenhum resultado')
    expect(wrapper.find('#search-retry').exists()).toBe(true)
    vi.doUnmock('@/services/catalogSearch')
    vi.restoreAllMocks()
  })
})
