import { describe, it, expect } from 'vitest'
import { h } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'

const ITEMS = Array.from({ length: 8 }, (_, i) => ({ stream_id: i, name: `Item ${i}` }))

describe('GridView — grade virtualizada', () => {
  it('passa a mesma função select a cada janela (cards sem mudança não re-renderizam ao rolar)', async () => {
    const { default: GridView } = await import('@/components/GridView.vue')
    const seen = new Set()
    const wrapper = mount(GridView, {
      props: { count: ITEMS.length, loadItems: async (start, n) => ITEMS.slice(start, start + n), columns: 4 },
      slots: { item: ({ item, index, select }) => (seen.add(select), h('button', { id: `g-${index}`, onClick: () => select(item, index) })) },
      attachTo: document.body,
    })
    await flushPromises()

    await wrapper.vm.refresh(true)
    await flushPromises()
    await wrapper.find('#g-0').trigger('click')

    expect(seen.size).toBe(1)
    expect(wrapper.emitted('select')).toEqual([[ITEMS[0], 0]])
    wrapper.unmount()
  })

  it('linhas fundas continuam na tela se a fonte da raiz muda sem resize (celular em pé)', async () => {
    const { default: GridView } = await import('@/components/GridView.vue')
    const root = document.documentElement
    root.style.fontSize = '14.4px'
    const many = Array.from({ length: 30000 }, (_, i) => ({ stream_id: i, name: `Item ${i}` }))
    const wrapper = mount(GridView, {
      // Mesmos números do celular em pé em CatalogBrowser.vue (pôster, 3 colunas).
      props: { count: many.length, loadItems: async (s, n) => many.slice(s, s + n), columns: 3, rowHeight: 10, gap: 0.6, maxDomItems: 27 },
      slots: { item: ({ index }) => h('button', { id: `g-${index}` }) },
      attachTo: document.body,
    })
    const vp = wrapper.element
    Object.defineProperty(vp, 'clientHeight', { configurable: true, value: 640 })
    Object.defineProperty(vp, 'scrollTop', { configurable: true, writable: true, value: 0 })
    wrapper.vm.measure() // lê 14.4px
    root.style.fontSize = '13px' // a raiz muda depois, sem evento de resize

    vp.scrollTop = 1_500_000
    await wrapper.vm.refresh()
    await flushPromises()

    // Posição real de cada slot como o navegador a resolveria (rem vale a fonte ATUAL da raiz).
    const px = (v) => parseFloat(v) * (v.endsWith('rem') ? 13 : 1)
    const tops = wrapper.findAll('[data-grid-slot]').map((s) => px(s.element.style.top))
    const onScreen = tops.filter((t) => t + 10 * 14.4 > vp.scrollTop && t < vp.scrollTop + 640)
    expect(onScreen.length).toBeGreaterThanOrEqual(9) // 3 fileiras de 3 cobrindo a tela
    wrapper.unmount()
    root.style.fontSize = ''
  })
})
