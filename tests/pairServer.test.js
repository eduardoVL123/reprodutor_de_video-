import { describe, it, expect, afterEach, vi } from 'vitest'
import http from 'node:http'

/** Servidor de pareamento (RFC-016): sessão efêmera que só repassa texto cifrado entre a TV e o celular. */

const PUB = 'B'.padEnd(87, 'A') // chave pública fictícia (o servidor só vê texto base64url opaco)
const BOX = 'Q'.repeat(200)
const CODE_FORMAT = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/

const servers = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((resolve) => s.close(resolve))))
})

async function start(options = {}) {
  const { createPairHandler } = await import('../server/pair/pair-server.mjs')
  const clock = { t: 1_000_000 }
  const handler = createPairHandler({ now: () => clock.t, ...options })
  const server = http.createServer(handler)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  servers.push(server)
  return { base: `http://127.0.0.1:${server.address().port}`, clock }
}

async function call(base, path, { method = 'GET', body, secret, headers = {} } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(secret ? { 'X-Pair-Secret': secret } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  })
  const text = await res.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch (_) {}
  return { status: res.status, headers: res.headers, text, json }
}

async function createSession(base, extra = {}) {
  const res = await call(base, '/v1/sessions', { method: 'POST', body: { pub: PUB }, ...extra })
  return res
}

describe('pareamento: criar sessão (TV)', () => {
  it('devolve código de 6 letras sem caracteres ambíguos, segredo e validade de 10 minutos', async () => {
    const { base } = await start()

    const res = await createSession(base)

    expect(res.status).toBe(201)
    expect(res.json.code).toMatch(CODE_FORMAT)
    expect(res.json.secret).toMatch(/^[A-Za-z0-9_-]{22,}$/)
    expect(res.json.expiresIn).toBe(600)
  })

  it('gera códigos diferentes a cada sessão', async () => {
    const { base } = await start()

    const codes = new Set()
    for (let i = 0; i < 5; i++) codes.add((await createSession(base)).json.code)

    expect(codes.size).toBe(5)
  })

  it.each([
    ['sem chave pública', {}],
    ['chave pública que não é base64url', { pub: 'não é base64url!' }],
    ['chave pública grande demais', { pub: 'A'.repeat(129) }],
    ['chave pública que não é texto', { pub: 42 }],
  ])('recusa %s com 400', async (_nome, body) => {
    const { base } = await start()

    const res = await call(base, '/v1/sessions', { method: 'POST', body })

    expect(res.status).toBe(400)
  })

  it('recusa JSON inválido com 400', async () => {
    const { base } = await start()

    const res = await call(base, '/v1/sessions', { method: 'POST', body: '{não é json' })

    expect(res.status).toBe(400)
  })

  it('recusa corpo acima de 4 KB com 413', async () => {
    const { base } = await start()

    const res = await call(base, '/v1/sessions', { method: 'POST', body: { pub: PUB, lixo: 'x'.repeat(5000) } })

    expect(res.status).toBe(413)
  })

  it('responde 503 quando há sessões demais', async () => {
    const { base } = await start({ maxSessions: 2 })
    await createSession(base)
    await createSession(base)

    const res = await createSession(base)

    expect(res.status).toBe(503)
  })
})

