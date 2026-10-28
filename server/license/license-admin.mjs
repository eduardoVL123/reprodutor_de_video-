/**
 * API do painel administrativo (RFC-018 §4): parceiros, relatório por ciclo e aparelhos.
 * Só com `Authorization: Bearer <LICENSE_ADMIN_TOKEN>`; sem token configurado o painel fica fechado.
 */
import { timingSafeEqualStr, readJsonBody } from '../pair/pair-core.mjs'
import { cyclesUntil, isActive, normalizeHost, extendActivation, ACTIVE_GAP_MS, DAY_MS } from './license-rules.mjs'
import { findDeviceByCode, activationEndsAt } from './license-db.mjs'
import { creditTotal, partnerMonthlyPrice } from './pricing.mjs'
import {
  publicReseller,
  findReseller,
  createReseller,
  rotateKey,
  adjustCredits,
  movements,
  validAmount,
} from './license-resellers.mjs'

const DATE = /^\d{4}-\d{2}-\d{2}$/
const MAX_NAME = 100

class AdminError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

async function partnerList(db) {
  const partners = (await db.prepare('SELECT * FROM partners ORDER BY name').all()).results
  const hosts = (await db.prepare('SELECT * FROM partner_hosts ORDER BY host').all()).results
  return partners.map((p) => ({
    id: p.id,
    name: p.name,
    startedOn: p.started_on,
    active: !!p.active,
    hosts: hosts.filter((h) => h.partner_id === p.id).map((h) => h.host),
  }))
}

function validPartner(body) {
  const name = String(body.name || '').trim()
  const hosts = [...new Set((Array.isArray(body.hosts) ? body.hosts : []).map(normalizeHost).filter(Boolean))]
  if (!name || name.length > MAX_NAME) throw new AdminError(400, 'Nome inválido.')
  if (!DATE.test(String(body.startedOn || '')) || isNaN(Date.parse(body.startedOn))) throw new AdminError(400, 'Data inválida.')
  if (!hosts.length) throw new AdminError(400, 'Informe ao menos um domínio válido.')
  return { name, startedOn: body.startedOn, active: body.active === false ? 0 : 1, hosts }
}

async function savePartner(db, id, partner) {
  for (const host of partner.hosts) {
    const owner = await db.prepare('SELECT partner_id FROM partner_hosts WHERE host = ?').bind(host).first()
    if (owner && owner.partner_id !== id) throw new AdminError(409, `O domínio ${host} já é de outro parceiro.`)
  }
  if (id === null) {
    const r = await db.prepare('INSERT INTO partners (name, started_on, active) VALUES (?, ?, ?)').bind(partner.name, partner.startedOn, partner.active).run()
    id = r.meta.last_row_id
  } else {
    await db.prepare('UPDATE partners SET name = ?, started_on = ?, active = ? WHERE id = ?').bind(partner.name, partner.startedOn, partner.active, id).run()
  }
  // Primeiro entram os domínios novos e só depois saem os que sumiram: uma falha no meio deixa domínios a mais,
  // nunca um parceiro sem domínio (seus aparelhos seriam bloqueados depois do teste).
  for (const host of partner.hosts) {
    await db.prepare('INSERT OR IGNORE INTO partner_hosts (host, partner_id) VALUES (?, ?)').bind(host, id).run()
  }
  const marks = partner.hosts.map(() => '?').join(', ')
  await db.prepare(`DELETE FROM partner_hosts WHERE partner_id = ? AND host NOT IN (${marks})`).bind(id, ...partner.hosts).run()
  return id
}

async function findPartner(db, id) {
  const partner = await db.prepare('SELECT * FROM partners WHERE id = ?').bind(id).first()
  if (!partner) throw new AdminError(404, 'Parceiro não encontrado.')
  return partner
}

