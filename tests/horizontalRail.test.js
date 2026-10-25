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

    const buttons = wrapper.findAll('button[data-rail-index]')
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

describe('HorizontalRail — item ativo', () => {
  it('marca o item ativo para a navegação entrar nele', async () => {
    const { default: HorizontalRail } = await import('@/components/ui/HorizontalRail.vue')
    const wrapper = mount(HorizontalRail, {
      props: { items: ITEMS, idPrefix: 'ep', activeIndex: 2 },
      slots: { item: '<template #item="{ item }">{{ item.name }}</template>' },
    })

    expect(wrapper.findAll('[data-focus-active="true"]').map((b) => b.attributes('id'))).toEqual(['ep-2'])
    wrapper.unmount()
  })
})

describe('HorizontalRail — mouse e toque (PC e celular)', () => {
  /** Fileira de 1280px de conteúdo numa janela de 500px: dá para deslizar até -780px. */
  async function setupScrollable() {
    const wrapper = await setup()
    wrapper.find('[data-rail-viewport]').element.getBoundingClientRect = rect(500)
    Object.defineProperty(wrapper.find('[data-rail-track]').element, 'scrollWidth', { configurable: true, value: 1280 })
    return wrapper
  }
  const track = (wrapper) => wrapper.find('[data-rail-track]').attributes('style')

  it('shift+roda (deltaX) desliza a fileira e é limitada ao fim do conteúdo', async () => {
    const wrapper = await setupScrollable()
    const view = wrapper.find('[data-rail-viewport]')

    await view.trigger('wheel', { deltaX: 300, deltaY: 0 })
    expect(track(wrapper)).toContain('translateX(-300px)')
    await view.trigger('wheel', { deltaX: 900, deltaY: 0 })
    expect(track(wrapper)).toContain('translateX(-780px)')
    await view.trigger('wheel', { deltaX: -2000, deltaY: 0 })
    expect(track(wrapper)).toContain('translateX(0px)')
    wrapper.unmount()
  })

  it('roda comum (vertical) não é capturada: a página continua rolando', async () => {
    const wrapper = await setupScrollable()
    const event = new WheelEvent('wheel', { deltaX: 0, deltaY: 120, cancelable: true, bubbles: true })

    wrapper.find('[data-rail-viewport]').element.dispatchEvent(event)
    await wrapper.vm.$nextTick()

    expect(event.defaultPrevented).toBe(false)
    expect(track(wrapper)).toContain('translateX(0px)')
    wrapper.unmount()
  })

  it('arrastar com o mouse ou o dedo desliza a fileira e o arrasto não vira clique no card', async () => {
    const wrapper = await setupScrollable()
    const view = wrapper.find('[data-rail-viewport]')
    const pointer = (type, clientX) =>
      view.element.dispatchEvent(new MouseEvent(type, { clientX, bubbles: true, cancelable: true }))

    pointer('pointerdown', 400)
    pointer('pointermove', 395) // abaixo do limiar: ainda é um clique
    expect(track(wrapper)).toContain('translateX(0px)')
    pointer('pointermove', 250) // arrastou 150px para a esquerda
    pointer('pointerup', 250)
    await wrapper.vm.$nextTick()
    expect(track(wrapper)).toContain('translateX(-150px)')

    await wrapper.find('#filmes-2').trigger('click') // o toque que soltou o dedo em cima do card
    expect(wrapper.emitted('select')).toBeUndefined()
    await wrapper.find('#filmes-2').trigger('click') // o clique seguinte é de verdade
    expect(wrapper.emitted('select')).toHaveLength(1)
    wrapper.unmount()
  })

  it('um toque simples (sem arrastar) continua selecionando o card', async () => {
    const wrapper = await setupScrollable()
    const view = wrapper.find('[data-rail-viewport]')

    view.element.dispatchEvent(new MouseEvent('pointerdown', { clientX: 300, bubbles: true }))
    view.element.dispatchEvent(new MouseEvent('pointerup', { clientX: 300, bubbles: true }))
    await wrapper.find('#filmes-1').trigger('click')

    expect(wrapper.emitted('select')).toEqual([[ITEMS[1], 1]])
    wrapper.unmount()
  })
})

describe('HorizontalRail — setas para o mouse', () => {
  async function setupArrows(content = 1280) {
    const wrapper = await setup()
    wrapper.find('[data-rail-viewport]').element.getBoundingClientRect = rect(500)
    Object.defineProperty(wrapper.find('[data-rail-track]').element, 'scrollWidth', { configurable: true, value: content })
    window.dispatchEvent(new Event('resize')) // refaz a medida, como ao redimensionar a janela
    await wrapper.vm.$nextTick()
    return wrapper
  }
  const arrow = (wrapper, label) => wrapper.find(`[aria-label="${label}"]`)
  const track = (wrapper) => wrapper.find('[data-rail-track]').attributes('style')

  it('sem sobra de conteúdo não há setas; no início só a seta para frente', async () => {
    const fits = await setupArrows(400)
    expect(arrow(fits, 'Anterior').exists()).toBe(false)
    expect(arrow(fits, 'Próximo').exists()).toBe(false)
    fits.unmount()

    const wrapper = await setupArrows()
    expect(arrow(wrapper, 'Anterior').exists()).toBe(false)
    expect(arrow(wrapper, 'Próximo').exists()).toBe(true)
    wrapper.unmount()
  })

  it('cada clique anda 80% da janela, e some a seta do lado em que a fileira acabou', async () => {
    const wrapper = await setupArrows()

    await arrow(wrapper, 'Próximo').trigger('click')
    expect(track(wrapper)).toContain('translateX(-400px)')
    expect(arrow(wrapper, 'Anterior').exists()).toBe(true)

    await arrow(wrapper, 'Próximo').trigger('click') // 800px passaria do fim: para em 780px
    expect(track(wrapper)).toContain('translateX(-780px)')
    expect(arrow(wrapper, 'Próximo').exists()).toBe(false)

    await arrow(wrapper, 'Anterior').trigger('click')
    expect(track(wrapper)).toContain('translateX(-380px)')
    wrapper.unmount()
  })

  it('as setas ficam fora da navegação do controle remoto e não selecionam card', async () => {
    const wrapper = await setupArrows()

    expect(arrow(wrapper, 'Próximo').attributes('tabindex')).toBe('-1')
    await arrow(wrapper, 'Próximo').trigger('click')

    expect(wrapper.emitted('select')).toBeUndefined()
    wrapper.unmount()
  })
})