describe('pareamento: celular lê a chave e envia, TV recebe uma única vez', () => {
  it('o celular obtém a chave pública da TV pelo código', async () => {
    const { base } = await start()
    const { json: session } = await createSession(base)

    const res = await call(base, `/v1/sessions/${session.code}`)

    expect(res.status).toBe(200)
    expect(res.json).toEqual({ pub: PUB })
  })

  it('código desconhecido dá 404', async () => {
    const { base } = await start()

    expect((await call(base, '/v1/sessions/ZZZZZZ')).status).toBe(404)
    expect((await call(base, '/v1/sessions/ZZZZZZ/payload', { method: 'POST', body: { box: BOX } })).status).toBe(404)
  })

  it('a TV recebe 204 enquanto espera e depois o texto cifrado, uma única vez', async () => {
    const { base } = await start()
    const { json: s } = await createSession(base)

    const waiting = await call(base, `/v1/sessions/${s.code}/payload`, { secret: s.secret })
    const sent = await call(base, `/v1/sessions/${s.code}/payload`, { method: 'POST', body: { box: BOX } })
    const got = await call(base, `/v1/sessions/${s.code}/payload`, { secret: s.secret })
    const again = await call(base, `/v1/sessions/${s.code}/payload`, { secret: s.secret })

    expect(waiting.status).toBe(204)
    expect(sent.status).toBe(204)
    expect(got.status).toBe(200)
    expect(got.json).toEqual({ box: BOX })
    expect(again.status).toBe(404)
  })

  it('só quem tem o segredo lê o resultado (403 sem ele ou com outro)', async () => {
    const { base } = await start()
    const { json: s } = await createSession(base)
    await call(base, `/v1/sessions/${s.code}/payload`, { method: 'POST', body: { box: BOX } })

    const none = await call(base, `/v1/sessions/${s.code}/payload`)
    const wrong = await call(base, `/v1/sessions/${s.code}/payload`, { secret: 'x'.repeat(s.secret.length) })
    const right = await call(base, `/v1/sessions/${s.code}/payload`, { secret: s.secret })

    expect(none.status).toBe(403)
    expect(wrong.status).toBe(403)
    expect(right.status).toBe(200)
  })

  it('o segundo envio para a mesma sessão dá 409 e não troca o primeiro', async () => {
    const { base } = await start()
    const { json: s } = await createSession(base)
    await call(base, `/v1/sessions/${s.code}/payload`, { method: 'POST', body: { box: BOX } })

    const second = await call(base, `/v1/sessions/${s.code}/payload`, { method: 'POST', body: { box: 'Z'.repeat(50) } })
    const got = await call(base, `/v1/sessions/${s.code}/payload`, { secret: s.secret })

    expect(second.status).toBe(409)
    expect(got.json.box).toBe(BOX)
  })

  it.each([
    ['sem box', {}],
    ['box que não é base64url', { box: 'com espaço' }],
    ['box que não é texto', { box: { a: 1 } }],
    ['box acima de 3600 caracteres', { box: 'A'.repeat(3601) }],
  ])('recusa envio %s com 400', async (_nome, body) => {
    const { base } = await start()
    const { json: s } = await createSession(base)

    const res = await call(base, `/v1/sessions/${s.code}/payload`, { method: 'POST', body })

    expect(res.status).toBe(400)
  })

  it('recusa envio com corpo acima de 4 KB com 413', async () => {
    const { base } = await start()
    const { json: s } = await createSession(base)

    const res = await call(base, `/v1/sessions/${s.code}/payload`, { method: 'POST', body: { box: BOX, lixo: 'x'.repeat(5000) } })

    expect(res.status).toBe(413)
  })

  it('métodos não previstos dão 405', async () => {
    const { base } = await start()
    const { json: s } = await createSession(base)

    expect((await call(base, '/v1/sessions', { method: 'GET' })).status).toBe(405)
    expect((await call(base, `/v1/sessions/${s.code}`, { method: 'DELETE' })).status).toBe(405)
  })
})

describe('pareamento: validade', () => {
  it('a sessão some depois de 10 minutos', async () => {
    const { base, clock } = await start()
    const { json: s } = await createSession(base)

    clock.t += 600_001

    expect((await call(base, `/v1/sessions/${s.code}`)).status).toBe(404)
    expect((await call(base, `/v1/sessions/${s.code}/payload`, { secret: s.secret })).status).toBe(404)
  })

  it('depois do envio a TV tem só 60 segundos para ler', async () => {
    const { base, clock } = await start()
    const { json: s } = await createSession(base)
    await call(base, `/v1/sessions/${s.code}/payload`, { method: 'POST', body: { box: BOX } })

    clock.t += 61_000

    expect((await call(base, `/v1/sessions/${s.code}/payload`, { secret: s.secret })).status).toBe(404)
  })

  it('o prazo de 60 s nunca estende uma sessão que já ia expirar antes', async () => {
    const { base, clock } = await start()
    const { json: s } = await createSession(base)
    clock.t += 590_000
    await call(base, `/v1/sessions/${s.code}/payload`, { method: 'POST', body: { box: BOX } })

    clock.t += 11_000

    expect((await call(base, `/v1/sessions/${s.code}/payload`, { secret: s.secret })).status).toBe(404)
  })
})

describe('pareamento: cabeçalhos', () => {
  it('as rotas da API liberam CORS, sem cache e respondem ao preflight com o cabeçalho do segredo', async () => {
    const { base } = await start()

    const created = await createSession(base)
    const preflight = await call(base, '/v1/sessions/ABCDEF/payload', { method: 'OPTIONS' })

    expect(created.headers.get('access-control-allow-origin')).toBe('*')
    expect(created.headers.get('cache-control')).toBe('no-store')
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('access-control-allow-headers')).toMatch(/x-pair-secret/i)
    expect(preflight.headers.get('access-control-allow-headers')).toMatch(/content-type/i)
  })

  it('não escreve corpo nem segredo em log', async () => {
    const spies = ['log', 'info', 'warn', 'error'].map((m) => vi.spyOn(console, m).mockImplementation(() => {}))
    const { base } = await start()
    const { json: s } = await createSession(base)
    await call(base, `/v1/sessions/${s.code}/payload`, { method: 'POST', body: { box: BOX } })
    await call(base, `/v1/sessions/${s.code}/payload`, { secret: s.secret })

    const logged = spies.flatMap((spy) => spy.mock.calls.flat().map(String)).join(' ')

    expect(logged).not.toContain(s.secret)
    expect(logged).not.toContain(BOX)
  })
})

