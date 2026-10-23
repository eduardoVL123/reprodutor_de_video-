import { describe, it, expect, vi, afterEach } from 'vitest'
import { layout, press as pressKey } from './helpers/layout'

async function setup(routeName = 'dashboard') {
  vi.doMock('@/services/platform', () => ({ exitApp: vi.fn() }))
  const nav = await import('@/utils/spatialNavigation')
  nav.initSpatialNavigation({ router: { currentRoute: { value: { name: routeName } }, replace: vi.fn() } })
  return nav
}

const right = () => pressKey('right')
const left = () => pressKey('left')
const down = () => pressKey('down')

let nav
afterEach(() => {
  if (nav) nav.stopSpatialNavigation()
  document.body.innerHTML = ''
})

// Tela inicial simplificada: menu no topo, destaque, e duas seções com cabeçalho + cards.
const HOME = `
  <header data-focus-group="top-nav">
    <button id="nav-home">Início</button><button id="nav-lists">Listas</button>
  </header>
  <div data-focus-group="hero">
    <button id="hero-play">Assistir</button><button id="hero-info">Info</button>
  </div>
  <section data-focus-group="continue">
    <button id="clear-history">Limpar</button>
    <button id="card-1">Card 1</button><button id="card-2">Card 2</button>
  </section>
  <section data-focus-group="movies">
    <button id="see-all">Ver todos</button>
    <button id="movie-1">Filme 1</button>
  </section>
`
const HOME_RECTS = {
  'group:top-nav': [0, 0, 1024, 60],
  'nav-home': [20, 10, 60, 40],
  'nav-lists': [900, 10, 80, 40],
  'group:hero': [0, 60, 1024, 200],
  'hero-play': [20, 180, 120, 40],
  'hero-info': [150, 180, 40, 40],
  'group:continue': [0, 280, 1024, 200],
  'clear-history': [900, 285, 100, 30],
  'card-1': [20, 330, 200, 120],
  'card-2': [240, 330, 200, 120],
  'group:movies': [0, 500, 1024, 200],
  'see-all': [900, 505, 100, 30],
  'movie-1': [20, 550, 200, 120],
}

describe('spatialNavigation — setas horizontais não fogem da linha', () => {
  it('no último botão do destaque, Direita fica parado (não pula para outra seção)', async () => {
    layout(HOME, HOME_RECTS)
    nav = await setup()
    document.getElementById('hero-info').focus()

    right()

    expect(document.activeElement.id).toBe('hero-info')
  })

  it('no último card de uma fileira, Direita não pula para o cabeçalho da seção de baixo', async () => {
    layout(HOME, HOME_RECTS)
    nav = await setup()
    document.getElementById('card-2').focus()

    right()

    expect(document.activeElement.id).toBe('card-2')
  })

  it('no primeiro item do menu, Esquerda fica parado (não desce para o conteúdo)', async () => {
    layout(HOME, HOME_RECTS)
    nav = await setup()
    document.getElementById('nav-home').focus()

    left()

    expect(document.activeElement.id).toBe('nav-home')
  })

  it('ainda passa entre painéis lado a lado (categorias → grade), mesmo em alturas diferentes', async () => {
    layout(
      `<aside data-focus-group="categories"><button id="cat-9">Categoria 9</button></aside>
       <div data-focus-group="content"><button id="item-0">Item 0</button></div>`,
      {
        'group:categories': [0, 0, 200, 700],
        'cat-9': [10, 600, 180, 40],
        'group:content': [220, 0, 800, 700],
        'item-0': [230, 20, 200, 100],
      },
    )
    nav = await setup()
    document.getElementById('cat-9').focus()

    right()

    expect(document.activeElement.id).toBe('item-0')
  })
})

