import { describe, it, expect, vi, beforeEach } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'

/** Liga a licença ao ciclo do app: abrir/trocar lista, voltar ao app, sair do app (RFC-018 R4). */

const license = { refresh: vi.fn(async () => {}), scheduleEntry: vi.fn(), cancelEntry: vi.fn() }
vi.mock('@/stores/licenseStore', () => ({ useLicenseStore: () => license }))

const listeners = {}
vi.mock('@/services/platform', () => ({
  onAppForeground: (cb) => ((listeners.fg = cb), () => delete listeners.fg),
  onAppBackground: (cb) => ((listeners.bg = cb), () => delete listeners.bg),
}))

const flush = () => new Promise((r) => setTimeout(r, 0))

async function mountWith(session, loaded = ref(true)) {
  const { useLicenseWatch } = await import('@/composables/useLicenseWatch')
  const comp = defineComponent({
    setup() {
      useLicenseWatch(
        () => session.value,
        () => loaded.value,
      )
      return () => h('div')
    },
  })
  return mount(comp)
}

beforeEach(() => {
  Object.values(license).forEach((fn) => fn.mockClear())
})

describe('useLicenseWatch', () => {
  it('ao abrir com uma lista: consulta a licença e agenda a entrada', async () => {
    const session = ref({ id: 'a', baseUrl: 'http://parceiro.com' })
    await mountWith(session)
    await flush()
    expect(license.refresh).toHaveBeenCalledWith(session.value)
    expect(license.scheduleEntry).toHaveBeenCalledWith(session.value)
  })

  it('trocar de lista consulta de novo; sem lista não consulta', async () => {
    const session = ref(null)
    await mountWith(session)
    await flush()
    expect(license.refresh).not.toHaveBeenCalled()
    session.value = { id: 'b', baseUrl: 'http://outra.com' }
    await nextTick()
    await flush()
    expect(license.refresh).toHaveBeenCalledTimes(1)
  })

  it('sair do app cancela a entrada; voltar consulta e agenda de novo', async () => {
    const session = ref({ id: 'a', baseUrl: 'http://parceiro.com' })
    await mountWith(session)
    await flush()
    listeners.bg()
    expect(license.cancelEntry).toHaveBeenCalled()
    listeners.fg()
    await flush()
    expect(license.refresh).toHaveBeenCalledTimes(2)
    expect(license.scheduleEntry).toHaveBeenCalledTimes(2)
  })

  it('lista que não carregou (servidor do parceiro fora do ar) não gera entrada: só quando o catálogo fica pronto', async () => {
    const session = ref({ id: 'a', baseUrl: 'http://parceiro.com' })
    const loaded = ref(false)
    await mountWith(session, loaded)
    await flush()
    expect(license.refresh).toHaveBeenCalled()
    expect(license.scheduleEntry).not.toHaveBeenCalled()
    loaded.value = true
    await nextTick()
    expect(license.scheduleEntry).toHaveBeenCalledWith(session.value)
  })

  it('voltar ao app com a lista sem carregar não gera entrada', async () => {
    const session = ref({ id: 'a', baseUrl: 'http://parceiro.com' })
    await mountWith(session, ref(false))
    await flush()
    listeners.fg()
    await flush()
    expect(license.scheduleEntry).not.toHaveBeenCalled()
  })

  it('a lista deixar de estar carregada (troca ou erro) cancela a entrada pendente', async () => {
    const loaded = ref(true)
    await mountWith(ref({ id: 'a', baseUrl: 'http://parceiro.com' }), loaded)
    await flush()
    license.cancelEntry.mockClear()
    loaded.value = false
    await nextTick()
    expect(license.cancelEntry).toHaveBeenCalled()
  })

  it('desmontar cancela a entrada e solta os avisos', async () => {
    const wrapper = await mountWith(ref({ id: 'a', baseUrl: 'http://parceiro.com' }))
    await flush()
    wrapper.unmount()
    expect(license.cancelEntry).toHaveBeenCalled()
    expect(listeners.fg).toBeUndefined()
    expect(listeners.bg).toBeUndefined()
  })
})
