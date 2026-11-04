/**
 * Pagamento pelo Mercado Pago (RFC-020): pedido Pix pela API Orders, status pelo `viewSecret` e webhook assinado.
 * Preço só do servidor (R3/G19): do navegador vêm o tipo, o meio, o código ou a quantidade e o e-mail do pagador.
 * O e-mail vai direto ao Mercado Pago e não é guardado nem registrado em log (G17).
 * Entrega (G15/G16): só depois de assinatura válida + consulta da order na API + valor/moeda/referência conferidos;
 * quem muda o pedido para 'paid' (UPDATE condicional) é o único que entrega.
 */
import { readJsonBody, timingSafeEqualStr } from '../pair/pair-core.mjs'
import { findDeviceByCode, activationEndsAt, hitLimit, revokeActivationStatements } from './license-db.mjs'
import { hashKey, createReseller, rotateKey, toBase64Url } from './license-resellers.mjs'
import { DAY_MS, extendActivation } from './license-rules.mjs'
import { DEVICE_ANNUAL_PRICE, MIN_CREDITS, MAX_CREDITS, creditTotal } from './pricing.mjs'
import { MpError, toAmount } from './mp-client.mjs'

export const PIX_TTL_MS = 30 * 60 * 1000
const PIX_EXPIRATION = 'PT30M' // mesmo prazo de PIX_TTL_MS, em ISO 8601 (o Mercado Pago aceita de 30 min a 30 dias)
// O desafio 3DS vale 40 min a partir da criação; depois disso o pedido de cartão não paga mais.
export const CARD_TTL_MS = 45 * 60 * 1000
// Assinatura: a 1ª parcela sai em até ~1 h e, recusada, tem novas tentativas por 10 dias (documentação oficial).
export const FIRST_CHARGE_TTL_MS = 11 * DAY_MS
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
const RECHECK_MS = 60 * 1000
const STUCK_DELIVERY_MS = 5 * 60 * 1000
// A chave do revendedor novo fica visível para quem tem o viewSecret por 1 h (recarregar a tela não a perde);
// depois some da tela e o expurgo diário a apaga do banco (license-db.mjs, purgeExpired).
export const KEY_VISIBLE_MS = 60 * 60 * 1000
// Status de estorno do Mercado Pago (pedido, pagamento ou parcela). shortcut: confirmar os nomes na etapa 7 (teste).
const REVERSED = ['refunded', 'charged_back']
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

const randomId = (bytes) => toBase64Url(crypto.getRandomValues(new Uint8Array(bytes)))

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

