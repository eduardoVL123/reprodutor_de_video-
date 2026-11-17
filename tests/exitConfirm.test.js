import { describe, it, expect, vi, afterEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

let nav
let wrapper
afterEach(() => {
  if (wrapper) wrapper.unmount()
  if (nav) nav.stopSpatialNavigation()
  wrapper = null
  document.body.innerHTML = ''
})

async function setup({ canExit = true, systemExit = false } = {}) {
  const exitApp = vi.fn()
  vi.doMock('@/services/platform', () => ({ exitApp, canExitApp: () => canExit, systemHandlesExit: () => systemExit }))
  nav = await import('@/utils/spatialNavigation')
  nav.initSpatialNavigation({ router: { currentRoute: { value: { name: 'dashboard' } }, replace: vi.fn() } })
  document.body.innerHTML = '<button id="home-btn">Início</button>'
  document.getElementById('home-btn').focus()
  const { default: ExitConfirm } = await import('@/components/ExitConfirm.vue')
  wrapper = mount(ExitConfirm, { attachTo: document.body })
  await flushPromises()
  return { exitApp }
}
const back = () =>
  document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true, cancelable: true }))

describe('ExitConfirm — Voltar na tela inicial (Samsung/LG)', () => {
  it('pergunta se quer sair, com o foco em "Cancelar"', async () => {
    const { exitApp } = await setup()

    back()
    await flushPromises()

    expect(document.getElementById('exit-confirm-dialog')).not.toBeNull()
    expect(document.activeElement.id).toBe('exit-cancel')
    expect(exitApp).not.toHaveBeenCalled()
  })

  it('"Sair" encerra o app', async () => {
    const { exitApp } = await setup()
    back()
    await flushPromises()

    document.getElementById('exit-confirm').click()

    expect(exitApp).toHaveBeenCalledTimes(1)
  })

  it('Voltar ou "Cancelar" fecham a pergunta e devolvem o foco', async () => {
    const { exitApp } = await setup()
    back()
    await flushPromises()

    back()
    await flushPromises()

    expect(document.getElementById('exit-confirm-dialog')).toBeNull()
    expect(document.activeElement.id).toBe('home-btn')
    expect(exitApp).not.toHaveBeenCalled()
  })

  // LG: em webOS 6+ o sistema mostra o próprio pop-up de sair; em webOS 23-25 o App Self Checklist pede a tela Home.
  // O platformBack() faz o certo em cada versão, então o nosso pop-up não aparece (seria uma pergunta dobrada).
  it('na LG não pergunta: Voltar vai direto para o sistema (platformBack)', async () => {
    const { exitApp } = await setup({ systemExit: true })

    back()
    await flushPromises()

    expect(document.getElementById('exit-confirm-dialog')).toBeNull()
    expect(exitApp).toHaveBeenCalledTimes(1)
  })

  it('no navegador do PC não pergunta nada (lá o app não fecha a janela)', async () => {
    await setup({ canExit: false })

    back()
    await flushPromises()

    expect(document.getElementById('exit-confirm-dialog')).toBeNull()
  })
})
