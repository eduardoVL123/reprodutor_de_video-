/**
 * Pagamento pelo Mercado Pago (RFC-020): pedido Pix pela API Orders, status pelo `viewSecret` e webhook assinado.
 * Preço só do servidor (R3/G19): do navegador vêm o tipo, o meio, o código ou a quantidade e o e-mail do pagador.
 * O e-mail vai direto ao Mercado Pago e não é guardado nem registrado em log (G17).
 * Entrega (G15/G16): só depois de assinatura válida + consulta da order na API + valor/moeda/referência conferidos;
 * quem muda o pedido para 'paid' (UPDATE condicional) é o único que entrega.
 */
import { readJsonBody } from '../pair/pair-core.mjs'
import { findDeviceByCode, activationEndsAt } from './license-db.mjs'
import { hashKey, createReseller } from './license-resellers.mjs'
import { DAY_MS, extendActivation } from './license-rules.mjs'
import { DEVICE_ANNUAL_PRICE, creditTotal } from './pricing.mjs'
import { MpError, toAmount } from './mp-client.mjs'

export const PIX_TTL_MS = 30 * 60 * 1000
const PIX_EXPIRATION = 'PT30M' // mesmo prazo de PIX_TTL_MS, em ISO 8601 (o Mercado Pago aceita de 30 min a 30 dias)
// O desafio 3DS vale 40 min a partir da criação; depois disso o pedido de cartão não paga mais.
export const CARD_TTL_MS = 45 * 60 * 1000
// Assinatura: a 1ª parcela sai em até ~1 h e, recusada, tem novas tentativas por 10 dias (documentação oficial).
export const FIRST_CHARGE_TTL_MS = 11 * DAY_MS
export const CHECKOUT_LIMITS = { checkout: 10, checkoutStatus: 60 }
const RECHECK_MS = 60 * 1000
const KINDS = ['device_annual', 'credits']
const METHODS = ['pix', 'card']
const EMAIL = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]+$/
const CARD_TOKEN = /^[A-Za-z0-9_-]{8,128}$/
const CARD_METHOD = /^[a-z_]{2,30}$/
const DECLINED = 'Pagamento recusado. Confira os dados do cartão ou use outro cartão.'
const MAX_NAME = 100
const MAX_CONTACT = 120
const STATUS_ROUTE = /^\/v1\/checkout\/([A-Za-z0-9_-]{22})$/
export const WEBHOOK_PATH = '/webhooks/mercadopago'

/**
 * CSP só da tela /pagar: o SDK JS do Mercado Pago (campos do cartão em iframe), o QR do Pix (data:) e o desafio 3DS
 * do banco. As outras páginas continuam com a PAGE_CSP fechada. 'unsafe-inline' em estilos: o SDK estiliza os campos.
 * 'unsafe-inline' em scripts (decisão do dono, 2026-10-28): o SDK injeta a identificação do aparelho (antifraude,
 * baixada de /v1/devices/widgets) como script embutido que muda a cada carga, então hash/nonce não servem. A página
 * não tem script embutido nosso e só escreve texto com textContent.
 * shortcut: domínios pelo curinga *.mercadopago.com(.br)/*.mlstatic.com; estreitar com a lista do teste manual.
 */
// *.mercadolivre.com(.br): a identificação do aparelho manda sinais (imagens) para www.mercadolivre.com (visto no navegador).
const MP_HOSTS =
  'https://*.mercadopago.com https://*.mercadopago.com.br https://*.mercadolibre.com https://*.mercadolivre.com https://*.mercadolivre.com.br https://*.mlstatic.com'