/** Aparelhos do ciclo com a regra do ativo aplicada (o ativo nunca é guardado: regra muda, número muda junto). */
async function cycleDevices(db, partnerId, cycleStart) {
  const rows = (
    await db
      .prepare(
        `SELECT d.code, e.first_at, e.last_at FROM partner_cycle_entries e JOIN devices d ON d.device_key = e.device_key
         WHERE e.partner_id = ? AND e.cycle_start = ? ORDER BY d.code`,
      )
      .bind(partnerId, cycleStart)
      .all()
  ).results
  return rows.map((r) => ({ code: r.code, firstAt: r.first_at, lastAt: r.last_at, active: isActive({ firstAt: r.first_at, lastAt: r.last_at }) }))
}

const isoTime = (ms) => new Date(ms).toISOString()

function toCsv(devices) {
  const lines = devices.map((d) => [d.code, isoTime(d.firstAt), isoTime(d.lastAt), d.active ? 'sim' : 'nao'].join(';'))
  return ['codigo;primeira_entrada;ultima_entrada;ativo', ...lines].join('\n') + '\n'
}

async function deviceInfo(db, code) {
  const device = await findDeviceByCode(db, code)
  if (!device) throw new AdminError(404, 'Aparelho não encontrado.')
  const activations = (
    await db.prepare('SELECT * FROM activations WHERE device_key = ? ORDER BY id').bind(device.device_key).all()
  ).results.map((a) => ({ startsAt: a.starts_at, endsAt: a.ends_at, source: a.source, note: a.note, revokedAt: a.revoked_at, resellerId: a.reseller_id ?? null }))
  const events = (
    await db.prepare('SELECT * FROM device_events WHERE device_key = ? ORDER BY id DESC LIMIT 50').bind(device.device_key).all()
  ).results.map((e) => ({ action: e.action, detail: e.detail || '', actor: e.actor, at: e.created_at }))
  return {
    device,
    info: {
      code: device.code,
      platform: device.platform,
      firstSeenAt: device.first_seen_at,
      trialEndsAt: device.trial_ends_at,
      activationEndsAt: await activationEndsAt(db, device.device_key),
      blockedAt: device.blocked_at ?? null,
      note: device.note || '',
      activations,
      events,
    },
  }
}

const logEvent = (db, deviceKey, action, detail, at) =>
  db.prepare('INSERT INTO device_events (device_key, action, detail, actor, created_at) VALUES (?, ?, ?, ?, ?)').bind(deviceKey, action, detail || null, 'admin', at).run()

const PERIOD_MONTHS = { '1m': 1, '3m': 3, '1y': 12 }

/** Fim da liberação pedida no painel: período (1m/3m/1y, padrão 1 ano) ou até o fim de um dia (Brasília). */
function releaseEnd(body, currentEnd, at) {
  if (body.until != null) {
    const end = Date.parse(`${body.until}T23:59:59-03:00`)
    if (!DATE.test(String(body.until)) || isNaN(end) || end <= at) throw new AdminError(400, 'Data inválida: use uma data futura.')
    return end
  }
  const months = PERIOD_MONTHS[body.period || '1y']
  if (!months) throw new AdminError(400, 'Período inválido: use 1 mês, 3 meses ou 1 ano.')
  return extendActivation(currentEnd, at, months)
}

const DEVICE_STATUS_SQL = `CASE
  WHEN d.blocked_at IS NOT NULL THEN 'blocked'
  WHEN act_end > :now THEN 'activated'
  WHEN d.trial_ends_at > :now THEN 'trial'
  ELSE 'expired' END`
const DEVICE_STATUSES = ['trial', 'activated', 'blocked', 'expired']
const DEVICE_PAGE = 50

