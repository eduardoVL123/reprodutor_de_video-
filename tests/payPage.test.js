import { createHmac } from 'node:crypto'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { openSqlite } from '../server/license/sqlite-d1.mjs'
import { migrate } from '../server/license/license-db.mjs'
import { createLicenseHandler } from '../server/license/license-core.mjs'
import { createMpClient } from '../server/license/mp-client.mjs'
import { createReseller } from '../server/license/license-resellers.mjs'

/** RFC-020 etapa 5: tela /pagar (Pix e cartão) no jsdom, falando com o serviço de verdade e o Mercado Pago simulado. */

const PAGE = 'server/license/public/site/pagar.html'
const SECRET = 'segredo-do-webhook'
const EMAIL = 'comprador@exemplo.com'
const CHALLENGE = 'https://www.mercadopago.com.br/auth/card/validation/pages/remedies/abc'
let db
let handle
let mpOrders
let cardOutcome
let posted
let cardFormOptions

const $ = (id) => document.getElementById(id)
const reply = (body, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }))

/** Mercado Pago simulado: Pix volta aguardando; cartão volta com `cardOutcome`; assinatura volta autorizada. */
function fakeMp(url, init = {}) {
  const path = url.replace('https://api.mercadopago.com', '')
  if (path === '/preapproval') return reply({ id: `pre-${JSON.parse(init.body).external_reference}`, status: 'authorized' }, 201)
  if (path === '/v1/orders' && init.method === 'POST') {
    const body = JSON.parse(init.body)
    const card = body.transactions.payments[0].payment_method.type === 'credit_card'
    const [status, detail] = card ? { approved: ['processed', 'accredited'], challenge: ['action_required', 'pending_challenge'] }[cardOutcome] : ['action_required', 'waiting_transfer']
    const method = card
      ? { id: 'master', type: 'credit_card', ...(cardOutcome === 'challenge' ? { transaction_security: { url: CHALLENGE } } : {}) }
      : { id: 'pix', type: 'bank_transfer', qr_code: '00020126PIXCOPIAECOLA', qr_code_base64: 'iVBORw0KGgo' }
    const order = { id: `ORD-${body.external_reference}`, status, status_detail: detail, total_amount: body.total_amount, external_reference: body.external_reference, currency: 'BRL', transactions: { payments: [{ amount: body.total_amount, payment_method: method }] } }
    mpOrders.set(order.id, order)
    return reply(order, 201)
  }
  const id = decodeURIComponent(path.split('/').pop())
  return mpOrders.has(id) ? reply(mpOrders.get(id)) : reply({}, 404)
}

function build({ payments = true } = {}) {
  const mp = payments ? createMpClient({ accessToken: 'APP_USR-token', fetch: fakeMp }) : null
  handle = createLicenseHandler({ db, adminToken: 'adm', contactUrl: 'https://wa.me/5516992791692', mp, mpWebhookSecret: SECRET, mpPublicKey: payments ? 'APP_USR-chave-publica' : '' })
}

const lastOrderId = async () => (await db.prepare('SELECT id FROM orders ORDER BY rowid DESC').first()).id

