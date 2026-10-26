import { describe, it, expect, vi, afterEach } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'

/** Máquina de estados do pareamento na TV (RFC-016): api e cifra são simuladas; o contrato real está em pairingFlow.test.js. */

const LISTA = { dns: 'http://srv.com/lista.m3u', username: '', password: 'segredo-do-provedor', label: 'Casa' }
const SESSION = { code: 'K7M2QP', secret: 'S1', expiresIn: 600 }
const pending = { status: 'pending' }
const ready = { status: 'ready', box: 'BOX' }

let current = null
afterEach(() => {
  if (current) current.stop()
  current = null
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

async function setup({ createSession, pollSession, open, login } = {}) {
  vi.useFakeTimers()
  vi.stubEnv('VITE_PAIR_BASE_URL', 'https://pulse.test')
  const api = {
    createSession: vi.fn(createSession || (async () => SESSION)),
    pollSession: vi.fn(pollSession || (async () => pending)),
  }
  const keys = { publicKey: 'PUB', open: vi.fn(open || (async () => ({ ...LISTA }))) }
  vi.doMock('@/services/pairingApi', async (importOriginal) => ({ ...(await importOriginal()), ...api }))
  vi.doMock('@/services/pairingCrypto', () => ({ createPairingKeys: vi.fn(async () => keys) }))

  const { createPinia, setActivePinia } = await import('pinia')
  setActivePinia(createPinia())
  const { useAuthStore } = await import('@/stores/authStore')
  const auth = useAuthStore()
  auth.login = vi.fn(login || (async () => true))
  const { usePairing } = await import('@/composables/usePairing')
  const pairing = usePairing()
  current = pairing
  const { PairingError } = await import('@/services/pairingApi')
  return { pairing, api, keys, auth, PairingError }
}

const tick = (ms) => vi.advanceTimersByTimeAsync(ms)

describe('usePairing — começar', () => {
  it('cria a sessão com a chave pública e mostra código, endereço e validade', async () => {
    const { pairing, api } = await setup()

    await pairing.start()

    expect(api.createSession).toHaveBeenCalledWith('PUB')
    expect(pairing.state.value).toBe('waiting')
    expect(pairing.code.value).toBe('K7M2QP')
    expect(pairing.pageUrl.value).toBe('https://pulse.test/K7M2QP')
    expect(pairing.displayUrl.value).toBe('pulse.test/K7M2QP')
    expect(pairing.secondsLeft.value).toBe(600)
  })

  it('fica em "starting" enquanto a sessão é criada', async () => {
    const { pairing } = await setup({ createSession: () => new Promise(() => {}) })

    pairing.start()
    await tick(0)

    expect(pairing.state.value).toBe('starting')
  })

  it('conta os segundos que restam', async () => {
    const { pairing } = await setup()
    await pairing.start()

    await tick(5000)

    expect(pairing.secondsLeft.value).toBe(595)
  })

  it('sem o serviço de pareamento: erro "unavailable" com a mensagem e sem consultar nada', async () => {
    const { pairing, api, PairingError } = await setup({
      createSession: async () => {
        throw new PairingError('UNAVAILABLE')
      },
    })

    await pairing.start()
    await tick(10_000)

    expect(pairing.state.value).toBe('error')
    expect(pairing.errorKind.value).toBe('unavailable')
    expect(pairing.error.value).toMatch(/pareamento/i)
    expect(api.pollSession).not.toHaveBeenCalled()
  })

  it('começar de novo no meio da espera descarta a sessão anterior', async () => {
    let n = 0
    const { pairing, api } = await setup({ createSession: async () => ({ code: `COD${++n}AA`, secret: `S${n}`, expiresIn: 600 }) })
    await pairing.start()
    await pairing.start()
    await tick(2000)

    expect(pairing.code.value).toBe('COD2AA')
    expect(api.pollSession.mock.calls.map(([, secret]) => secret)).toEqual(['S2'])
  })
})

describe('usePairing — respostas atrasadas', () => {
  it('uma sessão antiga que responde tarde não toma o lugar da nova', async () => {
    const answers = []
    const { pairing, api } = await setup({ createSession: () => new Promise((resolve) => answers.push(resolve)) })
    const first = pairing.start()
    await tick(0)
    const second = pairing.start()
    await tick(0)

    answers[1]({ code: 'NEW2AA', secret: 'S2', expiresIn: 600 })
    await second
    answers[0]({ code: 'OLD1AA', secret: 'S1', expiresIn: 600 })
    await first
    await tick(2000)

    expect(pairing.code.value).toBe('NEW2AA')
    expect(api.pollSession.mock.calls.map(([, secret]) => secret)).toEqual(['S2'])
  })
})

describe('usePairing — esperar o celular', () => {
  it('consulta a cada 2 segundos com o código e o segredo', async () => {
    const { pairing, api } = await setup()
    await pairing.start()

    await tick(1999)
    expect(api.pollSession).toHaveBeenCalledTimes(0)
    await tick(1)
    expect(api.pollSession).toHaveBeenCalledTimes(1)
    await tick(2000)

    expect(api.pollSession).toHaveBeenCalledTimes(2)
    expect(api.pollSession).toHaveBeenCalledWith('K7M2QP', 'S1')
  })

  it('não começa outra consulta enquanto a anterior não terminou', async () => {
    const { pairing, api } = await setup({ pollSession: () => new Promise((resolve) => setTimeout(() => resolve(pending), 5000)) })
    await pairing.start()

    await tick(6000)

    expect(api.pollSession).toHaveBeenCalledTimes(1)
  })

  it('quando chega, abre os dados, mostra só o servidor e o apelido e para de consultar', async () => {
    const { pairing, api, keys } = await setup({ pollSession: async () => ready })
    await pairing.start()

    await tick(2000)
    await tick(10_000)

    expect(keys.open).toHaveBeenCalledWith('BOX', 'K7M2QP')
    expect(pairing.state.value).toBe('received')
    expect(pairing.received.value).toEqual({ host: 'srv.com', label: 'Casa', insecure: true })
    expect(api.pollSession).toHaveBeenCalledTimes(1)
  })

  it('depois que a lista chegou, o prazo do código não derruba a confirmação', async () => {
    const { pairing } = await setup({ pollSession: async () => ready })
    await pairing.start()
    await tick(2000)

    await tick(700_000)

    expect(pairing.state.value).toBe('received')
  })

  it('o estado visível nunca guarda a senha nem o endereço completo', async () => {
    const { pairing } = await setup({ pollSession: async () => ready })
    await pairing.start()
    await tick(2000)

    const visible = JSON.stringify({ r: pairing.received.value, s: pairing.state.value, e: pairing.error.value })

    expect(visible).not.toContain('segredo-do-provedor')
    expect(visible).not.toContain('lista.m3u')
  })

  it.each([
    ['http://srv.com/lista.m3u', 'srv.com', true],
    ['https://srv.com:8443/get.php?username=a&password=b', 'srv.com:8443', false],
    ['servidor.com:8080', 'servidor.com:8080', true],
  ])('o servidor mostrado para %s é %s (sem criptografia: %s)', async (dns, host, insecure) => {
    const { pairing } = await setup({ pollSession: async () => ready, open: async () => ({ ...LISTA, dns }) })
    await pairing.start()

    await tick(2000)

    expect(pairing.received.value).toMatchObject({ host, insecure })
  })

  it('o apelido vazio chega como texto vazio', async () => {
    const { pairing } = await setup({ pollSession: async () => ready, open: async () => ({ ...LISTA, label: '' }) })
    await pairing.start()

    await tick(2000)

    expect(pairing.received.value.label).toBe('')
  })

  it('endereço recebido inválido vira erro "badData"', async () => {
    const { pairing } = await setup({ pollSession: async () => ready, open: async () => ({ ...LISTA, dns: 'http://' }) })
    await pairing.start()

    await tick(2000)

    expect(pairing.state.value).toBe('error')
    expect(pairing.errorKind.value).toBe('badData')
  })

  it('dado que não abre vira erro "badData" e pede novo código', async () => {
    const { pairing } = await setup({
      pollSession: async () => ready,
      open: async () => {
        throw new Error('BAD_DATA')
      },
    })
    await pairing.start()

    await tick(2000)

    expect(pairing.state.value).toBe('error')
    expect(pairing.errorKind.value).toBe('badData')
    expect(pairing.error.value).toMatch(/abrir os dados/)
  })

  it('o código expira em 10 minutos e a consulta para', async () => {
    const { pairing, api } = await setup()
    await pairing.start()

    await tick(600_000)
    const calls = api.pollSession.mock.calls.length
    await tick(30_000)

    expect(pairing.state.value).toBe('expired')
    expect(pairing.secondsLeft.value).toBe(0)
    expect(api.pollSession.mock.calls.length).toBe(calls)
  })

  it('servidor diz que a sessão não existe mais: expirou', async () => {
    const { pairing, PairingError } = await setup({
      pollSession: async () => {
        throw new PairingError('EXPIRED')
      },
    })
    await pairing.start()

    await tick(2000)

    expect(pairing.state.value).toBe('expired')
  })

  it('uma falha passageira não derruba a espera, e o contador de falhas zera quando volta', async () => {
    const works = [false, false, false, false, true, false, false, false, false] // 4 falhas, 1 acerto, 4 falhas
    const { pairing } = await setup({
      pollSession: async () => {
        if (!works.shift()) throw Object.assign(new Error('rede'), { code: 'UNAVAILABLE' })
        return pending
      },
    })
    await pairing.start()

    await tick(2000 * 9)

    expect(pairing.state.value).toBe('waiting')
  })

  it('5 falhas seguidas viram erro "unavailable"', async () => {
    const { pairing, PairingError } = await setup({
      pollSession: async () => {
        throw new PairingError('UNAVAILABLE')
      },
    })
    await pairing.start()

    await tick(2000 * 5)

    expect(pairing.state.value).toBe('error')
    expect(pairing.errorKind.value).toBe('unavailable')
  })

  it('parar interrompe a consulta e a contagem', async () => {
    const { pairing, api } = await setup()
    await pairing.start()

    pairing.stop()
    await tick(10_000)

    expect(api.pollSession).not.toHaveBeenCalled()
    expect(pairing.state.value).toBe('idle')
  })

  it('ao desmontar o componente que usa o pareamento, tudo é interrompido', async () => {
    const { api } = await setup()
    const { usePairing } = await import('@/composables/usePairing')
    let pairing
    const wrapper = mount(
      defineComponent({
        setup() {
          pairing = usePairing()
          return () => h('div')
        },
      }),
    )
    await pairing.start()

    wrapper.unmount()
    await tick(10_000)

    expect(api.pollSession).not.toHaveBeenCalled()
  })
})

describe('usePairing — confirmar', () => {
  async function received(options = {}) {
    const ctx = await setup({ pollSession: async () => ready, ...options })
    await ctx.pairing.start()
    await tick(2000)
    return ctx
  }

  it('entra na lista com os dados recebidos pelo mesmo login do app e termina em "done"', async () => {
    const { pairing, auth } = await received()

    const ok = await pairing.confirm()

    expect(ok).toBe(true)
    expect(auth.login).toHaveBeenCalledWith({ dns: LISTA.dns, username: '', password: 'segredo-do-provedor', label: 'Casa' })
    expect(pairing.state.value).toBe('done')
  })

  it('mostra "connecting" enquanto o login roda e ignora um segundo OK', async () => {
    let finish
    const { pairing, auth } = await received({ login: () => new Promise((resolve) => (finish = resolve)) })

    const first = pairing.confirm()
    const second = await pairing.confirm()

    expect(pairing.state.value).toBe('connecting')
    expect(second).toBe(false)
    finish(true)
    await first
    expect(auth.login).toHaveBeenCalledTimes(1)
  })

  it('login que falha vira erro "login" com a mensagem e o detalhe do app', async () => {
    const ctx = await received()
    ctx.auth.login = vi.fn(async () => {
      ctx.auth.error = 'Usuário ou senha incorretos recusados pelo servidor.'
      ctx.auth.errorDetail = '[AUTH_INVALID_CREDENTIALS] Host: http://srv.com'
      return false
    })

    const ok = await ctx.pairing.confirm()

    expect(ok).toBe(false)
    expect(ctx.pairing.state.value).toBe('error')
    expect(ctx.pairing.errorKind.value).toBe('login')
    expect(ctx.pairing.error.value).toBe('Usuário ou senha incorretos recusados pelo servidor.')
    expect(ctx.pairing.errorDetail.value).toBe('[AUTH_INVALID_CREDENTIALS] Host: http://srv.com')
  })

  it('depois de guardar o erro do login, limpa o do app para a tela de login não mostrar a mesma mensagem duas vezes', async () => {
    const ctx = await received()
    ctx.auth.login = vi.fn(async () => {
      ctx.auth.error = 'Falha ao conectar.'
      return false
    })

    await ctx.pairing.confirm()

    expect(ctx.pairing.error.value).toBe('Falha ao conectar.')
    expect(ctx.auth.error).toBe('')
  })

  it('só confirma o que foi recebido: antes disso não chama o login', async () => {
    const { pairing, auth } = await setup()
    await pairing.start()

    const ok = await pairing.confirm()

    expect(ok).toBe(false)
    expect(auth.login).not.toHaveBeenCalled()
  })

  it('depois de entrar, confirmar de novo não repete o login', async () => {
    const { pairing, auth } = await received()
    await pairing.confirm()

    expect(await pairing.confirm()).toBe(false)
    expect(auth.login).toHaveBeenCalledTimes(1)
  })

  it('descartar o que chegou pede um código novo e esquece a lista recebida', async () => {
    let n = 0
    const ctx = await received({ createSession: async () => ({ code: `COD${++n}AA`, secret: `S${n}`, expiresIn: 600 }) })

    await ctx.pairing.discard()

    expect(ctx.pairing.state.value).toBe('waiting')
    expect(ctx.pairing.code.value).toBe('COD2AA')
    expect(ctx.pairing.received.value).toBeNull()
    expect(await ctx.pairing.confirm()).toBe(false)
    expect(ctx.auth.login).not.toHaveBeenCalled()
  })
})