export function createCheckoutRoutes({ db, now, json, limiter, mp, webhookSecret = '', dbLimits = CHECKOUT_DB_LIMITS }) {
  /** Recusa (429) antes de criar o pedido se a rede, o aparelho ou o cartão em geral passaram do limite. */
  async function guardCheckout(purchase, who) {
    const at = now()
    const checks = [{ bucket: 'checkout', key: who, limit: dbLimits.perNetworkHour, windowMs: HOUR_MS }]
    if (purchase.method === 'card') {
      checks.push({ bucket: 'card', key: who, limit: dbLimits.cardPerNetworkHour, windowMs: HOUR_MS })
      if (purchase.deviceCode) checks.push({ bucket: 'cardDevice', key: purchase.deviceCode, limit: dbLimits.cardPerDeviceDay, windowMs: DAY_MS })
      checks.push({ bucket: 'cardAll', key: '*', limit: dbLimits.cardAllHour, windowMs: HOUR_MS })
    }
    for (const check of checks) {
      if (await hitLimit(db, { ...check, now: at })) {
        if (check.bucket === 'cardAll') console.warn('[checkout] teto geral de tentativas no cartão atingido: possível teste de cartões')
        throw new CheckoutError(429, check.bucket === 'cardAll' ? 'Cartão indisponível no momento. Pague com Pix.' : 'Muitas tentativas. Aguarde um pouco.')
      }
    }
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
  async function start(body, { resellerId = null, origin = '', who = '' } = {}) {
    if (!mp) throw new CheckoutError(503, 'Pagamento indisponível no momento. Fale com o suporte pelo WhatsApp.')
    const purchase = await describePurchase(body, resellerId)
    const isSubscription = purchase.method === 'card' && purchase.kind === 'device_annual'
    // As parcelas da assinatura só chegam pelo webhook: sem o segredo dele, venderíamos sem conseguir entregar.
    if (isSubscription && !webhookSecret) throw new CheckoutError(503, 'Assinatura no cartão indisponível no momento. Pague com Pix.')
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
    // Compra pelo site = tem nome do comprador (a do painel já nasce com reseller_id e sem nome).
    let resellerKey = null
    let resellerId = row.reseller_id
    if (!resellerId) {
      const created = await createReseller(db, { name: row.buyer_name, contact: row.buyer_contact, now: at })
      resellerId = created.id
      resellerKey = created.key
      await db.prepare('UPDATE orders SET reseller_id = ? WHERE id = ?').bind(resellerId, row.id).run()
    } else if (row.buyer_name) {
      // Tentativa anterior criou o revendedor e caiu antes de entregar: a chave dele nunca saiu, então trocar é seguro.
      resellerKey = await rotateKey(db, resellerId)
    }
    return [
      db.prepare('UPDATE resellers SET credits = credits + ? WHERE id = ?').bind(row.quantity, resellerId),
      db
        .prepare('INSERT INTO credit_movements (reseller_id, delta, kind, amount_cents, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(resellerId, row.quantity, 'purchase', row.amount_cents, `pedido ${row.id}`, DELIVERED_BY, at),
      // A chave fica para quem tem o viewSecret (G18) só por KEY_VISIBLE_MS.
      delivered({ credits: row.quantity, ...(resellerKey ? { resellerKey, keyUntil: at + KEY_VISIBLE_MS } : {}) }),
    ]
  }

  /**
   * Trava o pedido em 'delivering' e entrega tudo ou nada. Se a entrega falhar, volta para 'paid', que o webhook
   * repetido, a consulta da tela e o Reprocessar retomam (antes, um pedido 'paid' ficava parado para sempre).
   * `fromPending`: o pagamento acabou de ser confirmado (pending/expired também valem). Devolve false se outro já entrega.
   */
  async function deliver(row, at, { fromPending = false, mpOrderId = null } = {}) {
    const from = fromPending ? "status IN ('pending', 'expired', 'paid')" : "status = 'paid'"
    const claim = await db
      .prepare(
        `UPDATE orders SET status = 'delivering', checked_at = ?, paid_at = COALESCE(paid_at, ?), mp_order_id = COALESCE(mp_order_id, ?)
         WHERE id = ? AND (${from} OR (status = 'delivering' AND COALESCE(checked_at, 0) < ?))`,
      )
      .bind(at, at, mpOrderId, row.id, at - STUCK_DELIVERY_MS)
      .run()
    if (claim.meta.changes !== 1) return false
    const release = () => db.prepare("UPDATE orders SET status = 'paid' WHERE id = ? AND status = 'delivering'").bind(row.id).run()
    let statements
    try {
      statements = await deliveryStatements(row, at)
      if (statements) await db.batch(statements)
    } catch (err) {
      await release()
      throw err
    }
    if (!statements) {
      await release()
      throw new CheckoutError(409, 'Pago, mas o aparelho não existe mais. Libere o novo aparelho do cliente na aba Aparelhos.')
    }
    return true
  }

  /** Consulta a order no Mercado Pago, confere e entrega uma única vez. Erro da API sobe (o webhook responde 500). */
  async function confirm(mpOrderId) {
    await settle(await mp.getOrder(mpOrderId))
  }

  /** Confere a order vinda da API: paga → entrega uma vez; recusada ou cancelada → pedido falho. */
  async function settle(order) {
    const row = await db.prepare('SELECT * FROM orders WHERE id = ?').bind(String(order.external_reference || '')).first()
    // Sem mp_order_id = a criação deu erro ambíguo (rede/5xx); a referência é nossa (só o nosso token cria orders).
    if (!row || (row.mp_order_id && row.mp_order_id !== String(order.id))) return
    if (REVERSED.includes(order.status) || REVERSED.includes(order.status_detail)) {
      await reverseOrder(row, `${order.status}/${order.status_detail}`)
      return
    }
    // Devolução de parte do valor (desconto, acerto): a entrega continua; o dono decide no painel.
    if (order.status === 'partially_refunded' || order.status_detail === 'partially_refunded') {
      console.warn(`[checkout] pedido ${row.id}: estorno parcial no Mercado Pago; entrega mantida, confira no painel`)
      return
    }
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
    // Pix pago no limite do prazo pode já estar 'expired' aqui; o Mercado Pago é quem diz se foi pago.
    try {
      await deliver(row, now(), { fromPending: true, mpOrderId: String(order.id) })
    } catch (err) {
      if (!(err instanceof CheckoutError)) throw err // banco falhou: 500, o Mercado Pago reenvia e a entrega é retomada
      console.warn(`[checkout] pedido ${row.id}: pago, mas o aparelho não existe mais; fica 'paid' para o dono resolver`)
    }
  }

  /**
   * Estorno ou contestação (Pix devolvido, chargeback): o pedido vira 'refunded' uma única vez e o que foi entregue
   * volta. Aparelho: a ativação deste pedido é revogada. Créditos: tira o que ainda houver; se a revenda já gastou,
   * ela é suspensa (active = 0) para o dono resolver, porque ativações feitas não voltam.
   */
  async function reverseOrder(row, reason) {
    const claim = await db.prepare("UPDATE orders SET status = 'refunded' WHERE id = ? AND status != 'refunded'").bind(row.id).run()
    if (claim.meta.changes !== 1 || row.status !== 'delivered') return
    const at = now()
    if (row.kind === 'device_annual') {
      const revoked = (await db.prepare("SELECT id, device_key FROM activations WHERE note = ? AND source = 'purchase' AND revoked_at IS NULL").bind(row.id).all()).results
      for (const key of new Set(revoked.map((r) => r.device_key))) {
        const ids = revoked.filter((r) => r.device_key === key).map((r) => r.id)
        await db.batch(await revokeActivationStatements(db, key, ids, at))
      }
    } else if (row.reseller_id) {
      const reseller = await db.prepare('SELECT credits FROM resellers WHERE id = ?').bind(row.reseller_id).first()
      const taken = Math.min(row.quantity, reseller ? reseller.credits : 0)
      const short = taken < row.quantity
      await db.batch([
        db.prepare('UPDATE resellers SET credits = credits - ?, active = CASE WHEN ? THEN 0 ELSE active END WHERE id = ?').bind(taken, short ? 1 : 0, row.reseller_id),
        db
          .prepare('INSERT INTO credit_movements (reseller_id, delta, kind, amount_cents, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .bind(row.reseller_id, -taken, 'refund', -row.amount_cents, `estorno do pedido ${row.id}`, DELIVERED_BY, at),
        // Créditos do estorno já repassados (auditoria RFC-025, item 2): suspende quem recebeu repasse desta revenda desde
        // o pagamento, e as revendas abaixo delas, para o dono resolver; senão os créditos estornados seguem gastáveis.
        ...(short
          ? [
              db
                .prepare(
                  `WITH RECURSIVE hit(id) AS (
                     SELECT counterpart_id FROM credit_movements
                     WHERE reseller_id = ? AND kind = 'transfer_out' AND counterpart_id IS NOT NULL AND created_at >= ?
                     UNION SELECT r.id FROM resellers r JOIN hit ON r.parent_id = hit.id)
                   UPDATE resellers SET active = 0 WHERE id IN (SELECT id FROM hit)`,
                )
                .bind(row.reseller_id, row.paid_at || row.created_at),
            ]
          : []),
      ])
    }
    console.warn(`[checkout] pedido ${row.id}: estornado no Mercado Pago (${reason}); entrega desfeita, confira no painel`)
  }

  /** Resultado da entrega para quem tem o viewSecret; a chave do revendedor novo aparece até `keyUntil` e depois some. */
  async function publicResult(row, at) {
    if (row.status !== 'delivered' || !row.delivery) return undefined
    const { keyUntil, ...delivery } = JSON.parse(row.delivery)
    if (delivery.resellerKey && !(at < keyUntil)) {
      delete delivery.resellerKey
      await db.prepare('UPDATE orders SET delivery = ? WHERE id = ?').bind(JSON.stringify(delivery), row.id).run()
    }
    return delivery
  }

  async function status(orderId, secret) {
    let row = await db.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId).first()
    if (!row || !secret || row.view_secret_hash !== (await hashKey(secret))) return null
    const at = now()
    // Webhook perdido ou entrega que caiu no meio ('paid', ou 'delivering' parado): a consulta da tela pergunta ao
    // Mercado Pago, no máximo uma vez por minuto por pedido, e retoma a entrega.
    const resumable = row.status === 'pending' || row.status === 'paid' || (row.status === 'delivering' && at - (row.checked_at || 0) >= STUCK_DELIVERY_MS)
    if (resumable && mp && row.mp_order_id && at - (row.checked_at || row.created_at) >= RECHECK_MS) {
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
    const result = await publicResult(row, at)
    return { orderId, kind: row.kind, method: row.method, status: row.status, amountCents: row.amount_cents, expiresAt: row.expires_at, ...(result ? { result } : {}) }
  }

  async function findSubscription(preapprovalId) {
    return db.prepare('SELECT * FROM subscriptions WHERE mp_preapproval_id = ?').bind(String(preapprovalId)).first()
  }

  /**
   * Assinatura que existe no Mercado Pago mas não aqui (a criação deu timeout/5xx ou o INSERT falhou depois): o
   * `external_reference` é o id do nosso pedido de adesão, então a linha é recriada a partir dele. Sem isso, o cartão
   * seria cobrado todo ano e nada seria entregue.
   */
  async function adoptPreapproval(pre) {
    const order = pre && pre.external_reference
      ? await db.prepare("SELECT * FROM orders WHERE id = ? AND kind = 'device_annual' AND method = 'card'").bind(String(pre.external_reference)).first()
      : null
    if (!order) return null
    await db
      .prepare('INSERT OR IGNORE INTO subscriptions (id, device_code, mp_preapproval_id, status, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(order.id, order.device_code, String(pre.id), String(pre.status || 'pending'), now())
      .run()
    console.warn(`[checkout] assinatura ${pre.id}: não estava registrada; recuperada pelo pedido ${order.id}`)
    return findSubscription(pre.id)
  }

  /** Situação da assinatura vinda da API; cancelada antes da 1ª parcela → pedido de adesão falho. */
  async function syncPreapproval(preapprovalId) {
    const pre = await mp.getPreapproval(preapprovalId)
    const sub = (await findSubscription(pre.id)) || (await adoptPreapproval(pre))
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
    let sub = await findSubscription(charge.preapproval_id)
    if (!sub && charge.preapproval_id) sub = await adoptPreapproval(await mp.getPreapproval(charge.preapproval_id))
    if (!sub || !charge.payment) return
    if (REVERSED.includes(charge.payment.status)) return reverseInstallment(sub, charge)
    if (charge.payment.status !== 'approved') return
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

  /**
   * Parcela estornada ou contestada: revoga o ano que ela entregou (uma vez, pela trava em mp_deliveries) e para a
   * renovação, para o cartão não ser cobrado de novo por um serviço contestado.
   */
  async function reverseInstallment(sub, charge) {
    const delivered = await db.prepare('SELECT 1 FROM mp_deliveries WHERE mp_ref = ?').bind(`authorized_payment:${charge.id}`).first()
    if (!delivered) return
    const at = now()
    const last = await db
      .prepare("SELECT id, device_key FROM activations WHERE note = ? AND source = 'subscription' AND revoked_at IS NULL ORDER BY id DESC LIMIT 1")
      .bind(sub.id)
      .first()
    try {
      await db.batch([
        db.prepare('INSERT INTO mp_deliveries (mp_ref, subscription_id, delivered_at) VALUES (?, ?, ?)').bind(`refund:authorized_payment:${charge.id}`, sub.id, at),
        // Revoga o ano da parcela e puxa para trás o que foi empilhado depois (auditoria RFC-025, item 1).
        ...(last ? await revokeActivationStatements(db, last.device_key, [last.id], at) : []),
      ])
    } catch (err) {
      if (/UNIQUE constraint/i.test(String(err && err.message))) return // estorno já tratado
      throw err
    }
    console.warn(`[checkout] assinatura ${sub.id}: parcela ${charge.id} estornada (${charge.payment.status}); ano revogado`)
    if (sub.status !== 'cancelled') await cancelSubscription(sub.id).catch((err) => console.warn(`[checkout] assinatura ${sub.id}: não cancelou a renovação (${err.message})`))
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
    if (delivery) {
      delete delivery.resellerKey
      delete delivery.keyUntil
    }
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

  const ORDER_STATUSES = ['pending', 'paid', 'delivering', 'delivered', 'expired', 'failed', 'refunded']

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
    if (row.status !== 'paid' && row.status !== 'delivering') {
      throw new CheckoutError(409, row.status === 'delivered' ? 'Este pedido já foi entregue.' : 'Este pedido não pode ser reprocessado.')
    }
    // 'delivering' trava cliques juntos; se o servidor caiu no meio (marca com mais de 5 min), retoma a entrega.
    if (!(await deliver(row, now()))) throw new CheckoutError(409, 'Este pedido já está sendo entregue.')
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
        // Já cancelada lá (pelo cliente ou pelo próprio Mercado Pago): o PUT é recusado; basta acertar aqui.
        const remote = await mp.getPreapproval(sub.mp_preapproval_id).catch(() => null)
        if (!remote || remote.status !== 'cancelled') {
          throw new CheckoutError(502, 'Não foi possível cancelar no Mercado Pago agora. Tente de novo.')
        }
      }
      await db.prepare("UPDATE subscriptions SET status = 'cancelled', cancelled_at = ? WHERE id = ?").bind(now(), id).run()
    }
    return publicSubscription(await db.prepare('SELECT * FROM subscriptions WHERE id = ?').bind(id).first())
  }

  /**
   * Cliente cancela a renovação pelo site (RFC-025 §3): prova de posse é o e-mail do pagamento, que o Mercado Pago
   * guarda na assinatura (payer_email). Cancela as renovações abertas do código cujo e-mail confere.
   * shortcut: confirmar no teste com a conta de teste do MP que GET /preapproval traz payer_email; se não vier,
   * guardar o hash do e-mail em subscriptions na criação (subscribe).
   */
  async function cancelForPayer(code, email) {
    const subs = (await db.prepare("SELECT * FROM subscriptions WHERE device_code = ? AND status <> 'cancelled'").bind(code).all()).results
    if (!subs.length) throw new CheckoutError(404, 'Este código não tem renovação automática.')
    if (!mp) throw new CheckoutError(503, 'Não foi possível cancelar agora. Fale com o suporte pelo WhatsApp.')
    const typed = String(email || '').trim().toLowerCase()
    let cancelled = 0
    for (const sub of subs) {
      let remote
      try {
        remote = await mp.getPreapproval(sub.mp_preapproval_id)
      } catch (err) {
        if (!(err instanceof MpError)) throw err
        throw new CheckoutError(502, 'Não foi possível consultar o pagamento agora. Tente de novo em instantes.')
      }
      const payer = String((remote && remote.payer_email) || '').trim().toLowerCase()
      if (!payer || !timingSafeEqualStr(payer, typed)) continue
      await cancelSubscription(sub.id)
      cancelled++
    }
    if (!cancelled) throw new CheckoutError(403, 'Este e-mail não é o do pagamento. Confira e tente de novo, ou fale com o suporte.')
    return { cancelled: true }
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
  // Área do cliente (license-customer.mjs).
  handleCheckout.cancelForPayer = cancelForPayer
  return handleCheckout
}
