import { describe, it, expect } from 'vitest'
import {
  createPairCore,
  generateCode,
  timingSafeEqualStr,
  readJsonBody,
  CODE_ALPHABET,
  SECURITY_HEADERS,
  CORS_HEADERS,
  PAGE_CSP,
} from '../server/pair/pair-core.mjs'

const PUB = 'B'.padEnd(87, 'A')
const BOX = 'Q'.repeat(200)
const CODE_FORMAT = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/

function makeRequest(url, { method = 'GET', body, secret, headers = {} } = {}) {
  const reqHeaders = new Headers(headers)
  if (body !== undefined && !reqHeaders.has('Content-Type')) {
    reqHeaders.set('Content-Type', 'application/json')
  }
  if (secret) {
    reqHeaders.set('X-Pair-Secret', secret)
  }

  let reqBody = undefined
  if (body !== undefined) {
    reqBody = typeof body === 'string' ? body : JSON.stringify(body)
  }

  return new Request(url, {
    method,
    headers: reqHeaders,
    body: reqBody,
    duplex: reqBody ? 'half' : undefined,
  })
}

async function parseResponse(res) {
  const text = await res.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch (_) {}
  return { status: res.status, headers: res.headers, text, json }
}

describe('pair-core: primitivas criptográficas e de utilidade', () => {
  it('generateCode gera código de 6 caracteres pertencentes a CODE_ALPHABET', () => {
    for (let i = 0; i < 50; i++) {
      const code = generateCode()
      expect(code).toHaveLength(6)
      expect(code).toMatch(CODE_FORMAT)
      for (const ch of code) {
        expect(CODE_ALPHABET).toContain(ch)
      }
    }
  })

  it('generateCode evita colisões com conjunto de códigos existentes', () => {
    const taken = new Set(['AAAAAA', 'BBBBBB'])
    const code = generateCode(taken)
    expect(taken.has(code)).toBe(false)
  })

  it('timingSafeEqualStr compara strings de forma segura', () => {
    expect(timingSafeEqualStr('segredo123', 'segredo123')).toBe(true)
    expect(timingSafeEqualStr('segredo123', 'segredo124')).toBe(false)
    expect(timingSafeEqualStr('segredo123', 'curto')).toBe(false)
    expect(timingSafeEqualStr('curto', 'segredo123')).toBe(false)
    expect(timingSafeEqualStr('', '')).toBe(true)
    expect(timingSafeEqualStr(null, 'abc')).toBe(false)
    expect(timingSafeEqualStr('abc', undefined)).toBe(false)
  })

  it('readJsonBody lê stream com limite de bytes e rejeita corpo > 4096 com 413', async () => {
    const validStream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(JSON.stringify({ pub: PUB })))
        controller.close()
      },
    })
    const validReq = new Request('http://localhost/v1/sessions', {
      method: 'POST',
      body: validStream,
      duplex: 'half',
    })
    const parsed = await readJsonBody(validReq)
    expect(parsed.pub).toBe(PUB)

    const bigChunk = new Uint8Array(5000)
    let cancelled = false
    const bigStream = new ReadableStream({
      start(controller) {
        controller.enqueue(bigChunk)
      },
      cancel() {
        cancelled = true
      },
    })
    const bigReq = new Request('http://localhost/v1/sessions', {
      method: 'POST',
      body: bigStream,
      duplex: 'half',
    })
    await expect(readJsonBody(bigReq)).rejects.toMatchObject({ status: 413 })
    expect(cancelled).toBe(true)
  })

  it('readJsonBody rejeita JSON inválido com 400', async () => {
    const req = makeRequest('http://localhost/v1/sessions', { method: 'POST', body: '{ invalido' })
    await expect(readJsonBody(req)).rejects.toMatchObject({ status: 400 })
  })

  it('exporta constantes esperadas', () => {
    expect(CODE_ALPHABET).toBe('ABCDEFGHJKMNPQRSTUVWXYZ23456789')
    expect(SECURITY_HEADERS['Cache-Control']).toBe('no-store')
    expect(SECURITY_HEADERS['X-Content-Type-Options']).toBe('nosniff')
    expect(SECURITY_HEADERS['Referrer-Policy']).toBe('no-referrer')
    expect(CORS_HEADERS['Access-Control-Allow-Origin']).toBe('*')
    expect(PAGE_CSP).toContain("default-src 'none'")
  })
})

