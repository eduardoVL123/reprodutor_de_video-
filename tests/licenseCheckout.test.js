import { createHmac } from 'node:crypto'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { openSqlite } from '../server/license/sqlite-d1.mjs'
import { migrate, activationEndsAt, purgeExpired } from '../server/license/license-db.mjs'
import { createLicenseHandler } from '../server/license/license-core.mjs'
import { createMpClient, toAmount, MpError, mpErrorDetail } from '../server/license/mp-client.mjs'
import { findResellerByKey, createReseller } from '../server/license/license-resellers.mjs'

/**
 * RFC-020 etapas 1 e 2: pedido Pix pela API Orders do Mercado Pago (sempre simulado), consulta do status,
 * webhook assinado e entrega única.
 */

const MIN = 60e3
const KEY = 'f'.repeat(64)
const TOKEN = 'APP_USR-token-de-teste'
const SECRET = 'segredo-do-webhook'
const EMAIL = 'comprador@exemplo.com'
let db
let clock
let handle
let calls
let mpReply
let mpOrders

/** Mercado Pago simulado: guarda as orders criadas e devolve no GET /v1/orders/{id}. */
function defaultReply(url, init = {}) {
  if (init.method === 'POST') {
    const order = pixOrder(JSON.parse(init.body))
    mpOrders.set(order.id, order)
    return { status: 201, body: order }
  }
  const order = mpOrders.get(decodeURIComponent(url.split('/').pop()))
  return order ? { status: 200, body: order } : { status: 404, body: { message: 'not found' } }
}

function fakeFetch(url, init = {}) {
  calls.push({ url, method: init.method || 'GET', headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : null })
  const { status, body } = mpReply(url, init)
  return Promise.resolve(new Response(JSON.stringify(body), { status }))
}

/** O comprador pagou o Pix: a order passa a processed/accredited (como no webhook oficial). */
function pay(orderId, extra = {}) {
  Object.assign(mpOrders.get(`ORD-${orderId}`), { status: 'processed', status_detail: 'accredited', currency_id: 'BRL', ...extra })
}