export const PAY_CSP = [
  "default-src 'none'",
  `script-src 'self' 'unsafe-inline' https://sdk.mercadopago.com ${MP_HOSTS}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: ${MP_HOSTS}`,
  `connect-src 'self' ${MP_HOSTS}`,
  `frame-src ${MP_HOSTS}`,
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ')
const DELIVERED_BY = 'mercadopago'

class CheckoutError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

function randomId(bytes) {
  const raw = crypto.getRandomValues(new Uint8Array(bytes))
  return btoa(String.fromCharCode(...raw)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const text = (value, max) => String(value == null ? '' : value).trim().slice(0, max)

async function hmacHex(secret, message) {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message))
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('')
}

function sameText(a, b) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/**
 * Assinatura `x-signature` do Mercado Pago: HMAC-SHA256 de `id:<data.id em minúsculas>;request-id:<x-request-id>;ts:<ts>;`
 * (partes ausentes saem do manifesto). Sem janela de `ts`: um reenvio legítimo pode chegar horas depois, e repetir uma
 * notificação válida não causa nada (a entrega consulta a API e é única).
 */
async function validSignature(request, url, secret) {
  const fields = {}
  for (const part of (request.headers.get('x-signature') || '').split(',')) {
    const eq = part.indexOf('=')
    if (eq > 0) fields[part.slice(0, eq).trim()] = part.slice(eq + 1).trim()
  }
  if (!fields.ts || !fields.v1) return false
  const dataId = (url.searchParams.get('data.id') || '').toLowerCase()
  const requestId = request.headers.get('x-request-id') || ''
  const parts = []
  if (dataId) parts.push(`id:${dataId}`)
  if (requestId) parts.push(`request-id:${requestId}`)
  parts.push(`ts:${fields.ts}`)
  return sameText(await hmacHex(secret, `${parts.join(';')};`), fields.v1.toLowerCase())
}

export function createCheckoutRoutes({ db, now, json, limiter, mp, webhookSecret = '' }) {
  function throttled(bucket, ip) {
    const wait = limiter.retryAfter(bucket, ip, CHECKOUT_LIMITS[bucket])
    if (wait) return json(429, { error: 'Muitas tentativas. Aguarde um pouco.' }, { 'Retry-After': String(wait) })
    limiter.add(bucket, ip)
    return null
  }

  /** Token do SDK JS, bandeira e CPF; parcelas e emissor do navegador são ignorados (G20). */
  function cardFrom(body) {
    const card = body.card && typeof body.card === 'object' ? body.card : {}
    const token = text(card.token, 128)
    const paymentMethodId = text(card.paymentMethodId, 30)
    const cpf = text(card.cpf, 20).replace(/\D/g, '')
    if (!CARD_TOKEN.test(token) || !CARD_METHOD.test(paymentMethodId) || cpf.length !== 11) {
      throw new CheckoutError(400, 'Confira os dados do cartão e o CPF do titular.')
    }
    return { token, paymentMethodId, cpf }
  }

  /** O quê e quanto, decidido aqui (R1/R2/R3); recusa antes de qualquer cobrança. `resellerId`: compra pelo painel. */
  async function describePurchase(body, resellerId) {
    if (!KINDS.includes(body.kind)) throw new CheckoutError(400, 'Escolha o que deseja comprar.')
    if (!METHODS.includes(body.method)) throw new CheckoutError(400, 'Meio de pagamento inválido.')
    const email = text(body.email, 254)
    if (!EMAIL.test(email)) throw new CheckoutError(400, 'Informe um e-mail válido.')
    const card = body.method === 'card' ? cardFrom(body) : null
    const base = { kind: body.kind, method: body.method, email, card }

    if (body.kind === 'device_annual') {
      const device = await findDeviceByCode(db, text(body.code, 16).toUpperCase())
      if (!device) throw new CheckoutError(404, 'Código não encontrado. Abra o Pulse Player na TV uma vez e tente de novo.')
      if (device.blocked_at) throw new CheckoutError(409, 'Este aparelho está suspenso. Fale com o suporte.')
      return { ...base, deviceCode: device.code, quantity: 1, amountCents: DEVICE_ANNUAL_PRICE }
    }
    const amountCents = creditTotal(body.quantity)
    if (amountCents === null) throw new CheckoutError(400, 'A compra mínima é de 10 créditos.')
    if (resellerId) return { ...base, resellerId, quantity: body.quantity, amountCents }
    const name = text(body.name, MAX_NAME)
    const contact = text(body.contact, MAX_CONTACT)
    if (!name || !contact) throw new CheckoutError(400, 'Informe seu nome e um contato.')
    return { ...base, name, contact, quantity: body.quantity, amountCents }
  }

  /** Corpo da order na API Orders (formatos conferidos na documentação oficial, RFC-020 §4). */
  function orderBody(purchase, orderId) {
    const amount = toAmount(purchase.amountCents)
    const common = { type: 'online', processing_mode: 'automatic', total_amount: amount, external_reference: orderId }
    if (purchase.method === 'pix') {
      return {
        ...common,
        payer: { email: purchase.email },
        transactions: { payments: [{ amount, payment_method: { id: 'pix', type: 'bank_transfer' }, expiration_time: PIX_EXPIRATION }] },
      }
    }
    const { token, paymentMethodId, cpf } = purchase.card
    return {
      ...common,
      payer: { email: purchase.email, identification: { type: 'CPF', number: cpf } },
      config: { online: { transaction_security: { validation: 'on_fraud_risk', liability_shift: 'required' } } },
      transactions: { payments: [{ amount, payment_method: { id: paymentMethodId, type: 'credit_card', token, installments: 1 } }] },
    }
  }

  /** Falha ao chamar o Mercado Pago na criação: pedido falho; cartão recusado (4xx) vira 402. Devolve o erro a lançar. */
  async function startFailed(orderId, err, method) {
    await db.prepare("UPDATE orders SET status = 'failed' WHERE id = ?").bind(orderId).run()
    if (!(err instanceof MpError)) return err
    console.warn(`[checkout] pedido ${orderId}: ${err.message}`)
    if (method === 'card' && err.status < 500) return new CheckoutError(402, DECLINED)
    return new CheckoutError(502, 'Não foi possível iniciar o pagamento agora. Tente de novo em instantes.')
  }

  /** Aparelho no cartão (R1): assinatura anual no Mercado Pago; cada parcela aprovada soma 1 ano (webhook). */
  async function subscribe(purchase, reply, origin) {
    let pre
    try {
      pre = await mp.createPreapproval({
        reason: 'Pulse Player — ativação anual',
        external_reference: reply.orderId,
        payer_email: purchase.email,
        card_token_id: purchase.card.token,
        auto_recurring: { frequency: 12, frequency_type: 'months', transaction_amount: DEVICE_ANNUAL_PRICE / 100, currency_id: 'BRL' },
        back_url: `${origin}/assinar`,
        status: 'authorized',
      })
    } catch (err) {
      throw await startFailed(reply.orderId, err, 'card')
    }
    const status = String(pre.status || 'pending')
    await db
      .prepare('INSERT INTO subscriptions (id, device_code, mp_preapproval_id, status, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(reply.orderId, purchase.deviceCode, String(pre.id), status, now())
      .run()
    return { ...reply, subscription: { status } }
  }

  /** Cria o pedido e a cobrança. Cartão: a order já volta aprovada, recusada ou pedindo o desafio 3DS. */
  async function start(body, { resellerId = null, origin = '' } = {}) {
    if (!mp) throw new CheckoutError(503, 'Pagamento indisponível no momento. Fale com o suporte pelo WhatsApp.')
    const purchase = await describePurchase(body, resellerId)
    const isSubscription = purchase.method === 'card' && purchase.kind === 'device_annual'
    const at = now()
    const orderId = randomId(16)
    const viewSecret = randomId(32)
    const expiresAt = at + (purchase.method === 'pix' ? PIX_TTL_MS : isSubscription ? FIRST_CHARGE_TTL_MS : CARD_TTL_MS)
    await db
      .prepare(
        `INSERT INTO orders (id, kind, method, device_code, reseller_id, buyer_name, buyer_contact, quantity, amount_cents, status,
         view_secret_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
      )
      .bind(orderId, purchase.kind, purchase.method, purchase.deviceCode || null, purchase.resellerId || null, purchase.name || null, purchase.contact || null, purchase.quantity, purchase.amountCents, await hashKey(viewSecret), at, expiresAt)
      .run()
    const reply = { orderId, viewSecret, status: 'pending', amountCents: purchase.amountCents, expiresAt }
    if (isSubscription) return subscribe(purchase, reply, origin)

    let order
    try {
      order = await mp.createOrder(orderBody(purchase, orderId), orderId)
    } catch (err) {
      throw await startFailed(orderId, err, purchase.method)
    }
    await db.prepare('UPDATE orders SET mp_order_id = ? WHERE id = ?').bind(String(order.id), orderId).run()

    const paymentMethod = (order.transactions && order.transactions.payments && order.transactions.payments[0] && order.transactions.payments[0].payment_method) || {}
    if (purchase.method === 'pix') {
      return { ...reply, pix: { qrCode: paymentMethod.qr_code || '', qrCodeBase64: paymentMethod.qr_code_base64 || '', ticketUrl: paymentMethod.ticket_url || '' } }
    }
    // A resposta da criação vem da própria API (com o nosso token): vale como a consulta da G15.
    await settle(order)
    const { status: current } = await db.prepare('SELECT status FROM orders WHERE id = ?').bind(orderId).first()
    if (current === 'failed') throw new CheckoutError(402, DECLINED)
    const challengeUrl = paymentMethod.transaction_security && paymentMethod.transaction_security.url
    return { ...reply, status: current, ...(current === 'pending' && challengeUrl ? { challengeUrl } : {}) }
  }

  /** Statements que entregam o pedido e o marcam como entregue, no mesmo batch (tudo ou nada). */
  async function deliveryStatements(row, at) {
    const delivered = (delivery) =>
      db.prepare("UPDATE orders SET status = 'delivered', delivery = ? WHERE id = ?").bind(JSON.stringify(delivery), row.id)

    if (row.kind === 'device_annual') {
      const device = await findDeviceByCode(db, row.device_code)
      if (!device) return null
      const endsAt = extendActivation(await activationEndsAt(db, device.device_key), at)
      return [
        db
          .prepare('INSERT INTO activations (device_key, starts_at, ends_at, source, note, created_by) VALUES (?, ?, ?, ?, ?, ?)')
          .bind(device.device_key, at, endsAt, 'purchase', row.id, DELIVERED_BY),
        delivered({ activationEndsAt: endsAt }),
      ]
    }

    // Primeira compra pelo site cria o revendedor (R2); o id fica no pedido antes, para um reprocesso não criar outro.
    let resellerKey = null
    let resellerId = row.reseller_id
    if (!resellerId) {
      const created = await createReseller(db, { name: row.buyer_name, contact: row.buyer_contact, now: at })
      resellerId = created.id
      resellerKey = created.key
      await db.prepare('UPDATE orders SET reseller_id = ? WHERE id = ?').bind(resellerId, row.id).run()
    }
    return [
      db.prepare('UPDATE resellers SET credits = credits + ? WHERE id = ?').bind(row.quantity, resellerId),
      db
        .prepare('INSERT INTO credit_movements (reseller_id, delta, kind, amount_cents, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(resellerId, row.quantity, 'purchase', row.amount_cents, `pedido ${row.id}`, DELIVERED_BY, at),
      // A chave aparece uma vez para quem tem o viewSecret (G18) e é apagada na primeira consulta.
      delivered({ credits: row.quantity, ...(resellerKey ? { resellerKey } : {}) }),
    ]
  }

  /** Consulta a order no Mercado Pago, confere e entrega uma única vez. Erro da API sobe (o webhook responde 500). */
  async function confirm(mpOrderId) {
    await settle(await mp.getOrder(mpOrderId))
  }

  /** Confere a order vinda da API: paga → entrega uma vez; recusada ou cancelada → pedido falho. */
  async function settle(order) {
    const row = await db.prepare('SELECT * FROM orders WHERE id = ?').bind(String(order.external_reference || '')).first()
    if (!row || row.mp_order_id !== String(order.id)) return
    if (order.status === 'failed' || order.status === 'canceled') {
      await db.prepare("UPDATE orders SET status = 'failed' WHERE id = ? AND status = 'pending'").bind(row.id).run()
      return
    }
    if (order.status !== 'processed' || order.status_detail !== 'accredited') return
    // A notificação traz `currency_id`; a order consultada traz `currency` (documentação oficial, 2026-10-28).
    if (order.total_amount !== toAmount(row.amount_cents) || (order.currency || order.currency_id) !== 'BRL') {
      console.warn(`[checkout] pedido ${row.id}: valor ou moeda não conferem; não entregue`)
      return
    }
    const at = now()
    // Pix pago no limite do prazo pode já estar 'expired' aqui; o Mercado Pago é quem diz se foi pago.
    const claim = await db
      .prepare("UPDATE orders SET status = 'paid', paid_at = ? WHERE id = ? AND status IN ('pending', 'expired')")
      .bind(at, row.id)
      .run()
    if (claim.meta.changes !== 1) return
    const statements = await deliveryStatements(row, at)
    if (!statements) {
      console.warn(`[checkout] pedido ${row.id}: pago, mas o aparelho não existe mais; fica 'paid' para o dono resolver`)
      return
    }
    await db.batch(statements)
  }

  /** Resultado da entrega para quem tem o viewSecret; a chave do revendedor novo sai na primeira vez e some. */
  async function publicResult(row) {
    if (row.status !== 'delivered' || !row.delivery) return undefined
    const delivery = JSON.parse(row.delivery)
    if (delivery.resellerKey) {
      const withoutKey = { ...delivery }
      delete withoutKey.resellerKey
      await db.prepare('UPDATE orders SET delivery = ? WHERE id = ?').bind(JSON.stringify(withoutKey), row.id).run()
    }
    return delivery
  }

  async function status(orderId, secret) {
    let row = await db.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId).first()
    if (!row || !secret || row.view_secret_hash !== (await hashKey(secret))) return null
    const at = now()
    // Webhook perdido: a consulta da tela pergunta ao Mercado Pago, no máximo uma vez por minuto por pedido.
    if (row.status === 'pending' && mp && row.mp_order_id && at - (row.checked_at || row.created_at) >= RECHECK_MS) {
      await db.prepare('UPDATE orders SET checked_at = ? WHERE id = ?').bind(at, orderId).run()
      try {
        await confirm(row.mp_order_id)
      } catch (err) {
        console.warn(`[checkout] pedido ${orderId}: consulta ao Mercado Pago falhou (${err.message})`)
      }
      row = await db.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId).first()
    }
    if (row.status === 'pending' && at >= row.expires_at) {
      await db.prepare("UPDATE orders SET status = 'expired' WHERE id = ? AND status = 'pending'").bind(orderId).run()
      row.status = 'expired'
    }
    const result = await publicResult(row)
    return { orderId, kind: row.kind, method: row.method, status: row.status, amountCents: row.amount_cents, expiresAt: row.expires_at, ...(result ? { result } : {}) }
  }

  async function findSubscription(preapprovalId) {
    return db.prepare('SELECT * FROM subscriptions WHERE mp_preapproval_id = ?').bind(String(preapprovalId)).first()
  }

  /** Situação da assinatura vinda da API; cancelada antes da 1ª parcela → pedido de adesão falho. */
  async function syncPreapproval(preapprovalId) {
    const pre = await mp.getPreapproval(preapprovalId)
    const sub = await findSubscription(pre.id)
    if (!sub) return
    const status = String(pre.status || sub.status)
    if (status !== 'cancelled') {
      await db.prepare('UPDATE subscriptions SET status = ? WHERE id = ?').bind(status, sub.id).run()
      return
    }
    await db.batch([
      db.prepare('UPDATE subscriptions SET status = ?, cancelled_at = COALESCE(cancelled_at, ?) WHERE id = ?').bind(status, now(), sub.id),
      db.prepare("UPDATE orders SET status = 'failed' WHERE id = ? AND status IN ('pending', 'expired')").bind(sub.id),
    ])
  }

  /**
   * Parcela da assinatura (G15/G16): consultada na API, aprovada, desta assinatura, R$ 25 em BRL → soma 1 ano.
   * `mp_deliveries` (chave = id da parcela) no mesmo batch garante uma entrega por parcela.
   */
  async function deliverInstallment(authorizedPaymentId) {
    const charge = await mp.getAuthorizedPayment(authorizedPaymentId)
    const sub = await findSubscription(charge.preapproval_id)
    if (!sub || !charge.payment || charge.payment.status !== 'approved') return
    if (Math.round(Number(charge.transaction_amount) * 100) !== DEVICE_ANNUAL_PRICE || charge.currency_id !== 'BRL') {
      console.warn(`[checkout] assinatura ${sub.id}: valor ou moeda da parcela não conferem; não entregue`)
      return
    }
    const ref = `authorized_payment:${charge.id}`
    if (await db.prepare('SELECT 1 FROM mp_deliveries WHERE mp_ref = ?').bind(ref).first()) return
    const device = await findDeviceByCode(db, sub.device_code)
    if (!device) {
      console.warn(`[checkout] assinatura ${sub.id}: parcela paga, mas o aparelho não existe mais`)
      return
    }
    const at = now()
    const endsAt = extendActivation(await activationEndsAt(db, device.device_key), at)
    try {
      await db.batch([
        db.prepare('INSERT INTO mp_deliveries (mp_ref, subscription_id, delivered_at) VALUES (?, ?, ?)').bind(ref, sub.id, at),
        db
          .prepare('INSERT INTO activations (device_key, starts_at, ends_at, source, note, created_by) VALUES (?, ?, ?, ?, ?, ?)')
          .bind(device.device_key, at, endsAt, 'subscription', sub.id, DELIVERED_BY),
        // 1ª parcela: o pedido de adesão vira entregue (as seguintes não mexem nele).
        db
          .prepare("UPDATE orders SET status = 'delivered', paid_at = ?, delivery = ? WHERE id = ? AND status IN ('pending', 'expired')")
          .bind(at, JSON.stringify({ activationEndsAt: endsAt }), sub.id),
      ])
    } catch (err) {
      if (/UNIQUE constraint/i.test(String(err && err.message))) return // a mesma parcela chegou junto: já entregue
      throw err
    }
  }

  const WEBHOOK_TOPICS = { order: confirm, subscription_preapproval: syncPreapproval, subscription_authorized_payment: deliverInstallment }

  async function webhook(request, url) {
    if (!mp || !webhookSecret) return json(503, { error: 'Pagamento indisponível.' })
    if (!(await validSignature(request, url, webhookSecret))) return json(401, { error: 'Assinatura inválida.' })
    const body = await readJsonBody(request, 16384).catch(() => ({}))
    const type = url.searchParams.get('type') || body.type
    const dataId = url.searchParams.get('data.id') || (body.data && body.data.id)
    const handler = Object.hasOwn(WEBHOOK_TOPICS, type) && WEBHOOK_TOPICS[type]
    if (!handler || !dataId) return json(200, { received: true })
    try {
      await handler(String(dataId))
    } catch (err) {
      console.warn(`[checkout] webhook ${type}: ${err.message}`)
      return json(500, { error: 'Tente de novo.' })
    }
    return json(200, { received: true })
  }

  /** Pedido para o painel do dono; a chave do revendedor novo nunca sai daqui (só para o comprador, G18). */
  function adminOrder(o) {
    const delivery = o.delivery ? JSON.parse(o.delivery) : null
    if (delivery) delete delivery.resellerKey
    return {
      id: o.id,
      kind: o.kind,
      method: o.method,
      status: o.status,
      amountCents: o.amount_cents,
      quantity: o.quantity,
      deviceCode: o.device_code,
      resellerId: o.reseller_id ?? null,
      buyerName: o.buyer_name,
      buyerContact: o.buyer_contact,
      mpOrderId: o.mp_order_id,
      createdAt: o.created_at,
      paidAt: o.paid_at ?? null,
      delivery,
    }
  }

  const ORDER_STATUSES = ['pending', 'paid', 'delivering', 'delivered', 'expired', 'failed']

  async function listOrders(status) {
    const rows = ORDER_STATUSES.includes(status)
      ? await db.prepare('SELECT * FROM orders WHERE status = ? ORDER BY created_at DESC, rowid DESC LIMIT 200').bind(status).all()
      : await db.prepare('SELECT * FROM orders ORDER BY created_at DESC, rowid DESC LIMIT 200').all()
    return rows.results.map(adminOrder)
  }

  /**
   * Painel do dono: pago sem entrega → entrega agora (uma vez: o status 'delivering' trava cliques juntos);
   * pendente → consulta o Mercado Pago (cobre webhook perdido). Entregue ou falho não se reprocessa.
   */
  async function reprocessOrder(id) {
    const find = () => db.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first()
    const row = await find()
    if (!row) throw new CheckoutError(404, 'Pedido não encontrado.')
    if (row.status === 'pending' || row.status === 'expired') {
      if (!mp || !row.mp_order_id) throw new CheckoutError(409, 'Este pedido não tem cobrança no Mercado Pago para consultar.')
      try {
        await confirm(row.mp_order_id)
      } catch (err) {
        if (!(err instanceof MpError)) throw err
        throw new CheckoutError(502, 'Não foi possível consultar o Mercado Pago agora. Tente de novo.')
      }
      return adminOrder(await find())
    }
    if (row.status !== 'paid') throw new CheckoutError(409, row.status === 'delivered' ? 'Este pedido já foi entregue.' : 'Este pedido não pode ser reprocessado.')
    const claim = await db.prepare("UPDATE orders SET status = 'delivering' WHERE id = ? AND status = 'paid'").bind(id).run()
    if (claim.meta.changes !== 1) throw new CheckoutError(409, 'Este pedido já está sendo entregue.')
    const release = () => db.prepare("UPDATE orders SET status = 'paid' WHERE id = ? AND status = 'delivering'").bind(id).run()
    try {
      const statements = await deliveryStatements(row, now())
      if (!statements) {
        await release()
        throw new CheckoutError(409, 'Pago, mas o aparelho não existe mais. Libere o novo aparelho do cliente na aba Aparelhos.')
      }
      await db.batch(statements)
    } catch (err) {
      if (!(err instanceof CheckoutError)) await release()
      throw err
    }
    return adminOrder(await find())
  }

  const publicSubscription = (s) => ({
    id: s.id,
    deviceCode: s.device_code,
    status: s.status,
    mpPreapprovalId: s.mp_preapproval_id,
    createdAt: s.created_at,
    cancelledAt: s.cancelled_at ?? null,
  })

  async function listSubscriptions() {
    const rows = await db.prepare('SELECT * FROM subscriptions ORDER BY created_at DESC LIMIT 200').all()
    return rows.results.map(publicSubscription)
  }

  /** Painel do dono: para a renovação no Mercado Pago (a ativação já paga continua valendo). */
  async function cancelSubscription(id) {
    const sub = await db.prepare('SELECT * FROM subscriptions WHERE id = ?').bind(id).first()
    if (!sub) throw new CheckoutError(404, 'Assinatura não encontrada.')
    if (sub.status !== 'cancelled') {
      if (!mp) throw new CheckoutError(503, 'Pagamento indisponível: defina MP_ACCESS_TOKEN.')
      try {
        await mp.cancelPreapproval(sub.mp_preapproval_id)
      } catch (err) {
        if (!(err instanceof MpError)) throw err
        throw new CheckoutError(502, 'Não foi possível cancelar no Mercado Pago agora. Tente de novo.')
      }
      await db.prepare("UPDATE subscriptions SET status = 'cancelled', cancelled_at = ? WHERE id = ?").bind(now(), id).run()
    }
    return publicSubscription(await db.prepare('SELECT * FROM subscriptions WHERE id = ?').bind(id).first())
  }

  async function handleCheckout(request, url, ip) {
    try {
      if (url.pathname === WEBHOOK_PATH) {
        return request.method === 'POST' ? await webhook(request, url) : json(404, { error: 'Não encontrado.' })
      }
      if (request.method === 'GET') {
        const match = url.pathname.match(STATUS_ROUTE)
        if (!match) return json(404, { error: 'Não encontrado.' })
        const limited = throttled('checkoutStatus', ip)
        if (limited) return limited
        const found = await status(match[1], url.searchParams.get('s'))
        return found ? json(200, found) : json(404, { error: 'Pedido não encontrado.' })
      }
      if (request.method !== 'POST' || url.pathname !== '/v1/checkout') return json(404, { error: 'Não encontrado.' })
      if (!mp) return json(503, { error: 'Pagamento indisponível no momento. Fale com o suporte pelo WhatsApp.' })
      const limited = throttled('checkout', ip)
      if (limited) return limited
      return json(201, await start(await readJsonBody(request, 4096), { origin: url.origin }))
    } catch (err) {
      return json(err.status || 500, { error: err.status ? err.message : 'Erro interno.' })
    }
  }

  // Compra de créditos pelo painel da revenda (license-api.mjs), já autenticada pela chave do revendedor.
  handleCheckout.startForReseller = (reseller, body) => start({ ...body, kind: 'credits' }, { resellerId: reseller.id })
  // Painel do dono (license-admin.mjs).
  handleCheckout.listSubscriptions = listSubscriptions
  handleCheckout.cancelSubscription = cancelSubscription
  handleCheckout.listOrders = listOrders
  handleCheckout.reprocessOrder = reprocessOrder
  return handleCheckout
}
