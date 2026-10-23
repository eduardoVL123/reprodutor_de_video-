import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const CATEGORIES = [
  { category_id: 'all', category_name: 'Todos', count: 0 },
  { category_id: '7', category_name: 'Ação', count: 0 },
]

async function setup() {
  const { createPinia, setActivePinia } = await import('pinia')
  const pinia = createPinia()
  setActivePinia(pinia)
  const { useCatalogStore } = await import('@/stores/catalogStore')
  const catalog = useCatalogStore()
  catalog.loadSection = vi.fn(async () => {})
  catalog.categories = { live: [], vod: CATEGORIES, series: [] }
  catalog.status.vod.state = 'ready' // seção já em cache: a aba abre sem tela de carregamento

  const { default: CatalogBrowser } = await import('@/components/CatalogBrowser.vue')
  return mount(CatalogBrowser, { props: { section: 'vod' }, global: { plugins: [pinia] }, attachTo: document.body })
}

let wrapper
afterEach(() => {
  if (wrapper) wrapper.unmount()
  wrapper = null
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('CatalogBrowser — foco ao abrir a aba', () => {
  it('leva o foco para a categoria ativa assim que a lista de categorias carrega', async () => {
    // Layout fixo: no jsdom tudo mede 0×0 e nada seria navegável.
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600)
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 10, top: 10, width: 200, height: 40, right: 210, bottom: 50, x: 10, y: 10,
    })
    wrapper = await setup()

    await flushPromises()

    expect(document.activeElement.id).toBe('cat-0')
  })
})
