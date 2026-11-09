/**
 * Relatórios só de leitura para o sócio (RFC-025 §7): `Authorization: Bearer <LICENSE_REPORT_TOKEN>`, só GET em
 * /api/v1/reports/*. Respondem números e datas; nunca código de aparelho, e-mail, nome de comprador ou chave.
 * Essa chave não vale no painel do dono nem na API das revendas.
 */
import { timingSafeEqualStr } from '../pair/pair-core.mjs'
import { ACTIVE_GAP_MS, cyclesUntil } from './license-rules.mjs'
import { hitLimit, lockedFor } from './license-db.mjs'
import { partnerMonthlyPrice } from './pricing.mjs'

export const REPORT_FAIL_LIMIT = 10
export const REPORT_FAIL_WINDOW_MS = 15 * 60 * 1000
export const REPORT_PER_HOUR = 60
const HOUR_MS = 60 * 60 * 1000
const PAGE = 50
const PAID = "('paid', 'delivering', 'delivered')"
// Brasil sem horário de verão desde 2019: o mês do relatório é o de Brasília (UTC-3).
const BRT_OFFSET_MS = 3 * HOUR_MS
const MONTH = /^(\d{4})-(\d{2})$/

/** Mês 'AAAA-MM' (padrão: o atual em Brasília) → [início, fim) em ms. null = inválido. */
export function monthRange(text, at) {
  const value = text || new Date(at - BRT_OFFSET_MS).toISOString().slice(0, 7)
  const m = MONTH.exec(value)
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return null
  const start = Date.UTC(Number(m[1]), Number(m[2]) - 1, 1) + BRT_OFFSET_MS
  const end = Date.UTC(Number(m[1]), Number(m[2]), 1) + BRT_OFFSET_MS
  return { month: value, start, end }
}

