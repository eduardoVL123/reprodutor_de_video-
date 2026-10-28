/**
 * API do painel administrativo (RFC-018 §4): parceiros, relatório por ciclo e aparelhos.
 * Só com `Authorization: Bearer <LICENSE_ADMIN_TOKEN>`; sem token configurado o painel fica fechado.
 */
import { timingSafeEqualStr, readJsonBody } from '../pair/pair-core.mjs'
import { cyclesUntil, isActive, normalizeHost, extendActivation } from './license-rules.mjs'
import { findDeviceByCode, activationEndsAt } from './license-db.mjs'

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
    await db.prepare('DELETE FROM partner_hosts WHERE partner_id = ?').bind(id).run()
  }
  for (const host of partner.hosts) {
    await db.prepare('INSERT INTO partner_hosts (host, partner_id) VALUES (?, ?)').bind(host, id).run()
  }
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
  ).results.map((a) => ({ startsAt: a.starts_at, endsAt: a.ends_at, source: a.source, note: a.note, revokedAt: a.revoked_at }))
  return {
    device,
    info: {
      code: device.code,
      platform: device.platform,
      firstSeenAt: device.first_seen_at,
      trialEndsAt: device.trial_ends_at,
      activationEndsAt: await activationEndsAt(db, device.device_key),
      activations,
    },
  }
}

/** Devolve `handleAdmin(request, url) -> Response`, usando `json(status, body)` do núcleo. */
export function createAdminRoutes({ db, now, adminToken, json }) {
  const routes = [
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
        const cycles = cyclesUntil(partner.started_on, now())
        const result = []
        for (const c of cycles) result.push({ ...c, actives: (await cycleDevices(db, partner.id, c.start)).filter((d) => d.active).length })
        return json(200, result)
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
        return json(200, { ...cycle, actives: devices.filter((d) => d.active).length, devices })
      },
    ],
    ['GET', /^\/admin\/api\/devices\/([A-Z0-9]{4,16})$/, async (m) => json(200, (await deviceInfo(db, m[1])).info)],
    [
      'POST',
      /^\/admin\/api\/devices\/([A-Z0-9]{4,16})\/activate$/,
      async (m, body) => {
        const { device, info } = await deviceInfo(db, m[1])
        const at = now()
        const note = String(body.note || '').slice(0, 200) || null
        await db
          .prepare('INSERT INTO activations (device_key, starts_at, ends_at, source, note, created_by) VALUES (?, ?, ?, ?, ?, ?)')
          .bind(device.device_key, at, extendActivation(info.activationEndsAt, at), 'manual', note, 'admin')
          .run()
        return json(200, (await deviceInfo(db, m[1])).info)
      },
    ],
    [
      'POST',
      /^\/admin\/api\/devices\/([A-Z0-9]{4,16})\/revoke$/,
      async (m) => {
        const { device } = await deviceInfo(db, m[1])
        await db.prepare('UPDATE activations SET revoked_at = ? WHERE device_key = ? AND revoked_at IS NULL').bind(now(), device.device_key).run()
        return json(200, (await deviceInfo(db, m[1])).info)
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
        const body = method === 'GET' ? {} : await readJsonBody(request, 8192)
        return await run(match, body, url)
      } catch (err) {
        return json(err.status || 500, { error: err.status ? err.message : 'Erro interno.' })
      }
    }
    return json(404, { error: 'Não encontrado.' })
  }
}
