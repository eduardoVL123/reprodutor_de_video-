import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'

const ITEMS = Array.from({ length: 6 }, (_, i) => ({ stream_id: i + 1, name: `Item ${i + 1}` }))

async function setup() {
  const { default: HorizontalRail } = await import('@/components/ui/HorizontalRail.vue')
  return mount(HorizontalRail, {
    props: { items: ITEMS, idPrefix: 'filmes', itemKey: (it) => it.stream_id },
    slots: { item: '<template #item="{ item }"><span class="nome">{{ item.name }}</span></template>' },
    attachTo: document.body,
  })
}

const rect = (width) => () => ({ left: 0, top: 0, width, height: 100, right: width, bottom: 100, x: 0, y: 0 })

describe('HorizontalRail — fileira deslizante para o controle remoto', () => {
  it('cada item é focável, com id único e na mesma linha de foco', async () => {
    const wrapper = await setup()

    const buttons = wrapper.findAll('button')
    expect(buttons.map((b) => b.attributes('id'))).toEqual(['filmes-0', 'filmes-1', 'filmes-2', 'filmes-3', 'filmes-4', 'filmes-5'])
    expect(new Set(buttons.map((b) => b.element.closest('[data-focus-row]').getAttribute('data-focus-row'))).size).toBe(1)
    expect(wrapper.findAll('.nome').map((n) => n.text())).toEqual(ITEMS.map((it) => it.name))
    wrapper.unmount()
  })

  it('OK no item avisa o pai com o item e a posição', async () => {
    const wrapper = await setup()

    await wrapper.find('#filmes-2').trigger('click')

    expect(wrapper.emitted('select')).toEqual([[ITEMS[2], 2]])
    wrapper.unmount()
  })

  it('ao focar um item, a fileira desliza para deixá-lo no início', async () => {
    const wrapper = await setup()
    wrapper.find('[data-rail-viewport]').element.getBoundingClientRect = rect(500)
    wrapper.findAll('button').forEach((b) => (b.element.getBoundingClientRect = rect(200)))

    await wrapper.find('#filmes-3').trigger('focusin')

    // 6 itens de 200px + 5 espaços de 1rem (16px) = 1280px; janela 500px; item 3 → 3 × 216 = 648px.
    expect(wrapper.find('[data-rail-track]').attributes('style')).toContain('translateX(-648px)')
    wrapper.unmount()
  })

  it('foco vindo do mouse não desliza a fileira (senão ela corre sozinha sob o ponteiro até o fim)', async () => {
    const { vi } = await import('vitest')
    vi.doMock('@/services/platform', () => ({ exitApp: vi.fn() }))
    const nav = await import('@/utils/spatialNavigation')
    nav.initSpatialNavigation({ router: { currentRoute: { value: { name: 'dashboard' } }, replace: vi.fn() } })
    const wrapper = await setup()
    wrapper.find('[data-rail-viewport]').element.getBoundingClientRect = rect(500)
    wrapper.findAll('button').forEach((b) => (b.element.getBoundingClientRect = rect(200)))

    wrapper.find('#filmes-3').element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    await wrapper.vm.$nextTick()

    expect(document.activeElement.id).toBe('filmes-3')
    expect(wrapper.find('[data-rail-track]').attributes('style')).toContain('translateX(0px)')
    wrapper.unmount()
    nav.stopSpatialNavigation()
  })
})
