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

const DAY = 86400
const now = () => Math.floor(Date.now() / 1000)

async function setupRows({ section = 'vod', items = [] } = {}) {
  const { createPinia, setActivePinia } = await import('pinia')
  const pinia = createPinia()
  setActivePinia(pinia)
  const { useCatalogStore } = await import('@/stores/catalogStore')
  const catalog = useCatalogStore()
  catalog.loadSection = vi.fn(async () => {})
  catalog.getItems = vi.fn(async (_section, _cat, start, count) => items.slice(start, start + count))
  catalog.countFor = vi.fn(() => 500)
  catalog.categories = { live: CATEGORIES, vod: CATEGORIES, series: CATEGORIES }
  catalog.status[section].state = 'ready'

  const { default: CatalogBrowser } = await import('@/components/CatalogBrowser.vue')
  const w = mount(CatalogBrowser, { props: { section }, global: { plugins: [pinia] }, attachTo: document.body })
  await flushPromises()
  return w
}

describe('CatalogBrowser — fileiras por categoria', () => {
  it('não inventa programação nem progresso nos canais (o app não tem guia de programação)', async () => {
    wrapper = await setupRows({ section: 'live', items: [{ stream_id: 9, name: 'Canal 9' }] })

    expect(wrapper.text()).toContain('Canal 9')
    expect(wrapper.text()).not.toContain('Até 22:00')
    expect(wrapper.text()).not.toContain('Programação a seguir')
  })

  it('selo NOVO só no que entrou na lista nos últimos dias (dado do servidor), nunca em tudo', async () => {
    wrapper = await setupRows({
      items: [
        { stream_id: 1, name: 'Recente', added: String(now() - DAY) },
        { stream_id: 2, name: 'Antigo', added: '1700000000' },
        { stream_id: 3, name: 'Sem data' },
      ],
    })

    expect(wrapper.find('#item-7-0').text()).toContain('NOVO')
    expect(wrapper.find('#item-7-1').text()).not.toContain('NOVO')
    expect(wrapper.find('#item-7-2').text()).not.toContain('NOVO')
  })

  it('categorias e fileiras rolam de lado com o controle (data-scroll-x) e "Ver todos" é focável com id', async () => {
    wrapper = await setupRows({ items: [{ stream_id: 1, name: 'Filme' }] })

    expect(wrapper.find('[data-focus-row="categories"]').attributes()).toHaveProperty('data-scroll-x')
    expect(wrapper.find('[data-focus-row="rail-7"]').attributes()).toHaveProperty('data-scroll-x')
    expect(wrapper.find('#see-all-7').classes()).toContain('tv-focusable')
  })

  it('"Ver todos" abre a categoria inteira em grade, não só os primeiros itens', async () => {
    wrapper = await setupRows({ items: [{ stream_id: 1, name: 'Filme' }] })

    await wrapper.find('#see-all-7').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-grid-root]').attributes('data-grid-total')).toBe('500')
  })
})
