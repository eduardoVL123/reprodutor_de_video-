import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'

const PROPS = { activeTab: 'home', profile: { name: 'Paula', color: '#2563eb' }, listLabel: 'Casa' }

async function setup(props = {}) {
  const { default: SideMenu } = await import('@/components/SideMenu.vue')
  return mount(SideMenu, { props: { ...PROPS, ...props }, attachTo: document.body })
}

let wrapper
afterEach(() => {
  if (wrapper) wrapper.unmount()
  wrapper = null
  document.body.innerHTML = ''
})

describe('SideMenu — menu inferior só no celular', () => {
  it('decide pelo html.is-phone (variante phone:), nunca pela largura: janela estreita no PC mantém o menu lateral', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync('src/components/SideMenu.vue', 'utf8')
    expect(source).not.toMatch(/\b(max-)?(sm|md|lg|xl):/)
    expect(source).toContain('phone:flex-row')
  })
})

describe('SideMenu — menu lateral recolhido (layout B)', () => {
  it('tem os destinos na ordem do mockup, cada um com id único', async () => {
    wrapper = await setup()

    const ids = wrapper.findAll('button').map((b) => b.attributes('id'))
    expect(ids).toEqual([
      'nav-search',
      'nav-home',
      'nav-live',
      'nav-vod',
      'nav-series',
      'nav-favorites',
      'btn-manage-lists',
      'btn-switch-profile',
    ])
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('é um grupo de foco próprio e marca só a aba ativa', async () => {
    wrapper = await setup({ activeTab: 'vod' })

    expect(wrapper.find('nav').attributes('data-focus-group')).toBe('side-menu')
    const active = wrapper.findAll('[data-focus-active="true"]')
    expect(active.map((b) => b.attributes('id'))).toEqual(['nav-vod'])
  })

  it('expande ao receber o foco e recolhe quando o foco sai', async () => {
    wrapper = await setup()
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    const nav = wrapper.find('nav')
    expect(nav.attributes('data-open')).toBe('false')

    wrapper.find('#nav-live').element.focus()
    await wrapper.vm.$nextTick()
    expect(nav.attributes('data-open')).toBe('true')

    wrapper.find('#nav-vod').element.focus()
    await wrapper.vm.$nextTick()
    expect(nav.attributes('data-open')).toBe('true')

    outside.focus()
    await wrapper.vm.$nextTick()
    expect(nav.attributes('data-open')).toBe('false')
  })

  it('OK num destino avisa o pai; lista ativa e perfil aparecem nos itens de conta', async () => {
    wrapper = await setup()

    await wrapper.find('#nav-series').trigger('click')
    await wrapper.find('#btn-manage-lists').trigger('click')
    await wrapper.find('#btn-switch-profile').trigger('click')

    expect(wrapper.emitted('navigate')).toEqual([['series']])
    expect(wrapper.emitted('manage-lists')).toHaveLength(1)
    expect(wrapper.emitted('switch-profile')).toHaveLength(1)
    expect(wrapper.find('#btn-manage-lists').text()).toContain('Casa')
    expect(wrapper.find('#btn-switch-profile').text()).toContain('Paula')
  })
})

describe('tabBack — Voltar nas abas do Dashboard', () => {
  it('fora do Início volta para o Início; no Início deixa o app sair', async () => {
    const { tabBackAction } = await import('@/utils/tabBack')

    expect(tabBackAction({ tab: 'vod' })).toBe('home')
    expect(tabBackAction({ tab: 'search' })).toBe('home')
    expect(tabBackAction({ tab: 'home' })).toBe(null)
  })

  it('não age com o player ou a escolha de perfil abertos (eles tratam a tecla)', async () => {
    const { tabBackAction } = await import('@/utils/tabBack')

    expect(tabBackAction({ tab: 'vod', playerOpen: true })).toBe(null)
    expect(tabBackAction({ tab: 'vod', gateOpen: true })).toBe(null)
  })
})

describe('navegação entre menu lateral e conteúdo', () => {
  let nav
  afterEach(() => {
    if (nav) nav.stopSpatialNavigation()
  })

  // Menu à esquerda (altura toda) + Início com destaque e uma fileira deslizante.
  const SCREEN = `
    <nav data-focus-group="side-menu">
      <button id="nav-search">Busca</button>
      <button id="nav-home" data-focus-active="true">Início</button>
      <button id="nav-live">TV</button>
    </nav>
    <div data-focus-group="home-vitrine">
      <div data-focus-row="hero"><button id="hero-play">Assistir</button><button id="hero-info">Info</button></div>
      <div data-focus-row="rail-filmes">
        <button id="filmes-0">0</button><button id="filmes-1">1</button><button id="filmes-2">2</button>
      </div>
    </div>`
  const RECTS = {
    'group:side-menu': [0, 0, 112, 1080],
    'nav-search': [28, 160, 56, 56],
    'nav-home': [28, 240, 56, 56],
    'nav-live': [28, 320, 56, 56],
    'group:home-vitrine': [0, 0, 1920, 1080],
    'hero-play': [176, 520, 200, 56],
    'hero-info': [392, 520, 200, 56],
    'filmes-0': [176, 760, 192, 288],
    'filmes-1': [388, 760, 192, 288],
    'filmes-2': [600, 760, 192, 288],
  }

  async function start() {
    vi.doMock('@/services/platform', () => ({ exitApp: vi.fn() }))
    nav = await import('@/utils/spatialNavigation')
    nav.initSpatialNavigation({ router: { currentRoute: { value: { name: 'dashboard' } } } })
  }

  it('Esquerda no primeiro item da fileira vai para a aba ativa do menu', async () => {
    const { layout, press } = await import('./helpers/layout')
    layout(SCREEN, RECTS)
    await start()
    document.getElementById('filmes-0').focus()

    press('left')

    expect(document.activeElement.id).toBe('nav-home')
  })

  it('o menu lembra o último item focado e Direita volta ao conteúdo de onde saiu', async () => {
    const { layout, press } = await import('./helpers/layout')
    layout(SCREEN, RECTS)
    await start()
    document.getElementById('nav-live').focus()
    document.getElementById('hero-play').focus()

    press('left')
    expect(document.activeElement.id).toBe('nav-live')

    press('right')
    expect(document.activeElement.id).toBe('hero-play')
  })

  it('Direita no último item da fileira não foge da fileira', async () => {
    const { layout, press } = await import('./helpers/layout')
    layout(SCREEN, RECTS)
    await start()
    document.getElementById('filmes-1').focus()

    press('right')
    expect(document.activeElement.id).toBe('filmes-2')
    press('right')
    expect(document.activeElement.id).toBe('filmes-2')
  })
})
