/**
 * Pedidos do pagamento (RFC-020): conferência da order do Mercado Pago, entrega única, estorno, consulta da tela
 * e as ações do painel do dono. Saiu de license-checkout.mjs sem mudar a lógica.
 */
import { findDeviceByCode, activationEndsAt, revokeActivationStatements } from './license-db.mjs'
import { hashKey, createReseller, rotateKey } from './license-resellers.mjs'
import { extendActivation } from './license-rules.mjs'
import { MpError } from './mp-client.mjs'
import { CheckoutError, REVERSED, DELIVERED_BY } from './license-checkout-shared.mjs'

const RECHECK_MS = 60 * 1000
const STUCK_DELIVERY_MS = 5 * 60 * 1000
// Plano B do webhook do estorno: cada pedido entregue é conferido a cada 6 h por 180 dias (prazo de contestação do
// cartão), no máximo 50 por rodada; os menos conferidos primeiro.
const REFUND_RECHECK_MS = 6 * 3600 * 1000
const REFUND_WINDOW_MS = 180 * 24 * 3600 * 1000
const REFUND_BATCH = 50
// A chave do revendedor novo fica visível para quem tem o viewSecret por 1 h (recarregar a tela não a perde);
// depois some da tela e o expurgo diário a apaga do banco (license-db.mjs, purgeExpired).
export const KEY_VISIBLE_MS = 60 * 60 * 1000

export function createOrderFlow({ db, now, mp }) {
  /** Statements que entregam o pedido e o marcam como entregue, no mesmo batch (tudo ou nada). */
  async function deliveryStatements(row, at) {
    const delivered = (delivery) =>
      db.prepare("UPDATE orders SET status = 'delivered', delivery = ? WHERE id = ?").bind(JSON.stringify(delivery), row.id)

    if (row.kind === 'device_annual') {
      const device = await findDeviceByCode(db, row.device_code)
      if (!device) return null
      // shortcut: dois pagamentos do MESMO aparelho entregues no mesmo instante (ou um Pix e uma ativação da revenda)
      // partem do mesmo fim e somam 1 ano só; raro, o dono vê no painel; resolver com o cálculo no SQL se aparecer.
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
    // Em centavos: "25.0" ou 25 no lugar de "25.00" é o mesmo valor pago.
    if (Math.round(Number(order.total_amount) * 100) !== row.amount_cents || (order.currency || order.currency_id) !== 'BRL') {
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
    if (row.status === 'refunded') return
    // Entrega em andamento: erro → webhook 500 → o Mercado Pago reenvia o estorno depois que a entrega terminar.
    if (row.status === 'delivering') throw new Error(`pedido ${row.id}: estorno chegou durante a entrega`)
    const claim = await db.prepare("UPDATE orders SET status = 'refunded' WHERE id = ? AND status = ?").bind(row.id, row.status).run()
    if (claim.meta.changes !== 1) throw new Error(`pedido ${row.id}: mudou de estado durante o estorno`)
    if (row.status !== 'delivered') return
    try {
      await undoDelivery(row)
    } catch (err) {
      // Sem desfazer, o pedido não pode ficar 'refunded': o reenvio do webhook tenta de novo com o saldo atual.
      await db.prepare("UPDATE orders SET status = ? WHERE id = ? AND status = 'refunded'").bind(row.status, row.id).run()
      throw err
    }
    console.warn(`[checkout] pedido ${row.id}: estornado no Mercado Pago (${reason}); entrega desfeita, confira no painel`)
  }

  async function undoDelivery(row) {
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
      // 'delivering' não: renovar checked_at aqui fecharia a própria trava de 5 min que a entrega usa para retomar.
      if (row.status !== 'delivering') await db.prepare('UPDATE orders SET checked_at = ? WHERE id = ?').bind(at, orderId).run()
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
   * pendente ou entregue → consulta o Mercado Pago (cobre webhook perdido, inclusive o do estorno). Falho não se
   * reprocessa.
   */
  async function reprocessOrder(id) {
    const find = () => db.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first()
    const row = await find()
    if (!row) throw new CheckoutError(404, 'Pedido não encontrado.')
    if (row.status === 'pending' || row.status === 'expired' || row.status === 'delivered') {
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
      throw new CheckoutError(409, 'Este pedido não pode ser reprocessado.')
    }
    // 'delivering' trava cliques juntos; se o servidor caiu no meio (marca com mais de 5 min), retoma a entrega.
    if (!(await deliver(row, now()))) throw new CheckoutError(409, 'Este pedido já está sendo entregue.')
    return adminOrder(await find())
  }

  /**
   * Estorno real de 2026-11-10 não chegou pelo webhook e o aparelho ficou liberado: a rotina periódica (cron do Worker)
   * pergunta ao Mercado Pago pelos pedidos entregues; `settle` desfaz a entrega se houve estorno ou contestação.
   * @returns {Promise<number>} quantos pedidos foram conferidos
   */
  async function recheckRefunds() {
    if (!mp) return 0
    const at = now()
    const rows = (
      await db
        .prepare(
          "SELECT id, mp_order_id FROM orders WHERE status = 'delivered' AND mp_order_id IS NOT NULL AND paid_at >= ? AND COALESCE(checked_at, 0) < ? ORDER BY COALESCE(checked_at, 0) LIMIT ?",
        )
        .bind(at - REFUND_WINDOW_MS, at - REFUND_RECHECK_MS, REFUND_BATCH)
        .all()
    ).results
    for (const row of rows) {
      await db.prepare('UPDATE orders SET checked_at = ? WHERE id = ?').bind(at, row.id).run()
      try {
        await confirm(row.mp_order_id)
      } catch (err) {
        console.warn(`[checkout] pedido ${row.id}: conferência de estorno falhou (${err.message}); tenta na próxima rodada`)
      }
    }
    return rows.length
  }

  return { settle, confirm, status, listOrders, reprocessOrder, recheckRefunds }
}
