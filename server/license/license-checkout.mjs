/**
 * Pagamento pelo Mercado Pago (RFC-020): pedido Pix pela API Orders, status pelo `viewSecret` e webhook assinado.
 * Preço só do servidor (R3/G19): do navegador vêm o tipo, o meio, o código ou a quantidade e o e-mail do pagador.
 * O e-mail vai direto ao Mercado Pago e não é guardado nem registrado em log (G17).
 * Entrega (G15/G16): só depois de assinatura válida + consulta da order na API + valor/moeda/referência conferidos;
 * quem muda o pedido para 'paid' (UPDATE condicional) é o único que entrega.
 */
import { readJsonBody, timingSafeEqualStr } from '../pair/pair-core.mjs'
import { findDeviceByCode, hitLimit, lockedFor } from './license-db.mjs'
import { hashKey, toBase64Url } from './license-resellers.mjs'
import { DAY_MS } from './license-rules.mjs'
import { DEVICE_ANNUAL_PRICE, MIN_CREDITS, MAX_CREDITS, creditTotal } from './pricing.mjs'
import { MpError, toAmount } from './mp-client.mjs'
import { CheckoutError, ALREADY_RENEWING } from './license-checkout-shared.mjs'
import { createOrderFlow } from './license-checkout-orders.mjs'
import { createSubscriptionFlow } from './license-checkout-subscriptions.mjs'

export { KEY_VISIBLE_MS } from './license-checkout-orders.mjs'

export const PIX_TTL_MS = 30 * 60 * 1000
const PIX_EXPIRATION = 'PT30M' // mesmo prazo de PIX_TTL_MS, em ISO 8601 (o Mercado Pago aceita de 30 min a 30 dias)
// O desafio 3DS vale 40 min a partir da criação; depois disso o pedido de cartão não paga mais.
export const CARD_TTL_MS = 45 * 60 * 1000
// Assinatura: a 1ª parcela sai em até ~1 h e, recusada, tem novas tentativas por 10 dias (documentação oficial).
export const FIRST_CHARGE_TTL_MS = 11 * DAY_MS
const STALE_RESERVE_MS = 10 * 60e3
export const CHECKOUT_LIMITS = { checkout: 10, checkoutStatus: 60 }
/**
 * Freio contra teste de cartões roubados (carding), no D1 para valer no serviço todo: por rede, por aparelho e um teto
 * geral de tentativas no cartão por hora. Estourar o teto geral pausa o cartão para todos (o Pix segue): é melhor
 * perder vendas por uma hora do que a conta do Mercado Pago ser bloqueada por estornos.
 */
export const CHECKOUT_DB_LIMITS = {
  perNetworkHour: 30,
  cardPerNetworkHour: 5,
  cardPerDeviceDay: 5,
  cardAllHour: 300,
}
const HOUR_MS = 60 * 60 * 1000
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

const randomId = (bytes) => toBase64Url(crypto.getRandomValues(new Uint8Array(bytes)))

const text = (value, max) => String(value == null ? '' : value).trim().slice(0, max)

async function hmacHex(secret, message) {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message))
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('')
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
  return timingSafeEqualStr(await hmacHex(secret, `${parts.join(';')};`), fields.v1.toLowerCase())
}