export function createReportRoutes({ db, now, json, reportToken = '' }) {
  async function summary(range, at) {
    const one = (sql, ...args) => db.prepare(sql).bind(...args).first()
    const active = await one('SELECT COUNT(DISTINCT device_key) AS n FROM activations WHERE revoked_at IS NULL AND ends_at > ?', at)
    const trials = await one(
      `SELECT COUNT(*) AS n FROM devices d WHERE d.trial_ends_at > ?
       AND NOT EXISTS (SELECT 1 FROM activations a WHERE a.device_key = d.device_key AND a.revoked_at IS NULL AND a.ends_at > ?)`,
      at,
      at,
    )
    const activations = await one('SELECT COUNT(*) AS n FROM activations WHERE starts_at >= ? AND starts_at < ?', range.start, range.end)
    const byKindRows = (
      await db
        .prepare(`SELECT kind, COUNT(*) AS n, COALESCE(SUM(amount_cents), 0) AS cents FROM orders WHERE status IN ${PAID} AND paid_at >= ? AND paid_at < ? GROUP BY kind`)
        .bind(range.start, range.end)
        .all()
    ).results
    const byKind = { device_annual: { orders: 0, cents: 0 }, credits: { orders: 0, cents: 0 } }
    for (const r of byKindRows) byKind[r.kind] = { orders: r.n, cents: r.cents }
    // Renovações do cartão não criam pedido: cada parcela entregue vale o preço contratado na adesão. A 1ª parcela é o
    // próprio pedido (mesmo instante do paid_at) e já está em byKind; parcela estornada fica de fora.
    const renewals = await one(
      `SELECT COUNT(*) AS n, COALESCE(SUM(o.amount_cents), 0) AS cents FROM mp_deliveries m JOIN orders o ON o.id = m.subscription_id
       WHERE m.mp_ref LIKE 'authorized_payment:%' AND m.delivered_at >= ? AND m.delivered_at < ? AND m.delivered_at <> o.paid_at
       AND NOT EXISTS (SELECT 1 FROM mp_deliveries r WHERE r.mp_ref = 'refund:' || m.mp_ref)`,
      range.start,
      range.end,
    )
    return {
      month: range.month,
      activeDevices: active.n,
      trials: trials.n,
      activations: activations.n,
      paidOrders: byKindRows.reduce((sum, r) => sum + r.n, 0),
      revenueCents: byKindRows.reduce((sum, r) => sum + r.cents, 0) + renewals.cents,
      renewals: { count: renewals.n, cents: renewals.cents },
      byKind,
    }
  }

  /** Parceiros e os ativos de cada ciclo mensal (mesma regra do painel), sem a lista de aparelhos. */
  async function partners(at) {
    const list = (await db.prepare('SELECT id, name, started_on, active FROM partners ORDER BY name').all()).results
    const counted = (
      await db.prepare('SELECT partner_id, cycle_start, COUNT(*) AS n FROM partner_cycle_entries WHERE last_at - first_at >= ? GROUP BY partner_id, cycle_start').bind(ACTIVE_GAP_MS).all()
    ).results
    const actives = new Map(counted.map((r) => [`${r.partner_id}|${r.cycle_start}`, r.n]))
    return list.map((p) => ({
      partnerId: p.id,
      name: p.name,
      active: !!p.active,
      cycles: cyclesUntil(p.started_on, at).map((c) => {
        const n = actives.get(`${p.id}|${c.start}`) || 0
        return { start: c.start, end: c.end, actives: n, monthlyCents: partnerMonthlyPrice(n) }
      }),
    }))
  }

  async function orders(range, before) {
    const sql = `SELECT rowid AS seq, id, created_at, paid_at, kind, method, quantity, amount_cents, status FROM orders
                 WHERE created_at >= ? AND created_at < ? ${before ? 'AND rowid < ?' : ''} ORDER BY rowid DESC LIMIT ?`
    const args = before ? [range.start, range.end, before, PAGE] : [range.start, range.end, PAGE]
    const rows = (await db.prepare(sql).bind(...args).all()).results
    return rows.map((r) => ({ seq: r.seq, id: r.id, createdAt: r.created_at, paidAt: r.paid_at ?? null, kind: r.kind, method: r.method, quantity: r.quantity, amountCents: r.amount_cents, status: r.status }))
  }

  return async function handleReports(request, url, ip) {
    if (!reportToken) return json(503, { error: 'Relatórios desligados: defina LICENSE_REPORT_TOKEN.' })
    const at = now()
    const failKey = { bucket: 'reportFail', key: ip, limit: REPORT_FAIL_LIMIT, windowMs: REPORT_FAIL_WINDOW_MS }
    const locked = await lockedFor(db, { ...failKey, now: at })
    if (locked) return json(429, { error: 'Muitas tentativas com chave inválida. Aguarde.' }, { 'Retry-After': String(locked) })
    if (!timingSafeEqualStr(request.headers.get('Authorization') || '', `Bearer ${reportToken}`)) {
      await hitLimit(db, { ...failKey, now: at })
      return json(401, { error: 'Chave inválida.' })
    }
    if (request.method !== 'GET') return json(405, { error: 'Esta chave é só de leitura.' }, { Allow: 'GET' })
    const wait = await hitLimit(db, { bucket: 'reportUse', key: 'report', limit: REPORT_PER_HOUR, windowMs: HOUR_MS, now: at })
    if (wait) return json(429, { error: 'Muitas chamadas. Aguarde um pouco.' }, { 'Retry-After': String(wait) })

    const path = url.pathname.slice('/api/v1/reports/'.length)
    if (path === 'partners') return json(200, await partners(at))
    if (path !== 'summary' && path !== 'orders') return json(404, { error: 'Não encontrado.' })
    const range = monthRange(url.searchParams.get('month'), at)
    if (!range) return json(400, { error: 'Mês inválido. Use AAAA-MM, por exemplo 2026-11.' })
    if (path === 'summary') return json(200, await summary(range, at))
    return json(200, await orders(range, Number(url.searchParams.get('before')) || null))
  }
}