describe('spatialNavigation — setas verticais', () => {
  it('do cabeçalho de uma seção, Baixo entra nos cards da própria seção', async () => {
    layout(HOME, HOME_RECTS)
    nav = await setup()
    document.getElementById('clear-history').focus()

    down()

    expect(document.activeElement.id).toBe('card-2')
  })

  it('prefere o elemento logo abaixo (mesma coluna) a um cabeçalho distante na lateral', async () => {
    layout(HOME, HOME_RECTS)
    nav = await setup()
    document.getElementById('hero-info').focus()

    down()

    expect(document.activeElement.id).toBe('card-1')
  })

  it('do último card de uma seção, Baixo vai para a próxima seção', async () => {
    layout(HOME, HOME_RECTS)
    nav = await setup()
    document.getElementById('card-1').focus()

    down()

    expect(document.activeElement.id).toBe('movie-1')
  })
})

describe('spatialNavigation — teclas de mídia', () => {
  it.each([
    [{ key: 'MediaPlay', keyCode: 415 }, 'play'],
    [{ key: 'MediaPause', keyCode: 19 }, 'pause'],
    [{ key: 'MediaPlayPause', keyCode: 179 }, 'playPause'],
    [{ key: 'MediaStop', keyCode: 413 }, 'stop'],
    [{ key: 'MediaRewind', keyCode: 412 }, 'rewind'],
    [{ key: 'MediaFastForward', keyCode: 417 }, 'fastForward'],
    [{ key: 'Unidentified', keyCode: 413 }, 'stop'],
  ])('%o vira a ação %s', async (init, action) => {
    nav = await setup()

    expect(nav.getTvAction(new KeyboardEvent('keydown', init))).toBe(action)
  })

  it('registra no Tizen todas as teclas de mídia usadas pelo player', async () => {
    const registerKey = vi.fn()
    window.tizen = { tvinputdevice: { registerKey } }
    nav = await setup()

    const keys = registerKey.mock.calls.map(([k]) => k)
    expect(keys).toEqual(
      expect.arrayContaining(['MediaPlay', 'MediaPause', 'MediaPlayPause', 'MediaStop', 'MediaRewind', 'MediaFastForward']),
    )
    delete window.tizen
  })
})

describe('spatialNavigation — ponteiro (Magic Remote / mouse)', () => {
  it('passar o ponteiro sobre um item focável move o foco para ele', async () => {
    layout(HOME, HOME_RECTS)
    nav = await setup()
    document.getElementById('hero-play').focus()

    document.getElementById('card-2').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))

    expect(document.activeElement.id).toBe('card-2')
  })

  it('ponteiro parado não rouba o foco das setas quando o conteúdo desliza sob ele', async () => {
    layout(HOME, HOME_RECTS)
    nav = await setup()
    const at = (x, y) => ({ bubbles: true, clientX: x, clientY: y })
    document.dispatchEvent(new MouseEvent('mousemove', at(300, 390)))
    document.getElementById('card-1').focus()

    right() // a fileira desliza e outro card cai sob o ponteiro parado: o navegador dispara mouseover sozinho
    document.getElementById('card-1').dispatchEvent(new MouseEvent('mouseover', at(300, 390)))
    const afterKey = document.activeElement.id

    document.dispatchEvent(new MouseEvent('mousemove', at(320, 395)))
    document.getElementById('card-1').dispatchEvent(new MouseEvent('mouseover', at(320, 395)))

    expect(afterKey).toBe('card-2')
    expect(document.activeElement.id).toBe('card-1') // mexeu o mouse: volta a valer o ponteiro
  })

  it('não tira o foco de um campo de texto em edição', async () => {
    layout('<input id="campo" type="text" /><button id="botao">ok</button>', { campo: [0, 0, 200, 40], botao: [0, 60, 100, 40] })
    nav = await setup()
    const campo = document.getElementById('campo')
    campo.scrollIntoView = () => {} // jsdom não implementa; o modo de edição rola o campo após 150 ms
    nav.enterInputEditMode(campo)

    document.getElementById('botao').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))

    expect(document.activeElement.id).toBe('campo')
  })
})