async function webhook(mpOrderId, { secret = SECRET, type = 'order', requestId = 'req-1', ts = String(clock) } = {}) {
  const manifest = `id:${mpOrderId.toLowerCase()};request-id:${requestId};ts:${ts};`
  const v1 = createHmac('sha256', secret).update(manifest).digest('hex')
  const res = await handle(
    new Request(`http://license.test/webhooks/mercadopago?data.id=${mpOrderId}&type=${type}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': requestId },
      body: JSON.stringify({ type, action: 'order.processed', data: { id: mpOrderId } }),
    }),
    '10.9.9.9',
  )
  return { status: res.status, body: await res.json().catch(() => null) }
}

function pixOrder(body) {
  return {
    id: `ORD-${body.external_reference}`,
    status: 'action_required',
    status_detail: 'waiting_transfer',
    total_amount: body.total_amount,
    external_reference: body.external_reference,
    transactions: {
      payments: [
        {
          id: 'PAY01TESTE',
          status: 'action_required',
          amount: body.total_amount,
          payment_method: { id: 'pix', type: 'bank_transfer', ticket_url: 'https://mp.test/ticket', qr_code: '00020126PIX', qr_code_base64: 'iVBORw0KGgo' },
        },
      ],
    },
  }
}

async function req(method, path, body, ip = '10.4.4.4') {
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

async function tvCode() {
  return (await req('POST', '/v1/access', { deviceKey: KEY, platform: 'tizen', host: '' })).body.code
}

beforeEach(async () => {
  db = openSqlite(':memory:')
  await migrate(db)
  clock = Date.UTC(2026, 9, 28, 15)
  calls = []
  mpOrders = new Map()
  mpReply = defaultReply
  const mp = createMpClient({ accessToken: TOKEN, fetch: fakeFetch })
  handle = createLicenseHandler({ db, now: () => clock, adminToken: 'x', mp, mpWebhookSecret: SECRET })
})

describe('mp-client', () => {
  it('valores em texto com duas casas (a API recusa "25")', () => {
    expect(toAmount(2500)).toBe('25.00')
    expect(toAmount(18000)).toBe('180.00')
    expect(toAmount(1)).toBe('0.01')
  })

  it('cria a order com Bearer e chave de idempotência; erro da API vira MpError com o status', async () => {
    const mp = createMpClient({ accessToken: TOKEN, fetch: fakeFetch })
    await mp.createOrder({ total_amount: '25.00', external_reference: 'abc' }, 'abc')
    expect(calls[0].url).toBe('https://api.mercadopago.com/v1/orders')
    expect(calls[0].method).toBe('POST')
    expect(calls[0].headers.Authorization).toBe(`Bearer ${TOKEN}`)
    expect(calls[0].headers['X-Idempotency-Key']).toBe('abc')

    mpReply = () => ({ status: 422, body: { message: 'payer invalid' } })
    const err = await mp.createOrder({}, 'x').catch((e) => e)
    expect(err).toBeInstanceOf(MpError)
    expect(err.status).toBe(422)
  })
})

describe('POST /v1/checkout — Pix', () => {
  it('assinatura do aparelho: R$ 25 pela tabela do servidor, mesmo se o navegador mandar outro valor (G19)', async () => {
    const code = await tvCode()
    const { status, body } = await req('POST', '/v1/checkout', { kind: 'device_annual', method: 'pix', code: code.toLowerCase(), email: EMAIL, amount: 1 })
    expect(status).toBe(201)
    expect(body).toMatchObject({ amountCents: 2500, status: 'pending', pix: { qrCode: '00020126PIX', qrCodeBase64: 'iVBORw0KGgo', ticketUrl: 'https://mp.test/ticket' } })
    expect(body.orderId).toMatch(/^[A-Za-z0-9_-]{22}$/)
    expect(body.viewSecret).toMatch(/^[A-Za-z0-9_-]{22,}$/)
    expect(body.expiresAt).toBe(clock + 30 * MIN)

    const sent = calls[0]
    expect(sent.headers['X-Idempotency-Key']).toBe(body.orderId)
    expect(sent.body).toEqual({
      type: 'online',
      processing_mode: 'automatic',
      total_amount: '25.00',
      external_reference: body.orderId,
      payer: { email: EMAIL },
      transactions: { payments: [{ amount: '25.00', payment_method: { id: 'pix', type: 'bank_transfer' }, expiration_time: 'PT30M' }] },
    })
  })

  it('créditos: preço pela faixa (20 créditos = R$ 180) e pedem nome e contato', async () => {
    const ok = await req('POST', '/v1/checkout', { kind: 'credits', method: 'pix', quantity: 20, name: 'Loja do Zé', contact: '16 99999-0000', email: EMAIL })
    expect(ok.status).toBe(201)
    expect(ok.body.amountCents).toBe(18000)
    expect(calls[0].body.total_amount).toBe('180.00')

    calls = []
    expect((await req('POST', '/v1/checkout', { kind: 'credits', method: 'pix', quantity: 9, name: 'A', contact: 'B', email: EMAIL })).status).toBe(400)
    expect((await req('POST', '/v1/checkout', { kind: 'credits', method: 'pix', quantity: 20, name: '', contact: 'B', email: EMAIL })).status).toBe(400)
    expect((await req('POST', '/v1/checkout', { kind: 'credits', method: 'pix', quantity: 20, name: 'A', contact: '', email: EMAIL })).status).toBe(400)
    expect(calls).toHaveLength(0)
  })

  it('recusa antes de cobrar: código inexistente, aparelho bloqueado, e-mail inválido, tipo ou meio desconhecido', async () => {
    const code = await tvCode()
    expect((await req('POST', '/v1/checkout', { kind: 'device_annual', method: 'pix', code: 'ZZZZZZZZ', email: EMAIL })).status).toBe(404)
    expect((await req('POST', '/v1/checkout', { kind: 'device_annual', method: 'pix', code, email: 'sem-arroba' })).status).toBe(400)
    expect((await req('POST', '/v1/checkout', { kind: 'brinde', method: 'pix', code, email: EMAIL })).status).toBe(400)
    expect((await req('POST', '/v1/checkout', { kind: 'device_annual', method: 'boleto', code, email: EMAIL })).status).toBe(400)
    await db.prepare('UPDATE devices SET blocked_at = ? WHERE code = ?').bind(clock, code).run()
    expect((await req('POST', '/v1/checkout', { kind: 'device_annual', method: 'pix', code, email: EMAIL })).status).toBe(409)
    expect(calls).toHaveLength(0)
  })

  it('sem MP_ACCESS_TOKEN o pagamento fica desligado (503)', async () => {
    handle = createLicenseHandler({ db, now: () => clock, adminToken: 'x' })
    const code = await tvCode()
    expect((await req('POST', '/v1/checkout', { kind: 'device_annual', method: 'pix', code, email: EMAIL })).status).toBe(503)
  })

  it('erro 5xx do Mercado Pago: 502, pedido segue pendente (pode ter cobrado) e nada de token ou e-mail no log (G17)', async () => {
    const code = await tvCode()
    mpReply = () => ({ status: 500, body: { message: 'internal' } })
    const spies = ['log', 'warn', 'error', 'info'].map((m) => vi.spyOn(console, m).mockImplementation(() => {}))
    const { status, body } = await req('POST', '/v1/checkout', { kind: 'device_annual', method: 'pix', code, email: EMAIL })
    const logged = JSON.stringify(spies.flatMap((s) => s.mock.calls))
    spies.forEach((s) => s.mockRestore())

    expect(status).toBe(502)
    expect(JSON.stringify(body)).not.toContain(TOKEN)
    expect(logged).not.toContain(TOKEN)
    expect(logged).not.toContain(EMAIL)
    const row = await db.prepare('SELECT status FROM orders').first()
    expect(row.status).toBe('pending')
  })

  it('não guarda o e-mail do pagador no banco', async () => {
    const code = await tvCode()
    await req('POST', '/v1/checkout', { kind: 'device_annual', method: 'pix', code, email: EMAIL })
    const row = await db.prepare('SELECT * FROM orders').first()
    expect(JSON.stringify(row)).not.toContain(EMAIL)
    expect(row).toMatchObject({ kind: 'device_annual', method: 'pix', amount_cents: 2500, mp_order_id: `ORD-${row.id}`, status: 'pending' })
  })

  it('limite por IP para criar cobranças', async () => {
    const code = await tvCode()
    const statuses = []
    for (let i = 0; i < 12; i++) statuses.push((await req('POST', '/v1/checkout', { kind: 'device_annual', method: 'pix', code, email: EMAIL })).status)
    expect(statuses.slice(0, 10).every((s) => s === 201)).toBe(true)
    expect(statuses[11]).toBe(429)
  })
})

describe('GET /v1/checkout/:id', () => {
  async function newOrder() {
    const code = await tvCode()
    return (await req('POST', '/v1/checkout', { kind: 'device_annual', method: 'pix', code, email: EMAIL })).body
  }

  it('só quem tem o viewSecret vê o pedido', async () => {
    const { orderId, viewSecret } = await newOrder()
    const ok = await req('GET', `/v1/checkout/${orderId}?s=${viewSecret}`)
    expect(ok.status).toBe(200)
    expect(ok.body).toEqual({ orderId, kind: 'device_annual', method: 'pix', status: 'pending', amountCents: 2500, expiresAt: clock + 30 * MIN })
    expect((await req('GET', `/v1/checkout/${orderId}?s=errado`)).status).toBe(404)
    expect((await req('GET', `/v1/checkout/${orderId}`)).status).toBe(404)
    expect((await req('GET', '/v1/checkout/naoexiste?s=x')).status).toBe(404)
  })

  it('Pix não pago depois do vencimento vira expirado', async () => {
    const { orderId, viewSecret } = await newOrder()
    clock += 31 * MIN
    expect((await req('GET', `/v1/checkout/${orderId}?s=${viewSecret}`)).body.status).toBe('expired')
    const row = await db.prepare('SELECT status FROM orders WHERE id = ?').bind(orderId).first()
    expect(row.status).toBe('expired')
  })
})

describe('POST /webhooks/mercadopago — confirmação e entrega (etapa 2)', () => {
  async function pixFor(body) {
    return (await req('POST', '/v1/checkout', { method: 'pix', email: EMAIL, ...body })).body
  }

  async function deviceOrder() {
    const code = await tvCode()
    return pixFor({ kind: 'device_annual', code })
  }

  const activationRows = async () => (await db.prepare('SELECT * FROM activations').all()).results

  it('Pix pago: assinatura válida + consulta na API → 1 ano no aparelho; o status mostra o novo fim', async () => {
    const { orderId, viewSecret } = await deviceOrder()
    pay(orderId)
    calls = []
    const { status } = await webhook(`ORD-${orderId}`)
    expect(status).toBe(200)
    expect(calls).toEqual([expect.objectContaining({ method: 'GET', url: `https://api.mercadopago.com/v1/orders/ORD-${orderId}` })])

    const ends = await activationEndsAt(db, KEY)
    expect(ends).toBe(Date.UTC(2027, 9, 28, 15))
    expect((await activationRows())[0]).toMatchObject({ source: 'purchase', created_by: 'mercadopago', note: orderId })
    const seen = (await req('GET', `/v1/checkout/${orderId}?s=${viewSecret}`)).body
    expect(seen).toMatchObject({ status: 'delivered', result: { activationEndsAt: ends } })
  })

  it('assinatura inválida ou ausente: 401, sem consultar a API e sem entregar (G15)', async () => {
    const { orderId } = await deviceOrder()
    pay(orderId)
    calls = []
    expect((await webhook(`ORD-${orderId}`, { secret: 'outro-segredo' })).status).toBe(401)
    const unsigned = await handle(new Request(`http://license.test/webhooks/mercadopago?data.id=ORD-${orderId}&type=order`, { method: 'POST', body: '{}' }), '10.9.9.9')
    expect(unsigned.status).toBe(401)
    expect(calls).toHaveLength(0)
    expect(await activationRows()).toHaveLength(0)
  })

  it('não pago, valor ou moeda diferentes, ou order de outro pedido: nada é entregue', async () => {
    const { orderId } = await deviceOrder()
    expect((await webhook(`ORD-${orderId}`)).status).toBe(200) // ainda action_required
    pay(orderId, { total_amount: '1.00' })
    await webhook(`ORD-${orderId}`)
    pay(orderId, { total_amount: '25.00', currency_id: 'USD' })
    await webhook(`ORD-${orderId}`)
    mpOrders.set('ORD-alheia', { ...mpOrders.get(`ORD-${orderId}`), id: 'ORD-alheia', currency_id: 'BRL' })
    await webhook('ORD-alheia')
    expect(await activationRows()).toHaveLength(0)
    expect((await db.prepare('SELECT status FROM orders WHERE id = ?').bind(orderId).first()).status).toBe('pending')
  })

  it('valor pago escrito de outro jeito pelo Mercado Pago ("25.0", 25) é o mesmo valor: entrega', async () => {
    for (const total_amount of ['25.0', 25]) {
      const { orderId } = await deviceOrder()
      pay(orderId, { total_amount })
      await webhook(`ORD-${orderId}`)
      expect((await db.prepare('SELECT status FROM orders WHERE id = ?').bind(orderId).first()).status).toBe('delivered')
    }
  })

  it('entrega uma única vez: 3 webhooks iguais + consulta ao mesmo tempo → 1 ativação (G16)', async () => {
    const { orderId, viewSecret } = await deviceOrder()
    pay(orderId)
    clock += 2 * MIN // a consulta da tela também pode confirmar
    await Promise.all([
      webhook(`ORD-${orderId}`),
      webhook(`ORD-${orderId}`, { requestId: 'req-2' }),
      webhook(`ORD-${orderId}`, { requestId: 'req-3' }),
      req('GET', `/v1/checkout/${orderId}?s=${viewSecret}`),
    ])
    expect(await activationRows()).toHaveLength(1)
  })

  it('Pix pago perto do vencimento ainda é entregue, mesmo com o pedido já marcado como expirado', async () => {
    const { orderId, viewSecret } = await deviceOrder()
    clock += 31 * MIN
    await req('GET', `/v1/checkout/${orderId}?s=${viewSecret}`)
    pay(orderId)
    await webhook(`ORD-${orderId}`)
    expect(await activationRows()).toHaveLength(1)
  })

  it('créditos pelo site: cria o revendedor com o saldo e mostra a chave do painel só por 1 hora (G18)', async () => {
    const { orderId, viewSecret } = await pixFor({ kind: 'credits', quantity: 20, name: 'Loja do Zé', contact: '16 99999-0000' })
    pay(orderId)
    await webhook(`ORD-${orderId}`)

    const first = (await req('GET', `/v1/checkout/${orderId}?s=${viewSecret}`)).body
    expect(first).toMatchObject({ status: 'delivered', result: { credits: 20 } })
    expect(first.result.resellerKey).toMatch(/^pk_/)
    const reseller = await findResellerByKey(db, first.result.resellerKey)
    expect(reseller).toMatchObject({ name: 'Loja do Zé', contact: '16 99999-0000', credits: 20 })
    const movement = await db.prepare('SELECT * FROM credit_movements WHERE reseller_id = ?').bind(reseller.id).first()
    expect(movement).toMatchObject({ delta: 20, kind: 'purchase', amount_cents: 18000, created_by: 'mercadopago' })

    // Recarregar a tela dentro de 1 hora mostra a mesma chave (antes ela sumia na primeira consulta e se perdia).
    clock += 30 * MIN
    expect((await req('GET', `/v1/checkout/${orderId}?s=${viewSecret}`)).body.result.resellerKey).toBe(first.result.resellerKey)
    clock += 31 * MIN
    const again = (await req('GET', `/v1/checkout/${orderId}?s=${viewSecret}`)).body
    expect(again.result).toEqual({ credits: 20 })
    expect(JSON.stringify(await db.prepare('SELECT delivery FROM orders WHERE id = ?').bind(orderId).first())).not.toContain('pk_')
  })

  it('chave que ninguém buscou é apagada do banco pelo expurgo diário', async () => {
    const { orderId } = await pixFor({ kind: 'credits', quantity: 20, name: 'Loja do Zé', contact: '16 99999-0000' })
    pay(orderId)
    await webhook(`ORD-${orderId}`)
    expect((await db.prepare('SELECT delivery FROM orders WHERE id = ?').bind(orderId).first()).delivery).toContain('pk_')
    await purgeExpired(db, clock + 61 * MIN)
    expect(JSON.parse((await db.prepare('SELECT delivery FROM orders WHERE id = ?').bind(orderId).first()).delivery)).toEqual({ credits: 20 })
  })

  it('entrega que falhou no banco depois de pago é retomada pelo webhook repetido (antes ficava "paid" para sempre)', async () => {
    const { orderId, viewSecret } = await pixFor({ kind: 'credits', quantity: 20, name: 'Loja do Zé', contact: '16 99999-0000' })
    pay(orderId)
    const batch = db.batch.bind(db)
    db.batch = () => Promise.reject(new Error('D1 fora do ar'))
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect((await webhook(`ORD-${orderId}`)).status).toBe(500)
    spy.mockRestore()
    db.batch = batch
    expect((await db.prepare('SELECT status FROM orders WHERE id = ?').bind(orderId).first()).status).toBe('paid')

    expect((await webhook(`ORD-${orderId}`, { requestId: 'reenvio' })).status).toBe(200)
    const seen = (await req('GET', `/v1/checkout/${orderId}?s=${viewSecret}`)).body
    expect(seen.status).toBe('delivered')
    // O revendedor criado na 1ª tentativa é reaproveitado e a chave nova (a antiga nunca saiu) funciona.
    expect((await db.prepare('SELECT COUNT(*) AS n FROM resellers').first()).n).toBe(1)
    expect(await findResellerByKey(db, seen.result.resellerKey)).toMatchObject({ credits: 20 })
  })

  it('estorno do Pix: tira os créditos que sobraram, suspende a revenda se já gastou e marca o pedido', async () => {
    const { orderId } = await pixFor({ kind: 'credits', quantity: 20, name: 'Loja do Zé', contact: '16 99999-0000' })
    pay(orderId)
    await webhook(`ORD-${orderId}`)
    await db.prepare('UPDATE resellers SET credits = 5').run() // gastou 15 em ativações
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    pay(orderId, { status: 'refunded', status_detail: 'refunded' })
    await webhook(`ORD-${orderId}`, { requestId: 'estorno' })
    await webhook(`ORD-${orderId}`, { requestId: 'estorno-repetido' })
    spy.mockRestore()
    expect((await db.prepare('SELECT status FROM orders WHERE id = ?').bind(orderId).first()).status).toBe('refunded')
    expect(await db.prepare('SELECT credits, active FROM resellers').first()).toEqual({ credits: 0, active: 0 })
    const refunds = (await db.prepare("SELECT delta FROM credit_movements WHERE kind = 'refund'").all()).results
    expect(refunds).toEqual([{ delta: -5 }])
  })

  it('estorno que falha ao desfazer (banco caiu, saldo mudou no meio) não fica "refunded": o reenvio desfaz', async () => {
    const { orderId } = await pixFor({ kind: 'credits', quantity: 20, name: 'Loja do Zé', contact: '16 99999-0000' })
    pay(orderId)
    await webhook(`ORD-${orderId}`)
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    pay(orderId, { status: 'refunded', status_detail: 'refunded' })
    const batch = vi.spyOn(db, 'batch').mockRejectedValueOnce(new Error('CHECK constraint failed'))
    expect((await webhook(`ORD-${orderId}`, { requestId: 'estorno' })).status).toBe(500)
    batch.mockRestore()
    expect((await db.prepare('SELECT status FROM orders WHERE id = ?').bind(orderId).first()).status).toBe('delivered')
    expect((await webhook(`ORD-${orderId}`, { requestId: 'estorno-reenvio' })).status).toBe(200)
    spy.mockRestore()
    expect((await db.prepare('SELECT status FROM orders WHERE id = ?').bind(orderId).first()).status).toBe('refunded')
    expect((await db.prepare('SELECT credits FROM resellers').first()).credits).toBe(0)
  })

  it('estorno no meio da entrega: espera (500) em vez de marcar e deixar a entrega gravar "entregue" por cima', async () => {
    const { orderId } = await pixFor({ kind: 'credits', quantity: 20, name: 'Loja do Zé', contact: '16 99999-0000' })
    pay(orderId, { status: 'refunded', status_detail: 'refunded' })
    await db.prepare("UPDATE orders SET status = 'delivering', checked_at = ? WHERE id = ?").bind(clock, orderId).run()
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect((await webhook(`ORD-${orderId}`, { requestId: 'estorno' })).status).toBe(500)
    spy.mockRestore()
    expect((await db.prepare('SELECT status FROM orders WHERE id = ?').bind(orderId).first()).status).toBe('delivering')
  })

  it('estorno parcial (desconto, acerto) mantém os créditos e só avisa o dono', async () => {
    const { orderId } = await pixFor({ kind: 'credits', quantity: 20, name: 'Loja do Zé', contact: '16 99999-0000' })
    pay(orderId)
    await webhook(`ORD-${orderId}`)
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    pay(orderId, { status: 'processed', status_detail: 'partially_refunded' })
    await webhook(`ORD-${orderId}`, { requestId: 'parcial' })
    expect(spy.mock.calls.flat().join(' ')).toMatch(/estorno parcial/)
    spy.mockRestore()
    expect((await db.prepare('SELECT status FROM orders WHERE id = ?').bind(orderId).first()).status).toBe('delivered')
    expect(await db.prepare('SELECT credits, active FROM resellers').first()).toEqual({ credits: 20, active: 1 })
  })

  it('estorno da ativação do aparelho revoga o ano comprado', async () => {
    const { orderId } = await deviceOrder()
    pay(orderId)
    await webhook(`ORD-${orderId}`)
    expect(await activationEndsAt(db, KEY)).not.toBeNull()
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    pay(orderId, { status: 'processed', status_detail: 'charged_back' })
    await webhook(`ORD-${orderId}`, { requestId: 'chargeback' })
    spy.mockRestore()
    expect(await activationEndsAt(db, KEY)).toBeNull()
  })

  it('estorno de um ano com outro empilhado depois: o fim volta a contar só o ano que ficou (auditoria RFC-025, item 1)', async () => {
    const first = await deviceOrder()
    pay(first.orderId)
    await webhook(`ORD-${first.orderId}`)
    const oneYear = await activationEndsAt(db, KEY)
    const second = await deviceOrder()
    pay(second.orderId)
    await webhook(`ORD-${second.orderId}`, { requestId: 'segunda' })
    expect(await activationEndsAt(db, KEY)).toBeGreaterThan(oneYear)
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    pay(first.orderId, { status: 'processed', status_detail: 'charged_back' })
    await webhook(`ORD-${first.orderId}`, { requestId: 'chargeback-1' })
    spy.mockRestore()
    // O ano que ficou mantém a duração exata que somou (366 dias se cair em ano bissexto): até 1 dia de diferença.
    expect(Math.abs((await activationEndsAt(db, KEY)) - oneYear)).toBeLessThanOrEqual(24 * 3600 * 1000)
  })

  it('estorno de créditos já repassados: suspende a revenda e quem recebeu o repasse, com as de baixo (auditoria RFC-025, item 2)', async () => {
    const { orderId } = await pixFor({ kind: 'credits', quantity: 20, name: 'Loja do Zé', contact: '16 99999-0000' })
    pay(orderId)
    await webhook(`ORD-${orderId}`)
    const parent = await db.prepare('SELECT id FROM resellers').first()
    const at = Date.now()
    await db.batch([
      db.prepare("INSERT INTO resellers (id, parent_id, name, key_hash, credits, active, created_at) VALUES (900, ?, 'Filha', 'h900', 20, 1, ?)").bind(parent.id, at),
      db.prepare("INSERT INTO resellers (id, parent_id, name, key_hash, credits, active, created_at) VALUES (901, 900, 'Neta', 'h901', 0, 1, ?)").bind(at),
      db.prepare("INSERT INTO resellers (id, parent_id, name, key_hash, credits, active, created_at) VALUES (902, ?, 'Outra filha', 'h902', 0, 1, ?)").bind(parent.id, at),
      db.prepare('UPDATE resellers SET credits = 0 WHERE id = ?').bind(parent.id),
      db.prepare("INSERT INTO credit_movements (reseller_id, delta, kind, counterpart_id, created_at) VALUES (?, -20, 'transfer_out', 900, ?)").bind(parent.id, at + 1),
    ])
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    pay(orderId, { status: 'refunded', status_detail: 'refunded' })
    await webhook(`ORD-${orderId}`, { requestId: 'estorno' })
    spy.mockRestore()
    const active = (await db.prepare('SELECT id, active FROM resellers ORDER BY id').all()).results
    expect(active).toEqual([
      { id: parent.id, active: 0 },
      { id: 900, active: 0 },
      { id: 901, active: 0 },
      { id: 902, active: 1 },
    ])
  })

  it('webhook perdido: a consulta da tela confirma no Mercado Pago, no máximo uma vez por minuto', async () => {
    const { orderId, viewSecret } = await deviceOrder()
    pay(orderId)
    calls = []
    clock += 30e3
    expect((await req('GET', `/v1/checkout/${orderId}?s=${viewSecret}`)).body.status).toBe('pending')
    expect(calls).toHaveLength(0)
    clock += 31e3
    expect((await req('GET', `/v1/checkout/${orderId}?s=${viewSecret}`)).body.status).toBe('delivered')
    expect(calls).toHaveLength(1)
  })

  it('outros tópicos são aceitos sem consulta; sem segredo configurado o webhook fica desligado (503)', async () => {
    const { orderId } = await deviceOrder()
    calls = []
    expect((await webhook(`ORD-${orderId}`, { type: 'payment' })).status).toBe(200)
    expect(calls).toHaveLength(0)
    handle = createLicenseHandler({ db, now: () => clock, adminToken: 'x', mp: createMpClient({ accessToken: TOKEN, fetch: fakeFetch }) })
    expect((await webhook(`ORD-${orderId}`)).status).toBe(503)
  })

  it('falha ao consultar o Mercado Pago: 500 para ele reenviar depois, sem token nem e-mail no log', async () => {
    const { orderId } = await deviceOrder()
    mpReply = () => ({ status: 503, body: {} })
    const spies = ['log', 'warn', 'error', 'info'].map((m) => vi.spyOn(console, m).mockImplementation(() => {}))
    const { status } = await webhook(`ORD-${orderId}`)
    const logged = JSON.stringify(spies.flatMap((s) => s.mock.calls))
    spies.forEach((s) => s.mockRestore())
    expect(status).toBe(500)
    expect(logged).not.toContain(TOKEN)
    expect(logged).not.toContain(EMAIL)
  })
})

