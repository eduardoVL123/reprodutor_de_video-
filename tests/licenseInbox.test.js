import { describe, it, expect, beforeEach } from 'vitest'
import { openSqlite } from '../server/license/sqlite-d1.mjs'
import { migrate, purgeExpired } from '../server/license/license-db.mjs'
import { createLicenseHandler } from '../server/license/license-core.mjs'

/** RFC-021: caixa de entrada cifrada da TV (lista enviada pelo site). O servidor só vê texto cifrado. */

const DAY = 24 * 3600e3
const KEY = 'f'.repeat(64)
const PUB = 'B' + 'a'.repeat(86) // 87 caracteres base64url = chave pública P-256 crua (65 bytes)
const BOX = 'x'.repeat(300)
let db
let clock
let handle

async function req(method, path, body, ip = '10.3.3.3') {
  const res = await handle(
    new Request(`http://license.test${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    }),
    ip,
  )
  return { status: res.status, body: await res.json().catch(() => null) }
}

async function tv(pub = PUB) {
  return (await req('POST', '/v1/access', { deviceKey: KEY, platform: 'tizen', host: '', pub })).body
}

beforeEach(async () => {
  db = openSqlite(':memory:')
  await migrate(db)
  clock = Date.UTC(2026, 9, 28, 15)
  handle = createLicenseHandler({ db, now: () => clock, adminToken: 'x' })
})

describe('chave pública da TV', () => {
  it('a TV publica a chave no /v1/access e o site a busca pelo código', async () => {
    const { code } = await tv()
    expect((await req('GET', `/v1/inbox/${code}/key`)).body).toEqual({ pub: PUB })
  })

  it('a TV sem lista (tela de login) também se registra: host vazio é aceito', async () => {
    const res = await req('POST', '/v1/access', { deviceKey: KEY, platform: 'tizen', host: '', pub: PUB })
    expect(res.status).toBe(200)
    expect(res.body.code).toHaveLength(8)
  })

  it('código desconhecido ou TV que ainda não publicou chave: 404 com instrução', async () => {
    expect((await req('GET', '/v1/inbox/ZZZZZZZZ/key')).status).toBe(404)
    const { code } = await tv(null)
    const res = await req('GET', `/v1/inbox/${code}/key`)
    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/Abra o Pulse Player/)
  })

  it('chave em formato inválido é ignorada (não substitui a boa)', async () => {
    const { code } = await tv()
    await tv('não é base64url!')
    expect((await req('GET', `/v1/inbox/${code}/key`)).body.pub).toBe(PUB)
  })
})

describe('enviar e receber', () => {
  let code
  beforeEach(async () => {
    code = (await tv()).code
  })

  it('o site entrega o texto cifrado e a TV recebe, confirma e ele some do servidor', async () => {
    expect((await req('POST', `/v1/inbox/${code}`, { box: BOX })).status).toBe(201)
    const pulled = (await req('POST', '/v1/inbox/pull', { deviceKey: KEY })).body
    expect(pulled).toEqual([{ id: expect.any(Number), box: BOX }])
    await req('POST', '/v1/inbox/ack', { deviceKey: KEY, ids: pulled.map((p) => p.id) })
    expect((await req('POST', '/v1/inbox/pull', { deviceKey: KEY })).body).toEqual([])
  })

  it('só aceita texto cifrado (base64url até 3600): lista em texto aberto é recusada (G19)', async () => {
    for (const box of ['http://servidor.com usuario senha', '', 'a'.repeat(3601), { dns: 'x' }]) {
      expect((await req('POST', `/v1/inbox/${code}`, { box })).status).toBe(400)
    }
    expect((await db.prepare('SELECT COUNT(*) AS n FROM inbox').first()).n).toBe(0)
  })

  it('no máximo 3 listas esperando por TV: a mais antiga sai', async () => {
    for (const b of ['a1', 'b2', 'c3', 'd4']) {
      clock += 1000
      await req('POST', `/v1/inbox/${code}`, { box: b.repeat(50) })
    }
    const boxes = (await req('POST', '/v1/inbox/pull', { deviceKey: KEY })).body.map((p) => p.box.slice(0, 2))
    expect(boxes).toEqual(['b2', 'c3', 'd4'])
  })

  it('lista esperando há mais de 7 dias não é entregue e a limpeza apaga', async () => {
    await req('POST', `/v1/inbox/${code}`, { box: BOX })
    clock += 7 * DAY + 1000
    expect((await req('POST', '/v1/inbox/pull', { deviceKey: KEY })).body).toEqual([])
    await purgeExpired(db, clock)
    expect((await db.prepare('SELECT COUNT(*) AS n FROM inbox').first()).n).toBe(0)
  })

  it('uma TV não recebe nem apaga a lista de outra', async () => {
    await req('POST', `/v1/inbox/${code}`, { box: BOX })
    const other = 'g'.repeat(64)
    await req('POST', '/v1/access', { deviceKey: other, host: '', pub: PUB })
    expect((await req('POST', '/v1/inbox/pull', { deviceKey: other })).body).toEqual([])
    const id = (await db.prepare('SELECT id FROM inbox').first()).id
    await req('POST', '/v1/inbox/ack', { deviceKey: other, ids: [id] })
    expect((await req('POST', '/v1/inbox/pull', { deviceKey: KEY })).body).toHaveLength(1)
  })

  it('código desconhecido é 404', async () => {
    expect((await req('POST', '/v1/inbox/ZZZZZZZZ', { box: BOX })).status).toBe(404)
  })

  it('muitos envios do mesmo IP em 1 minuto viram 429', async () => {
    const statuses = []
    for (let i = 0; i < 12; i++) statuses.push((await req('POST', `/v1/inbox/${code}`, { box: BOX }, '10.9.9.1')).status)
    expect(statuses).toContain(429)
  })
})