/** O comprador pagou: a order fica creditada e o Mercado Pago avisa pelo webhook assinado. */
async function payAndNotify() {
  const orderId = await lastOrderId()
  Object.assign(mpOrders.get(`ORD-${orderId}`), { status: 'processed', status_detail: 'accredited' })
  const ts = '1793160000000'
  const v1 = createHmac('sha256', SECRET).update(`id:ord-${orderId.toLowerCase()};request-id:r1;ts:${ts};`).digest('hex')
  const res = await handle(
    new Request(`http://site.test/webhooks/mercadopago?data.id=ORD-${orderId}&type=order`, { method: 'POST', headers: { 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': 'r1' }, body: '{}' }),
    '9.9.9.9',
  )
  expect(res.status).toBe(200)
}

async function open(search) {
  const html = readFileSync(PAGE, 'utf8')
  document.body.innerHTML = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>')).replace(/<script[^>]*><\/script>/g, '')
  window.history.replaceState({}, '', `/pagar${search}`)
  vi.stubGlobal(
    'fetch',
    vi.fn((url, init = {}) => {
      if (init.method === 'POST') posted.push({ url: String(url), headers: init.headers || {}, body: JSON.parse(init.body) })
      return handle(new Request(new URL(String(url), 'http://site.test'), init), '1.2.3.4')
    }),
  )
  new Function(readFileSync('server/license/public/site/pagar.js', 'utf8'))()
  await vi.waitFor(() => expect($('pay-total').textContent).not.toBe(''))
}

async function tvCode() {
  const res = await handle(new Request('http://site.test/v1/access', { method: 'POST', body: JSON.stringify({ deviceKey: 'f'.repeat(64), platform: 'tizen', host: '' }) }), '1.2.3.4')
  return (await res.json()).code
}

beforeEach(async () => {
  db = openSqlite(':memory:')
  await migrate(db)
  mpOrders = new Map()
  posted = []
  cardOutcome = 'approved'
  cardFormOptions = null
  sessionStorage.clear()
  build()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('tela /pagar — Pix', () => {
  it('aparelho: total de R$ 25 acima do formulário, QR + copia-e-cola e, pago, a confirmação', async () => {
    const code = await tvCode()
    await open(`?tipo=aparelho&codigo=${code}`)
    expect($('pay-total').textContent).toMatch(/R\$\s?25,00/)
    expect($('pay-code').value).toBe(code)
    $('form-checkout__cardholderEmail').value = EMAIL
    $('pix-generate').click()
    await vi.waitFor(() => expect($('pix-result').hidden).toBe(false))
    expect($('pix-qr').getAttribute('src')).toBe('data:image/png;base64,iVBORw0KGgo')
    expect($('pix-code').value).toBe('00020126PIXCOPIAECOLA')
    expect(posted[0].body).toEqual({ kind: 'device_annual', method: 'pix', code, email: EMAIL })

    await payAndNotify()
    await vi.advanceTimersByTimeAsync(3000) // próxima consulta da tela
    await vi.waitFor(() => expect($('pay-done').hidden).toBe(false))
    expect($('done-text').textContent).toMatch(/ativado até/)
  })

  it('créditos pelo site: pede nome e contato; pago, mostra a chave do painel uma vez', async () => {
    await open('?tipo=creditos&qtd=20')
    expect($('pay-total').textContent).toMatch(/R\$\s?180,00/)
    $('form-checkout__cardholderEmail').value = EMAIL
    $('pix-generate').click()
    await vi.waitFor(() => expect($('result').textContent).toMatch(/nome/))
    expect(posted).toHaveLength(0)

    $('pay-name').value = 'Loja do Zé'
    $('pay-contact').value = '16 99999-0000'
    $('pix-generate').click()
    await vi.waitFor(() => expect($('pix-result').hidden).toBe(false))
    expect(posted[0].body).toEqual({ kind: 'credits', method: 'pix', quantity: 20, name: 'Loja do Zé', contact: '16 99999-0000', email: EMAIL })
    await payAndNotify()
    await vi.advanceTimersByTimeAsync(3000)
    await vi.waitFor(() => expect($('pay-done').hidden).toBe(false))
    expect($('done-key').textContent).toMatch(/pk_/)
  })

  it('painel da revenda: usa a chave da aba e compra pela API da revenda', async () => {
    const { id, key } = await createReseller(db, { name: 'Revenda', contact: 'x', now: Date.now() })
    sessionStorage.setItem('pulse-reseller-key', key)
    await open('?tipo=revenda&qtd=10')
    expect($('fields-buyer').hidden).toBe(true)
    $('form-checkout__cardholderEmail').value = EMAIL
    $('pix-generate').click()
    await vi.waitFor(() => expect($('pix-result').hidden).toBe(false))
    expect(posted[0].url).toBe('/api/v1/credits/checkout')
    expect(posted[0].headers.Authorization).toBe(`Bearer ${key}`)
    expect((await db.prepare('SELECT reseller_id FROM orders').first()).reseller_id).toBe(id)
  })

  it('pagamento desligado no servidor: aviso visível com o WhatsApp, sem formulário de pagamento', async () => {
    build({ payments: false })
    await open('?tipo=creditos&qtd=10')
    expect($('checkout-init-error').hidden).toBe(false)
    expect($('checkout-init-error').querySelector('a').href).toContain('https://wa.me/5516992791692')
    expect($('form-checkout').hidden).toBe(true)
  })
})

describe('tela /pagar — cartão', () => {
  /** SDK JS do Mercado Pago simulado: guarda as opções do cardForm e devolve o token. */
  async function openCard(search) {
    vi.stubGlobal(
      'MercadoPago',
      vi.fn(function () {
        this.cardForm = (options) => {
          cardFormOptions = options
          options.callbacks.onFormMounted()
          return { getCardFormData: () => ({ token: 'tok_0123456789abcdef', paymentMethodId: 'master', identificationNumber: '12345678909', cardholderEmail: EMAIL }) }
        }
      }),
    )
    await open(search)
    $('method-card').click()
    await vi.waitFor(() => expect(cardFormOptions).not.toBeNull())
  }

  async function submitCard() {
    $('form-checkout__cardholderEmail').value = EMAIL
    cardFormOptions.callbacks.onSubmit(new Event('submit', { cancelable: true }))
    await vi.waitFor(() => expect(posted).toHaveLength(1))
  }

  it('sem chave pública no servidor, o cartão mostra o motivo e o Pix continua disponível', async () => {
    handle = createLicenseHandler({ db, contactUrl: 'https://wa.me/5516992791692', mp: createMpClient({ accessToken: 'APP_USR-token', fetch: fakeMp }) })
    vi.stubGlobal('MercadoPago', vi.fn())
    await open('?tipo=creditos&qtd=10')
    $('method-card').click()
    await vi.waitFor(() => expect($('checkout-init-error').hidden).toBe(false))
    expect($('checkout-init-error').textContent).toMatch(/cartão indisponível/)
    expect(window.MercadoPago).not.toHaveBeenCalled()
    $('method-pix').click()
    expect($('pix-section').hidden).toBe(false)
  })

  it('monta o formulário seguro com a chave pública de /v1/mp-config e campos que existem na página', async () => {
    await openCard('?tipo=creditos&qtd=20')
    expect(window.MercadoPago).toHaveBeenCalledWith('APP_USR-chave-publica', { locale: 'pt-BR' })
    expect(cardFormOptions.amount).toBe('180.00')
    expect(cardFormOptions.form.id).toBe('form-checkout')
    for (const [name, field] of Object.entries(cardFormOptions.form)) {
      if (name !== 'id') expect(document.querySelectorAll(`#${field.id}`)).toHaveLength(1)
    }
    for (const field of ['issuer', 'installments', 'identificationType']) {
      const select = $(cardFormOptions.form[field].id)
      expect(select.tagName).toBe('SELECT')
      expect(select.hidden).toBe(true)
      expect(select.disabled).toBe(false)
    }
  })

  it('créditos pelo painel aprovados na hora: manda o token (nunca parcelas) e mostra a confirmação', async () => {
    sessionStorage.setItem('pulse-reseller-key', (await createReseller(db, { name: 'R', contact: 'x', now: Date.now() })).key)
    await openCard('?tipo=revenda&qtd=10')
    await submitCard()
    expect(posted[0].body).toEqual({ kind: 'credits', method: 'card', quantity: 10, email: EMAIL, card: { token: 'tok_0123456789abcdef', paymentMethodId: 'master', cpf: '12345678909' } })
    await vi.waitFor(() => expect($('pay-done').hidden).toBe(false))
    expect($('done-text').textContent).toMatch(/10 créditos/)
  })

  it('desafio 3DS: abre a página do banco e, quando ela termina, acompanha até a confirmação', async () => {
    cardOutcome = 'challenge'
    await openCard('?tipo=creditos&qtd=20')
    $('pay-name').value = 'Loja do Zé'
    $('pay-contact').value = '16 99999-0000'
    await submitCard()
    await vi.waitFor(() => expect($('challenge').hidden).toBe(false))
    expect($('challenge').getAttribute('src')).toBe(CHALLENGE)

    await payAndNotify()
    window.dispatchEvent(new MessageEvent('message', { data: { status: 'COMPLETE' } }))
    await vi.waitFor(() => expect($('pay-done').hidden).toBe(false))
    expect($('challenge').hidden).toBe(true)
  })

  it('aparelho no cartão: assinatura anual que renova sozinha; a TV libera em até 1 hora', async () => {
    const code = await tvCode()
    await openCard(`?tipo=aparelho&codigo=${code}`)
    expect($('card-note').textContent).toMatch(/renova sozinha todo ano/)
    await submitCard()
    expect(posted[0].body).toMatchObject({ kind: 'device_annual', method: 'card', code })
    await vi.waitFor(() => expect($('result').textContent).toMatch(/até 1 hora/))
  })
})
