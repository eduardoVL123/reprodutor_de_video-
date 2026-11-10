/**
 * Assinatura anual no cartão (RFC-020): adesão, parcelas, estorno de parcela e cancelamento da renovação.
 * Saiu de license-checkout.mjs sem mudar a lógica.
 */
import { timingSafeEqualStr } from '../pair/pair-core.mjs'
import { findDeviceByCode, activationEndsAt, hitLimit, revokeActivationStatements } from './license-db.mjs'
import { extendActivation } from './license-rules.mjs'
import { DEVICE_ANNUAL_PRICE } from './pricing.mjs'
import { MpError } from './mp-client.mjs'
import { CheckoutError, ALREADY_RENEWING, REVERSED, DELIVERED_BY } from './license-checkout-shared.mjs'

/** `startFailed` e `declineChecks` vêm de license-checkout.mjs (falha na criação e freio de cartão recusado). */
export function createSubscriptionFlow({ db, now, mp, startFailed, declineChecks }) {
  /** Aparelho no cartão (R1): assinatura anual no Mercado Pago; cada parcela aprovada soma 1 ano (webhook). */
  async function subscribe(purchase, reply, origin) {
    // Reserva num comando só (vale entre Workers): dois pedidos juntos não criam duas assinaturas no Mercado Pago.
    const reserved = await db
      .prepare(
        `INSERT INTO subscriptions (id, device_code, mp_preapproval_id, status, created_at) SELECT ?, ?, ?, 'creating', ?
         WHERE NOT EXISTS (SELECT 1 FROM subscriptions WHERE device_code = ? AND status <> 'cancelled')`,
      )
      .bind(reply.orderId, purchase.deviceCode, `pending:${reply.orderId}`, now(), purchase.deviceCode)
      .run()
    if (!reserved.meta.changes) {
      await db.prepare("UPDATE orders SET status = 'failed' WHERE id = ?").bind(reply.orderId).run()
      throw new CheckoutError(409, ALREADY_RENEWING)
    }
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
      const failure = await startFailed(reply.orderId, err, 'card')
      // Recusa: nada nasceu lá, a reserva sai. Rede ou 5xx: fica (pode ter nascido) e o aviso do Mercado Pago a adota.
      if (failure.status === 402) {
        await db.prepare("DELETE FROM subscriptions WHERE id = ? AND status = 'creating'").bind(reply.orderId).run()
        // Só o freio da TV: aqui o 4xx não separa cartão recusado de token inventado, e esse não pode pausar o site (cardAll).
        await hitLimit(db, { ...declineChecks(purchase.deviceCode)[0], now: now() })
      }
      throw failure
    }
    const status = String(pre.status || 'pending')
    await db.prepare('UPDATE subscriptions SET mp_preapproval_id = ?, status = ? WHERE id = ?').bind(String(pre.id), status, reply.orderId).run()
    return { ...reply, subscription: { status } }
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
    // A reserva da adesão (subscribe) ganha o id de verdade; sem reserva, a linha é criada.
    await db.prepare("UPDATE subscriptions SET mp_preapproval_id = ?, status = ? WHERE id = ? AND status = 'creating'").bind(String(pre.id), String(pre.status || 'pending'), order.id).run()
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
    // Valor contratado na adesão (o pedido tem o mesmo id da assinatura), não o preço de hoje da tabela.
    const signup = await db.prepare('SELECT amount_cents FROM orders WHERE id = ?').bind(sub.id).first()
    const expected = signup ? signup.amount_cents : DEVICE_ANNUAL_PRICE
    if (Math.round(Number(charge.transaction_amount) * 100) !== expected || charge.currency_id !== 'BRL') {
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
        // Estorno da 1ª parcela (paga no mesmo instante do pedido de adesão): o pedido sai da receita, como no Pix.
        db
          .prepare("UPDATE orders SET status = 'refunded' WHERE id = ? AND status = 'delivered' AND paid_at = (SELECT delivered_at FROM mp_deliveries WHERE mp_ref = ?)")
          .bind(sub.id, `authorized_payment:${charge.id}`),
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

  const publicSubscription = (s) => ({
    id: s.id,
    deviceCode: s.device_code,
    status: s.status,
    mpPreapprovalId: s.mp_preapproval_id,
    createdAt: s.created_at,
    cancelledAt: s.cancelled_at ?? null,
  })

  /** Mais novas primeiro (200); com `device`, só as daquele código (a de uma TV antiga some das 200). */
  async function listSubscriptions(device = '') {
    const code = String(device || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
    const rows = code
      ? await db.prepare('SELECT * FROM subscriptions WHERE device_code = ? ORDER BY created_at DESC').bind(code).all()
      : await db.prepare('SELECT * FROM subscriptions ORDER BY created_at DESC LIMIT 200').all()
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

  return { subscribe, syncPreapproval, deliverInstallment, listSubscriptions, cancelSubscription, cancelForPayer }
}
