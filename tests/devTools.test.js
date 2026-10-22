import { describe, it, expect } from 'vitest'

describe('devTools — ferramentas de conferência (só em desenvolvimento)', () => {
  it('instala window.__neutro com auditoria, caminhada por setas e ids duplicados', async () => {
    const { installDevTools } = await import('@/utils/devTools')

    installDevTools()

    expect(Object.keys(window.__neutro).sort()).toEqual(['audit', 'duplicateIds', 'walk'])
    delete window.__neutro
  })

  it('duplicateIds acha ids repetidos na tela', async () => {
    document.body.innerHTML = '<button id="a"></button><button id="b"></button><button id="a"></button>'
    const { duplicateIds } = await import('@/utils/devTools')

    expect(duplicateIds()).toEqual(['a'])
    document.body.innerHTML = ''
  })

  it('walk aperta as teclas e informa onde o foco parou', async () => {
    document.body.innerHTML = '<button id="um"></button><button id="dois"></button>'
    document.body.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') document.getElementById('dois').focus()
    })
    document.getElementById('um').focus()
    const { walk } = await import('@/utils/devTools')

    const log = await walk(['Right'], 0)

    expect(log).toEqual(['Right→dois'])
    document.body.innerHTML = ''
  })
})