describe('spatialNavigation — menu lateral (layout 2.0)', () => {
  // Menu lateral fixo à esquerda (altura toda) e conteúdo à direita com duas fileiras.
  const SIDE = `
    <nav data-focus-group="side-menu">
      <button id="nav-search">Busca</button><button id="nav-home">Início</button><button id="avatar">P</button>
    </nav>
    <main data-focus-group="home-vitrine">
      <div data-focus-group="hero"><button id="hero-play">Assistir</button></div>
      <section data-focus-group="channels"><button id="live-0">Canal</button></section>
    </main>
  `
  const SIDE_RECTS = {
    'group:side-menu': [0, 0, 112, 720],
    'group:home-vitrine': [112, 0, 1168, 720],
    'nav-search': [16, 80, 64, 56],
    'nav-home': [16, 150, 64, 56],
    avatar: [16, 640, 64, 56],
    'group:hero': [112, 0, 1168, 400],
    'hero-play': [180, 300, 200, 50],
    'group:channels': [112, 420, 1168, 220],
    'live-0': [180, 450, 260, 150],
  }
  const up = () => pressKey('up')

  it('Baixo na última fileira não cai no menu lateral', async () => {
    layout(SIDE, SIDE_RECTS)
    nav = await setup()
    document.getElementById('live-0').focus()

    down()

    expect(document.activeElement.id).toBe('live-0')
  })

  it('Cima no primeiro item do menu fica no menu, mesmo com o conteúdo rolado para cima', async () => {
    // Página rolada: o destaque ficou acima da tela, "acima" do item Busca.
    layout(SIDE, { ...SIDE_RECTS, 'group:hero': [112, -400, 1168, 400], 'hero-play': [180, -120, 200, 50] })
    nav = await setup()
    document.getElementById('nav-search').focus()

    up()

    expect(document.activeElement.id).toBe('nav-search')
  })

  it('Esquerda no conteúdo ainda entra no menu lateral', async () => {
    layout(SIDE, SIDE_RECTS)
    nav = await setup()
    document.getElementById('hero-play').focus()

    left()

    expect(document.activeElement.id).toMatch(/^nav-/)
  })
})

describe('spatialNavigation — memória de foco', () => {
  // Detalhes de uma série: botão Assistir em cima e a fileira de episódios embaixo.
  const DETAILS = `
    <div data-focus-group="details"><button id="play">Assistir</button></div>
    <div data-focus-group="episodes">
      <button id="ep-0">E1</button><button id="ep-1">E2</button><button id="ep-2">E3</button>
    </div>
  `
  const DETAILS_RECTS = {
    'group:details': [0, 0, 1280, 300],
    play: [20, 200, 200, 50],
    'group:episodes': [0, 320, 1280, 200],
    'ep-0': [20, 340, 280, 160],
    'ep-1': [320, 340, 280, 160],
    'ep-2': [620, 340, 280, 160],
  }
  const up = () => pressKey('up')

  it('volta ao episódio em que estava ao descer de novo na mesma tela', async () => {
    layout(DETAILS, DETAILS_RECTS)
    nav = await setup()
    document.getElementById('ep-2').focus()

    up()
    down()

    expect(document.activeElement.id).toBe('ep-2')
  })

  it('não herda a posição de outra tela que usa os mesmos ids (outra série)', async () => {
    layout(DETAILS, DETAILS_RECTS)
    nav = await setup()
    document.getElementById('ep-2').focus()

    layout(DETAILS, DETAILS_RECTS) // abriu outra série: elementos novos com os mesmos ids
    document.getElementById('play').focus()
    down()

    expect(document.activeElement.id).toBe('ep-0')
  })
})

describe('spatialNavigation — Voltar na tela inicial', () => {
  const back = () => pressKey('back')

  it('sem confirmação registrada, encerra o app direto', async () => {
    layout('<button id="a">A</button>', { a: [0, 0, 100, 40] })
    nav = await setup('dashboard')
    const { exitApp } = await import('@/services/platform')
    document.getElementById('a').focus()

    back()

    expect(exitApp).toHaveBeenCalledTimes(1)
  })

  it('com a confirmação registrada (Samsung/LG), pergunta em vez de sair', async () => {
    layout('<button id="a">A</button>', { a: [0, 0, 100, 40] })
    nav = await setup('dashboard')
    const { exitApp } = await import('@/services/platform')
    const ask = vi.fn()
    const unregister = nav.setExitHandler(ask)
    document.getElementById('a').focus()

    back()
    unregister()

    expect(ask).toHaveBeenCalledTimes(1)
    expect(exitApp).not.toHaveBeenCalled()
  })
})