/** Lista do painel com a situação de cada aparelho; filtro por situação e busca no código ou na observação. */
async function listDevices(db, url, at) {
  const status = url.searchParams.get('status')
  const q = String(url.searchParams.get('q') || '').trim().toLowerCase()
  const page = Math.max(0, Number(url.searchParams.get('page')) || 0)
  const where = []
  const args = [at, at]
  if (DEVICE_STATUSES.includes(status)) {
    where.push('status = ?')
    args.push(status)
  }
  if (q) {
    where.push("(LOWER(code) LIKE ? OR LOWER(COALESCE(note, '')) LIKE ?)")
    args.push(`%${q}%`, `%${q}%`)
  }
  const sql = `SELECT * FROM (
      SELECT d.code, d.platform, d.first_seen_at, d.trial_ends_at, d.blocked_at, d.note, act_end,
             ${DEVICE_STATUS_SQL.split(':now').join('?')} AS status
      FROM (SELECT d.*, (SELECT MAX(ends_at) FROM activations a WHERE a.device_key = d.device_key AND a.revoked_at IS NULL) AS act_end
            FROM devices d) d
    ) ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY first_seen_at DESC, code LIMIT ? OFFSET ?`
  const rows = (await db.prepare(sql).bind(...args, DEVICE_PAGE + 1, page * DEVICE_PAGE).all()).results
  return {
    items: rows.slice(0, DEVICE_PAGE).map((r) => ({
      code: r.code,
      platform: r.platform,
      status: r.status,
      firstSeenAt: r.first_seen_at,
      trialEndsAt: r.trial_ends_at,
      activationEndsAt: r.act_end ?? null,
      note: r.note || '',
    })),
    nextPage: rows.length > DEVICE_PAGE ? page + 1 : null,
  }
}

/** Valor do mês do parceiro pela tabela (RFC-019 R5); null = sob consulta. */
const withAmount = (cycle) => ({ ...cycle, amountCents: partnerMonthlyPrice(cycle.actives) })

const CREDIT_KINDS = ['purchase', 'grant', 'refund']

/** Lançamento do dono: compra usa o valor informado ou a tabela (R1); cortesia e estorno não têm valor. */
function creditEntry(body) {
  const amount = validAmount(body.amount)
  if (!CREDIT_KINDS.includes(body.kind)) throw new AdminError(400, 'Tipo inválido: use compra, cortesia ou estorno.')
  let amountCents = null
  if (body.kind === 'purchase') {
    amountCents = Number.isInteger(body.amountCents) && body.amountCents >= 0 ? body.amountCents : creditTotal(amount)
    if (amountCents === null) throw new AdminError(400, 'Compra abaixo de 10 créditos: informe o valor pago.')
  }
  return { amount, kind: body.kind, amountCents, note: body.note }
}