describe('cartão com 3DS nos créditos e compra pelo painel da revenda (etapa 3)', () => {
  const CARD = { token: 'tok_0123456789abcdef', paymentMethodId: 'master', cpf: '123.456.789-09' }
  const CHALLENGE = 'https://www.mercadopago.com.br/auth/card/validation/pages/remedies/abc?display_mode=self_hosted'

  /** Mercado Pago simulado para cartão: a order já volta com o resultado (aprovada, desafio 3DS ou recusada). */
  function cardReply(outcome) {
    mpReply = (url, init = {}) => {
      if (init.method !== 'POST') return defaultReply(url, init)
      const body = JSON.parse(init.body)
      const [status, detail] = { approved: ['processed', 'accredited'], challenge: ['action_required', 'pending_challenge'], declined: ['failed', 'failed'] }[outcome]
      const order = {
        id: `ORD-${body.external_reference}`,
        status,
        status_detail: detail,
        total_amount: body.total_amount,
        external_reference: body.external_reference,
        currency: 'BRL',
        transactions: {
          payments: [{ id: 'PAY-1', status, status_detail: detail, amount: body.total_amount, payment_method: { id: 'master', type: 'credit_card', ...(outcome === 'challenge' ? { transaction_security: { url: CHALLENGE } } : {}) } }],
        },
      }
      mpOrders.set(order.id, order)
      return { status: 201, body: order }
    }
  }

  const buyCredits = (extra = {}) =>
    req('POST', '/v1/checkout', { kind: 'credits', method: 'card', quantity: 20, name: 'Loja do Zé', contact: '16 99999-0000', email: EMAIL, card: CARD, ...extra })

  it('cartão aprovado na hora: corpo da order como na documentação, 1 parcela, 3DS ligado, sem issuer_id (G20)', async () => {
    cardReply('approved')
    const { status, body } = await buyCredits({ card: { ...CARD, installments: 12, issuerId: '24' } })
    expect(status).toBe(201)
    expect(body).toMatchObject({ status: 'delivered', amountCents: 18000 })
    expect(calls[0].body).toEqual({
      type: 'online',
      processing_mode: 'automatic',
      total_amount: '180.00',
      external_reference: body.orderId,
      payer: { email: EMAIL, identification: { type: 'CPF', number: '12345678909' } },
      config: { online: { transaction_security: { validation: 'on_fraud_risk', liability_shift: 'required' } } },
      transactions: { payments: [{ amount: '180.00', payment_method: { id: 'master', type: 'credit_card', token: CARD.token, installments: 1 } }] },
    })
    const seen = (await req('GET', `/v1/checkout/${body.orderId}?s=${body.viewSecret}`)).body
    expect(seen.result.credits).toBe(20)
    expect(seen.result.resellerKey).toMatch(/^pk_/)
    const row = await db.prepare('SELECT * FROM orders').first()
    expect(JSON.stringify(row)).not.toContain(CARD.token)
    expect(JSON.stringify(row)).not.toContain('12345678909')
  })

  it('desafio 3DS: devolve a URL do desafio; o webhook depois confirma e entrega', async () => {
    cardReply('challenge')
    const { body } = await buyCredits()
    expect(body).toMatchObject({ status: 'pending', challengeUrl: CHALLENGE })
    pay(body.orderId)
    await webhook(`ORD-${body.orderId}`)
    expect((await req('GET', `/v1/checkout/${body.orderId}?s=${body.viewSecret}`)).body.status).toBe('delivered')
  })

  it('cartão recusado (pela order ou pela API): 402, pedido falho, sem token no log', async () => {
    cardReply('declined')
    const spies = ['log', 'warn', 'error', 'info'].map((m) => vi.spyOn(console, m).mockImplementation(() => {}))
    const declined = await buyCredits()
    mpReply = () => ({ status: 400, body: { message: 'invalid token' } })
    const refused = await buyCredits()
    const logged = JSON.stringify(spies.flatMap((s) => s.mock.calls))
    spies.forEach((s) => s.mockRestore())
    expect(declined.status).toBe(402)
    expect(refused.status).toBe(402)
    expect(logged).not.toContain(CARD.token)
    const rows = (await db.prepare('SELECT status FROM orders').all()).results
    expect(rows.map((r) => r.status)).toEqual(['failed', 'failed'])
    expect((await db.prepare('SELECT COUNT(*) AS n FROM resellers').first()).n).toBe(0)
  })

  it('dados do cartão inválidos: 400 sem chamar o Mercado Pago', async () => {
    cardReply('approved')
    expect((await buyCredits({ card: { ...CARD, token: '' } })).status).toBe(400)
    expect((await buyCredits({ card: { ...CARD, cpf: '123' } })).status).toBe(400)
    expect((await buyCredits({ card: { ...CARD, paymentMethodId: 'Visa<script>' } })).status).toBe(400)
    expect((await buyCredits({ card: undefined })).status).toBe(400)
    expect(calls).toHaveLength(0)
  })

  it('a consulta da order que traz a moeda em "currency" (e não "currency_id") também é aceita', async () => {
    const code = await tvCode()
    const { orderId } = (await req('POST', '/v1/checkout', { kind: 'device_annual', method: 'pix', code, email: EMAIL })).body
    pay(orderId, { currency_id: undefined, currency: 'BRL' })
    await webhook(`ORD-${orderId}`)
    expect(await activationEndsAt(db, KEY)).not.toBeNull()
  })

  describe('POST /api/v1/credits/checkout (painel da revenda)', () => {
    async function panel(body, key) {
      const res = await handle(
        new Request('http://license.test/api/v1/credits/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
          body: JSON.stringify(body),
        }),
        '10.5.5.5',
      )
      return { status: res.status, body: await res.json() }
    }

    it('credita o revendedor logado: não cria outro revendedor e não devolve chave', async () => {
      const { id, key } = await createReseller(db, { name: 'Revenda Antiga', contact: 'x', now: clock })
      const { status, body } = await panel({ method: 'pix', quantity: 10, email: EMAIL }, key)
      expect(status).toBe(201)
      expect(body.amountCents).toBe(10000)
      pay(body.orderId)
      await webhook(`ORD-${body.orderId}`)

      const seen = (await req('GET', `/v1/checkout/${body.orderId}?s=${body.viewSecret}`)).body
      expect(seen).toMatchObject({ status: 'delivered', result: { credits: 10 } })
      expect(seen.result.resellerKey).toBeUndefined()
      expect((await db.prepare('SELECT credits FROM resellers WHERE id = ?').bind(id).first()).credits).toBe(10)
      expect((await db.prepare('SELECT COUNT(*) AS n FROM resellers').first()).n).toBe(1)
    })

    it('sem chave: 401; sem Mercado Pago configurado: 503', async () => {
      expect((await panel({ method: 'pix', quantity: 10, email: EMAIL })).status).toBe(401)
      const { key } = await createReseller(db, { name: 'R', contact: 'x', now: clock })
      handle = createLicenseHandler({ db, now: () => clock, adminToken: 'x' })
      expect((await panel({ method: 'pix', quantity: 10, email: EMAIL }, key)).status).toBe(503)
    })
  })
})

