/**
 * src/utils/spatialNavigation.js
 * Lógica global de navegação D-Pad (Navegação Espacial).
 *
 * Camadas (em ordem de prioridade a cada tecla):
 *  1. Handlers de tecla registrados (`registerKeyHandler`) — ex.: player em tela cheia.
 *  2. Tecla Voltar → pilha de `registerBackHandler`; fallback: nas telas raiz (login e dashboard) sai do app.
 *  3. Setas dentro de uma grade virtualizada (`registerGrid`) → navegação por índice lógico.
 *  4. Setas fora da grade (ou na borda dela) → cálculo geométrico + memória de foco por
 *     painel (`data-focus-group`).
 *
 * Compatível com ES2017 / Chromium 53+ (sem Array.prototype.at, Object.hasOwn etc.).
 */

import { exitApp } from '@/services/platform'

let isEnabled = false
let routerRef = null
const ROOT_ROUTES = ['login', 'dashboard']

const backHandlers = []
const keyHandlers = []
const focusScopes = []
const gridApis = new Map() // elemento raiz da grade => api
const lastFocusedByGroup = new Map() // nome do grupo => { id, el }
let pendingGridRoot = null // grade com foco assíncrono em andamento
let exitHandler = null // confirmação de saída (Samsung/LG); sem ela, Voltar na tela raiz sai direto
let focusingFromPointer = false // foco dado pelo mouse/Magic Remote (ver isPointerFocus)
let lastPointer = null // última posição real do ponteiro { x, y }
let pointerAtKeyNav = null // posição do ponteiro na última seta: parado ali, ele não rouba o foco

const FOCUSABLE_SELECTOR = '.tv-focusable, button, a[href], input, select, textarea, [tabindex]'

// ---------------------------------------------------------------------------
// Normalização de teclas de controle remoto
// ---------------------------------------------------------------------------

const ACTION_BY_KEY = {
  ArrowUp: 'up',
  Up: 'up',
  ArrowDown: 'down',
  Down: 'down',
  ArrowLeft: 'left',
  Left: 'left',
  ArrowRight: 'right',
  Right: 'right',
  Enter: 'select',
  Escape: 'back',
  Esc: 'back',
  Backspace: 'back',
  XF86Back: 'back',
  GoBack: 'back',
  MediaPlayPause: 'playPause',
  MediaPlay: 'play',
  MediaPause: 'pause',
  MediaStop: 'stop',
  MediaRewind: 'rewind',
  MediaFastForward: 'fastForward',
  ChannelUp: 'channelUp',
  ChannelDown: 'channelDown',
  PageUp: 'channelUp',
  PageDown: 'channelDown',
}

const ACTION_BY_CODE = {
  38: 'up',
  40: 'down',
  37: 'left',
  39: 'right',
  13: 'select',
  27: 'back',
  8: 'back',
  10009: 'back', // Samsung Tizen "Return"
  461: 'back', // LG webOS "Back"
  179: 'playPause',
  415: 'play', // Samsung/LG Play
  19: 'pause', // Samsung/LG Pause
  413: 'stop', // Samsung/LG Stop
  412: 'rewind', // Samsung/LG Rewind
  417: 'fastForward', // Samsung/LG Fast Forward
  427: 'channelUp',
  33: 'channelUp',
  428: 'channelDown',
  34: 'channelDown',
}

