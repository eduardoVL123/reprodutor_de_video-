import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

/** App ↔ serviço de licença (RFC-018 Task 5): identidade, chamadas e regras de bloqueio do lado do app. */

const getId = vi.fn(async () => ({ identifier: 'android-id-123' }))
vi.mock('@capacitor/device', () => ({ Device: { getId: () => getId() } }))
vi.mock('@/services/inboxKeys', () => ({ loadOrCreateInboxKeys: async () => ({ publicKey: 'PUB-DA-TV', open: async () => ({}) }) }))

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

  it('no app de PC usa o MachineGuid do Windows em hash; reinstalar dá a mesma chave', async () => {
    window.pulseDesktop = { machineId: async () => 'guid-do-windows-123' }
    try {
      const { getDeviceKey, devicePlatform } = await import('@/services/deviceIdentity')
      const key = await getDeviceKey()
      expect(devicePlatform()).toBe('desktop')
      expect(key).toMatch(/^[a-f0-9]{64}$/)
      expect(key).not.toContain('guid-do-windows')
      vi.resetModules()
      memory.clear() // reinstalação apaga os dados do app
      expect(await (await import('@/services/deviceIdentity')).getDeviceKey()).toBe(key)
    } finally {
      delete window.pulseDesktop
    }
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

  it('na LG, um boot em que o sistema demora não troca a chave já usada (cliente ativado continua ativado)', async () => {
    window.PalmSystem = {}
    let answers = true
    window.PalmServiceBridge = class {
      call() {
        if (answers) setTimeout(() => this.onservicecallback(JSON.stringify({ idList: [{ idType: 'LGUDID', idValue: 'LG-UDID-1' }] })))
      }
    }
    const first = await (await import('@/services/deviceIdentity')).getDeviceKey()
    vi.resetModules()
    answers = false // próximo boot: o sistema não responde a tempo
    vi.useFakeTimers()
    const pending = (await import('@/services/deviceIdentity')).getDeviceKey()
    await vi.advanceTimersByTimeAsync(5000)
    expect(await pending).toBe(first)
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
    expect(Object.keys(body).sort()).toEqual(['deviceKey', 'host', 'nonce', 'platform', 'pub'])
    expect(body.pub).toBe('PUB-DA-TV')
    expect(body.host).toBe('parceiro.com')
    expect(init.body).not.toMatch(/S3nh|joao|get\.php/)
  })
})

