import { describe, it, expect, beforeEach, vi } from 'vitest'
import { openSqlite } from '../server/license/sqlite-d1.mjs'
import { migrate } from '../server/license/license-db.mjs'
import { createLicenseHandler } from '../server/license/license-core.mjs'
import { API_FAIL_LIMIT } from '../server/license/license-api.mjs'

/** RFC-025: site de vendas, área do cliente e rotas fechadas. */

const ADMIN = 'segredo-admin'
let db
let clock
let handle

function req(method, path, { body, token, ip = '10.1.1.1', headers = {} } = {}) {
  const h = { 'Content-Type': 'application/json', ...headers }
  if (token) h.Authorization = `Bearer ${token}`
  return handle(new Request(`https://license.test${path}`, { method, headers: h, body: body ? JSON.stringify(body) : undefined }), ip)
}

beforeEach(async () => {
  db = openSqlite(':memory:')
  await migrate(db)
  clock = Date.UTC(2026, 10, 4, 15)
  handle = createLicenseHandler({ db, now: () => clock, adminToken: ADMIN })
})

describe('cabeçalhos e CORS (§6)', () => {
  it('a API do painel do dono não libera leitura por outros sites', async () => {
    const res = await req('GET', '/admin/api/partners', { token: ADMIN })
    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
    expect((await req('OPTIONS', '/admin/api/partners')).headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('a API do app e a das revendas continuam com CORS (TV com origem file://, painéis de terceiros)', async () => {
    expect((await req('GET', '/v1/site-config')).headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect((await req('GET', '/api/v1/me')).headers.get('Access-Control-Allow-Origin')).toBe('*')
  })

  it('toda resposta leva HSTS, X-Frame-Options e Permissions-Policy', async () => {
    const res = await req('GET', '/v1/site-config')
    expect(res.headers.get('Strict-Transport-Security')).toContain('max-age=')
    expect(res.headers.get('X-Frame-Options')).toBe('DENY')
    expect(res.headers.get('Permissions-Policy')).toContain('camera=()')
  })
})

describe('chave errada na API das revendas (§4)', () => {
  it(`trava a rede depois de ${API_FAIL_LIMIT} chaves erradas, sem afetar outra rede`, async () => {
    for (let i = 0; i < API_FAIL_LIMIT; i++) expect((await req('GET', '/api/v1/me', { token: `pk_errada${i}` })).status).toBe(401)
    const locked = await req('GET', '/api/v1/me', { token: 'pk_outra' })
    expect(locked.status).toBe(429)
    expect(Number(locked.headers.get('Retry-After'))).toBeGreaterThan(0)
    expect((await req('GET', '/api/v1/me', { token: 'pk_x', ip: '10.9.9.9' })).status).toBe(401)
    clock += 15 * 60 * 1000
    expect((await req('GET', '/api/v1/me', { token: 'pk_x' })).status).toBe(401)
  })
})

const DAY = 24 * 3600 * 1000
const hello = async (key = 'k'.repeat(40)) => (await (await req('POST', '/v1/hello', { body: { deviceKey: key, platform: 'android' } })).json()).code
const status = async (code, ip) => req('POST', '/v1/device-status', { body: { code }, ip })
const keyOf = async (code) => (await db.prepare('SELECT device_key FROM devices WHERE code = ?').bind(code).first()).device_key
const activate = async (code, endsAt) =>
  db.prepare("INSERT INTO activations (device_key, starts_at, ends_at, source) VALUES (?, ?, ?, 'manual')").bind(await keyOf(code), clock, endsAt).run()
const subscribe = (code, subStatus = 'authorized', id = 'sub1') =>
  db.prepare('INSERT INTO subscriptions (id, device_code, mp_preapproval_id, status, created_at) VALUES (?, ?, ?, ?, ?)').bind(id, code, `pre-${id}`, subStatus, clock).run()

describe('Minha TV — POST /v1/device-status (§3)', () => {
  it('em teste: estado e data do fim do teste, nada além disso', async () => {
    const code = await hello()
    expect(await (await status(code)).json()).toEqual({ state: 'trial', until: clock + 7 * DAY, renews: false })
  })

  it('ativo, com renovação no cartão', async () => {
    const code = await hello()
    await activate(code, clock + 365 * DAY)
    await subscribe(code)
    expect(await (await status(code)).json()).toEqual({ state: 'active', until: clock + 365 * DAY, renews: true })
  })

  it('código inexistente, vencido e suspenso dão exatamente a mesma resposta', async () => {
    const expired = await hello('e'.repeat(40))
    const blocked = await hello('b'.repeat(40))
    await activate(blocked, clock + 365 * DAY)
    await db.prepare('UPDATE devices SET blocked_at = ? WHERE code = ?').bind(clock, blocked).run()
    clock += 8 * DAY
    const texts = []
    for (const code of ['ZZZZ9999', expired, blocked]) {
      const res = await status(code, `10.2.0.${texts.length}`)
      expect(res.status).toBe(200)
      texts.push(await res.text())
    }
    expect(new Set(texts).size).toBe(1)
    expect(JSON.parse(texts[0])).toEqual({ state: 'none', until: null, renews: false })
  })

  it('código com formato errado: 400 (o formato não é segredo)', async () => {
    expect((await status('abc')).status).toBe(400)
  })

  it('15 respostas "sem ativação" na hora travam a rede (varredura de códigos)', async () => {
    let i = 0
    const next = () => `ZZZZ${'23456789'[Math.floor(i / 8) % 8]}${'23456789'[i++ % 8]}22`
    for (let n = 0; n < 15; n++) {
      clock += 4000 // fora do limite por minuto: o que trava aqui é o do D1
      expect((await status(next())).status).toBe(200)
    }
    clock += 4000
    const res = await status(next())
    expect(res.status).toBe(429)
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0)
    clock += 4000
    expect((await status(next(), '10.7.7.7')).status).toBe(200)
  })
})

describe('cancelar renovação — POST /v1/subscription/cancel (§3)', () => {
  let mp
  beforeEach(() => {
    mp = {
      getPreapproval: vi.fn(async () => ({ id: 'pre-sub1', status: 'authorized', payer_email: 'Maria@Exemplo.com' })),
      cancelPreapproval: vi.fn(async () => ({ status: 'cancelled' })),
    }
    handle = createLicenseHandler({ db, now: () => clock, adminToken: ADMIN, mp })
  })
  const cancel = (code, email, ip) => req('POST', '/v1/subscription/cancel', { body: { code, email }, ip })

  it('com o e-mail do pagamento: cancela no Mercado Pago e a ativação paga continua', async () => {
    const code = await hello()
    await activate(code, clock + 365 * DAY)
    await subscribe(code)
    const res = await cancel(code, ' maria@exemplo.com ')
    expect(res.status).toBe(200)
    expect(mp.cancelPreapproval).toHaveBeenCalledTimes(1)
    expect(mp.cancelPreapproval).toHaveBeenCalledWith('pre-sub1')
    expect((await db.prepare('SELECT status FROM subscriptions').first()).status).toBe('cancelled')
    expect(await (await status(code)).json()).toEqual({ state: 'active', until: clock + 365 * DAY, renews: false })
  })

  it('e-mail errado: 403 e nada é cancelado', async () => {
    const code = await hello()
    await subscribe(code)
    expect((await cancel(code, 'outro@exemplo.com')).status).toBe(403)
    expect(mp.cancelPreapproval).not.toHaveBeenCalled()
    expect((await db.prepare('SELECT status FROM subscriptions').first()).status).toBe('authorized')
  })

  it('sem renovação no cartão: 404', async () => {
    expect((await cancel(await hello(), 'maria@exemplo.com')).status).toBe(404)
  })

  it('a 6ª tentativa na hora é recusada (adivinhar o e-mail)', async () => {
    const code = await hello()
    await subscribe(code)
    for (let n = 0; n < 5; n++) {
      clock += 15000
      expect((await cancel(code, `x${n}@exemplo.com`)).status).toBe(403)
    }
    clock += 15000
    expect((await cancel(code, 'maria@exemplo.com')).status).toBe(429)
    expect(mp.cancelPreapproval).not.toHaveBeenCalled()
  })
})

describe('relatórios do sócio — GET /api/v1/reports/* (§7)', () => {
  const REPORT = 'chave-de-leitura-do-socio-com-32-caracteres'
  beforeEach(() => {
    handle = createLicenseHandler({ db, now: () => clock, adminToken: ADMIN, reportToken: REPORT })
  })

  it('sem a chave configurada fica desligado', async () => {
    handle = createLicenseHandler({ db, now: () => clock, adminToken: ADMIN })
    expect((await req('GET', '/api/v1/reports/summary', { token: REPORT })).status).toBe(503)
  })

  it('só lê: POST é recusado, e a chave não vale no painel do dono nem na API das revendas', async () => {
    expect((await req('POST', '/api/v1/reports/summary', { token: REPORT })).status).toBe(405)
    expect((await req('GET', '/admin/api/partners', { token: REPORT })).status).toBe(401)
    expect((await req('GET', '/api/v1/me', { token: REPORT })).status).toBe(401)
    expect((await req('GET', '/api/v1/reports/summary', { token: ADMIN })).status).toBe(401)
  })

  it('resumo do mês e pedidos sem dado pessoal', async () => {
    const code = await hello()
    await activate(code, clock + 365 * DAY)
    await db
      .prepare(
        `INSERT INTO orders (id, kind, method, device_code, buyer_name, buyer_contact, quantity, amount_cents, status, view_secret_hash, created_at, paid_at, expires_at)
         VALUES ('pedido-1', 'device_annual', 'pix', ?, 'Maria', '16 99999-0000', 1, 2500, 'delivered', 'h', ?, ?, ?)`,
      )
      .bind(code, clock, clock, clock + DAY)
      .run()
    const summary = await (await req('GET', '/api/v1/reports/summary?month=2026-11', { token: REPORT })).json()
    expect(summary).toMatchObject({ month: '2026-11', activeDevices: 1, activations: 1, paidOrders: 1, revenueCents: 2500 })
    const orders = await (await req('GET', '/api/v1/reports/orders?month=2026-11', { token: REPORT })).json()
    expect(orders).toEqual([expect.objectContaining({ id: 'pedido-1', kind: 'device_annual', amountCents: 2500, status: 'delivered' })])
    const partners = await (await req('GET', '/api/v1/reports/partners', { token: REPORT })).json()
    const text = JSON.stringify([summary, orders, partners])
    for (const secret of [code, 'Maria', '99999', 'deviceCode', 'email', 'contact']) expect(text).not.toContain(secret)
    expect((await req('GET', '/api/v1/reports/summary?month=2026-13', { token: REPORT })).status).toBe(400)
  })

  it('10 chaves erradas travam a rede', async () => {
    for (let n = 0; n < 10; n++) expect((await req('GET', '/api/v1/reports/summary', { token: `errada${n}` })).status).toBe(401)
    expect((await req('GET', '/api/v1/reports/summary', { token: REPORT })).status).toBe(429)
  })
})