describe('pareamento: limites por IP', () => {
  const asIp = (ip) => ({ headers: { 'X-Forwarded-For': ip } })

  it('limita sessões novas a 10 por minuto e libera no minuto seguinte (com Retry-After)', async () => {
    const { base, clock } = await start({ trustProxy: true })
    for (let i = 0; i < 10; i++) expect((await createSession(base, asIp('203.0.113.7'))).status).toBe(201)

    const blocked = await createSession(base, asIp('203.0.113.7'))
    const other = await createSession(base, asIp('203.0.113.8'))
    clock.t += 60_001
    const later = await createSession(base, asIp('203.0.113.7'))

    expect(blocked.status).toBe(429)
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0)
    expect(other.status).toBe(201)
    expect(later.status).toBe(201)
  })

  it('sem trustProxy ignora o X-Forwarded-For (não dá para fingir outro IP)', async () => {
    const { base } = await start()
    for (let i = 0; i < 10; i++) await createSession(base, asIp(`198.51.100.${i}`))

    const res = await createSession(base, asIp('198.51.100.200'))

    expect(res.status).toBe(429)
  })

  it('com trustProxy usa o último IP da lista (o que o proxy confiável acrescentou)', async () => {
    const { base } = await start({ trustProxy: true })
    for (let i = 0; i < 10; i++) await createSession(base, asIp(`1.1.1.${i}, 203.0.113.9`))

    const res = await createSession(base, asIp('9.9.9.9, 203.0.113.9'))

    expect(res.status).toBe(429)
  })

  it('bloqueia quem erra códigos demais (20 por minuto) mesmo que depois acerte', async () => {
    const { base } = await start({ trustProxy: true })
    const { json: s } = await createSession(base, asIp('10.0.0.1'))
    for (let i = 0; i < 20; i++) {
      expect((await call(base, '/v1/sessions/ZZZZZZ', asIp('203.0.113.50'))).status).toBe(404)
    }

    const guess = await call(base, `/v1/sessions/${s.code}`, asIp('203.0.113.50'))
    const honest = await call(base, `/v1/sessions/${s.code}`, asIp('203.0.113.51'))

    expect(guess.status).toBe(429)
    expect(honest.status).toBe(200)
  })

  it('a TV pode consultar a cada 2 s pelos 10 minutos de validade sem ser limitada', async () => {
    const { base, clock } = await start({ trustProxy: true })
    const { json: s } = await createSession(base, asIp('203.0.113.60'))
    const poll = () => call(base, `/v1/sessions/${s.code}/payload`, { secret: s.secret, ...asIp('203.0.113.60') })

    for (let minute = 0; minute < 10; minute++) {
      for (let i = 0; i < 30; i++) expect((await poll()).status).toBe(204)
      clock.t += 60_001
    }
  }, 30_000) // 300 chamadas HTTP seguidas: com a suíte inteira disputando CPU passam dos 5 s padrão

  it('consultas em excesso (mais de 120 por minuto do mesmo IP) levam 429', async () => {
    const { base } = await start({ trustProxy: true })
    const { json: s } = await createSession(base, asIp('203.0.113.61'))
    const poll = () => call(base, `/v1/sessions/${s.code}/payload`, { secret: s.secret, ...asIp('203.0.113.61') })

    for (let i = 0; i < 120; i++) await poll()

    expect((await poll()).status).toBe(429)
  })
})

describe('pareamento: página do celular', () => {
  it('serve a página em / e em /<código> com política de segurança restritiva', async () => {
    const { base } = await start()

    for (const path of ['/', '/K7M2QP', '/k7m2qp']) {
      const res = await call(base, path)

      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toMatch(/text\/html/)
      expect(res.headers.get('content-security-policy')).toContain("default-src 'none'")
      expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
      expect(res.headers.get('x-content-type-options')).toBe('nosniff')
      expect(res.headers.get('referrer-policy')).toBe('no-referrer')
      expect(res.text).toContain('<html')
    }
  })

  it('serve os scripts e o estilo da página e responde 404 ao resto', async () => {
    const { base } = await start()

    const lib = await call(base, '/pair-lib.js')
    const app = await call(base, '/app.js')
    const css = await call(base, '/app.css')

    expect(lib.headers.get('content-type')).toMatch(/javascript/)
    expect(app.headers.get('content-type')).toMatch(/javascript/)
    expect(css.headers.get('content-type')).toMatch(/text\/css/)
    expect((await call(base, '/../package.json')).status).toBe(404)
    expect((await call(base, '/qualquer-coisa')).status).toBe(404)
  })

  it('responde a HEAD na página e no /healthz (verificadores de saúde e prévias de link usam HEAD)', async () => {
    const { base } = await start()

    const page = await call(base, '/', { method: 'HEAD' })
    const health = await call(base, '/healthz', { method: 'HEAD' })

    expect(page.status).toBe(200)
    expect(page.headers.get('content-security-policy')).toContain("default-src 'none'")
    expect(page.text).toBe('')
    expect(health.status).toBe(200)
  })

  it('responde ok em /healthz', async () => {
    const { base } = await start()

    expect((await call(base, '/healthz')).status).toBe(200)
  })
})