describe('pair-core: ciclo de vida de sessões e endpoints da API', () => {
  it('cria sessão com 201, segredo base64url e expiresIn 600', async () => {
    const clock = { t: 1_000_000 }
    const core = createPairCore({ now: () => clock.t })

    const req = makeRequest('http://localhost/v1/sessions', { method: 'POST', body: { pub: PUB } })
    const res = await parseResponse(await core.handleApi(req, '1.2.3.4'))

    expect(res.status).toBe(201)
    expect(res.json.code).toMatch(CODE_FORMAT)
    expect(res.json.secret).toMatch(/^[A-Za-z0-9_-]{22,}$/)
    expect(res.json.expiresIn).toBe(600)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it.each([
    ['sem chave pública', {}],
    ['chave pública que não é base64url', { pub: 'não é base64url!' }],
    ['chave pública grande demais', { pub: 'A'.repeat(129) }],
    ['chave pública que não é texto', { pub: 42 }],
  ])('recusa criação %s com 400', async (_nome, body) => {
    const core = createPairCore()
    const req = makeRequest('http://localhost/v1/sessions', { method: 'POST', body })
    const res = await parseResponse(await core.handleApi(req, '1.2.3.4'))
    expect(res.status).toBe(400)
  })

  it('retorna 503 quando estoura maxSessions', async () => {
    const core = createPairCore({ maxSessions: 1 })
    const req1 = makeRequest('http://localhost/v1/sessions', { method: 'POST', body: { pub: PUB } })
    const res1 = await parseResponse(await core.handleApi(req1, '1.2.3.4'))
    expect(res1.status).toBe(201)

    const req2 = makeRequest('http://localhost/v1/sessions', { method: 'POST', body: { pub: PUB } })
    const res2 = await parseResponse(await core.handleApi(req2, '1.2.3.4'))
    expect(res2.status).toBe(503)
  })

  it('fluxo completo: celular obtém pub, envia box, TV recebe e sessão é apagada (leitura única)', async () => {
    const core = createPairCore()

    // 1. TV cria sessão
    const createReq = makeRequest('http://localhost/v1/sessions', { method: 'POST', body: { pub: PUB } })
    const created = await parseResponse(await core.handleApi(createReq, '10.0.0.1'))
    const { code, secret } = created.json

    // 2. TV consulta antes de celular enviar -> 204
    const pollWaitingReq = makeRequest(`http://localhost/v1/sessions/${code}/payload`, { secret })
    const pollWaitingRes = await parseResponse(await core.handleApi(pollWaitingReq, '10.0.0.1'))
    expect(pollWaitingRes.status).toBe(204)

    // 3. Celular obtém a chave pública
    const getPubReq = makeRequest(`http://localhost/v1/sessions/${code}`)
    const getPubRes = await parseResponse(await core.handleApi(getPubReq, '10.0.0.2'))
    expect(getPubRes.status).toBe(200)
    expect(getPubRes.json).toEqual({ pub: PUB })

    // 4. Celular envia o payload
    const sendReq = makeRequest(`http://localhost/v1/sessions/${code}/payload`, { method: 'POST', body: { box: BOX } })
    const sendRes = await parseResponse(await core.handleApi(sendReq, '10.0.0.2'))
    expect(sendRes.status).toBe(204)

    // 5. TV recebe payload -> 200 com { box }
    const pollReadyReq = makeRequest(`http://localhost/v1/sessions/${code}/payload`, { secret })
    const pollReadyRes = await parseResponse(await core.handleApi(pollReadyReq, '10.0.0.1'))
    expect(pollReadyRes.status).toBe(200)
    expect(pollReadyRes.json).toEqual({ box: BOX })

    // 6. Segunda leitura pela TV -> 404 (já apagada)
    const pollAgainReq = makeRequest(`http://localhost/v1/sessions/${code}/payload`, { secret })
    const pollAgainRes = await parseResponse(await core.handleApi(pollAgainReq, '10.0.0.1'))
    expect(pollAgainRes.status).toBe(404)
  })

  it('segundo envio de payload pelo celular retorna 409', async () => {
    const core = createPairCore()
    const createReq = makeRequest('http://localhost/v1/sessions', { method: 'POST', body: { pub: PUB } })
    const { json: s } = await parseResponse(await core.handleApi(createReq, '10.0.0.1'))

    const send1 = makeRequest(`http://localhost/v1/sessions/${s.code}/payload`, { method: 'POST', body: { box: BOX } })
    const res1 = await parseResponse(await core.handleApi(send1, '10.0.0.2'))
    expect(res1.status).toBe(204)

    const send2 = makeRequest(`http://localhost/v1/sessions/${s.code}/payload`, { method: 'POST', body: { box: 'XYZ' } })
    const res2 = await parseResponse(await core.handleApi(send2, '10.0.0.2'))
    expect(res2.status).toBe(409)
  })

  it('segredo inválido ou ausente retorna 403', async () => {
    const core = createPairCore()
    const createReq = makeRequest('http://localhost/v1/sessions', { method: 'POST', body: { pub: PUB } })
    const { json: s } = await parseResponse(await core.handleApi(createReq, '10.0.0.1'))

    const noSecret = makeRequest(`http://localhost/v1/sessions/${s.code}/payload`)
    const resNo = await parseResponse(await core.handleApi(noSecret, '10.0.0.1'))
    expect(resNo.status).toBe(403)

    const wrongSecret = makeRequest(`http://localhost/v1/sessions/${s.code}/payload`, { secret: 'errado123' })
    const resWrong = await parseResponse(await core.handleApi(wrongSecret, '10.0.0.1'))
    expect(resWrong.status).toBe(403)
  })

  it('OPTIONS retorna 204 com cabeçalhos CORS', async () => {
    const core = createPairCore()
    const req = makeRequest('http://localhost/v1/sessions/ABCDEF/payload', { method: 'OPTIONS' })
    const res = await parseResponse(await core.handleApi(req, '10.0.0.1'))
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(res.headers.get('access-control-allow-headers')).toMatch(/x-pair-secret/i)
  })

  it('métodos não permitidos retornam 405 com Allow correspondente', async () => {
    const core = createPairCore()
    const getSess = makeRequest('http://localhost/v1/sessions', { method: 'GET' })
    const res1 = await parseResponse(await core.handleApi(getSess, '10.0.0.1'))
    expect(res1.status).toBe(405)
    expect(res1.headers.get('allow')).toBe('POST')

    const delCode = makeRequest('http://localhost/v1/sessions/ABCDEF', { method: 'DELETE' })
    const res2 = await parseResponse(await core.handleApi(delCode, '10.0.0.1'))
    expect(res2.status).toBe(405)
    expect(res2.headers.get('allow')).toBe('GET')
  })

  it('expiração de sessão (10 minutos) e expiração pós-envio (60 segundos)', async () => {
    const clock = { t: 1_000_000 }
    const core = createPairCore({ now: () => clock.t })

    const createReq = makeRequest('http://localhost/v1/sessions', { method: 'POST', body: { pub: PUB } })
    const { json: s } = await parseResponse(await core.handleApi(createReq, '10.0.0.1'))

    // Avança 10 minutos e 1 ms
    clock.t += 600_001
    const checkExpired = makeRequest(`http://localhost/v1/sessions/${s.code}`)
    const resExpired = await parseResponse(await core.handleApi(checkExpired, '10.0.0.2'))
    expect(resExpired.status).toBe(404)

    // Cria nova sessão e envia payload
    clock.t = 2_000_000
    const createReq2 = makeRequest('http://localhost/v1/sessions', { method: 'POST', body: { pub: PUB } })
    const { json: s2 } = await parseResponse(await core.handleApi(createReq2, '10.0.0.1'))

    const sendReq = makeRequest(`http://localhost/v1/sessions/${s2.code}/payload`, { method: 'POST', body: { box: BOX } })
    await core.handleApi(sendReq, '10.0.0.2')

    // Avança 61 segundos após envio
    clock.t += 61_000
    const checkDeliveryExpired = makeRequest(`http://localhost/v1/sessions/${s2.code}/payload`, { secret: s2.secret })
    const resDelivExpired = await parseResponse(await core.handleApi(checkDeliveryExpired, '10.0.0.1'))
    expect(resDelivExpired.status).toBe(404)
  })

  it('rate limiting por IP (create, poll, write, miss)', async () => {
    const clock = { t: 1_000_000 }
    const core = createPairCore({ now: () => clock.t })

    // 10 sessões permitidas por minuto
    for (let i = 0; i < 10; i++) {
      const req = makeRequest('http://localhost/v1/sessions', { method: 'POST', body: { pub: PUB } })
      const res = await parseResponse(await core.handleApi(req, '192.168.1.10'))
      expect(res.status).toBe(201)
    }
    // 11ª sessão toma 429
    const req11 = makeRequest('http://localhost/v1/sessions', { method: 'POST', body: { pub: PUB } })
    const res11 = await parseResponse(await core.handleApi(req11, '192.168.1.10'))
    expect(res11.status).toBe(429)
    expect(Number(res11.headers.get('retry-after'))).toBeGreaterThan(0)

    // Outro IP não é afetado
    const reqOther = makeRequest('http://localhost/v1/sessions', { method: 'POST', body: { pub: PUB } })
    const resOther = await parseResponse(await core.handleApi(reqOther, '192.168.1.11'))
    expect(resOther.status).toBe(201)

    // Após 60s janela libera
    clock.t += 60_001
    const reqLiberado = makeRequest('http://localhost/v1/sessions', { method: 'POST', body: { pub: PUB } })
    const resLiberado = await parseResponse(await core.handleApi(reqLiberado, '192.168.1.10'))
    expect(resLiberado.status).toBe(201)
  })
})
