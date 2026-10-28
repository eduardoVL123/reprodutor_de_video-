import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

/** RFC-021: a TV recebe a lista enviada pelo site (caixa de entrada cifrada). */

async function pairLib() {
  await import('../server/pair/public/pair-lib.js')
  return globalThis.PairLib
}

const LIST = { dns: 'http://servidor.test:8080', username: 'joao', password: 'S3nh@', label: 'Sala' }

describe('chave da caixa de entrada', () => {
  it('a lista cifrada pelo site (pair-lib) abre na TV com o código do aparelho', async () => {
    const { loadOrCreateInboxKeys } = await import('@/services/inboxKeys')
    const keys = await loadOrCreateInboxKeys(new Map())
    const box = await (await pairLib()).seal(keys.publicKey, 'ABCD2345', LIST)
    expect(await keys.open(box, 'ABCD2345')).toEqual(LIST)
  })

  it('com outro código (dado autenticado) não abre', async () => {
    const { loadOrCreateInboxKeys } = await import('@/services/inboxKeys')
    const keys = await loadOrCreateInboxKeys(new Map())
    const box = await (await pairLib()).seal(keys.publicKey, 'ABCD2345', LIST)
    await expect(keys.open(box, 'ZZZZ9999')).rejects.toThrow()
  })

  it('a chave fica guardada: reabrir o app usa a mesma (a lista enviada com a TV desligada ainda abre)', async () => {
    const { loadOrCreateInboxKeys } = await import('@/services/inboxKeys')
    const store = new Map()
    const first = await loadOrCreateInboxKeys(store)
    const box = await (await pairLib()).seal(first.publicKey, 'ABCD2345', LIST)
    const again = await loadOrCreateInboxKeys(store)
    expect(again.publicKey).toBe(first.publicKey)
    expect(await again.open(box, 'ABCD2345')).toEqual(LIST)
  })
})

describe('useSiteInbox', () => {
  const keys = { publicKey: 'PUB', open: vi.fn() }
  const api = { pullInbox: vi.fn(), ackInbox: vi.fn(async () => {}) }
  const login = vi.fn(async () => true)

  beforeEach(() => {
    vi.resetModules()
    setActivePinia(createPinia())
    vi.useFakeTimers()
    keys.open.mockReset()
    api.pullInbox.mockReset()
    api.ackInbox.mockClear()
    login.mockClear()
    vi.doMock('@/services/inboxKeys', () => ({ loadOrCreateInboxKeys: async () => keys }))
    vi.doMock('@/services/licenseApi', () => ({ isLicenseEnabled: () => true, ...api }))
    vi.doMock('@/services/deviceIdentity', () => ({ getDeviceKey: async () => 'k'.repeat(64), devicePlatform: () => 'tizen' }))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  async function mountInbox(code = 'ABCD2345') {
    const { useLicenseStore } = await import('@/stores/licenseStore')
    useLicenseStore().code = code
    const { useAuthStore } = await import('@/stores/authStore')
    vi.spyOn(useAuthStore(), 'login').mockImplementation(login)
    const { useSiteInbox } = await import('@/composables/useSiteInbox')
    let inbox
    const wrapper = mount(
      defineComponent({
        setup() {
          inbox = useSiteInbox()
          return () => h('div')
        },
      }),
    )
    await flushPromises()
    return { wrapper, inbox }
  }

  it('ao abrir, busca e mostra servidor e apelido (nunca a senha) para confirmar', async () => {
    api.pullInbox.mockResolvedValue([{ id: 7, box: 'BOX' }])
    keys.open.mockResolvedValue(LIST)
    const { inbox } = await mountInbox()
    expect(keys.open).toHaveBeenCalledWith('BOX', 'ABCD2345')
    expect(inbox.received.value).toEqual({ host: 'servidor.test:8080', label: 'Sala', insecure: true })
    expect(JSON.stringify(inbox.received.value)).not.toContain('S3nh@')
  })

  it('Adicionar entra na lista e apaga a caixa no servidor', async () => {
    api.pullInbox.mockResolvedValue([{ id: 7, box: 'BOX' }])
    keys.open.mockResolvedValue(LIST)
    const { inbox } = await mountInbox()
    expect(await inbox.confirm()).toBe(true)
    expect(login).toHaveBeenCalledWith(LIST)
    expect(api.ackInbox).toHaveBeenCalledWith({ deviceKey: 'k'.repeat(64), ids: [7] })
    expect(inbox.received.value).toBeNull()
  })

  it('Descartar só apaga, sem entrar', async () => {
    api.pullInbox.mockResolvedValue([{ id: 7, box: 'BOX' }])
    keys.open.mockResolvedValue(LIST)
    const { inbox } = await mountInbox()
    await inbox.discard()
    expect(login).not.toHaveBeenCalled()
    expect(api.ackInbox).toHaveBeenCalledWith({ deviceKey: 'k'.repeat(64), ids: [7] })
  })

  it('caixa que não abre (outra chave ou lixo) é apagada em silêncio', async () => {
    api.pullInbox.mockResolvedValue([{ id: 3, box: 'LIXO' }])
    keys.open.mockRejectedValue(new Error('BAD_DATA'))
    const { inbox } = await mountInbox()
    expect(inbox.received.value).toBeNull()
    expect(api.ackInbox).toHaveBeenCalledWith({ deviceKey: 'k'.repeat(64), ids: [3] })
  })

  it('procura de novo a cada minuto e para ao sair da tela', async () => {
    api.pullInbox.mockResolvedValue([])
    const { wrapper } = await mountInbox()
    expect(api.pullInbox).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60000)
    expect(api.pullInbox).toHaveBeenCalledTimes(2)
    wrapper.unmount()
    await vi.advanceTimersByTimeAsync(180000)
    expect(api.pullInbox).toHaveBeenCalledTimes(2)
  })

  it('sem código do aparelho ainda (serviço fora do ar), não procura', async () => {
    api.pullInbox.mockResolvedValue([])
    await mountInbox('')
    await nextTick()
    expect(api.pullInbox).not.toHaveBeenCalled()
  })
})