describe('assinatura anual do aparelho no cartão (etapa 4)', () => {
  const CARD = { token: 'tok_0123456789abcdef', paymentMethodId: 'visa', cpf: '12345678909' }
  const YEAR_2027 = Date.UTC(2027, 9, 28, 15)
  let preapprovals
  let installments

  /** Mercado Pago simulado: /preapproval (assinaturas) e /authorized_payments (parcelas). */
  function subscriptionReply(url, init = {}) {
    const path = url.replace('https://api.mercadopago.com', '')
    if (path === '/preapproval' && init.method === 'POST') {
      const body = JSON.parse(init.body)
      const pre = { id: `pre-${body.external_reference}`, status: 'authorized', external_reference: body.external_reference }
      preapprovals.set(pre.id, pre)
      return { status: 201, body: pre }
    }
    let match = path.match(/^\/preapproval\/(.+)$/)
    if (match && init.method === 'PUT') {
      Object.assign(preapprovals.get(match[1]), JSON.parse(init.body))
      return { status: 200, body: preapprovals.get(match[1]) }
    }
    if (match) return { status: 200, body: preapprovals.get(match[1]) }
    match = path.match(/^\/authorized_payments\/(.+)$/)
    if (match) return installments.has(match[1]) ? { status: 200, body: installments.get(match[1]) } : { status: 404, body: {} }
    return defaultReply(url, init)
  }

  it('dois pedidos ao mesmo tempo para o mesmo aparelho: só uma assinatura nasce no Mercado Pago', async () => {
    const code = await tvCode()
    const body = { kind: 'device_annual', method: 'card', code, email: EMAIL, card: CARD }
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const both = await Promise.all([req('POST', '/v1/checkout', body), req('POST', '/v1/checkout', body)])
    spy.mockRestore()
    expect(both.map((r) => r.status).sort()).toEqual([201, 409])
    expect(calls.filter((c) => c.url.endsWith('/preapproval') && c.method === 'POST')).toHaveLength(1)
  })

  it('cartão recusado na adesão: a reserva some e dá para tentar de novo', async () => {
    mpReply = (url, init = {}) => (url.endsWith('/preapproval') && init.method === 'POST' ? { status: 400, body: { message: 'recusado' } } : subscriptionReply(url, init))
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect((await subscribe()).httpStatus).toBe(402)
    spy.mockRestore()
    expect((await db.prepare('SELECT COUNT(*) AS n FROM subscriptions').first()).n).toBe(0)
  })

  it('cartão recusado na adesão conta no freio da TV (5 por dia), sem gastar o teto geral do site', async () => {
    mpReply = (url, init = {}) => (url.endsWith('/preapproval') && init.method === 'POST' ? { status: 400, body: { message: 'recusado' } } : subscriptionReply(url, init))
    const code = await tvCode()
    const tryCard = (n) => req('POST', '/v1/checkout', { kind: 'device_annual', method: 'card', code, email: EMAIL, card: CARD }, `10.40.${n}.1`)
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    for (let n = 1; n <= 5; n++) expect((await tryCard(n)).status).toBe(402)
    expect((await tryCard(6)).status).toBe(429)
    spy.mockRestore()
    expect((await db.prepare("SELECT COUNT(*) AS n FROM rate_limits WHERE bucket = 'cardAll'").first()).n).toBe(0)
  })

  it('reserva parada há mais de 10 min (o Mercado Pago nunca respondeu): libera nova tentativa', async () => {
    mpReply = (url, init = {}) => (url.endsWith('/preapproval') && init.method === 'POST' ? { status: 504, body: {} } : subscriptionReply(url, init))
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect((await subscribe()).httpStatus).toBe(502)
    spy.mockRestore()
    mpReply = subscriptionReply
    expect((await subscribe()).httpStatus).toBe(409)
    clock += 11 * MIN
    expect((await subscribe()).httpStatus).toBe(201)
  })

  /** Parcela cobrada pelo Mercado Pago (aprovada por padrão). */
  function installment(id, preapprovalId, extra = {}) {
    installments.set(id, { id, preapproval_id: preapprovalId, transaction_amount: 25, currency_id: 'BRL', status: 'processed', payment: { id: 900 + installments.size, status: 'approved' }, ...extra })
  }

  async function subscribe() {
    const code = await tvCode()
    const res = await req('POST', '/v1/checkout', { kind: 'device_annual', method: 'card', code, email: EMAIL, card: CARD })
    return { ...res.body, httpStatus: res.status, preId: `pre-${res.body.orderId}` }
  }

  async function admin(method, path) {
    const res = await handle(
      new Request(`http://license.test${path}`, { method, headers: { Authorization: 'Bearer x', 'Content-Type': 'application/json' }, body: method === 'GET' ? undefined : '{}' }),
      '10.1.1.1',
    )
    return { status: res.status, body: await res.json() }
  }

  beforeEach(() => {
    preapprovals = new Map()
    installments = new Map()
    mpReply = subscriptionReply
  })

  it('cria a assinatura anual no Mercado Pago (R$ 25 a cada 12 meses) sem guardar o token do cartão', async () => {
    const sub = await subscribe()
    expect(sub.httpStatus).toBe(201)
    expect(sub).toMatchObject({ status: 'pending', amountCents: 2500, subscription: { status: 'authorized' } })
    const sent = calls.find((c) => c.url.endsWith('/preapproval'))
    expect(sent.body).toEqual({
      reason: 'Pulse Player — ativação anual',
      external_reference: sub.orderId,
      payer_email: EMAIL,
      card_token_id: CARD.token,
      auto_recurring: { frequency: 12, frequency_type: 'months', transaction_amount: 25, currency_id: 'BRL' },
      back_url: 'http://license.test/assinar',
      status: 'authorized',
    })
    const rows = JSON.stringify([await db.prepare('SELECT * FROM orders').first(), await db.prepare('SELECT * FROM subscriptions').first()])
    expect(rows).not.toContain(CARD.token)
    expect(rows).toContain(sub.preId)
  })

  it('cada parcela aprovada soma 1 ano, uma única vez por parcela (G16)', async () => {
    const sub = await subscribe()
    installment('7001', sub.preId)
    await Promise.all([1, 2, 3].map((n) => webhook('7001', { type: 'subscription_authorized_payment', requestId: `r${n}` })))
    expect(await activationEndsAt(db, KEY)).toBe(YEAR_2027)
    const seen = (await req('GET', `/v1/checkout/${sub.orderId}?s=${sub.viewSecret}`)).body
    expect(seen).toMatchObject({ status: 'delivered', result: { activationEndsAt: YEAR_2027 } })

    clock = YEAR_2027
    installment('7002', sub.preId)
    await webhook('7002', { type: 'subscription_authorized_payment' })
    await webhook('7002', { type: 'subscription_authorized_payment', requestId: 'repetido' })
    expect(await activationEndsAt(db, KEY)).toBe(Date.UTC(2028, 9, 28, 15))
    const rows = (await db.prepare("SELECT source, note FROM activations WHERE source = 'subscription'").all()).results
    expect(rows).toEqual([
      { source: 'subscription', note: sub.orderId },
      { source: 'subscription', note: sub.orderId },
    ])
  })

  it('parcela recusada, com outro valor ou de outra assinatura: nada é entregue', async () => {
    const sub = await subscribe()
    installment('8001', sub.preId, { payment: { id: 1, status: 'rejected' } })
    installment('8002', sub.preId, { transaction_amount: 1 })
    installment('8003', 'pre-de-outra-loja')
    for (const id of ['8001', '8002', '8003']) await webhook(id, { type: 'subscription_authorized_payment' })
    expect(await activationEndsAt(db, KEY)).toBeNull()
  })

  it('preço da tabela mudou depois da adesão: a parcela no valor contratado ainda é entregue', async () => {
    const sub = await subscribe()
    await db.prepare('UPDATE orders SET amount_cents = 1990 WHERE id = ?').bind(sub.orderId).run() // contratou a R$ 19,90
    installment('8101', sub.preId, { transaction_amount: 19.9 })
    await webhook('8101', { type: 'subscription_authorized_payment' })
    expect(await activationEndsAt(db, KEY)).not.toBeNull()
  })

  it('assinatura cancelada no Mercado Pago: fica cancelada aqui; se nunca pagou, o pedido falha', async () => {
    const sub = await subscribe()
    preapprovals.get(sub.preId).status = 'cancelled'
    await webhook(sub.preId, { type: 'subscription_preapproval' })
    expect((await db.prepare('SELECT status, cancelled_at FROM subscriptions').first())).toEqual({ status: 'cancelled', cancelled_at: clock })
    expect((await req('GET', `/v1/checkout/${sub.orderId}?s=${sub.viewSecret}`)).body.status).toBe('failed')
  })

  it('assinatura criada lá mas sem registro aqui (timeout na criação): a parcela recupera e entrega', async () => {
    mpReply = (url, init) => {
      const reply = subscriptionReply(url, init)
      return url.endsWith('/preapproval') && init.method === 'POST' ? { status: 504, body: {} } : reply
    }
    const sub = await subscribe()
    expect(sub.httpStatus).toBe(502)
    expect((await db.prepare('SELECT status FROM subscriptions').first()).status).toBe('creating') // reserva: segura o 2º clique

    mpReply = subscriptionReply
    const preId = [...preapprovals.keys()][0]
    installment('9001', preId)
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await webhook('9001', { type: 'subscription_authorized_payment' })
    spy.mockRestore()
    expect(await activationEndsAt(db, KEY)).toBe(YEAR_2027)
    expect((await db.prepare('SELECT mp_preapproval_id FROM subscriptions').first()).mp_preapproval_id).toBe(preId)
  })

  it('parcela estornada: revoga o ano dela uma vez e cancela a renovação', async () => {
    const sub = await subscribe()
    installment('7101', sub.preId)
    await webhook('7101', { type: 'subscription_authorized_payment' })
    expect(await activationEndsAt(db, KEY)).toBe(YEAR_2027)

    installments.get('7101').payment.status = 'charged_back'
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await webhook('7101', { type: 'subscription_authorized_payment', requestId: 'cb1' })
    await webhook('7101', { type: 'subscription_authorized_payment', requestId: 'cb2' })
    spy.mockRestore()
    expect(await activationEndsAt(db, KEY)).toBeNull()
    expect((await db.prepare('SELECT status FROM subscriptions').first()).status).toBe('cancelled')
    expect(preapprovals.get(sub.preId).status).toBe('cancelled')
    // 1ª parcela estornada: o pedido de adesão sai da receita (auditoria 10)
    expect((await db.prepare('SELECT status FROM orders WHERE id = ?').bind(sub.orderId).first()).status).toBe('refunded')
  })

  it('webhook da assinatura chegou antes do registro: a adesão não dá erro nem cria outra (auditoria 3)', async () => {
    mpReply = (url, init = {}) => {
      const reply = subscriptionReply(url, init)
      if (url.endsWith('/preapproval') && init.method === 'POST') {
        const pre = reply.body // o aviso do MP chegou e gravou a assinatura antes da resposta da criação
        db.prepare('UPDATE subscriptions SET mp_preapproval_id = ?, status = ? WHERE id = ?').bind(pre.id, 'authorized', pre.external_reference).runSync()
      }
      return reply
    }
    const sub = await subscribe()
    expect(sub.httpStatus).toBe(201)
    expect((await db.prepare('SELECT COUNT(*) AS n FROM subscriptions').first()).n).toBe(1)
  })

  it('aparelho que já tem renovação no cartão não assina de novo (cobrança em dobro) (auditoria 3)', async () => {
    const first = await subscribe()
    expect(first.httpStatus).toBe(201)
    const again = await subscribe()
    expect(again.httpStatus).toBe(409)
    expect(calls.filter((c) => c.url.endsWith('/preapproval') && c.method === 'POST')).toHaveLength(1)
  })

  it('expurgo de 24 meses não apaga o pedido de adesão de assinatura viva nem o aparelho dela (auditoria 4)', async () => {
    const sub = await subscribe()
    clock += 800 * 24 * 3600 * 1000
    await purgeExpired(db, clock)
    expect(await db.prepare('SELECT id FROM orders WHERE id = ?').bind(sub.orderId).first()).not.toBeNull()
    expect(await db.prepare('SELECT code FROM devices').first()).not.toBeNull()
  })

  it('cartão recusado na adesão: 402, pedido falho e nenhuma assinatura', async () => {
    mpReply = (url, init) => (url.endsWith('/preapproval') ? { status: 400, body: { message: 'card rejected' } } : subscriptionReply(url, init))
    const sub = await subscribe()
    expect(sub.httpStatus).toBe(402)
    expect((await db.prepare('SELECT status FROM orders').first()).status).toBe('failed')
    expect((await db.prepare('SELECT COUNT(*) AS n FROM subscriptions').first()).n).toBe(0)
  })

  it('cancelar assinatura já cancelada no Mercado Pago: acerta aqui em vez de dar erro para sempre', async () => {
    const sub = await subscribe()
    preapprovals.get(sub.preId).status = 'cancelled' // o cliente cancelou direto no Mercado Pago
    const reply = subscriptionReply
    mpReply = (url, init = {}) => (init.method === 'PUT' ? { status: 400, body: { message: 'already cancelled' } } : reply(url, init))
    const res = await admin('POST', `/admin/api/subscriptions/${sub.orderId}/cancel`)
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('cancelled')

    // Ainda ativa lá e o PUT falhou: continua sendo erro (nada é marcado à toa).
    const other = await subscribe()
    const failed = await admin('POST', `/admin/api/subscriptions/${other.orderId}/cancel`)
    expect(failed.status).toBe(502)
  })

  it('painel do dono: lista as assinaturas e cancela a renovação no Mercado Pago', async () => {
    const sub = await subscribe()
    const list = await admin('GET', '/admin/api/subscriptions')
    expect(list.status).toBe(200)
    expect(list.body).toEqual([{ id: sub.orderId, deviceCode: expect.any(String), status: 'authorized', mpPreapprovalId: sub.preId, createdAt: clock, cancelledAt: null }])
    // Mais de 200 assinaturas: a de uma TV antiga se acha pelo código (auditoria 11)
    const code = list.body[0].deviceCode
    expect((await admin('GET', `/admin/api/subscriptions?device=${code.toLowerCase()}`)).body).toHaveLength(1)
    expect((await admin('GET', '/admin/api/subscriptions?device=ZZZZ9999')).body).toEqual([])

    calls = []
    const cancelled = await admin('POST', `/admin/api/subscriptions/${sub.orderId}/cancel`)
    expect(cancelled.status).toBe(200)
    expect(cancelled.body).toMatchObject({ status: 'cancelled', cancelledAt: clock })
    expect(calls).toEqual([expect.objectContaining({ method: 'PUT', url: `https://api.mercadopago.com/preapproval/${sub.preId}`, body: { status: 'cancelled' } })])
    expect((await admin('POST', '/admin/api/subscriptions/naoexiste/cancel')).status).toBe(404)
    const anon = await handle(new Request('http://license.test/admin/api/subscriptions'), '10.1.1.1')
    expect(anon.status).toBe(401)
  })
})

