import { describe, it, expect, vi, afterEach } from 'vitest'

/** Chamadas da TV ao servidor de pareamento (RFC-016). */

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

function reply(status, json) {
  return { ok: status >= 200 && status < 300, status, json: async () => json ?? {} }
}

function setup({ base = 'https://pulse.test', fetchImpl = async () => reply(204) } = {}) {
  vi.stubEnv('VITE_PAIR_BASE_URL', base)
  const fetchMock = vi.fn(fetchImpl)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const SESSION = { code: 'K7M2QP', secret: 'segredo-da-tv-1234567', expiresIn: 600 }

describe('configuração', () => {
  it('sem VITE_PAIR_BASE_URL o pareamento não está disponível', async () => {
    setup({ base: '' })
    const { isPairingConfigured } = await import('@/services/pairingApi')

    expect(isPairingConfigured()).toBe(false)
  })

  it('com o endereço configurado está disponível e ignora a barra final', async () => {
    setup({ base: 'https://pulse.test/' })
    const { isPairingConfigured, pairPageUrl, pairDisplayUrl } = await import('@/services/pairingApi')

    expect(isPairingConfigured()).toBe(true)
    expect(pairPageUrl('K7M2QP')).toBe('https://pulse.test/K7M2QP')
    expect(pairDisplayUrl('K7M2QP')).toBe('pulse.test/K7M2QP')
  })

  it('o endereço para mostrar na TV não leva o protocolo e preserva porta e caminho', async () => {
    setup({ base: 'http://pulse.test:8788/p' })
    const { pairDisplayUrl } = await import('@/services/pairingApi')

    expect(pairDisplayUrl('K7M2QP')).toBe('pulse.test:8788/p/K7M2QP')
  })
})

describe('isPairingAvailable', () => {
  it('só está disponível com o endereço configurado e WebCrypto no aparelho', async () => {
    setup({ base: 'https://pulse.test' })
    const { isPairingAvailable } = await import('@/services/pairingApi')
    expect(isPairingAvailable()).toBe(true)

    vi.stubEnv('VITE_PAIR_BASE_URL', '')
    expect(isPairingAvailable()).toBe(false)

    vi.stubEnv('VITE_PAIR_BASE_URL', 'https://pulse.test')
    vi.stubGlobal('crypto', {})
    expect(isPairingAvailable()).toBe(false)
  })
})

describe('createSession', () => {
  it('manda a chave pública em JSON e devolve código, segredo e validade', async () => {
    const fetchMock = setup({ fetchImpl: async () => reply(201, SESSION) })
    const { createSession } = await import('@/services/pairingApi')

    const session = await createSession('CHAVE_PUBLICA')

    expect(session).toEqual(SESSION)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://pulse.test/v1/sessions')
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(init.body)).toEqual({ pub: 'CHAVE_PUBLICA' })
    expect(init.credentials).toBe('omit')
  })

  it.each([
    ['429 (muitas sessões)', async () => reply(429), 'BUSY'],
    ['503 (serviço ocupado)', async () => reply(503), 'UNAVAILABLE'],
    ['500', async () => reply(500), 'UNAVAILABLE'],
    ['resposta sem código', async () => reply(201, { secret: 'x' }), 'UNAVAILABLE'],
    ['rede caída', async () => { throw new TypeError('Failed to fetch') }, 'UNAVAILABLE'],
  ])('falha traduzida: %s', async (_nome, fetchImpl, code) => {
    setup({ fetchImpl })
    const { createSession } = await import('@/services/pairingApi')

    await expect(createSession('PUB')).rejects.toMatchObject({ name: 'PairingError', code })
  })

  it('sem endereço configurado rejeita sem chamar a rede', async () => {
    const fetchMock = setup({ base: '' })
    const { createSession } = await import('@/services/pairingApi')

    await expect(createSession('PUB')).rejects.toMatchObject({ code: 'UNAVAILABLE' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('desiste quando o servidor não responde em 15 segundos', async () => {
    vi.useFakeTimers()
    setup({ fetchImpl: () => new Promise(() => {}) })
    const { createSession } = await import('@/services/pairingApi')

    const result = expect(createSession('PUB')).rejects.toMatchObject({ code: 'UNAVAILABLE' })
    await vi.advanceTimersByTimeAsync(15_001)

    await result
  })

  it('a mensagem para o usuário vem em português', async () => {
    setup({ fetchImpl: async () => reply(500) })
    const { createSession } = await import('@/services/pairingApi')

    const err = await createSession('PUB').catch((e) => e)

    expect(err.userMessage).toMatch(/pareamento/i)
  })
})

describe('pollSession', () => {
  it('pede o resultado com o segredo no cabeçalho', async () => {
    const fetchMock = setup({ fetchImpl: async () => reply(204) })
    const { pollSession } = await import('@/services/pairingApi')

    await pollSession('K7M2QP', 'SEGREDO')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://pulse.test/v1/sessions/K7M2QP/payload')
    expect(init.method).toBe('GET')
    expect(init.headers['X-Pair-Secret']).toBe('SEGREDO')
    expect(init.cache).toBe('no-store')
  })

  it('204 = ainda esperando; 200 = chegou o texto cifrado', async () => {
    setup({ fetchImpl: async () => reply(204) })
    const { pollSession } = await import('@/services/pairingApi')
    expect(await pollSession('K7M2QP', 'S')).toEqual({ status: 'pending' })

    setup({ fetchImpl: async () => reply(200, { box: 'CIFRADO' }) })
    expect(await pollSession('K7M2QP', 'S')).toEqual({ status: 'ready', box: 'CIFRADO' })
  })

  it.each([
    ['404 (expirou ou já lida)', async () => reply(404), 'EXPIRED'],
    ['429', async () => reply(429), 'BUSY'],
    ['403', async () => reply(403), 'UNAVAILABLE'],
    ['500', async () => reply(500), 'UNAVAILABLE'],
    ['200 sem box', async () => reply(200, {}), 'UNAVAILABLE'],
    ['rede caída', async () => { throw new TypeError('Failed to fetch') }, 'UNAVAILABLE'],
  ])('falha traduzida: %s', async (_nome, fetchImpl, code) => {
    setup({ fetchImpl })
    const { pollSession } = await import('@/services/pairingApi')

    await expect(pollSession('K7M2QP', 'S')).rejects.toMatchObject({ name: 'PairingError', code })
  })
})
