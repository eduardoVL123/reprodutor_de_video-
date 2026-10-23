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
})