describe('painel do dono — pedidos (etapa 6)', () => {
  async function admin(method, path) {
    const res = await handle(
      new Request(`http://license.test${path}`, { method, headers: { Authorization: 'Bearer x', 'Content-Type': 'application/json' }, body: method === 'GET' ? undefined : '{}' }),
      '10.1.1.1',
    )
    return { status: res.status, body: await res.json() }
  }

  const buyCredits = async () =>
    (await req('POST', '/v1/checkout', { kind: 'credits', method: 'pix', quantity: 20, name: 'Loja do Zé', contact: '16 99999-0000', email: EMAIL })).body
  const status = async (orderId) => (await db.prepare('SELECT status FROM orders WHERE id = ?').bind(orderId).first()).status
  const credits = async () => (await db.prepare('SELECT COALESCE(SUM(credits), 0) AS n FROM resellers').first()).n

  it('lista os pedidos (mais novos primeiro, filtro por situação) sem nunca mostrar a chave do revendedor (G18)', async () => {
    const first = await buyCredits()
    clock += MIN
    const second = await buyCredits()
    pay(first.orderId)
    await webhook(`ORD-${first.orderId}`)

    const all = await admin('GET', '/admin/api/orders')
    expect(all.status).toBe(200)
    expect(all.body.map((o) => o.id)).toEqual([second.orderId, first.orderId])
    expect(all.body[1]).toMatchObject({
      kind: 'credits',
      method: 'pix',
      status: 'delivered',
      amountCents: 18000,
      quantity: 20,
      buyerName: 'Loja do Zé',
      buyerContact: '16 99999-0000',
      mpOrderId: `ORD-${first.orderId}`,
      delivery: { credits: 20 },
    })
    expect(JSON.stringify(all.body)).not.toContain('pk_')
    expect((await admin('GET', '/admin/api/orders?status=pending')).body.map((o) => o.id)).toEqual([second.orderId])
  })

  it('reprocessar pedido pago sem entrega: entrega uma única vez, mesmo com dois cliques juntos', async () => {
    const { orderId } = await buyCredits()
    await db.prepare("UPDATE orders SET status = 'paid', paid_at = ? WHERE id = ?").bind(clock, orderId).run() // entrega interrompida
    const [a, b] = await Promise.all([admin('POST', `/admin/api/orders/${orderId}/reprocess`), admin('POST', `/admin/api/orders/${orderId}/reprocess`)])
    expect([a.status, b.status].sort()).toEqual([200, 409])
    expect(await status(orderId)).toBe('delivered')
    expect(await credits()).toBe(20)
    // Entregue: reprocessar só consulta o Mercado Pago (ainda pendente lá) e não entrega de novo.
    expect((await admin('POST', `/admin/api/orders/${orderId}/reprocess`)).body.status).toBe('delivered')
    expect(await credits()).toBe(20)
  })

  it('estorno sem webhook (2026-11-10): reprocessar o pedido entregue consulta o Mercado Pago e revoga o ano', async () => {
    const { orderId } = (await req('POST', '/v1/checkout', { kind: 'device_annual', method: 'pix', code: await tvCode(), email: EMAIL })).body
    pay(orderId)
    await webhook(`ORD-${orderId}`)
    const endsAt = await activationEndsAt(db, KEY)
    expect((await admin('POST', `/admin/api/orders/${orderId}/reprocess`)).body.status).toBe('delivered')
    expect(await activationEndsAt(db, KEY)).toBe(endsAt) // ainda pago lá: nada muda, nem soma outro ano
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    pay(orderId, { status: 'refunded', status_detail: 'refunded' })
    const done = await admin('POST', `/admin/api/orders/${orderId}/reprocess`)
    spy.mockRestore()
    expect(done.body.status).toBe('refunded')
    expect(await activationEndsAt(db, KEY)).toBeNull()
  })

  it('webhook recusado por assinatura deixa aviso no log, sem a assinatura nem o segredo', async () => {
    const { orderId } = (await req('POST', '/v1/checkout', { kind: 'device_annual', method: 'pix', code: await tvCode(), email: EMAIL })).body
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect((await webhook(`ORD-${orderId}`, { secret: 'outro-segredo' })).status).toBe(401)
    const logged = spy.mock.calls.flat().join(' ')
    spy.mockRestore()
    expect(logged).toMatch(/assinatura/)
    expect(logged).not.toContain(SECRET)
  })

  it('reprocessar pedido pendente consulta o Mercado Pago: pago lá → entregue; ainda não pago → continua pendente', async () => {
    const { orderId } = await buyCredits()
    expect((await admin('POST', `/admin/api/orders/${orderId}/reprocess`)).body.status).toBe('pending')
    pay(orderId)
    const done = await admin('POST', `/admin/api/orders/${orderId}/reprocess`)
    expect(done.body).toMatchObject({ status: 'delivered', delivery: { credits: 20 } })
    expect(await credits()).toBe(20)
  })

  it('pago, mas o aparelho foi apagado: avisa e continua pago; pedido inexistente: 404; falho: 409', async () => {
    const code = await tvCode()
    const { orderId } = (await req('POST', '/v1/checkout', { kind: 'device_annual', method: 'pix', code, email: EMAIL })).body
    await db.prepare('DELETE FROM devices WHERE code = ?').bind(code).run()
    pay(orderId)
    await webhook(`ORD-${orderId}`)
    expect(await status(orderId)).toBe('paid')
    const blocked = await admin('POST', `/admin/api/orders/${orderId}/reprocess`)
    expect(blocked.status).toBe(409)
    expect(blocked.body.error).toMatch(/aparelho não existe mais/)
    expect(await status(orderId)).toBe('paid')

    expect((await admin('POST', '/admin/api/orders/AAAAAAAAAAAAAAAAAAAAAA/reprocess')).status).toBe(404)
    await db.prepare("UPDATE orders SET status = 'failed' WHERE id = ?").bind(orderId).run()
    expect((await admin('POST', `/admin/api/orders/${orderId}/reprocess`)).status).toBe(409)
  })

  it('sem o token do painel: 401', async () => {
    expect((await handle(new Request('http://license.test/admin/api/orders'), '10.1.1.1')).status).toBe(401)
  })
})

