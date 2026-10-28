import { describe, it, expect, beforeEach } from 'vitest'
import { openSqlite } from '../server/license/sqlite-d1.mjs'
import { migrate } from '../server/license/license-db.mjs'
import { createLicenseHandler } from '../server/license/license-core.mjs'

/** RFC-019: revendedores no painel do dono (passo 3). */

const ADMIN = 'segredo-admin'
let db
let clock
let handle

async function call(method, path, body, token = ADMIN) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await handle(new Request(`http://license.test${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), '10.1.1.1')
  return { status: res.status, body: await res.json().catch(() => null) }
}

beforeEach(async () => {
  db = openSqlite(':memory:')
  await migrate(db)
  clock = Date.UTC(2026, 9, 28, 15)
  handle = createLicenseHandler({ db, now: () => clock, adminToken: ADMIN })
})

const createReseller = async (body = { name: 'Loja do João', contact: '16 99999-0000' }) => (await call('POST', '/admin/api/resellers', body)).body

describe('painel — revendedores', () => {
  it('cria revendedor e mostra a chave uma única vez (no banco fica só o hash)', async () => {
    const created = await createReseller()
    expect(created.id).toEqual(expect.any(Number))
    expect(created.key).toMatch(/^pk_[A-Za-z0-9_-]{40,}$/)
    const list = (await call('GET', '/admin/api/resellers')).body
    expect(list).toEqual([expect.objectContaining({ id: created.id, name: 'Loja do João', credits: 0, active: true, keyHint: created.key.slice(-4), parentId: null })])
    expect(JSON.stringify(list)).not.toContain(created.key)
    const row = await db.prepare('SELECT * FROM resellers').first()
    expect(JSON.stringify(row)).not.toContain(created.key)
  })

  it('recusa nome vazio', async () => {
    expect((await call('POST', '/admin/api/resellers', { name: '  ' })).status).toBe(400)
  })

  it('lançar compra de 20 créditos registra R$ 180 pela tabela e soma o saldo', async () => {
    const { id } = await createReseller()
    const res = await call('POST', `/admin/api/resellers/${id}/credits`, { amount: 20, kind: 'purchase', note: 'Pix 123' })
    expect(res.status).toBe(200)
    expect(res.body.credits).toBe(20)
    const moves = (await call('GET', `/admin/api/resellers/${id}/movements`)).body
    expect(moves[0]).toMatchObject({ delta: 20, kind: 'purchase', amountCents: 18000, note: 'Pix 123' })
  })

  it('cortesia (grant) não tem valor; estorno tira créditos e não deixa o saldo negativo', async () => {
    const { id } = await createReseller()
    await call('POST', `/admin/api/resellers/${id}/credits`, { amount: 5, kind: 'grant' })
    expect((await call('POST', `/admin/api/resellers/${id}/credits`, { amount: 2, kind: 'refund' })).body.credits).toBe(3)
    expect((await call('POST', `/admin/api/resellers/${id}/credits`, { amount: 9, kind: 'refund' })).status).toBe(409)
    expect((await call('GET', '/admin/api/resellers')).body[0].credits).toBe(3)
  })

  it('quantidade precisa ser inteira e positiva', async () => {
    const { id } = await createReseller()
    for (const amount of [0, -3, 1.5, '10']) {
      expect((await call('POST', `/admin/api/resellers/${id}/credits`, { amount, kind: 'grant' })).status).toBe(400)
    }
  })

  it('bloquear e desbloquear', async () => {
    const { id } = await createReseller()
    await call('POST', `/admin/api/resellers/${id}/active`, { active: false })
    expect((await call('GET', '/admin/api/resellers')).body[0].active).toBe(false)
    await call('POST', `/admin/api/resellers/${id}/active`, { active: true })
    expect((await call('GET', '/admin/api/resellers')).body[0].active).toBe(true)
  })

  it('trocar a chave devolve uma nova e a antiga deixa de valer', async () => {
    const { id, key } = await createReseller()
    const fresh = (await call('POST', `/admin/api/resellers/${id}/key`, {})).body.key
    expect(fresh).not.toBe(key)
    expect((await call('GET', '/api/v1/me', null, key)).status).toBe(401)
    expect((await call('GET', '/api/v1/me', null, fresh)).status).toBe(200)
  })

  it('revendedor desconhecido é 404', async () => {
    expect((await call('POST', '/admin/api/resellers/999/credits', { amount: 10, kind: 'grant' })).status).toBe(404)
  })
})

/** RFC-019 passo 4: API pública dos revendedores. */
describe('API — ativar aparelhos com créditos', () => {
  let reseller
  let codes

  async function device(i) {
    const res = await call('POST', '/v1/access', { deviceKey: `${'d'.repeat(60)}${String(i).padStart(4, '0')}`, platform: 'android', host: 'x.com' }, null)
    return res.body.code
  }

  beforeEach(async () => {
    reseller = await createReseller()
    await call('POST', `/admin/api/resellers/${reseller.id}/credits`, { amount: 3, kind: 'grant' })
    codes = [await device(1), await device(2), await device(3), await device(4), await device(5)]
  })

  const activate = (code, key = reseller.key, idem = `k-${code}-${Math.random()}`) =>
    handle(
      new Request('http://license.test/api/v1/activations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, 'Idempotency-Key': idem },
        body: JSON.stringify({ code }),
      }),
      '10.1.1.1',
    ).then(async (r) => ({ status: r.status, body: await r.json() }))

  it('ativa 1 ano gastando 1 crédito e o app passa a ver o aparelho ativado', async () => {
    const res = await activate(codes[0])
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ code: codes[0], credits: 2 })
    expect(res.body.activationEndsAt).toBe(new Date(clock).setUTCFullYear(new Date(clock).getUTCFullYear() + 1))
    const access = await call('POST', '/v1/access', { deviceKey: `${'d'.repeat(60)}0001`, host: 'nada.com' }, null)
    expect(access.body.access).toBe('activated')
  })

  it('duplo clique (mesma Idempotency-Key) gasta 1 crédito só e devolve a mesma resposta', async () => {
    const first = await activate(codes[0], reseller.key, 'clique-1')
    const second = await activate(codes[0], reseller.key, 'clique-1')
    expect(second.body).toEqual(first.body)
    expect((await call('GET', '/api/v1/me', null, reseller.key)).body.credits).toBe(2)
  })

  it('sem Idempotency-Key é recusado (evita débito duplo por repetição)', async () => {
    const res = await handle(
      new Request('http://license.test/api/v1/activations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${reseller.key}` },
        body: JSON.stringify({ code: codes[0] }),
      }),
      '10.1.1.1',
    )
    expect(res.status).toBe(400)
  })

  it('5 ativações ao mesmo tempo com saldo 3: 3 ativam, 2 recebem 402, saldo 0 (G11)', async () => {
    const results = await Promise.all(codes.map((c) => activate(c)))
    expect(results.filter((r) => r.status === 200)).toHaveLength(3)
    expect(results.filter((r) => r.status === 402)).toHaveLength(2)
    expect((await call('GET', '/api/v1/me', null, reseller.key)).body.credits).toBe(0)
  })

  it('código inexistente é 404 e aparelho suspenso é 409, sem gastar crédito', async () => {
    expect((await activate('ZZZZZZZZ')).status).toBe(404)
    await db.prepare('UPDATE devices SET blocked_at = 1 WHERE code = ?').bind(codes[0]).run()
    expect((await activate(codes[0])).status).toBe(409)
    expect((await call('GET', '/api/v1/me', null, reseller.key)).body.credits).toBe(3)
  })

  it('revenda bloqueada pelo dono recebe 403', async () => {
    await call('POST', `/admin/api/resellers/${reseller.id}/active`, { active: false })
    expect((await activate(codes[0])).status).toBe(403)
  })

  it('lista as próprias ativações e o extrato', async () => {
    await activate(codes[0])
    const list = (await call('GET', '/api/v1/activations', null, reseller.key)).body
    expect(list).toEqual([expect.objectContaining({ code: codes[0], startsAt: clock, endsAt: expect.any(Number) })])
    const moves = (await call('GET', '/api/v1/movements', null, reseller.key)).body
    expect(moves.map((m) => m.kind)).toEqual(['activation', 'grant'])
  })

  it('consulta um aparelho pelo código só com dados de licença', async () => {
    const res = await call('GET', `/api/v1/devices/${codes[0]}`, null, reseller.key)
    expect(res.body).toEqual({ code: codes[0], platform: 'android', activationEndsAt: null, suspended: false })
  })

  it('um revendedor não vê as ativações nem o extrato do outro (G12)', async () => {
    await activate(codes[0])
    const other = await createReseller({ name: 'Outra loja' })
    expect((await call('GET', '/api/v1/activations', null, other.key)).body).toEqual([])
    expect((await call('GET', '/api/v1/movements', null, other.key)).body).toEqual([])
  })

  it('chave inválida é 401', async () => {
    expect((await call('GET', '/api/v1/me', null, 'pk_falsa')).status).toBe(401)
  })

  it('painéis de terceiros no navegador podem chamar (CORS libera Authorization e Idempotency-Key)', async () => {
    const res = await handle(new Request('http://license.test/api/v1/activations', { method: 'OPTIONS' }), '10.1.1.1')
    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Headers')).toMatch(/Authorization/)
    expect(res.headers.get('Access-Control-Allow-Headers')).toMatch(/Idempotency-Key/)
  })
})