describe('registro na tela de login (RFC-021)', () => {
  it('sem lista, a TV se registra com domínio vazio e a chave da caixa de entrada, e ganha o código', async () => {
    const fetchMock = setup({ fetchImpl: async () => reply(200, { access: 'trial', code: 'QDU5NXY7', trialEndsAt: 1, activationEndsAt: null, serverTime: 2 }) })
    const { useLicenseStore } = await import('@/stores/licenseStore')
    const license = useLicenseStore()
    await license.announce()
    expect(license.code).toBe('QDU5NXY7')
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body).toMatchObject({ host: '', pub: 'PUB-DA-TV' })
  })

  it('registrar na tela de login não apaga o estado salvo da lista (o bloqueio da lista continua valendo)', async () => {
    let answer = 'blocked'
    setup({ fetchImpl: async () => reply(200, { access: answer, code: 'QDU5NXY7', trialEndsAt: 1, activationEndsAt: null, serverTime: 2 }) })
    const { useLicenseStore } = await import('@/stores/licenseStore')
    const license = useLicenseStore()
    await license.refresh({ baseUrl: 'http://outra.com' })
    answer = 'trial'
    await license.announce()
    expect(license.shouldBlock({ baseUrl: 'http://outra.com' })).toBe(true)
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

  it('lista de demonstração nunca bloqueia (o revisor da loja reabre o app depois dos 7 dias); outra lista sim', async () => {
    const DEMO = 'https://demo.test/pulse-demo.m3u'
    vi.stubEnv('VITE_DEMO_PLAYLIST_URL', DEMO)
    setup({ fetchImpl: async () => reply(200, { access: 'blocked', code: 'QDU5NXY7', trialEndsAt: 1, activationEndsAt: null, serverTime: 2 }) })
    const { useLicenseStore } = await import('@/stores/licenseStore')
    const license = useLicenseStore()
    const demo = { type: 'm3u', baseUrl: 'https://demo.test', resolvedUrl: DEMO }
    await license.refresh(demo)
    expect(license.shouldBlock(demo)).toBe(false)
    const parecida = { type: 'm3u', baseUrl: 'https://demo.test', resolvedUrl: 'https://demo.test/outra.m3u' }
    await license.refresh(parecida)
    expect(license.shouldBlock(parecida)).toBe(true)
  })

  it('troca de lista no meio da consulta: a resposta atrasada da lista antiga não libera a nova', async () => {
    let releaseA = null
    const answer = (access) => reply(200, { access, code: 'QDU5NXY7', trialEndsAt: 1, activationEndsAt: null, serverTime: 2 })
    setup({
      fetchImpl: async (_url, init) => {
        if (String(init && init.body).includes('lista-a')) {
          await new Promise((r) => (releaseA = r))
          return answer('activated')
        }
        return answer('blocked')
      },
    })
    const { useLicenseStore } = await import('@/stores/licenseStore')
    const license = useLicenseStore()
    const A = { baseUrl: 'http://lista-a.test' }
    const B = { baseUrl: 'http://lista-b.test' }
    const slowA = license.refresh(A)
    await vi.waitFor(() => expect(releaseA).toBeTypeOf('function'))
    await license.refresh(B)
    releaseA()
    await slowA
    expect(license.shouldBlock(B)).toBe(true)
  })

  it('o bloqueio salvo de uma lista não bloqueia outra lista', async () => {
    setup({ fetchImpl: async () => reply(200, { access: 'blocked', code: 'QDU5NXY7', trialEndsAt: 1, activationEndsAt: null, serverTime: 2 }) })
    const { useLicenseStore } = await import('@/stores/licenseStore')
    const license = useLicenseStore()
    await license.refresh(LIST)
    expect(license.shouldBlock({ baseUrl: 'http://parceiro.com' })).toBe(false)
  })

  it('antes da primeira resposta nada bloqueia (a tela não pisca enquanto consulta)', async () => {
    setup({ fetchImpl: () => new Promise(() => {}) })
    const { useLicenseStore } = await import('@/stores/licenseStore')
    const license = useLicenseStore()
    license.refresh(LIST)
    expect(license.shouldBlock(LIST)).toBe(false)
  })

  it('servidor fora do ar e esta lista nunca confirmada: bloqueia pedindo conexão (antes liberava para sempre)', async () => {
    setup({ fetchImpl: async () => { throw new TypeError('Failed to fetch') } })
    const { useLicenseStore } = await import('@/stores/licenseStore')
    const license = useLicenseStore()
    await license.refresh(LIST)
    expect(license.blockReason(LIST)).toBe('offline')
  })

  it('carência: ativado e sem serviço, libera por 7 dias; depois pede conexão; voltar o serviço libera de novo', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const start = Date.UTC(2026, 9, 1)
    vi.setSystemTime(start)
    let up = true
    setup({
      fetchImpl: async () => {
        if (!up) throw new TypeError('Failed to fetch')
        return reply(200, { access: 'activated', code: 'QDU5NXY7', trialEndsAt: 1, activationEndsAt: start + 300 * DAY, serverTime: start })
      },
    })
    const { useLicenseStore } = await import('@/stores/licenseStore')
    const license = useLicenseStore()
    await license.refresh(LIST)
    up = false
    vi.setSystemTime(start + 6 * DAY)
    await license.refresh(LIST)
    expect(license.shouldBlock(LIST)).toBe(false)
    vi.setSystemTime(start + 8 * DAY)
    await license.refresh(LIST)
    expect(license.blockReason(LIST)).toBe('offline')
    up = true
    await license.refresh(LIST)
    expect(license.shouldBlock(LIST)).toBe(false)
  })

  it('sem serviço: teste que venceu nesse meio-tempo e relógio voltado para trás pedem conexão', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const start = Date.UTC(2026, 9, 1)
    vi.setSystemTime(start)
    let up = true
    setup({
      fetchImpl: async () => {
        if (!up) throw new TypeError('Failed to fetch')
        return reply(200, { access: 'trial', code: 'QDU5NXY7', trialEndsAt: start + 2 * DAY, activationEndsAt: null, serverTime: start })
      },
    })
    const { useLicenseStore } = await import('@/stores/licenseStore')
    const license = useLicenseStore()
    await license.refresh(LIST)
    up = false
    vi.setSystemTime(start + DAY)
    await license.refresh(LIST)
    expect(license.shouldBlock(LIST)).toBe(false)
    vi.setSystemTime(start + 3 * DAY)
    await license.refresh(LIST)
    expect(license.blockReason(LIST)).toBe('offline')
    vi.setSystemTime(start - 3 * DAY)
    await license.refresh(LIST)
    expect(license.blockReason(LIST)).toBe('offline')
  })

  it('sem serviço: relógio voltado para trás depois de já ter andado não reabre a carência (TV "congelada")', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const start = Date.UTC(2026, 9, 1)
    vi.setSystemTime(start)
    let up = true
    setup({
      fetchImpl: async () => {
        if (!up) throw new TypeError('Failed to fetch')
        return reply(200, { access: 'trial', code: 'QDU5NXY7', trialEndsAt: start + 30 * DAY, activationEndsAt: null, serverTime: start })
      },
    })
    const { useLicenseStore } = await import('@/stores/licenseStore')
    const license = useLicenseStore()
    await license.refresh(LIST)
    up = false
    vi.setSystemTime(start + 6 * DAY)
    await license.refresh(LIST)
    vi.setSystemTime(start + DAY) // usuário volta o relógio para dentro da carência
    expect(license.blockReason(LIST)).toBe('offline')
  })

  it('bloqueio salvo continua valendo sem serviço', async () => {
    let up = true
    setup({
      fetchImpl: async () => {
        if (!up) throw new TypeError('Failed to fetch')
        return reply(200, { access: 'blocked', code: 'QDU5NXY7', trialEndsAt: 1, activationEndsAt: null, serverTime: Date.now() })
      },
    })
    const { useLicenseStore } = await import('@/stores/licenseStore')
    const license = useLicenseStore()
    await license.refresh(LIST)
    up = false
    await license.refresh(LIST)
    expect(license.blockReason(LIST)).toBe('blocked')
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

describe('assinatura do servidor (resposta falsa de proxy ou hosts não libera)', () => {
  const LIST = { baseUrl: 'http://outra.com' }

  async function keys() {
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
    const priv = await crypto.subtle.exportKey('jwk', pair.privateKey)
    const pub = await crypto.subtle.exportKey('jwk', pair.publicKey)
    const { createSigner } = await import('../server/license/license-sign.mjs')
    return { sign: createSigner(JSON.stringify(priv)), publicText: `${pub.x}.${pub.y}` }
  }

  /** Servidor de verdade: assina a resposta para a chave do aparelho e a lista que perguntaram. */
  async function signedServer(sign, state) {
    const { licenseSignedText } = await import('../server/license/license-rules.mjs')
    return async (_url, init) => {
      const body = JSON.parse(init.body)
      return reply(200, { ...state, sig: await sign(licenseSignedText({ ...state, deviceKey: body.deviceKey, host: body.host, nonce: body.nonce })) })
    }
  }

  const ACTIVATED = { access: 'activated', code: 'QDU5NXY7', trialEndsAt: 1, activationEndsAt: Date.now() + 300 * DAY, serverTime: Date.now() }

  it('resposta assinada vale; sem assinatura ou assinada por outra chave conta como serviço fora do ar', async () => {
    const { sign, publicText } = await keys()
    const other = await keys()
    setup({ fetchImpl: await signedServer(sign, ACTIVATED) })
    vi.stubEnv('VITE_LICENSE_PUBLIC_KEY', publicText)
    const { useLicenseStore } = await import('@/stores/licenseStore')
    const license = useLicenseStore()
    await license.refresh(LIST)
    expect(license.access).toBe('activated')
    expect(license.shouldBlock(LIST)).toBe(false)

    // Lista nova, proxy respondendo "activated" sem assinatura ou com outra chave: não libera.
    const NEW = { baseUrl: 'http://nova.com' }
    vi.stubGlobal('fetch', vi.fn(async () => reply(200, ACTIVATED)))
    await license.refresh(NEW)
    expect(license.blockReason(NEW)).toBe('offline')
    vi.stubGlobal('fetch', vi.fn(await signedServer(other.sign, ACTIVATED)))
    await license.refresh(NEW)
    expect(license.blockReason(NEW)).toBe('offline')
  })

  it('resposta assinada gravada e repetida (replay por proxy) não renova a carência: o nonce muda a cada consulta', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const start = Date.UTC(2026, 9, 1)
    vi.setSystemTime(start)
    const { sign, publicText } = await keys()
    let recorded = null
    const real = await signedServer(sign, { access: 'trial', code: 'QDU5NXY7', trialEndsAt: start + 30 * DAY, activationEndsAt: null, serverTime: start })
    setup({
      fetchImpl: async (url, init) => {
        if (recorded) return reply(200, recorded)
        const res = await real(url, init)
        recorded = await res.json()
        return reply(200, recorded)
      },
    })
    vi.stubEnv('VITE_LICENSE_PUBLIC_KEY', publicText)
    const { useLicenseStore } = await import('@/stores/licenseStore')
    const license = useLicenseStore()
    await license.refresh(LIST)
    expect(license.blockReason(LIST)).toBe('')
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.setSystemTime(start + 8 * DAY)
    await license.refresh(LIST) // servidor bloqueado; o proxy devolve a resposta gravada no 1º dia
    spy.mockRestore()
    expect(license.blockReason(LIST)).toBe('offline')
  })

  it('estado salvo editado no aparelho (trocar "blocked" por "activated") é descartado ao abrir', async () => {
    const { sign, publicText } = await keys()
    const BLOCKED = { ...ACTIVATED, access: 'blocked', activationEndsAt: null }
    setup({ fetchImpl: await signedServer(sign, BLOCKED) })
    vi.stubEnv('VITE_LICENSE_PUBLIC_KEY', publicText)
    let { useLicenseStore } = await import('@/stores/licenseStore')
    await useLicenseStore().refresh(LIST)
    memory.set('license:state', { ...memory.get('license:state'), access: 'activated' })

    vi.resetModules()
    setActivePinia(createPinia())
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline') }))
    ;({ useLicenseStore } = await import('@/stores/licenseStore'))
    const license = useLicenseStore()
    await license.refresh(LIST)
    expect(license.access).not.toBe('activated')
    expect(license.blockReason(LIST)).toBe('offline')
  })
})