describe('auditoria ponytail — nunca cobrar sem entregar', () => {
  const CARD = { token: 'tok_0123456789abcdef', paymentMethodId: 'master', cpf: '12345678909' }
  const buyByCard = () =>
    req('POST', '/v1/checkout', { kind: 'credits', method: 'card', quantity: 20, name: 'Loja do Zé', contact: '16 99999-0000', email: EMAIL, card: CARD })
  const orderRow = () => db.prepare('SELECT * FROM orders').first()

  async function admin(method, path) {
    const res = await handle(
      new Request(`http://license.test${path}`, { method, headers: { Authorization: 'Bearer x', 'Content-Type': 'application/json' }, body: method === 'GET' ? undefined : '{}' }),
      '10.1.1.1',
    )
    return { status: res.status, body: await res.json() }
  }

  it('erro 5xx na criação, mas o Mercado Pago cobrou: o pedido fica pendente e o webhook entrega', async () => {
    mpReply = (url, init = {}) => {
      if (init.method !== 'POST') return defaultReply(url, init)
      const body = JSON.parse(init.body)
      const id = `ORD-${body.external_reference}`
      mpOrders.set(id, { id, status: 'processed', status_detail: 'accredited', currency: 'BRL', total_amount: body.total_amount, external_reference: body.external_reference })
      return { status: 503, body: {} }
    }
    expect((await buyByCard()).status).toBe(502)
    const row = await orderRow()
    expect(row).toMatchObject({ status: 'pending', mp_order_id: null })
    await webhook(`ORD-${row.id}`)
    expect((await orderRow()).status).toBe('delivered')
    expect((await db.prepare('SELECT credits FROM resellers').first()).credits).toBe(20)
  })

  it('queda de rede na criação também deixa o pedido pendente (não "falhou")', async () => {
    mpReply = () => {
      throw new TypeError('fetch failed')
    }
    expect((await buyByCard()).status).toBe(502)
    expect((await orderRow()).status).toBe('pending')
  })

  it('sem MP_WEBHOOK_SECRET não vende assinatura no cartão (as parcelas só chegam pelo webhook)', async () => {
    handle = createLicenseHandler({ db, now: () => clock, adminToken: 'x', mp: createMpClient({ accessToken: TOKEN, fetch: fakeFetch }) })
    const code = await tvCode()
    calls = []
    const res = await req('POST', '/v1/checkout', { kind: 'device_annual', method: 'card', code, email: EMAIL, card: CARD })
    expect(res.status).toBe(503)
    expect(calls).toHaveLength(0)
  })

  it('apagar ou revogar um aparelho com renovação ativa é recusado até cancelar a assinatura', async () => {
    mpReply = (url, init = {}) => {
      if (url.endsWith('/preapproval')) return { status: 201, body: { id: 'pre-1', status: 'authorized' } }
      if (init.method === 'PUT') return { status: 200, body: { id: 'pre-1', status: 'cancelled' } }
      return defaultReply(url, init)
    }
    const code = await tvCode()
    const { orderId } = (await req('POST', '/v1/checkout', { kind: 'device_annual', method: 'card', code, email: EMAIL, card: CARD })).body
    const blocked = await admin('DELETE', `/admin/api/devices/${code}`)
    expect(blocked.status).toBe(409)
    expect(blocked.body.error).toMatch(/renovação.*antes de apagar/)
    // Revogar também: a próxima parcela paga ativaria o aparelho de novo.
    const revoke = await admin('POST', `/admin/api/devices/${code}/revoke`)
    expect(revoke.status).toBe(409)
    expect(revoke.body.error).toMatch(/antes de revogar/)
    await admin('POST', `/admin/api/subscriptions/${orderId}/cancel`)
    expect((await admin('POST', `/admin/api/devices/${code}/revoke`)).status).toBe(200)
    expect((await admin('DELETE', `/admin/api/devices/${code}`)).status).toBe(200)
  })

  it('pedido preso em "entregando" (servidor caiu) é retomado pelo Reprocessar depois de 5 minutos', async () => {
    const { orderId } = (await req('POST', '/v1/checkout', { kind: 'credits', method: 'pix', quantity: 20, name: 'Loja do Zé', contact: 'x', email: EMAIL })).body
    await db.prepare("UPDATE orders SET status = 'delivering', checked_at = ? WHERE id = ?").bind(clock, orderId).run()
    expect((await admin('POST', `/admin/api/orders/${orderId}/reprocess`)).status).toBe(409)
    clock += 6 * MIN
    const done = await admin('POST', `/admin/api/orders/${orderId}/reprocess`)
    expect(done.body.status).toBe('delivered')
  })

  it('pedido preso em "entregando" com a tela de pagamento aberta: a própria consulta da tela retoma a entrega', async () => {
    mpReply = defaultReply
    const { orderId, viewSecret } = (await req('POST', '/v1/checkout', { kind: 'credits', method: 'pix', quantity: 20, name: 'Loja do Zé', contact: 'x', email: EMAIL })).body
    pay(orderId)
    await db.prepare("UPDATE orders SET status = 'delivering', checked_at = ? WHERE id = ?").bind(clock, orderId).run()
    let seen
    for (let i = 0; i < 12; i++) {
      clock += MIN // a tela consulta sem parar; aqui, uma vez por minuto
      seen = (await req('GET', `/v1/checkout/${orderId}?s=${viewSecret}`)).body
    }
    expect(seen.status).toBe('delivered')
  })
})

