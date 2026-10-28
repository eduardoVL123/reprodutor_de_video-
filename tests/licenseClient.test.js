import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

/** App ↔ serviço de licença (RFC-018 Task 5): identidade, chamadas e regras de bloqueio do lado do app. */

const getId = vi.fn(async () => ({ identifier: 'android-id-123' }))
vi.mock('@capacitor/device', () => ({ Device: { getId: () => getId() } }))

const memory = new Map()
vi.mock('@/services/storage', async (importOriginal) => ({
  ...(await importOriginal()),
  storage: {
    get: async (k) => (memory.has(k) ? memory.get(k) : null),
    set: async (k, v) => void memory.set(k, v),
    remove: async (k) => void memory.delete(k),
  },
}))

const DAY = 24 * 3600e3

function reply(status, json) {
  return { ok: status >= 200 && status < 300, status, json: async () => json ?? {} }
}

function setup({ base = 'https://licenca.test', fetchImpl } = {}) {
  vi.stubEnv('VITE_LICENSE_BASE_URL', base)
  const fetchMock = vi.fn(fetchImpl || (async () => reply(200, { access: 'partner', code: 'QDU5NXY7', trialEndsAt: 1, activationEndsAt: null, serverTime: 2 })))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  vi.resetModules()
  memory.clear()
  setActivePinia(createPinia())
  delete window.androidBridge
  delete window.tizen
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('identidade do aparelho', () => {
  it('no APK usa o ID do Android, transformado em hash (o ID cru nunca sai do aparelho)', async () => {
    window.androidBridge = { postMessage: () => {} }
    const { getDeviceKey, devicePlatform } = await import('@/services/deviceIdentity')
    const key = await getDeviceKey()
    expect(devicePlatform()).toBe('android')
    expect(key).toMatch(/^[a-f0-9]{64}$/)
    expect(key).not.toContain('android-id-123')
  })

  it('o mesmo aparelho dá sempre a mesma chave (reinstalar não muda)', async () => {
    window.androidBridge = { postMessage: () => {} }
    const first = await (await import('@/services/deviceIdentity')).getDeviceKey()
    vi.resetModules()
    memory.clear() // reinstalação apaga os dados do app
    const second = await (await import('@/services/deviceIdentity')).getDeviceKey()
    expect(second).toBe(first)
  })

  it('no navegador usa um código aleatório guardado no aparelho', async () => {
    const { getDeviceKey, devicePlatform } = await import('@/services/deviceIdentity')
    const key = await getDeviceKey()
    expect(devicePlatform()).toBe('web')
    expect(key).toMatch(/^[A-Za-z0-9_-]{16,128}$/)
    vi.resetModules()
    expect(await (await import('@/services/deviceIdentity')).getDeviceKey()).toBe(key)
  })

  it('na LG pede o LGUDID ao sistema pela ponte nativa e usa o hash dele', async () => {
    const calls = []
    window.PalmSystem = {}
    window.PalmServiceBridge = class {
      call(uri, params) {
        calls.push([uri, JSON.parse(params)])
        setTimeout(() => this.onservicecallback(JSON.stringify({ returnValue: true, idList: [{ idType: 'LGUDID', idValue: 'LG-UDID-1' }] })))
      }
    }
    const { getDeviceKey, devicePlatform } = await import('@/services/deviceIdentity')
    const key = await getDeviceKey()
    expect(devicePlatform()).toBe('webos')
    expect(calls).toEqual([['luna://com.webos.service.sm/deviceid/getIDs', { idType: ['LGUDID'] }]])
    expect(key).toMatch(/^[a-f0-9]{64}$/)
    delete window.PalmSystem
    delete window.PalmServiceBridge
  })

  it('na LG sem resposta do sistema, usa o código aleatório guardado (não trava a abertura)', async () => {
    vi.useFakeTimers()
    window.PalmSystem = {}
    window.PalmServiceBridge = class {
      call() {}
    }
    const { getDeviceKey } = await import('@/services/deviceIdentity')
    const pending = getDeviceKey()
    await vi.advanceTimersByTimeAsync(5000)
    expect(await pending).toMatch(/^[a-f0-9]{48}$/)
    delete window.PalmSystem
    delete window.PalmServiceBridge
  })

  it('na Samsung usa o DUID quando a API da TV está carregada', async () => {
    window.tizen = {}
    window.webapis = { productinfo: { getDuid: () => 'DUID-XYZ' } }
    const { getDeviceKey, devicePlatform } = await import('@/services/deviceIdentity')
    expect(devicePlatform()).toBe('tizen')
    expect(await getDeviceKey()).toMatch(/^[a-f0-9]{64}$/)
    delete window.webapis
  })
})

describe('chamadas ao serviço (G3: só chave, plataforma e domínio)', () => {
  it('sem VITE_LICENSE_BASE_URL o recurso fica desligado e nada vai para a rede', async () => {
    const fetchMock = setup({ base: '' })
    const { useLicenseStore } = await import('@/stores/licenseStore')
    const license = useLicenseStore()
    await license.refresh({ baseUrl: 'http://parceiro.com', username: 'u', password: 'p' })
    expect(license.shouldBlock({ baseUrl: 'http://parceiro.com' })).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('o corpo leva só chave, plataforma e domínio: nunca usuário, senha ou caminho da lista', async () => {
    const fetchMock = setup()
    const { useLicenseStore } = await import('@/stores/licenseStore')
    await useLicenseStore().refresh({ baseUrl: 'http://joao:S3nh@@Parceiro.com:8080/get.php?username=joao&password=S3nh@', username: 'joao', password: 'S3nh@' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://licenca.test/v1/access')
    const body = JSON.parse(init.body)
    expect(Object.keys(body).sort()).toEqual(['deviceKey', 'host', 'platform'])
    expect(body.host).toBe('parceiro.com')
    expect(init.body).not.toMatch(/S3nh|joao|get\.php/)
  })
})

describe('bloqueio (G2: falha aberta)', () => {
  const LIST = { baseUrl: 'http://outra.com' }

  it('aparelho suspenso pelo dono (RFC-019) também bloqueia', async () => {
    setup({ fetchImpl: async () => reply(200, { access: 'suspended', code: 'QDU5NXY7', trialEndsAt: 1, activationEndsAt: null, serverTime: 2 }) })
    const { useLicenseStore } = await import('@/stores/licenseStore')
    const license = useLicenseStore()
    await license.refresh(LIST)
    expect(license.shouldBlock(LIST)).toBe(true)
  })

  it('com resposta "blocked" do servidor, bloqueia essa lista', async () => {
    setup({ fetchImpl: async () => reply(200, { access: 'blocked', code: 'QDU5NXY7', trialEndsAt: 1, activationEndsAt: null, serverTime: 2 }) })
    const { useLicenseStore } = await import('@/stores/licenseStore')
    const license = useLicenseStore()
    await license.refresh(LIST)
    expect(license.shouldBlock(LIST)).toBe(true)
    expect(license.code).toBe('QDU5NXY7')
  })

  it('o bloqueio salvo de uma lista não bloqueia outra lista', async () => {
    setup({ fetchImpl: async () => reply(200, { access: 'blocked', code: 'QDU5NXY7', trialEndsAt: 1, activationEndsAt: null, serverTime: 2 }) })
    const { useLicenseStore } = await import('@/stores/licenseStore')
    const license = useLicenseStore()
    await license.refresh(LIST)
    expect(license.shouldBlock({ baseUrl: 'http://parceiro.com' })).toBe(false)
  })

  it('servidor fora do ar e nada salvo: libera', async () => {
    setup({ fetchImpl: async () => { throw new TypeError('Failed to fetch') } })
    const { useLicenseStore } = await import('@/stores/licenseStore')
    const license = useLicenseStore()
    await license.refresh(LIST)
    expect(license.shouldBlock(LIST)).toBe(false)
  })

  it('servidor fora do ar: bloqueio salvo há 6 dias continua; há 8 dias libera', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.UTC(2026, 9, 1))
    let up = true
    setup({
      fetchImpl: async () => {
        if (!up) throw new TypeError('Failed to fetch')
        return reply(200, { access: 'blocked', code: 'QDU5NXY7', trialEndsAt: 1, activationEndsAt: null, serverTime: 2 })
      },
    })
    const { useLicenseStore } = await import('@/stores/licenseStore')
    const license = useLicenseStore()
    await license.refresh(LIST)
    up = false
    vi.setSystemTime(Date.UTC(2026, 9, 7))
    await license.refresh(LIST)
    expect(license.shouldBlock(LIST)).toBe(true)
    vi.setSystemTime(Date.UTC(2026, 9, 9))
    await license.refresh(LIST)
    expect(license.shouldBlock(LIST)).toBe(false)
  })

  it('o estado salvo sobrevive a reabrir o app (lido do armazenamento)', async () => {
    setup({ fetchImpl: async () => reply(200, { access: 'blocked', code: 'QDU5NXY7', trialEndsAt: 1, activationEndsAt: null, serverTime: 2 }) })
    let { useLicenseStore } = await import('@/stores/licenseStore')
    await useLicenseStore().refresh(LIST)
    vi.resetModules()
    setActivePinia(createPinia())
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline') }))
    ;({ useLicenseStore } = await import('@/stores/licenseStore'))
    const license = useLicenseStore()
    await license.refresh(LIST)
    expect(license.shouldBlock(LIST)).toBe(true)
  })
})

describe('entrada (R4: lista de parceiro carregada por mais de 10 s)', () => {
  const LIST = { baseUrl: 'http://parceiro.com' }

  async function partnerStore() {
    const fetchMock = setup()
    const { useLicenseStore } = await import('@/stores/licenseStore')
    const license = useLicenseStore()
    await license.refresh(LIST)
    vi.useFakeTimers()
    fetchMock.mockClear()
    return { license, fetchMock }
  }

  const entryCalls = (fetchMock) => fetchMock.mock.calls.filter(([url]) => url.endsWith('/v1/entry'))

  it('envia a entrada aos 10 segundos', async () => {
    const { license, fetchMock } = await partnerStore()
    license.scheduleEntry(LIST)
    await vi.advanceTimersByTimeAsync(9999)
    expect(entryCalls(fetchMock)).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(entryCalls(fetchMock)).toHaveLength(1)
  })

  it('sair antes de 10 segundos não conta', async () => {
    const { license, fetchMock } = await partnerStore()
    license.scheduleEntry(LIST)
    await vi.advanceTimersByTimeAsync(9000)
    license.cancelEntry()
    await vi.advanceTimersByTimeAsync(5000)
    expect(entryCalls(fetchMock)).toHaveLength(0)
  })

  it('app aberto sem parar não gera outra entrada; agendar de novo (volta ao app) gera', async () => {
    const { license, fetchMock } = await partnerStore()
    license.scheduleEntry(LIST)
    await vi.advanceTimersByTimeAsync(3 * DAY)
    expect(entryCalls(fetchMock)).toHaveLength(1)
    license.scheduleEntry(LIST)
    await vi.advanceTimersByTimeAsync(10000)
    expect(entryCalls(fetchMock)).toHaveLength(2)
  })

  it('lista que não é de parceiro não agenda entrada', async () => {
    setup({ fetchImpl: async () => reply(200, { access: 'activated', code: 'QDU5NXY7', trialEndsAt: 1, activationEndsAt: 9, serverTime: 2 }) })
    const { useLicenseStore } = await import('@/stores/licenseStore')
    const license = useLicenseStore()
    await license.refresh(LIST)
    vi.useFakeTimers()
    const fetchMock = globalThis.fetch
    fetchMock.mockClear()
    license.scheduleEntry(LIST)
    await vi.advanceTimersByTimeAsync(20000)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('lista com endereço sem ponto (ex.: http://servidor:8080)', () => {
  it('também consulta o serviço e é bloqueada quando o teste acaba', async () => {
    const LAN = { baseUrl: 'http://servidor:8080' }
    const fetchMock = setup({ fetchImpl: async () => reply(200, { access: 'blocked', code: 'QDU5NXY7', trialEndsAt: 1, activationEndsAt: null, serverTime: 2 }) })
    const { useLicenseStore } = await import('@/stores/licenseStore')
    const license = useLicenseStore()

    await license.refresh(LAN)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).host).toBe('')
    expect(license.shouldBlock(LAN)).toBe(true)
  })
})
