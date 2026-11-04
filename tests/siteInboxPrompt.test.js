import { describe, it, expect, vi, afterEach } from 'vitest'
import { ref } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { duplicateIds } from '@/utils/devTools'

/** RFC-021: aviso na TV de lista recebida pelo site + dica com o endereço e o código. */

let wrapper
afterEach(() => {
  if (wrapper) wrapper.unmount()
  wrapper = null
  document.body.innerHTML = ''
  vi.unstubAllEnvs()
  vi.resetModules()
})

async function setup({ received = null, code = 'ABCD2345', confirmResult = true } = {}) {
  vi.stubEnv('VITE_LICENSE_BASE_URL', 'https://pulse-license.test')
  const inbox = {
    received: ref(received),
    connecting: ref(false),
    confirm: vi.fn(async () => confirmResult),
    discard: vi.fn(async () => {}),
    check: vi.fn(async () => {}),
  }
  vi.doMock('@/composables/useSiteInbox', () => ({ useSiteInbox: () => inbox }))
  setActivePinia(createPinia())
  const { useLicenseStore } = await import('@/stores/licenseStore')
  const license = useLicenseStore()
  license.code = code
  vi.spyOn(license, 'announce').mockResolvedValue()
  const nav = await import('@/utils/spatialNavigation')
  nav.initSpatialNavigation()
  const { default: SiteInboxPrompt } = await import('@/components/SiteInboxPrompt.vue')
  wrapper = mount(SiteInboxPrompt, { attachTo: document.body })
  await flushPromises()
  return { inbox, license }
}

describe('dica do site', () => {
  it('mostra o endereço do site e o código do aparelho', async () => {
    await setup()
    expect(wrapper.find('#site-hint').text()).toContain('pulse-license.test/enviar')
    expect(wrapper.find('#site-hint').text()).toContain('ABCD2345')
  })

  it('sem código ainda: registra o aparelho e procura a lista quando o código chega', async () => {
    const { license, inbox } = await setup({ code: '' })
    expect(license.announce).toHaveBeenCalledTimes(1)
    expect(wrapper.find('#site-hint').exists()).toBe(false)
    expect(inbox.check).not.toHaveBeenCalled() // sem código não há caixa de entrada para olhar
  })

  it('serviço fora do ar ao abrir a tela: tenta de novo e o código aparece quando o serviço volta', async () => {
    vi.useFakeTimers()
    try {
      const { license, inbox } = await setup({ code: '' })
      expect(wrapper.find('#site-hint').exists()).toBe(false)
      license.announce.mockImplementation(async () => {
        license.code = 'QDU5NXY7'
      })
      await vi.advanceTimersByTimeAsync(5000)
      await flushPromises()
      expect(license.announce).toHaveBeenCalledTimes(2)
      expect(wrapper.find('#site-hint').text()).toContain('QDU5NXY7')
      expect(inbox.check).toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('lista recebida', () => {
  const RECEIVED = { host: 'servidor.test:8080', label: 'Sala', insecure: true }

  it('pergunta antes de adicionar, mostra servidor e apelido e o foco vai para Adicionar', async () => {
    await setup({ received: RECEIVED })
    const dialog = wrapper.find('#site-inbox-dialog')
    expect(dialog.text()).toContain('Adicionar esta lista?')
    expect(dialog.text()).toContain('servidor.test:8080')
    expect(dialog.text()).toContain('Sala')
    expect(document.activeElement.id).toBe('site-inbox-accept')
    expect(duplicateIds(document)).toEqual([])
  })

  it('Adicionar entra e avisa o pai', async () => {
    const { inbox } = await setup({ received: RECEIVED })
    await wrapper.find('#site-inbox-accept').trigger('click')
    await flushPromises()
    expect(inbox.confirm).toHaveBeenCalled()
    expect(wrapper.emitted('done')).toHaveLength(1)
  })

  it('Descartar não entra', async () => {
    const { inbox } = await setup({ received: RECEIVED })
    await wrapper.find('#site-inbox-discard').trigger('click')
    expect(inbox.discard).toHaveBeenCalled()
    expect(wrapper.emitted('done')).toBeUndefined()
  })

  it('sem lista recebida, não há aviso', async () => {
    await setup()
    expect(wrapper.find('#site-inbox-dialog').exists()).toBe(false)
  })
})

describe('dica do site no celular (RFC-023)', () => {
  afterEach(() => {
    vi.doUnmock('@/utils/compat')
    vi.doUnmock('@/services/platform')
  })

  it('vira um botão que abre o site com o código do aparelho; na TV continua só o texto', async () => {
    const openExternal = vi.fn()
    vi.doMock('@/services/platform', async (importOriginal) => ({ ...(await importOriginal()), openExternal }))
    vi.doMock('@/utils/compat', async (importOriginal) => ({ ...(await importOriginal()), isPhone: () => true }))
    await setup()
    await wrapper.find('#site-open').trigger('click')
    expect(openExternal).toHaveBeenCalledWith('https://pulse-license.test/enviar?codigo=ABCD2345')
    wrapper.unmount()
    wrapper = null
    document.body.innerHTML = ''

    vi.resetModules()
    vi.doMock('@/utils/compat', async (importOriginal) => ({ ...(await importOriginal()), isPhone: () => false }))
    await setup()
    expect(wrapper.find('#site-open').exists()).toBe(false)
    expect(wrapper.find('#site-hint').exists()).toBe(true)
  })
})