describe('revisão de segurança — limites no banco (valem entre isolates do Worker)', () => {
  const CARD = { token: 'tok_0123456789abcdef', paymentMethodId: 'visa', cpf: '12345678909' }
  const cardTry = (ip) =>
    req('POST', '/v1/checkout', { kind: 'credits', method: 'card', quantity: 20, name: 'A', contact: 'B', email: EMAIL, card: CARD }, ip)

  it('teste de cartões: no máximo 5 tentativas no cartão por rede por hora, contando IPv6 pelo /64', async () => {
    for (let n = 1; n <= 5; n++) expect((await cardTry(`2001:db8:aa:bb::${n}`)).status).not.toBe(429)
    const blocked = await cardTry('2001:db8:aa:bb:ffff::9')
    expect(blocked.status).toBe(429)
    expect((await cardTry('2001:db8:aa:cc::1')).status).not.toBe(429) // outro /64
    clock += 61 * MIN
    expect((await cardTry('2001:db8:aa:bb::1')).status).not.toBe(429)
  })

  it('teto geral do cartão: estourou, o cartão pausa para todos e o Pix continua', async () => {
    const mp = createMpClient({ accessToken: TOKEN, fetch: fakeFetch })
    handle = createLicenseHandler({ db, now: () => clock, adminToken: 'x', mp, mpWebhookSecret: SECRET })
    for (let n = 1; n <= 300; n++) await db.prepare("INSERT OR REPLACE INTO rate_limits VALUES ('cardAll', '*', ?, ?)").bind(clock, n).run()
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const card = await cardTry('10.7.7.7')
    spy.mockRestore()
    expect(card.status).toBe(429)
    expect(card.body.error).toMatch(/Pix/)
    const pix = await req('POST', '/v1/checkout', { kind: 'credits', method: 'pix', quantity: 20, name: 'A', contact: 'B', email: EMAIL }, '10.7.7.7')
    expect(pix.status).toBe(201)
  })

  it('token inventado (o Mercado Pago recusa o token) não gasta o teto geral do cartão (auditoria 6)', async () => {
    await db.prepare("INSERT INTO rate_limits VALUES ('cardAll', '*', ?, 299)").bind(clock).run()
    mpReply = () => ({ status: 400, body: { message: 'invalid card_token' } })
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    for (let n = 1; n <= 3; n++) expect((await cardTry(`10.20.${n}.1`)).status).toBe(402)
    mpReply = defaultReply
    const next = await cardTry('10.21.0.1')
    spy.mockRestore()
    expect(next.status).not.toBe(429)
  })

  it('cartão recusado de verdade (a order volta falha) conta no teto geral (auditoria 6)', async () => {
    await db.prepare("INSERT INTO rate_limits VALUES ('cardAll', '*', ?, 299)").bind(clock).run()
    mpReply = (url, init = {}) => {
      if (init.method !== 'POST') return defaultReply(url, init)
      const body = JSON.parse(init.body)
      const order = { id: `ORD-${body.external_reference}`, status: 'failed', status_detail: 'failed', total_amount: body.total_amount, external_reference: body.external_reference, transactions: { payments: [{ id: 'P', status: 'failed', amount: body.total_amount, payment_method: { id: 'visa', type: 'credit_card' } }] } }
      mpOrders.set(order.id, order)
      return { status: 201, body: order }
    }
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect((await cardTry('10.22.0.1')).status).toBe(402)
    const next = await cardTry('10.23.0.1')
    spy.mockRestore()
    expect(next.status).toBe(429)
  })

  it('painel do dono: 10 tokens errados travam a rede por 15 minutos, até para o token certo', async () => {
    const admin = (token, ip = '10.3.3.3') =>
      handle(new Request('http://license.test/admin/api/orders', { headers: { Authorization: `Bearer ${token}` } }), ip)
    for (let n = 0; n < 10; n++) expect((await admin('chute')).status).toBe(401)
    expect((await admin('x')).status).toBe(429)
    expect((await admin('x', '10.3.3.4')).status).toBe(200)
    clock += 16 * MIN
    expect((await admin('x')).status).toBe(200)
  })

  it('aparelhos novos por dia ficam no banco: outra instância do serviço não zera a conta', async () => {
    const other = createLicenseHandler({ db, now: () => clock, adminToken: 'x' })
    const hello = (h, n) =>
      h(new Request('http://license.test/v1/hello', { method: 'POST', body: JSON.stringify({ deviceKey: `chave-aparelho-${String(n).padStart(4, '0')}`, platform: 'web' }) }), '2001:db8:8::8')
    for (let n = 0; n < 20; n++) expect((await hello(n % 2 ? handle : other, n)).status).toBe(200)
    expect((await hello(other, 99)).status).toBe(429)
  })
})