/** Devolve `handleAdmin(request, url) -> Response`, usando `json(status, body)` do núcleo. */
export function createAdminRoutes({ db, now, adminToken, json }) {
  const routes = [
    [
      'GET',
      /^\/admin\/api\/resellers$/,
      async () => json(200, (await db.prepare('SELECT * FROM resellers ORDER BY name').all()).results.map(publicReseller)),
    ],
    [
      'POST',
      /^\/admin\/api\/resellers$/,
      async (_m, body) => {
        const parentId = body.parentId == null ? null : (await findReseller(db, Number(body.parentId))).id
        return json(201, await createReseller(db, { name: body.name, contact: body.contact, parentId, now: now() }))
      },
    ],
    [
      'POST',
      /^\/admin\/api\/resellers\/(\d+)\/credits$/,
      async (m, body) => {
        const reseller = await findReseller(db, Number(m[1]))
        const entry = creditEntry(body)
        return json(200, publicReseller(await adjustCredits(db, { resellerId: reseller.id, ...entry, createdBy: 'admin', now: now() })))
      },
    ],
    [
      'POST',
      /^\/admin\/api\/resellers\/(\d+)\/active$/,
      async (m, body) => {
        const reseller = await findReseller(db, Number(m[1]))
        await db.prepare('UPDATE resellers SET active = ? WHERE id = ?').bind(body.active === false ? 0 : 1, reseller.id).run()
        return json(200, publicReseller(await findReseller(db, reseller.id)))
      },
    ],
    [
      'POST',
      /^\/admin\/api\/resellers\/(\d+)\/key$/,
      async (m) => json(200, { key: await rotateKey(db, (await findReseller(db, Number(m[1]))).id) }),
    ],
    [
      'GET',
      /^\/admin\/api\/resellers\/(\d+)\/movements$/,
      async (m, _b, url) => {
        const reseller = await findReseller(db, Number(m[1]))
        return json(200, await movements(db, reseller.id, { before: Number(url.searchParams.get('before')) || null }))
      },
    ],
    ['GET', /^\/admin\/api\/partners$/, async () => json(200, await partnerList(db))],
    ['POST', /^\/admin\/api\/partners$/, async (_m, body) => json(201, { id: await savePartner(db, null, validPartner(body)) })],
    [
      'PUT',
      /^\/admin\/api\/partners\/(\d+)$/,
      async (m, body) => {
        const current = await findPartner(db, Number(m[1]))
        const partner = validPartner(body)
        if (partner.startedOn !== current.started_on) {
          // As entradas guardam o início do ciclo: outra data esconderia os ciclos já contados (e cobrados).
          const used = await db.prepare('SELECT 1 FROM partner_cycle_entries WHERE partner_id = ? LIMIT 1').bind(current.id).first()
          if (used) throw new AdminError(409, 'Este parceiro já tem entradas: a data da parceria não pode mudar.')
        }
        await savePartner(db, Number(m[1]), partner)
        return json(200, { id: Number(m[1]) })
      },
    ],
    [
      'GET',
      /^\/admin\/api\/partners\/(\d+)\/cycles$/,
      async (m) => {
        const partner = await findPartner(db, Number(m[1]))
        // Uma consulta para todos os ciclos; a regra do ativo é a mesma de isActive (ACTIVE_GAP_MS).
        const counted = (
          await db
            .prepare(
              `SELECT cycle_start, COUNT(*) AS n FROM partner_cycle_entries
               WHERE partner_id = ? AND last_at - first_at >= ? GROUP BY cycle_start`,
            )
            .bind(partner.id, ACTIVE_GAP_MS)
            .all()
        ).results
        const actives = new Map(counted.map((r) => [r.cycle_start, r.n]))
        return json(200, cyclesUntil(partner.started_on, now()).map((c) => withAmount({ ...c, actives: actives.get(c.start) || 0 })))
      },
    ],
    [
      'GET',
      /^\/admin\/api\/partners\/(\d+)\/cycles\/(\d+)$/,
      async (m, _b, url) => {
        const partner = await findPartner(db, Number(m[1]))
        const cycle = cyclesUntil(partner.started_on, now())[Number(m[2])]
        if (!cycle) throw new AdminError(404, 'Ciclo não encontrado.')
        const devices = await cycleDevices(db, partner.id, cycle.start)
        if (url.searchParams.get('format') === 'csv') {
          return new Response(toCsv(devices), {
            status: 200,
            headers: {
              'Content-Type': 'text/csv; charset=utf-8',
              'Content-Disposition': `attachment; filename="ativos-${partner.id}-${cycle.start}.csv"`,
              'Cache-Control': 'no-store',
            },
          })
        }
        return json(200, { ...withAmount({ ...cycle, actives: devices.filter((d) => d.active).length }), devices })
      },
    ],
    ['GET', /^\/admin\/api\/devices$/, async (_m, _b, url) => json(200, await listDevices(db, url, now()))],
    ['GET', /^\/admin\/api\/devices\/([A-Z0-9]{4,16})$/, async (m) => json(200, (await deviceInfo(db, m[1])).info)],
    [
      'POST',
      /^\/admin\/api\/devices\/([A-Z0-9]{4,16})\/activate$/,
      async (m, body) => {
        const { device, info } = await deviceInfo(db, m[1])
        const at = now()
        const end = releaseEnd(body, info.activationEndsAt, at)
        const note = String(body.note || '').slice(0, 200) || null
        await db
          .prepare('INSERT INTO activations (device_key, starts_at, ends_at, source, note, created_by) VALUES (?, ?, ?, ?, ?, ?)')
          .bind(device.device_key, at, end, 'manual', note, 'admin')
          .run()
        await logEvent(db, device.device_key, 'activate', `até ${new Date(end).toISOString()}${note ? ` · ${note}` : ''}`, at)
        return json(200, (await deviceInfo(db, m[1])).info)
      },
    ],
    [
      'POST',
      /^\/admin\/api\/devices\/([A-Z0-9]{4,16})\/revoke$/,
      async (m) => {
        const { device } = await deviceInfo(db, m[1])
        const at = now()
        await db.prepare('UPDATE activations SET revoked_at = ? WHERE device_key = ? AND revoked_at IS NULL').bind(at, device.device_key).run()
        await logEvent(db, device.device_key, 'revoke', '', at)
        return json(200, (await deviceInfo(db, m[1])).info)
      },
    ],
    [
      'POST',
      /^\/admin\/api\/devices\/([A-Z0-9]{4,16})\/(block|unblock)$/,
      async (m) => {
        const { device } = await deviceInfo(db, m[1])
        const at = now()
        await db.prepare('UPDATE devices SET blocked_at = ? WHERE device_key = ?').bind(m[2] === 'block' ? at : null, device.device_key).run()
        await logEvent(db, device.device_key, m[2], '', at)
        return json(200, (await deviceInfo(db, m[1])).info)
      },
    ],
    [
      'POST',
      /^\/admin\/api\/devices\/([A-Z0-9]{4,16})\/trial$/,
      async (m, body) => {
        const { device } = await deviceInfo(db, m[1])
        if (!Number.isInteger(body.days) || body.days < 1 || body.days > 365) throw new AdminError(400, 'Dias inválidos: de 1 a 365.')
        const at = now()
        const end = Math.max(at, device.trial_ends_at) + body.days * DAY_MS
        await db.prepare('UPDATE devices SET trial_ends_at = ? WHERE device_key = ?').bind(end, device.device_key).run()
        await logEvent(db, device.device_key, 'trial', `+${body.days} dias`, at)
        return json(200, (await deviceInfo(db, m[1])).info)
      },
    ],
    [
      'POST',
      /^\/admin\/api\/devices\/([A-Z0-9]{4,16})\/note$/,
      async (m, body) => {
        const { device } = await deviceInfo(db, m[1])
        await db.prepare('UPDATE devices SET note = ? WHERE device_key = ?').bind(String(body.note || '').trim().slice(0, 200) || null, device.device_key).run()
        return json(200, (await deviceInfo(db, m[1])).info)
      },
    ],
    [
      'DELETE',
      /^\/admin\/api\/devices\/([A-Z0-9]{4,16})$/,
      async (m) => {
        // Pedido de LGPD: some tudo do aparelho; se o app abrir de novo, ele volta como aparelho novo (com teste).
        const { device } = await deviceInfo(db, m[1])
        await db.batch(
          ['partner_cycle_entries', 'activations', 'device_events', 'devices'].map((table) =>
            db.prepare(`DELETE FROM ${table} WHERE device_key = ?`).bind(device.device_key),
          ),
        )
        return json(200, { deleted: device.code })
      },
    ],
  ]

  return async function handleAdmin(request, url) {
    if (!adminToken) return json(503, { error: 'Painel desligado: defina LICENSE_ADMIN_TOKEN.' })
    const auth = request.headers.get('Authorization') || ''
    if (!timingSafeEqualStr(auth, `Bearer ${adminToken}`)) return json(401, { error: 'Não autorizado.' })
    for (const [method, pattern, run] of routes) {
      const match = request.method === method && url.pathname.match(pattern)
      if (!match) continue
      try {
        const body = method === 'GET' || method === 'DELETE' ? {} : await readJsonBody(request, 8192)
        return await run(match, body, url)
      } catch (err) {
        return json(err.status || 500, { error: err.status ? err.message : 'Erro interno.' })
      }
    }
    return json(404, { error: 'Não encontrado.' })
  }
}
