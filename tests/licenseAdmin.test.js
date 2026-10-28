import { describe, it, expect, beforeEach } from 'vitest'
import { openSqlite } from '../server/license/sqlite-d1.mjs'
import { migrate } from '../server/license/license-db.mjs'
import { createLicenseHandler } from '../server/license/license-core.mjs'

const brt = (y, m, d, h = 12, min = 0) => Date.UTC(y, m - 1, d, h + 3, min)
const YEAR = 365 * 24 * 3600e3

let db
let clock
let handle

async function call(method, path, body, token = 'segredo') {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await handle(
    new Request(`http://license.test${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }),
    '10.0.0.9',
  )
  const type = res.headers.get('Content-Type') || ''
  return { status: res.status, type, body: type.includes('json') ? await res.json() : await res.text() }
}

async function entry(deviceKey, host, at) {
  clock = at
  return call('POST', '/v1/entry', { deviceKey, host }, null)
}

beforeEach(async () => {
  db = openSqlite(':memory:')
  await migrate(db)
  clock = brt(2026, 3, 1)
  handle = createLicenseHandler({ db, now: () => clock, adminToken: 'segredo' })
})

describe('painel — acesso', () => {
  it('sem token ou com token errado é 401', async () => {
    expect((await call('GET', '/admin/api/partners', null, null)).status).toBe(401)
    expect((await call('GET', '/admin/api/partners', null, 'errado')).status).toBe(401)
  })

  it('servidor sem LICENSE_ADMIN_TOKEN configurado fecha o painel (503)', async () => {
    handle = createLicenseHandler({ db, now: () => clock, adminToken: '' })
    expect((await call('GET', '/admin/api/partners')).status).toBe(503)
  })
})

describe('painel — parceiros', () => {
  it('cadastra parceiro com domínios normalizados e lista de volta', async () => {
    const created = await call('POST', '/admin/api/partners', {
      name: 'Servidor X',
      startedOn: '2026-04-02',
      active: true,
      hosts: ['HTTP://AppScdd.Top:8080/', 'alt.appscdd.top'],
    })
    expect(created.status).toBe(201)
    const list = await call('GET', '/admin/api/partners')
    expect(list.body).toEqual([
      { id: created.body.id, name: 'Servidor X', startedOn: '2026-04-02', active: true, hosts: ['alt.appscdd.top', 'appscdd.top'] },
    ])
  })

  it('recusa nome vazio, data inválida e lista sem domínio válido', async () => {
    for (const bad of [
      { name: '', startedOn: '2026-04-02', hosts: ['a.com'] },
      { name: 'X', startedOn: '02/04/2026', hosts: ['a.com'] },
      { name: 'X', startedOn: '2026-04-02', hosts: ['lixo'] },
    ]) {
      expect((await call('POST', '/admin/api/partners', bad)).status).toBe(400)
    }
  })

  it('domínio que já é de outro parceiro é 409', async () => {
    await call('POST', '/admin/api/partners', { name: 'A', startedOn: '2026-04-02', hosts: ['a.com'] })
    expect((await call('POST', '/admin/api/partners', { name: 'B', startedOn: '2026-04-02', hosts: ['A.com'] })).status).toBe(409)
  })

  it('editar troca nome, data, situação e domínios', async () => {
    const { body } = await call('POST', '/admin/api/partners', { name: 'A', startedOn: '2026-04-02', hosts: ['a.com'] })
    const put = await call('PUT', `/admin/api/partners/${body.id}`, { name: 'A2', startedOn: '2026-04-03', active: false, hosts: ['b.com'] })
    expect(put.status).toBe(200)
    expect((await call('GET', '/admin/api/partners')).body[0]).toMatchObject({ name: 'A2', startedOn: '2026-04-03', active: false, hosts: ['b.com'] })
  })
})

describe('painel — relatório do ciclo (exemplo do dono: parceria em 02/04)', () => {
  let partnerId

  beforeEach(async () => {
    partnerId = (await call('POST', '/admin/api/partners', { name: 'X', startedOn: '2026-04-02', hosts: ['x.com'] })).body.id
    const a = 'a'.repeat(64)
    const b = 'b'.repeat(64)
    await call('POST', '/v1/hello', { deviceKey: a, platform: 'android' }, null) // 01/03: teste acaba antes da parceria
    await call('POST', '/v1/hello', { deviceKey: b, platform: 'android' }, null)
    await entry(a, 'x.com', brt(2026, 4, 5)) // A: 05/04 e 03/05 → não conta no ciclo 0
    await entry(a, 'x.com', brt(2026, 5, 3))
    await entry(b, 'x.com', brt(2026, 4, 5)) // B: 05/04 e 02/05 → conta
    await entry(b, 'x.com', brt(2026, 5, 2))
  })

  it('lista os ciclos com o número de ativos', async () => {
    clock = brt(2026, 5, 10)
    const { body } = await call('GET', `/admin/api/partners/${partnerId}/cycles`)
    expect(body).toEqual([
      { index: 0, start: '2026-04-02', end: '2026-05-02', actives: 1, amountCents: 35000 },
      { index: 1, start: '2026-05-03', end: '2026-06-03', actives: 0, amountCents: 0 },
    ])
  })

  it('o ciclo aberto também traz o valor do mês pela tabela do parceiro (RFC-019 R5)', async () => {
    const { body } = await call('GET', `/admin/api/partners/${partnerId}/cycles/0`)
    expect(body.amountCents).toBe(35000)
  })

  it('abre o ciclo com os aparelhos que formam o número', async () => {
    const { body } = await call('GET', `/admin/api/partners/${partnerId}/cycles/0`)
    expect(body.actives).toBe(1)
    expect(body.devices).toHaveLength(2)
    expect(body.devices.filter((d) => d.active)).toHaveLength(1)
    expect(body.devices[0]).toEqual(expect.objectContaining({ code: expect.any(String), firstAt: expect.any(Number), lastAt: expect.any(Number) }))
  })

  it('com entradas gravadas, não deixa trocar a data da parceria (os ciclos antigos sumiriam do relatório)', async () => {
    const res = await call('PUT', `/admin/api/partners/${partnerId}`, { name: 'X2', startedOn: '2026-04-03', hosts: ['x.com'] })
    expect(res.status).toBe(409)
    expect((await call('GET', '/admin/api/partners')).body[0]).toMatchObject({ name: 'X', startedOn: '2026-04-02' })
  })

  it('com entradas gravadas, editar nome e domínios mantendo a data continua permitido', async () => {
    const res = await call('PUT', `/admin/api/partners/${partnerId}`, { name: 'X2', startedOn: '2026-04-02', hosts: ['x.com', 'y.com'] })
    expect(res.status).toBe(200)
  })

  it('exporta o ciclo em CSV, uma linha por aparelho', async () => {
    const res = await call('GET', `/admin/api/partners/${partnerId}/cycles/0?format=csv`)
    expect(res.type).toContain('text/csv')
    const lines = res.body.trim().split('\n')
    expect(lines[0]).toBe('codigo;primeira_entrada;ultima_entrada;ativo')
    expect(lines).toHaveLength(3)
  })

  it('ciclo inexistente é 404', async () => {
    expect((await call('GET', `/admin/api/partners/${partnerId}/cycles/9`)).status).toBe(404)
    expect((await call('GET', '/admin/api/partners/999/cycles')).status).toBe(404)
  })
})

describe('painel — aparelhos', () => {
  let code

  beforeEach(async () => {
    code = (await call('POST', '/v1/hello', { deviceKey: 'c'.repeat(64), platform: 'tizen' }, null)).body.code
  })

  it('busca pelo código mostra plataforma, teste e ativação', async () => {
    const { body } = await call('GET', `/admin/api/devices/${code}`)
    expect(body).toMatchObject({ code, platform: 'tizen', firstSeenAt: clock, activationEndsAt: null, activations: [] })
  })

  it('liberar duas vezes soma dois anos', async () => {
    await call('POST', `/admin/api/devices/${code}/activate`, { note: 'Pix 1' })
    await call('POST', `/admin/api/devices/${code}/activate`, { note: 'Pix 2' })
    const { body } = await call('GET', `/admin/api/devices/${code}`)
    expect(body.activationEndsAt).toBe(new Date(clock).setUTCFullYear(new Date(clock).getUTCFullYear() + 2))
    expect(body.activations).toHaveLength(2)
  })

  it('revogar tira a ativação e o app volta à regra normal', async () => {
    await call('POST', `/admin/api/devices/${code}/activate`, {})
    await call('POST', `/admin/api/devices/${code}/revoke`, {})
    expect((await call('GET', `/admin/api/devices/${code}`)).body.activationEndsAt).toBeNull()
    clock += YEAR / 12
    expect((await call('POST', '/v1/access', { deviceKey: 'c'.repeat(64), host: 'nada.com' }, null)).body.access).toBe('blocked')
  })

  it('código desconhecido é 404', async () => {
    expect((await call('GET', '/admin/api/devices/ZZZZZZZZ')).status).toBe(404)
  })
})

describe('painel — trocar domínios do parceiro', () => {
  const body = (hosts) => ({ name: 'Servidor X', startedOn: '2026-04-02', active: true, hosts })
  const hostsOf = async (id) => (await call('GET', '/admin/api/partners')).body.find((p) => p.id === id).hosts

  it('troca os domínios: entram os novos e saem os que sumiram', async () => {
    const { id } = (await call('POST', '/admin/api/partners', body(['a.com', 'b.com']))).body
    expect((await call('PUT', `/admin/api/partners/${id}`, body(['b.com', 'c.com']))).status).toBe(200)
    expect(await hostsOf(id)).toEqual(['b.com', 'c.com'])
  })

  it('se a gravação falhar no meio, o parceiro não fica sem domínio', async () => {
    const { id } = (await call('POST', '/admin/api/partners', body(['a.com']))).body
    const real = db.prepare
    db.prepare = (sql) => {
      if (/INSERT OR IGNORE INTO partner_hosts/.test(sql)) throw new Error('D1 caiu')
      return real(sql)
    }
    const res = await call('PUT', `/admin/api/partners/${id}`, body(['novo.com']))
    db.prepare = real
    expect(res.status).toBe(500)
    expect(await hostsOf(id)).toEqual(['a.com'])
  })
})

describe('painel — lista de ciclos', () => {
  it('conta como ativo só o aparelho com 24 h ou mais entre a primeira e a última entrada', async () => {
    const { id } = (await call('POST', '/admin/api/partners', { name: 'P', startedOn: '2026-03-01', active: true, hosts: ['p.com'] })).body
    for (const key of ['d'.repeat(64), 'e'.repeat(64)]) await call('POST', '/v1/hello', { deviceKey: key }, null)
    clock = brt(2026, 3, 10)
    await entry('d'.repeat(64), 'p.com', clock)
    await entry('e'.repeat(64), 'p.com', clock)
    await entry('d'.repeat(64), 'p.com', clock + 25 * 3600e3)
    clock = brt(2026, 3, 12)
    const cycles = (await call('GET', `/admin/api/partners/${id}/cycles`)).body
    expect(cycles[0]).toMatchObject({ index: 0, actives: 1 })
  })
})