/** RFC-019 passo 5: sub-revendas (R3). */
describe('API — sub-revendas', () => {
  let parent

  const api = (method, path, body, key = parent.key, idem = `i-${Math.random()}`) =>
    handle(
      new Request(`http://license.test${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, 'Idempotency-Key': idem },
        body: body ? JSON.stringify(body) : undefined,
      }),
      '10.1.1.1',
    ).then(async (r) => ({ status: r.status, body: await r.json() }))

  beforeEach(async () => {
    parent = await createReseller({ name: 'Revenda mãe' })
    await call('POST', `/admin/api/resellers/${parent.id}/credits`, { amount: 10, kind: 'grant' })
  })

  it('cria revenda abaixo dela, com chave mostrada uma vez', async () => {
    const res = await api('POST', '/api/v1/sub-resellers', { name: 'Filial', contact: 'zap' })
    expect(res.status).toBe(201)
    expect(res.body.key).toMatch(/^pk_/)
    const list = (await api('GET', '/api/v1/sub-resellers')).body
    expect(list).toEqual([expect.objectContaining({ id: res.body.id, name: 'Filial', credits: 0, parentId: parent.id })])
    expect(JSON.stringify(list)).not.toContain(res.body.key)
  })

  it('repassa créditos: sai de um saldo e entra no outro, nunca cria crédito', async () => {
    const child = (await api('POST', '/api/v1/sub-resellers', { name: 'Filial' })).body
    const res = await api('POST', `/api/v1/sub-resellers/${child.id}/credits`, { amount: 4 })
    expect(res.status).toBe(200)
    expect(res.body.credits).toBe(6)
    expect((await call('GET', '/api/v1/me', null, child.key)).body.credits).toBe(4)
    const kinds = (await api('GET', '/api/v1/movements')).body.map((m) => m.kind)
    expect(kinds[0]).toBe('transfer_out')
    expect((await call('GET', '/api/v1/movements', null, child.key)).body[0]).toMatchObject({ kind: 'transfer_in', delta: 4 })
  })

  it('repasse maior que o saldo é 402 e não muda nenhum saldo', async () => {
    const child = (await api('POST', '/api/v1/sub-resellers', { name: 'Filial' })).body
    expect((await api('POST', `/api/v1/sub-resellers/${child.id}/credits`, { amount: 11 })).status).toBe(402)
    expect((await api('GET', '/api/v1/me')).body.credits).toBe(10)
    expect((await call('GET', '/api/v1/me', null, child.key)).body.credits).toBe(0)
  })

  it('o mesmo repasse repetido (mesma Idempotency-Key) só vale uma vez', async () => {
    const child = (await api('POST', '/api/v1/sub-resellers', { name: 'Filial' })).body
    await api('POST', `/api/v1/sub-resellers/${child.id}/credits`, { amount: 3 }, parent.key, 'repasse-1')
    await api('POST', `/api/v1/sub-resellers/${child.id}/credits`, { amount: 3 }, parent.key, 'repasse-1')
    expect((await call('GET', '/api/v1/me', null, child.key)).body.credits).toBe(3)
  })

  it('só vê e abastece as revendas diretas: a revenda da filial não aparece para a mãe', async () => {
    const child = (await api('POST', '/api/v1/sub-resellers', { name: 'Filial' })).body
    const grandchild = (await api('POST', '/api/v1/sub-resellers', { name: 'Neta' }, child.key)).body
    expect((await api('GET', '/api/v1/sub-resellers')).body.map((r) => r.name)).toEqual(['Filial'])
    expect((await api('POST', `/api/v1/sub-resellers/${grandchild.id}/credits`, { amount: 1 })).status).toBe(404)
  })

  it('uma revenda não mexe na revenda de outra mãe', async () => {
    const other = await createReseller({ name: 'Outra' })
    const strangerChild = (await api('POST', '/api/v1/sub-resellers', { name: 'Filial da outra' }, other.key)).body
    expect((await api('POST', `/api/v1/sub-resellers/${strangerChild.id}/credits`, { amount: 1 })).status).toBe(404)
    expect((await api('POST', `/api/v1/sub-resellers/${strangerChild.id}/key`, {})).status).toBe(404)
  })

  it('troca a chave da revenda direta e a própria', async () => {
    const child = (await api('POST', '/api/v1/sub-resellers', { name: 'Filial' })).body
    const childKey = (await api('POST', `/api/v1/sub-resellers/${child.id}/key`, {})).body.key
    expect((await call('GET', '/api/v1/me', null, child.key)).status).toBe(401)
    expect((await call('GET', '/api/v1/me', null, childKey)).status).toBe(200)
    const mine = (await api('POST', '/api/v1/me/key', {})).body.key
    expect((await call('GET', '/api/v1/me', null, parent.key)).status).toBe(401)
    expect((await call('GET', '/api/v1/me', null, mine)).status).toBe(200)
  })

  it('o dono vê a árvore toda no painel', async () => {
    const child = (await api('POST', '/api/v1/sub-resellers', { name: 'Filial' })).body
    await api('POST', '/api/v1/sub-resellers', { name: 'Neta' }, child.key)
    const all = (await call('GET', '/admin/api/resellers')).body
    expect(all.map((r) => [r.name, r.parentId])).toEqual(expect.arrayContaining([['Revenda mãe', null], ['Filial', parent.id], ['Neta', child.id]]))
  })
})