function isTextField(el) {
  if (!el) return false
  if (el.isContentEditable) return true
  const tag = (el.tagName || '').toLowerCase()
  if (tag === 'textarea') return true
  if (tag !== 'input') return false
  const type = (el.getAttribute('type') || 'text').toLowerCase()
  return ['button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'color', 'file', 'image'].indexOf(type) === -1
}

export function isEditingTextField(el) {
  if (!isTextField(el)) return false
  return !el.readOnly && el.getAttribute('data-tv-editing') !== 'false'
}

/** Ativa o modo de edição em campo de texto na Smart TV (remove readonly e sobe teclado) */
export function enterInputEditMode(inputEl) {
  if (!inputEl || !isTextField(inputEl)) return
  inputEl.removeAttribute('readonly')
  inputEl.setAttribute('data-tv-editing', 'true')
  document.body.classList.add('tv-keyboard-open')
  inputEl.focus()
  try {
    const len = inputEl.value ? inputEl.value.length : 0
    inputEl.setSelectionRange(len, len)
  } catch (_) {}
  setTimeout(() => {
    try {
      inputEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
    } catch (_) {
      inputEl.scrollIntoView(false)
    }
  }, 150)
}

/** Sai do modo de edição (restaura readonly para fechar teclado sem perder foco) */
export function exitInputEditMode(inputEl, keepFocus = true) {
  if (!inputEl || !isTextField(inputEl)) return
  inputEl.setAttribute('readonly', 'readonly')
  inputEl.setAttribute('data-tv-editing', 'false')
  document.body.classList.remove('tv-keyboard-open')
  if (keepFocus) {
    try {
      inputEl.blur()
      inputEl.focus({ preventScroll: true })
    } catch (_) {
      inputEl.focus()
    }
  }
}

export function initTextField(el) {
  if (!el || !isTextField(el)) return
  if (!el.hasAttribute('data-tv-editing')) {
    el.setAttribute('readonly', 'readonly')
    el.setAttribute('data-tv-editing', 'false')
  }
}

export function scanTextFields(root) {
  const scope = root || document
  if (!scope || !scope.querySelectorAll) return
  const list = scope.querySelectorAll('input, textarea')
  for (let i = 0; i < list.length; i++) {
    initTextField(list[i])
  }
}

function onMouseDown(e) {
  const el = e.target
  if (isTextField(el)) {
    enterInputEditMode(el)
  }
}

/**
 * Ponteiro (Magic Remote da LG, mouse no PC/Tizen): o item sob o ponteiro recebe o foco,
 * para existir um único destaque na tela. Não interrompe a digitação num campo de texto.
 */
function onPointerOver(e) {
  const target = e.target && e.target.closest ? e.target.closest(FOCUSABLE_SELECTOR) : null
  if (!target || target === document.activeElement) return
  if (isEditingTextField(document.activeElement) || !isNavigable(target)) return
  if (isPointerParkedSinceKeyNav(e)) return
  const scope = currentScope()
  if (scope !== document && !scope.contains(target)) return
  focusingFromPointer = true
  try {
    target.focus({ preventScroll: true })
  } catch (_) {
    target.focus()
  } finally {
    focusingFromPointer = false
  }
}

function onPointerMove(e) {
  lastPointer = { x: e.clientX, y: e.clientY }
}

/**
 * Depois de uma seta, o conteúdo desliza sob o ponteiro parado e o navegador dispara `mouseover` sozinho
 * no item que caiu embaixo dele. Só volta a valer o ponteiro quando ele se mexer de verdade.
 */
function isPointerParkedSinceKeyNav(e) {
  if (!pointerAtKeyNav) return false
  if (e.clientX === pointerAtKeyNav.x && e.clientY === pointerAtKeyNav.y) return true
  pointerAtKeyNav = null
  return false
}

/**
 * Verdadeiro durante o foco dado pelo ponteiro (o `focusin` é síncrono). Quem rola ou desliza conteúdo no foco
 * deve ignorá-lo: o item já está sob o ponteiro, e mexer nele faz outro item cair embaixo do ponteiro.
 */
export function isPointerFocus() {
  return focusingFromPointer
}

function onFocusOut(e) {
  const el = e.target
  if (isTextField(el) && el.getAttribute('data-tv-editing') === 'true') {
    if (e.relatedTarget !== el) {
      el.setAttribute('readonly', 'readonly')
      el.setAttribute('data-tv-editing', 'false')
      document.body.classList.remove('tv-keyboard-open')
    }
  }
}

/**
 * Traduz `event.key` / `event.keyCode` para uma ação semântica.
 * @returns {'up'|'down'|'left'|'right'|'select'|'back'|'play'|'pause'|'playPause'|'stop'|'rewind'|'fastForward'|'channelUp'|'channelDown'|null}
 */
export function getTvAction(event) {
  if (!event) return null
  const code = event.keyCode || event.which || 0
  const action = ACTION_BY_KEY[event.key] || ACTION_BY_CODE[code] || null
  if (!action) return null
  // Backspace dentro de campo de texto apaga caractere; não é "Voltar".
  if (action === 'back' && (event.key === 'Backspace' || code === 8) && isTextField(document.activeElement)) {
    return null
  }
  return action
}

/** Tizen só entrega teclas de mídia/canal ao app depois de registradas. */
function registerTizenKeys() {
  try {
    const input = window.tizen && window.tizen.tvinputdevice
    if (!input) return
    ;[
      'MediaPlayPause',
      'MediaPlay',
      'MediaPause',
      'MediaStop',
      'MediaRewind',
      'MediaFastForward',
      'ChannelUp',
      'ChannelDown',
    ].forEach((k) => {
      try {
        input.registerKey(k)
      } catch (_) {
        /* tecla inexistente neste modelo */
      }
    })
  } catch (_) {
    /* fora do Tizen */
  }
}

// ---------------------------------------------------------------------------
// Pilhas públicas (Voltar, teclas, escopo de foco, grades)
// ---------------------------------------------------------------------------

function pushTo(list, item) {
  list.push(item)
  return () => {
    const i = list.lastIndexOf(item)
    if (i !== -1) list.splice(i, 1)
  }
}

/**
 * Registra um interceptador da tecla Voltar. O mais recente roda primeiro; se
 * retornar `true`, o evento é consumido. @returns {Function} cleanup
 */
export function registerBackHandler(fn) {
  return pushTo(backHandlers, fn)
}

/**
 * Registra um interceptador genérico `(action, event) => boolean`, consultado
 * antes da navegação padrão (ex.: player em tela cheia). Ações 'back' que não
 * forem consumidas seguem para a pilha de Voltar. @returns {Function} cleanup
 */
export function registerKeyHandler(fn) {
  return pushTo(keyHandlers, fn)
}

/** Troca a saída direta da tela raiz por uma confirmação (ex.: diálogo "Sair?"). @returns {Function} cleanup */
export function setExitHandler(fn) {
  exitHandler = fn
  return () => {
    if (exitHandler === fn) exitHandler = null
  }
}

/** Restringe a navegação a um contêiner (ex.: overlay modal). @returns {Function} cleanup */
export function pushFocusScope(el) {
  return pushTo(focusScopes, el)
}

/**
 * Registra uma grade virtualizada. A api deve expor:
 *   columns(): number, count(): number, currentIndex(): number,
 *   isPending(): boolean, focusIndex(index): Promise<boolean>
 * @returns {Function} cleanup
 */
export function registerGrid(el, api) {
  gridApis.set(el, api)
  return () => {
    if (gridApis.get(el) === api) gridApis.delete(el)
    if (pendingGridRoot === el) pendingGridRoot = null
  }
}

// ---------------------------------------------------------------------------
// Utilitários de foco
// ---------------------------------------------------------------------------

function currentScope() {
  for (let i = focusScopes.length - 1; i >= 0; i--) {
    const el = focusScopes[i]
    if (el && document.body.contains(el)) return el
  }
  return document
}

function centerOf(rect) {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
}

function getScrollParent(el) {
  if (!el || !el.parentElement) return null
  if (el.closest) {
    const named = el.closest('[data-focus-group="home-vitrine"], [data-focus-group="series-view"], [data-focus-group="favorites-view"], main')
    if (named) return named
  }
  let cur = el.parentElement
  while (cur && cur !== document.body && cur !== document.documentElement) {
    const s = window.getComputedStyle(cur)
    if (s.overflowY === 'auto' || s.overflowY === 'scroll') return cur
    cur = cur.parentElement
  }
  return null
}

export function isNavigable(el) {
  if (!el || el.disabled) return false
  if (el.getAttribute('tabindex') === '-1') return false
  const rect = el.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return false
  if (window.getComputedStyle(el).visibility === 'hidden') return false

  // Fora horizontalmente da tela
  if (rect.right <= 0 || rect.left >= window.innerWidth) {
    return false
  }

  // Recorte estrito de viewport APENAS para elementos dentro de [data-grid-root]
  // (onde o GridView já gerencia os slots via gridTarget)
  const root = el.closest ? el.closest('[data-grid-root]') : null
  if (root) {
    if (rect.bottom <= 0 || rect.top >= window.innerHeight) return false
    const r = root.getBoundingClientRect()
    const c = centerOf(rect)
    if (c.y < r.top || c.y > r.bottom || c.x < r.left || c.x > r.right) return false
    return true
  }

  // Para containers roláveis (como <main> ou data-focus-group="home-vitrine")
  const scrollParent = getScrollParent(el)
  if (scrollParent) {
    const maxBottom = window.innerHeight * 2.2
    const minTop = -window.innerHeight * 1.5
    if (rect.top > maxBottom || rect.bottom < minTop) return false
    return true
  }

  // Elementos normais fora de container rolável
  if (rect.bottom <= 0 || rect.top >= window.innerHeight) {
    return false
  }
  return true
}

function getFocusableElements(root) {
  const scope = root || document
  return Array.prototype.filter.call(scope.querySelectorAll(FOCUSABLE_SELECTOR), isNavigable)
}

function focusEl(el, preventScroll) {
  if (!el) return
  try {
    el.focus(preventScroll ? { preventScroll: true } : undefined)
  } catch (_) {
    el.focus()
  }

  const isGrid = el.closest && el.closest('[data-grid-root]')
  if (!isGrid) {
    const container = getScrollParent(el)
    if (container && container !== document.body && container !== document.documentElement) {
      // Se o elemento focável for do primeiro grupo (como #hero-play), volta scrollTop = 0
      if (el.id === 'hero-play' || el.id === 'hero-bookmark' || el.id === 'hero-info') {
        try {
          container.scrollTo({ top: 0, behavior: 'smooth' })
        } catch (_) {
          container.scrollTop = 0
        }
        return
      }

      const cRect = container.getBoundingClientRect()
      const elRect = el.getBoundingClientRect()

      // Se estiver próximo das bordas ou fora da área visível do ancestral rolável
      const padding = 70
      const isAbove = elRect.top < cRect.top + padding
      const isBelow = elRect.bottom > cRect.bottom - padding

      if (isAbove || isBelow) {
        const currentScroll = container.scrollTop
        const targetScroll = currentScroll + (elRect.top - cRect.top) - (cRect.height / 2) + (elRect.height / 2)
        try {
          container.scrollTo({ top: Math.max(0, targetScroll), behavior: 'smooth' })
        } catch (_) {
          container.scrollTop = Math.max(0, targetScroll)
        }
      }
    }
  }
}

/** Foca o item ativo (`data-focus-active`) ou o primeiro focável do contêiner. */
export function focusFirstIn(selectorOrElement) {
  const root = typeof selectorOrElement === 'string' ? document.querySelector(selectorOrElement) : selectorOrElement
  if (!root) return false
  const active = root.querySelector('[data-focus-active="true"]')
  if (active && isNavigable(active)) {
    focusEl(active)
    return true
  }
  const list = getFocusableElements(root)
  if (list.length) {
    focusEl(list[0])
    return true
  }
  return false
}

function groupElOf(el) {
  return el && el.closest ? el.closest('[data-focus-group]') : null
}

function isInDirection(fromRect, el, direction) {
  const a = centerOf(fromRect)
  const b = centerOf(el.getBoundingClientRect())
  const dx = b.x - a.x
  const dy = b.y - a.y
  if (direction === 'left') return dx < -0.1
  if (direction === 'right') return dx > 0.1
  if (direction === 'up') return dy < -0.1
  return dy > 0.1
}

const lastFocusedByRow = new Map() // nome da row => { id, el }

function onFocusIn(e) {
  const el = e.target
  if (isTextField(el)) initTextField(el)
  if (!el || !el.id) return
  const group = groupElOf(el)
  if (group) lastFocusedByGroup.set(group.getAttribute('data-focus-group'), { id: el.id, el })
  const row = el.closest ? el.closest('[data-focus-row]') : null
  if (row) {
    const rowName = row.getAttribute('data-focus-row')
    if (rowName) lastFocusedByRow.set(rowName, { id: el.id, el })
  }
}

/**
 * Elemento de uma lembrança, só se for o mesmo nó ainda com aquele id: ids se repetem entre telas
 * (episode-card-4 existe em toda série) e a grade virtualizada recicla nós trocando o id.
 */
function rememberedElement(record) {
  if (!record || !record.id) return null
  const el = document.getElementById(record.id)
  return el && el === record.el ? el : null
}

/** Elemento lembrado da linha de destino, se estiver visível e navegável. */
function rememberedInRow(rowEl) {
  const el = rememberedElement(lastFocusedByRow.get(rowEl.getAttribute('data-focus-row')))
  return el && rowEl.contains(el) && isNavigable(el) ? el : null
}

/** Elemento lembrado (ou ativo) do painel de destino, se estiver visível e na direção. */
function rememberedIn(groupEl, fromRect, direction) {
  const el = rememberedElement(lastFocusedByGroup.get(groupEl.getAttribute('data-focus-group')))
  if (el && groupEl.contains(el) && isNavigable(el) && isInDirection(fromRect, el, direction)) return el
  const active = groupEl.querySelector('[data-focus-active="true"]')
  if (active && isNavigable(active) && isInDirection(fromRect, active, direction)) return active
  return null
}

/** Busca prioritariamente elemento no Top Nav sem penalidade excessiva no eixo X */
function findTopNavTarget(topNav, fromRect) {
  if (!topNav) return null

  // 1. Elemento lembrado no top-nav
  const remembered = rememberedIn(topNav, fromRect, 'up')
  if (remembered) return remembered

  // 2. Elemento ativo da aba atual
  const activeNav = topNav.querySelector('.text-white.font-semibold, [data-focus-active="true"]')
  if (activeNav && isNavigable(activeNav)) return activeNav

  // 3. Qualquer botão navegável em top-nav mais próximo horizontalmente (sem penalidade * 5)
  const navItems = getFocusableElements(topNav)
  if (!navItems.length) return null

  const fromX = centerOf(fromRect).x
  let closest = navItems[0]
  let minDist = Infinity
  for (let i = 0; i < navItems.length; i++) {
    const it = navItems[i]
    const dist = Math.abs(centerOf(it.getBoundingClientRect()).x - fromX)
    if (dist < minDist) {
      minDist = dist
      closest = it
    }
  }
  return closest
}

// ---------------------------------------------------------------------------
// Navegação
// ---------------------------------------------------------------------------

/** Próximo índice lógico na grade, ou -1 para delegar à navegação geométrica. */
function gridTarget(api, direction) {
  const cols = Math.max(1, api.columns())
  const count = api.count()
  const index = api.currentIndex()
  if (index < 0 || index >= count) return -1
  const col = index % cols

  if (direction === 'right') return col < cols - 1 && index + 1 < count ? index + 1 : -1
  if (direction === 'left') return col > 0 ? index - 1 : -1
  if (direction === 'up') return index - cols >= 0 ? index - cols : -1
  // down: se a linha seguinte for incompleta, vai para o último item dela.
  if (index + cols < count) return index + cols
  const lastRow = Math.floor((count - 1) / cols)
  return Math.floor(index / cols) < lastRow ? count - 1 : -1
}

/**
 * Determina se dois elementos pertencem à mesma linha horizontal.
 * 1. Prioriza data-focus-row compartilhado (se ambos tiverem e forem iguais => true; se forem diferentes => false).
 * 2. Se nenhum tiver data-focus-row, avalia sobreposição vertical significativa (>= 35% da menor altura).
 */
export function areInSameHorizontalRow(elA, elB, rectA, rectB) {
  if (!elA || !elB) return false

  const rowA = elA.closest ? elA.closest('[data-focus-row]') : null
  const rowB = elB.closest ? elB.closest('[data-focus-row]') : null

  if (rowA && rowB) {
    return rowA === rowB
  }
  if (rowA || rowB) {
    return false
  }

  const rA = rectA || elA.getBoundingClientRect()
  const rB = rectB || elB.getBoundingClientRect()

  const overlapY = Math.min(rA.bottom, rB.bottom) - Math.max(rA.top, rB.top)
  const minHeight = Math.min(rA.height, rB.height)
  return minHeight > 0 && overlapY > minHeight * 0.35
}

const overlapsVertically = (a, b) => a.top < b.bottom && a.bottom > b.top

/** Grupos irmãos (nenhum contém o outro): ex. painel de categorias ao lado da grade. */
function isSidePanelTransition(current, currentGroup, cand, candGroup) {
  if (!candGroup || !currentGroup || candGroup === currentGroup) return false
  return !candGroup.contains(current) && !currentGroup.contains(cand)
}

const overlapsHorizontally = (a, b) => a.left < b.right && a.right > b.left

/** Painel ao lado do atual (menu lateral, categorias): só se entra nele com Esquerda/Direita. */
function isBesidePanel(current, currentGroup, cand) {
  const candGroup = groupElOf(cand)
  if (!isSidePanelTransition(current, currentGroup, cand, candGroup)) return false
  return !overlapsHorizontally(candGroup.getBoundingClientRect(), currentGroup.getBoundingClientRect())
}

/**
 * Melhor candidato vertical: dentro do mesmo grupo primeiro (ex.: cabeçalho da seção → cards dela).
 * Cima/Baixo nunca atravessam para um painel ao lado (ex.: da última fileira para o avatar do menu).
 */
function findBestVertical(fromRect, allCandidates, direction, current) {
  const currentGroup = groupElOf(current)
  let candidates = allCandidates
  if (currentGroup) {
    candidates = allCandidates.filter((cand) => !isBesidePanel(current, currentGroup, cand))
    const sameGroup = candidates.filter((cand) => groupElOf(cand) === currentGroup)
    const inGroup = scoreVertical(fromRect, sameGroup, direction, current)
    if (inGroup) return inGroup
  }
  return scoreVertical(fromRect, candidates, direction, current)
}

function findBest(fromRect, candidates, direction, current) {
  if (direction === 'up' || direction === 'down') return findBestVertical(fromRect, candidates, direction, current)
  const currentCenter = centerOf(fromRect)

  // =========================================================================
  // NAVEGAÇÃO HORIZONTAL (LEFT / RIGHT) — REGRA DE OURO DA LINHA HORIZONTAL
  // =========================================================================
  if (direction === 'left' || direction === 'right') {
    // PASSO 1 (Prioridade Absoluta — Mesma Linha):
    // Filtra candidatos na mesma linha horizontal e na direção correta.
    let sameRowBest = null
    let sameRowMinDist = Infinity

    for (let i = 0; i < candidates.length; i++) {
      const cand = candidates[i]
      if (cand === current) continue
      const candRect = cand.getBoundingClientRect()
      const candCenter = centerOf(candRect)

      const isDirectionOk =
        direction === 'right'
          ? candCenter.x > currentCenter.x + 2
          : candCenter.x < currentCenter.x - 2

      if (!isDirectionOk) continue

      if (areInSameHorizontalRow(current, cand, fromRect, candRect)) {
        const distX = Math.abs(candCenter.x - currentCenter.x)
        if (distX < sameRowMinDist) {
          sameRowMinDist = distX
          sameRowBest = cand
        }
      }
    }

    if (sameRowBest) {
      return sameRowBest
    }

    // PASSO 2 (Transição entre Painéis Laterais, ex.: Categorias ↔ Grade de Conteúdo):
    // Somente se NÃO houver mais nenhum candidato na mesma linha horizontal.
    const currentGroup = groupElOf(current)
    let bestCandidate = null
    let minScore = Infinity

    for (let i = 0; i < candidates.length; i++) {
      const cand = candidates[i]
      if (cand === current) continue
      const candRect = cand.getBoundingClientRect()
      const candCenter = centerOf(candRect)

      const isDirectionOk =
        direction === 'right'
          ? candCenter.x > currentCenter.x + 2
          : candCenter.x < currentCenter.x - 2

      if (!isDirectionOk) continue

      // Painel lateral = outro grupo, sem um conter o outro (categorias ↔ grade, teclado ↔ resultados).
      const candGroup = groupElOf(cand)
      const isDiffGroup = isSidePanelTransition(current, currentGroup, cand, candGroup)

      // BLOQUEIO DE FUGA VERTICAL:
      // Em movimentos 'left' ou 'right', NUNCA permita focar um elemento que esteja
      // inteiramente acima ou inteiramente abaixo do atual dentro do mesmo grupo/painel.
      // Para outro painel, ele precisa estar ao lado (faixa vertical em comum), não em outra seção.
      const isEntirelyAbove = candRect.bottom <= fromRect.top + 4
      const isEntirelyBelow = candRect.top >= fromRect.bottom - 4

      if (!isDiffGroup && (isEntirelyAbove || isEntirelyBelow)) {
        continue
      }
      if (isDiffGroup && !overlapsVertically(candGroup.getBoundingClientRect(), fromRect)) {
        continue
      }

      const dx = Math.abs(candCenter.x - currentCenter.x)
      const dy = Math.abs(candCenter.y - currentCenter.y)
      // Se for transição entre painéis laterais distintos, prioriza menor diferença vertical |dy|
      const score = isDiffGroup ? dy * 3 + dx : dx + dy * 5

      if (score < minScore) {
        minScore = score
        bestCandidate = cand
      }
    }

    return bestCandidate
  }
  return null
}

// =========================================================================
// NAVEGAÇÃO VERTICAL (UP / DOWN)
// =========================================================================
function scoreVertical(fromRect, candidates, direction, current) {
  const currentCenter = centerOf(fromRect)
  const currentRow = current.closest ? current.closest('[data-focus-row]') : null
  let best = null
  let bestDistance = Infinity

  for (let i = 0; i < candidates.length; i++) {
    const cand = candidates[i]
    if (cand === current) continue

    // Fora do mesmo data-focus-row
    const candRow = cand.closest ? cand.closest('[data-focus-row]') : null
    if (currentRow && candRow && currentRow === candRow) {
      continue
    }

    const candRect = cand.getBoundingClientRect()
    const candCenter = centerOf(candRect)

    if (direction === 'up') {
      if (candCenter.y >= fromRect.top + 4) continue
    } else if (direction === 'down') {
      if (candCenter.y <= fromRect.bottom - 4) continue
    }

    // Correção para Elementos de Largura Total (w-full como #osd-progress):
    // Clampa currentCenter.x dentro da faixa horizontal [candRect.left, candRect.right]
    const clampedX = Math.max(candRect.left, Math.min(currentCenter.x, candRect.right))
    const dx = Math.abs(clampedX - currentCenter.x)
    const dy = Math.abs(candCenter.y - currentCenter.y)
    const distance = dy + dx * 5

    if (distance < bestDistance) {
      bestDistance = distance
      best = cand
    }
  }

  return best
}

function navigate(direction) {
  pointerAtKeyNav = lastPointer
  const scope = currentScope()
  const current = document.activeElement

  // 1) Grade virtualizada (inclusive com foco assíncrono ainda pendente).
  let gridRoot = null
  let api = null
  if (pendingGridRoot && gridApis.has(pendingGridRoot) && gridApis.get(pendingGridRoot).isPending()) {
    gridRoot = pendingGridRoot
    api = gridApis.get(gridRoot)
  } else if (current && current.closest && current.hasAttribute('data-grid-index')) {
    gridRoot = current.closest('[data-grid-root]')
    api = gridRoot ? gridApis.get(gridRoot) : null
  }
  if (api && scope.contains(gridRoot)) {
    const target = gridTarget(api, direction)
    if (target >= 0) {
      pendingGridRoot = gridRoot
      api.focusIndex(target)
      return
    }
  } else {
    gridRoot = null
  }

  const hasCurrent = current && current !== document.body && scope.contains(current)
  if (!hasCurrent || (!gridRoot && !isNavigable(current))) {
    focusFirstIn(scope === document ? document.body : scope)
    return
  }

  const fromRect = current.getBoundingClientRect()
  const currentRow = current.closest ? current.closest('[data-focus-row]') : null

  // 2) Subida garantida para Top Navbar quando direção for 'up'
  if (direction === 'up') {
    const topNav = scope.querySelector ? scope.querySelector('[data-focus-group="top-nav"]') : null
    const currentGroup = groupElOf(current)
    const isAlreadyInTopNav = currentGroup && currentGroup.getAttribute('data-focus-group') === 'top-nav'

    if (topNav && !isAlreadyInTopNav) {
      // Se estamos na linha 0 de uma grade ou se não há botões intermediários no mesmo painel
      const localCandidates = getFocusableElements(scope).filter(
        (el) => !(gridRoot && el.hasAttribute('data-grid-index') && gridRoot.contains(el)),
      )
      const localBest = findBest(fromRect, localCandidates, 'up', current)

      // Se não há candidato local ou se o candidato local já é do top-nav, ou se estava na grade na linha 0
      // sem botão de header local entre eles:
      const localHeader = current.closest && current.closest('[data-focus-group="header"]')
      if (!localBest || localBest.closest('[data-focus-group="top-nav"]') || (gridRoot && !localHeader)) {
        const navTarget = findTopNavTarget(topNav, fromRect)
        if (navTarget) {
          focusEl(navTarget)
          return
        }
      }
    }
  }

  // 3) Geometria (na borda da grade, ignora os itens da própria grade).
  const candidates = getFocusableElements(scope).filter(
    (el) => !(gridRoot && el.hasAttribute('data-grid-index') && gridRoot.contains(el)),
  )
  let best = findBest(fromRect, candidates, direction, current)
  if (!best) {
    if (direction === 'up') {
      const topNav = scope.querySelector ? scope.querySelector('[data-focus-group="top-nav"]') : null
      const navTarget = findTopNavTarget(topNav, fromRect)
      if (navTarget) {
        focusEl(navTarget)
        return
      }
    }
    return
  }

  // 4) Memória de foco ao trocar de painel ou linha.
  const targetGroup = groupElOf(best)
  if (targetGroup && targetGroup !== groupElOf(current)) {
    const preferred = rememberedIn(targetGroup, fromRect, direction)
    if (preferred) best = preferred
  } else if (direction === 'up' || direction === 'down') {
    const targetRow = best && best.closest ? best.closest('[data-focus-row]') : null
    if (targetRow && targetRow !== currentRow) {
      const preferredRow = rememberedInRow(targetRow)
      if (preferredRow) best = preferredRow
    }
  }
  focusEl(best)
}

function handleBack() {
  for (let i = backHandlers.length - 1; i >= 0; i--) {
    try {
      if (backHandlers[i]() === true) return
    } catch (err) {
      console.warn('[spatialNavigation] Handler de Voltar falhou:', err)
    }
  }
  if (!routerRef) return
  // Telas raiz: Voltar sem nada para fechar pergunta se quer sair (exigência das lojas Samsung/LG).
  if (ROOT_ROUTES.indexOf(routerRef.currentRoute.value.name) === -1) return
  if (exitHandler) exitHandler()
  else exitApp()
}

function onKeyDown(e) {
  const current = document.activeElement
  const action = getTvAction(e)

  // 1. Campo de texto em MODO DE EDIÇÃO: movimentação livre de cursor e controle do teclado
  if (isEditingTextField(current)) {
    // Seta Esquerda / Direita: NUNCA prevenir default e NUNCA navegar!
    // Permite que o WebView mova o cursor nativamente entre os caracteres.
    if (action === 'left' || action === 'right' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      try {
        const start = current.selectionStart
        const end = current.selectionEnd
        if (typeof start === 'number' && typeof end === 'number') {
          const delta = action === 'left' || e.key === 'ArrowLeft' ? -1 : 1
          // Fallback seguro: se após o keydown o WebView da TV não mover o cursor, movemos via JS
          setTimeout(() => {
            try {
              if (
                current &&
                document.activeElement === current &&
                current.selectionStart === start &&
                current.selectionEnd === end
              ) {
                const len = (current.value || '').length
                const newPos = Math.max(0, Math.min(len, start === end ? start + delta : delta < 0 ? start : end))
                current.setSelectionRange(newPos, newPos)
              }
            } catch (_) {}
          }, 0)
        }
      } catch (_) {}
      return
    }

    if (action === 'back') {
      e.preventDefault()
      exitInputEditMode(current)
      return
    }
    if (action === 'select') {
      e.preventDefault()
      exitInputEditMode(current)
      return
    }
    if (action === 'up' || action === 'down') {
      e.preventDefault()
      exitInputEditMode(current, false)
      navigate(action)
      return
    }
    return
  }

  // 2. Handlers de tecla registrados (ex.: player em tela cheia)
  if (action) {
    for (let i = keyHandlers.length - 1; i >= 0; i--) {
      let consumed = false
      try {
        consumed = keyHandlers[i](action, e) === true
      } catch (err) {
        console.warn('[spatialNavigation] Handler de tecla falhou:', err)
      }
      if (consumed) {
        e.preventDefault()
        return
      }
    }
  }

  const inText = isTextField(current)

  // 3. Campo de texto FOCADO mas NÃO editando (apenas foco / teclado fechado)
  if (inText) {
    if (action === 'select') {
      e.preventDefault()
      enterInputEditMode(current)
      return
    }
  }

  if (!action) return

  if (action === 'back') {
    e.preventDefault()
    handleBack()
    return
  }
  if (action === 'up' || action === 'down' || action === 'left' || action === 'right') {
    e.preventDefault()
    navigate(action)
  }
  // 'select' segue o comportamento nativo (clique no botão focado).
}

// ---------------------------------------------------------------------------
// Ciclo de vida
// ---------------------------------------------------------------------------

let domObserver = null

/** @param {{ router?: import('vue-router').Router }} [options] */
export function initSpatialNavigation(options) {
  if (options && options.router) routerRef = options.router
  if (isEnabled) return
  isEnabled = true
  registerTizenKeys()
  // Captura: roda antes dos listeners dos componentes e pode cancelar o clique do Enter.
  window.addEventListener('keydown', onKeyDown, true)
  document.addEventListener('focusin', onFocusIn)
  document.addEventListener('focusout', onFocusOut)
  document.addEventListener('mousedown', onMouseDown, true)
  document.addEventListener('mouseover', onPointerOver)
  document.addEventListener('mousemove', onPointerMove, true)

  if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined' && document.body) {
    domObserver = new MutationObserver((mutations) => {
      for (let i = 0; i < mutations.length; i++) {
        const added = mutations[i].addedNodes
        for (let j = 0; j < added.length; j++) {
          const node = added[j]
          if (node.nodeType === 1) {
            if (isTextField(node)) initTextField(node)
            scanTextFields(node)
          }
        }
      }
    })
    domObserver.observe(document.body, { childList: true, subtree: true })
  }
  scanTextFields(document.body)
}

export function stopSpatialNavigation() {
  if (!isEnabled) return
  isEnabled = false
  window.removeEventListener('keydown', onKeyDown, true)
  document.removeEventListener('focusin', onFocusIn)
  document.removeEventListener('focusout', onFocusOut)
  document.removeEventListener('mousedown', onMouseDown, true)
  document.removeEventListener('mouseover', onPointerOver)
  document.removeEventListener('mousemove', onPointerMove, true)
  if (domObserver) {
    domObserver.disconnect()
    domObserver = null
  }
}

