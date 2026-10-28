import { describe, it, expect, beforeEach } from 'vitest'
import { openSqlite } from '../server/license/sqlite-d1.mjs'
import { migrate } from '../server/license/license-db.mjs'
import { createLicenseHandler } from '../server/license/license-core.mjs'

/** RFC-019 passo 6: controle de acessos dos aparelhos no painel do dono. */

const DAY = 24 * 3600e3
const ADMIN = 'segredo-admin'
let db
let clock
let handle

async function call(method, path, body, token = ADMIN) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await handle(new Request(`http://license.test${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), '10.2.2.2')
  return { status: res.status, body: await res.json().catch(() => null) }
}

const key = (i) => `${'e'.repeat(60)}${String(i).padStart(4, '0')}`
const access = async (i, host = 'nada.com') => (await call('POST', '/v1/access', { deviceKey: key(i), platform: 'android', host }, null)).body

beforeEach(async () => {
  db = openSqlite(':memory:')
  await migrate(db)
  clock = Date.UTC(2026, 9, 1, 15)
  handle = createLicenseHandler({ db, now: () => clock, adminToken: ADMIN })
})

describe('painel — lista de aparelhos', () => {
  it('lista com situação e filtra por em teste, ativados, bloqueados e sem acesso', async () => {
    const a = await access(1)
    clock += 10 * DAY
    const b = await access(2) // em teste
    const c = await access(3)
    await call('POST', `/admin/api/devices/${c.code}/activate`, {})
    const d = await access(4)
    await call('POST', `/admin/api/devices/${d.code}/block`, {})

    const all = (await call('GET', '/admin/api/devices')).body
    expect(all.items.map((x) => [x.code, x.status]).sort()).toEqual(
      [
        [a.code, 'expired'],
        [b.code, 'trial'],
        [c.code, 'activated'],
        [d.code, 'blocked'],
      ].sort(),
    )
    for (const [filter, code] of [
      ['trial', b.code],
      ['activated', c.code],
      ['blocked', d.code],
      ['expired', a.code],
    ]) {
      expect((await call('GET', `/admin/api/devices?status=${filter}`)).body.items.map((x) => x.code)).toEqual([code])
    }
  })

  it('busca por parte do código ou da observação', async () => {
    const a = await access(1)
    await access(2)
    await call('POST', `/admin/api/devices/${a.code}/note`, { note: 'Cliente Maria' })
    expect((await call('GET', '/admin/api/devices?q=maria')).body.items.map((x) => x.code)).toEqual([a.code])
    expect((await call('GET', `/admin/api/devices?q=${a.code.slice(0, 4).toLowerCase()}`)).body.items.map((x) => x.code)).toContain(a.code)
  })
})

describe('painel — ações no aparelho', () => {
  let dev

  beforeEach(async () => {
    dev = await access(1)
  })

  it('libera por 1 mês, 3 meses ou 1 ano', async () => {
    const base = new Date(clock)
    const months = (n) => new Date(base).setUTCMonth(base.getUTCMonth() + n)
    expect((await call('POST', `/admin/api/devices/${dev.code}/activate`, { period: '1m' })).body.activationEndsAt).toBe(months(1))
    await call('POST', `/admin/api/devices/${dev.code}/revoke`, {})
    expect((await call('POST', `/admin/api/devices/${dev.code}/activate`, { period: '3m' })).body.activationEndsAt).toBe(months(3))
    await call('POST', `/admin/api/devices/${dev.code}/revoke`, {})
    expect((await call('POST', `/admin/api/devices/${dev.code}/activate`, { period: '1y' })).body.activationEndsAt).toBe(months(12))
  })

  it('libera até uma data (fim do dia em Brasília); data no passado é recusada', async () => {
    const res = await call('POST', `/admin/api/devices/${dev.code}/activate`, { until: '2026-12-31' })
    expect(res.body.activationEndsAt).toBe(Date.parse('2026-12-31T23:59:59-03:00'))
    expect((await call('POST', `/admin/api/devices/${dev.code}/activate`, { until: '2026-01-01' })).status).toBe(400)
    expect((await call('POST', `/admin/api/devices/${dev.code}/activate`, { period: '7x' })).status).toBe(400)
  })

  it('bloquear suspende o aparelho mesmo ativado; desbloquear devolve', async () => {
    await call('POST', `/admin/api/devices/${dev.code}/activate`, {})
    await call('POST', `/admin/api/devices/${dev.code}/block`, {})
    expect((await access(1)).access).toBe('suspended')
    await call('POST', `/admin/api/devices/${dev.code}/unblock`, {})
    expect((await access(1)).access).toBe('activated')
  })

  it('aparelho suspenso não conta como ativo de parceiro', async () => {
    await call('POST', '/admin/api/partners', { name: 'P', startedOn: '2026-09-01', hosts: ['parceiro.com'] })
    clock += 8 * DAY
    await call('POST', `/admin/api/devices/${dev.code}/block`, {})
    const res = await call('POST', '/v1/entry', { deviceKey: key(1), host: 'parceiro.com' }, null)
    expect(res.body.recorded).toBe(false)
  })

  it('dá mais dias de teste a partir do fim atual (ou de agora, se já acabou)', async () => {
    const before = dev.trialEndsAt
    expect((await call('POST', `/admin/api/devices/${dev.code}/trial`, { days: 3 })).body.trialEndsAt).toBe(before + 3 * DAY)
    clock += 30 * DAY
    expect((await call('POST', `/admin/api/devices/${dev.code}/trial`, { days: 2 })).body.trialEndsAt).toBe(clock + 2 * DAY)
    expect((await call('POST', `/admin/api/devices/${dev.code}/trial`, { days: 0 })).status).toBe(400)
  })

  it('guarda a observação (nome do cliente)', async () => {
    expect((await call('POST', `/admin/api/devices/${dev.code}/note`, { note: 'João — sala' })).body.note).toBe('João — sala')
  })

  it('cada ação fica no histórico do aparelho com quem fez e quando', async () => {
    await call('POST', `/admin/api/devices/${dev.code}/block`, {})
    await call('POST', `/admin/api/devices/${dev.code}/unblock`, {})
    const events = (await call('GET', `/admin/api/devices/${dev.code}`)).body.events
    expect(events.map((e) => [e.action, e.actor])).toEqual([
      ['unblock', 'admin'],
      ['block', 'admin'],
    ])
  })

  it('apagar os dados tira o aparelho do sistema; se abrir o app de novo, volta como aparelho novo', async () => {
    await call('POST', `/admin/api/devices/${dev.code}/activate`, {})
    expect((await call('DELETE', `/admin/api/devices/${dev.code}`)).status).toBe(200)
    expect((await call('GET', `/admin/api/devices/${dev.code}`)).status).toBe(404)
    for (const table of ['activations', 'device_events', 'partner_cycle_entries']) {
      expect((await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n).toBe(0)
    }
    const again = await access(1)
    expect(again.code).not.toBe(dev.code)
  })
})