export function createCheckoutRoutes({ db, now, json, limiter, mp, webhookSecret = '', dbLimits = CHECKOUT_DB_LIMITS }) {
  /** Recusa (429) antes de criar o pedido se a rede, o aparelho ou o cartão em geral passaram do limite. */
  /**
   * Tetos que só contam cartão recusado de verdade (noteCardDecline): contar toda tentativa deixava qualquer um, com
   * tokens inventados, pausar o cartão do site inteiro (cardAll) ou de uma TV (cardDevice).
   */
  const declineChecks = (deviceCode) => [
    ...(deviceCode ? [{ bucket: 'cardDevice', key: deviceCode, limit: dbLimits.cardPerDeviceDay, windowMs: DAY_MS }] : []),
    { bucket: 'cardAll', key: '*', limit: dbLimits.cardAllHour, windowMs: HOUR_MS },
  ]

  async function guardCheckout(purchase, who) {
    const at = now()
    const checks = [{ bucket: 'checkout', key: who, limit: dbLimits.perNetworkHour, windowMs: HOUR_MS }]
    if (purchase.method === 'card') checks.push({ bucket: 'card', key: who, limit: dbLimits.cardPerNetworkHour, windowMs: HOUR_MS })
    for (const check of checks) {
      if (await hitLimit(db, { ...check, now: at })) throw new CheckoutError(429, 'Muitas tentativas. Aguarde um pouco.')
    }
    if (purchase.method !== 'card') return
    for (const check of declineChecks(purchase.deviceCode)) {
      if (await lockedFor(db, { ...check, now: at })) {
        if (check.bucket === 'cardAll') console.warn('[checkout] teto geral de cartões recusados atingido: possível teste de cartões')
        throw new CheckoutError(429, check.bucket === 'cardAll' ? 'Cartão indisponível no momento. Pague com Pix.' : 'Muitas tentativas. Aguarde um pouco.')
      }
    }
  }

  /** Cartão recusado pelo banco (a order nasceu e falhou): é o sinal de teste de cartões roubados. */
  async function noteCardDecline(deviceCode) {
    const at = now()
    for (const check of declineChecks(deviceCode)) await hitLimit(db, { ...check, now: at })
  }

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
    if (amountCents === null) throw new CheckoutError(400, `Compre de ${MIN_CREDITS} a ${MAX_CREDITS.toLocaleString('pt-BR')} créditos.`)
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
    // Só a recusa (4xx) garante que nada foi cobrado. Rede ou 5xx: o pedido fica pendente e o webhook decide.
    const refused = err instanceof MpError && err.status < 500
    if (refused) await db.prepare("UPDATE orders SET status = 'failed' WHERE id = ?").bind(orderId).run()
    console.warn(`[checkout] pedido ${orderId}: ${err.message}`)
    if (refused && method === 'card') return new CheckoutError(402, DECLINED)
    return new CheckoutError(502, 'Não foi possível iniciar o pagamento agora. Tente de novo em instantes.')
  }

  const { settle, confirm, status, listOrders, reprocessOrder, recheckRefunds } = createOrderFlow({ db, now, mp })
  const { subscribe, syncPreapproval, deliverInstallment, listSubscriptions, cancelSubscription, cancelForPayer } = createSubscriptionFlow({ db, now, mp, startFailed, declineChecks })

  /** Cria o pedido e a cobrança. Cartão: a order já volta aprovada, recusada ou pedindo o desafio 3DS. */
  async function start(body, { resellerId = null, origin = '', who = '' } = {}) {
    if (!mp) throw new CheckoutError(503, 'Pagamento indisponível no momento. Fale com o suporte pelo WhatsApp.')
    const purchase = await describePurchase(body, resellerId)
    const isSubscription = purchase.method === 'card' && purchase.kind === 'device_annual'
    // As parcelas da assinatura só chegam pelo webhook: sem o segredo dele, venderíamos sem conseguir entregar.
    if (isSubscription && !webhookSecret) throw new CheckoutError(503, 'Assinatura no cartão indisponível no momento. Pague com Pix.')
    // Reserva que o Mercado Pago nunca confirmou (o aviso dele chega em segundos): não prende o aparelho para sempre.
    if (isSubscription) {
      await db.prepare("DELETE FROM subscriptions WHERE device_code = ? AND status = 'creating' AND created_at < ?").bind(purchase.deviceCode, now() - STALE_RESERVE_MS).run()
    }
    // Duas renovações no mesmo aparelho cobrariam duas vezes por ano.
    if (isSubscription && (await db.prepare("SELECT 1 FROM subscriptions WHERE device_code = ? AND status <> 'cancelled'").bind(purchase.deviceCode).first())) {
      throw new CheckoutError(409, ALREADY_RENEWING)
    }
    await guardCheckout(purchase, who)
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
    if (current === 'failed') {
      await noteCardDecline(purchase.deviceCode)
      throw new CheckoutError(402, DECLINED)
    }
    const challengeUrl = paymentMethod.transaction_security && paymentMethod.transaction_security.url
    return { ...reply, status: current, ...(current === 'pending' && challengeUrl ? { challengeUrl } : {}) }
  }

  const WEBHOOK_TOPICS = { order: confirm, subscription_preapproval: syncPreapproval, subscription_authorized_payment: deliverInstallment }

  async function webhook(request, url) {
    if (!mp || !webhookSecret) return json(503, { error: 'Pagamento indisponível.' })
    if (!(await validSignature(request, url, webhookSecret))) {
      // Segredo errado no painel do Mercado Pago (teste x produção) também cai aqui: sem este aviso, o estorno some calado.
      console.warn(`[checkout] webhook recusado: assinatura não confere (tipo ${url.searchParams.get('type') || '-'}, id ${url.searchParams.get('data.id') || '-'})`)
      return json(401, { error: 'Assinatura inválida.' })
    }
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
      return json(201, await start(await readJsonBody(request, 4096), { origin: url.origin, who: ip }))
    } catch (err) {
      return json(err.status || 500, { error: err.status ? err.message : 'Erro interno.' })
    }
  }

  // Compra de créditos pelo painel da revenda (license-api.mjs), já autenticada pela chave do revendedor.
  handleCheckout.startForReseller = (reseller, body) => start({ ...body, kind: 'credits' }, { resellerId: reseller.id, who: `reseller:${reseller.id}` })
  // Painel do dono (license-admin.mjs).
  handleCheckout.listSubscriptions = listSubscriptions
  handleCheckout.cancelSubscription = cancelSubscription
  handleCheckout.listOrders = listOrders
  handleCheckout.reprocessOrder = reprocessOrder
  // Rotina periódica (worker.mjs, scheduled): estorno cujo webhook se perdeu.
  handleCheckout.recheckRefunds = recheckRefunds
  // Área do cliente (license-customer.mjs).
  handleCheckout.cancelForPayer = cancelForPayer
  return handleCheckout
}