describe('erro do Mercado Pago no log', () => {
  it('guarda só a mensagem do erro, com e-mail e números longos mascarados', async () => {
    const body = { message: 'Invalid users involved', error: 'bad_request', cause: [{ code: 3, description: 'payer_email teste@x.com invalid for 12345678909' }] }
    const detail = mpErrorDetail(body)
    expect(detail).toContain('Invalid users involved')
    expect(detail).not.toContain('teste@x.com')
    expect(detail).not.toContain('12345678909')
    const mp = createMpClient({ accessToken: 't', fetch: async () => new Response(JSON.stringify(body), { status: 400 }) })
    const err = await mp.createPreapproval({}).catch((e) => e)
    expect(err).toBeInstanceOf(MpError)
    expect(err.status).toBe(400)
    expect(err.message).toContain('Invalid users involved')
  })
})

describe('auditoria ponytail 2 — estorno e assinatura em dobro', () => {
  it('estornar a compra não apaga a cortesia "até a data" dada dentro dela', async () => {
    const { revokeActivationStatements } = await import('../server/license/license-db.mjs')
    const day = 24 * 60 * MIN
    const add = (startsDay, endsDay) =>
      db.prepare("INSERT INTO activations (device_key, starts_at, ends_at, source) VALUES ('k', ?, ?, 'x')").bind(startsDay * day, endsDay * day).run()
    await add(0, 365) // compra de 1 ano
    await add(10, 100) // cortesia do dono até o dia 100
    await db.batch(await revokeActivationStatements(db, 'k', [1], clock))
    expect((await db.prepare('SELECT ends_at FROM activations WHERE id = 2').first()).ends_at).toBe(100 * day)
  })
})
