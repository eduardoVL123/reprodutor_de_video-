/**
 * Revendedores e créditos (RFC-019): regras usadas pelo painel do dono (license-admin.mjs) e pela API pública
 * (license-api.mjs). 1 crédito = 1 aparelho por 1 ano; créditos só descem na árvore; saldo nunca negativo (CHECK no
 * banco); débito e movimento no mesmo batch (tudo ou nada).
 */
import { extendActivation } from './license-rules.mjs'
import { findDeviceByCode, activationEndsAt } from './license-db.mjs'

export class ResellerError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

const MAX_NAME = 100
const MAX_CONTACT = 120
const MAX_NOTE = 200

function toBase64Url(bytes) {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Chave nova (G13): 32 bytes aleatórios, prefixo pk_. */
export function newKey() {
  return `pk_${toBase64Url(crypto.getRandomValues(new Uint8Array(32)))}`
}

export async function hashKey(key) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(key)))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

export const publicReseller = (r) => ({
  id: r.id,
  parentId: r.parent_id ?? null,
  name: r.name,
  contact: r.contact || '',
  credits: r.credits,
  active: !!r.active,
  keyHint: r.key_hint || '',
  createdAt: r.created_at,
})

export const publicMovement = (m) => ({
  id: m.id,
  delta: m.delta,
  kind: m.kind,
  deviceCode: m.device_code || null,
  counterpartId: m.counterpart_id ?? null,
  amountCents: m.amount_cents ?? null,
  note: m.note || '',
  createdAt: m.created_at,
})

export function validAmount(amount) {
  if (!Number.isInteger(amount) || amount < 1) throw new ResellerError(400, 'Quantidade inválida: use um número inteiro maior que zero.')
  return amount
}

export async function findReseller(db, id) {
  const r = await db.prepare('SELECT * FROM resellers WHERE id = ?').bind(id).first()
  if (!r) throw new ResellerError(404, 'Revendedor não encontrado.')
  return r
}

export async function findResellerByKey(db, key) {
  if (typeof key !== 'string' || !key.startsWith('pk_')) return null
  return db.prepare('SELECT * FROM resellers WHERE key_hash = ?').bind(await hashKey(key)).first()
}

export async function createReseller(db, { name, contact, parentId = null, now }) {
  const cleanName = String(name || '').trim()
  if (!cleanName || cleanName.length > MAX_NAME) throw new ResellerError(400, 'Nome inválido.')
  const key = newKey()
  const r = await db
    .prepare('INSERT INTO resellers (parent_id, name, contact, key_hash, key_hint, credits, active, created_at) VALUES (?, ?, ?, ?, ?, 0, 1, ?)')
    .bind(parentId, cleanName, String(contact || '').trim().slice(0, MAX_CONTACT), await hashKey(key), key.slice(-4), now)
    .run()
  return { id: r.meta.last_row_id, key }
}

export async function rotateKey(db, id) {
  const key = newKey()
  await db.prepare('UPDATE resellers SET key_hash = ?, key_hint = ? WHERE id = ?').bind(await hashKey(key), key.slice(-4), id).run()
  return key
}

/** Lançamento do dono: compra (valor pela tabela ou informado), cortesia ou estorno (tira créditos). */
export async function adjustCredits(db, { resellerId, amount, kind, amountCents = null, note = '', createdBy, now }) {
  validAmount(amount)
  const delta = kind === 'refund' ? -amount : amount
  try {
    await db.batch([
      db.prepare('UPDATE resellers SET credits = credits + ? WHERE id = ?').bind(delta, resellerId),
      db
        .prepare('INSERT INTO credit_movements (reseller_id, delta, kind, amount_cents, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(resellerId, delta, kind, amountCents, String(note || '').slice(0, MAX_NOTE) || null, createdBy, now),
    ])
  } catch (err) {
    if (/CHECK/i.test(String(err && err.message))) throw new ResellerError(409, 'Saldo insuficiente para esse estorno.')
    throw err
  }
  return findReseller(db, resellerId)
}

export async function movements(db, resellerId, { before = null, limit = 50 } = {}) {
  const rows = before
    ? await db.prepare('SELECT * FROM credit_movements WHERE reseller_id = ? AND id < ? ORDER BY id DESC LIMIT ?').bind(resellerId, before, limit).all()
    : await db.prepare('SELECT * FROM credit_movements WHERE reseller_id = ? ORDER BY id DESC LIMIT ?').bind(resellerId, limit).all()
  return rows.results.map(publicMovement)
}

async function replay(db, resellerId, idempotencyKey) {
  if (!idempotencyKey) return null
  const m = await db.prepare('SELECT response FROM credit_movements WHERE reseller_id = ? AND idempotency_key = ?').bind(resellerId, idempotencyKey).first()
  return m && m.response ? JSON.parse(m.response) : null
}

/**
 * Ativa o aparelho do código por 1 ano gastando 1 crédito (G11). Idempotente pela chave: repetir devolve a mesma
 * resposta sem novo débito. Sem saldo → 402; aparelho inexistente → 404; bloqueado pelo dono → 409.
 * shortcut: duas ativações simultâneas do MESMO aparelho com chaves diferentes calculam o fim a partir do mesmo valor
 * (cada uma gasta 1 crédito e o aparelho ganha só 1 ano); raro, o dono estorna; resolver com o cálculo no SQL se aparecer.
 */
export async function activateDevice(db, { reseller, code, idempotencyKey, now }) {
  const previous = await replay(db, reseller.id, idempotencyKey)
  if (previous) return previous
  const device = await findDeviceByCode(db, String(code || '').toUpperCase())
  if (!device) throw new ResellerError(404, 'Código não encontrado. Abra o Pulse Player na TV uma vez e tente de novo.')
  if (device.blocked_at) throw new ResellerError(409, 'Este aparelho está suspenso. Fale com o suporte.')

  const endsAt = extendActivation(await activationEndsAt(db, device.device_key), now)
  const response = { code: device.code, activationEndsAt: endsAt, credits: reseller.credits - 1 }
  try {
    await db.batch([
      db.prepare('UPDATE resellers SET credits = credits - 1 WHERE id = ?').bind(reseller.id),
      db
        .prepare('INSERT INTO activations (device_key, starts_at, ends_at, source, note, created_by, reseller_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(device.device_key, now, endsAt, 'reseller', null, `reseller:${reseller.id}`, reseller.id),
      db
        .prepare(
          `INSERT INTO credit_movements (reseller_id, delta, kind, device_code, created_by, created_at, idempotency_key, response)
           VALUES (?, -1, 'activation', ?, ?, ?, ?, ?)`,
        )
        .bind(reseller.id, device.code, `reseller:${reseller.id}`, now, idempotencyKey || null, JSON.stringify(response)),
    ])
  } catch (err) {
    const again = await replay(db, reseller.id, idempotencyKey) // a mesma chave chegou junto: vale a resposta dela
    if (again) return again
    if (/CHECK/i.test(String(err && err.message))) throw new ResellerError(402, 'Saldo de créditos insuficiente.')
    throw err
  }
  const fresh = await findReseller(db, reseller.id)
  return { ...response, credits: fresh.credits }
}

/** Repasse para uma revenda direta (R3): sai de um saldo e entra no outro, nunca cria crédito. */
export async function transferCredits(db, { from, toId, amount, idempotencyKey, now }) {
  validAmount(amount)
  const previous = await replay(db, from.id, idempotencyKey)
  if (previous) return previous
  const child = await db.prepare('SELECT * FROM resellers WHERE id = ? AND parent_id = ?').bind(toId, from.id).first()
  if (!child) throw new ResellerError(404, 'Revenda não encontrada entre as suas.')
  const response = { toId: child.id, amount, credits: from.credits - amount }
  try {
    await db.batch([
      db.prepare('UPDATE resellers SET credits = credits - ? WHERE id = ?').bind(amount, from.id),
      db.prepare('UPDATE resellers SET credits = credits + ? WHERE id = ?').bind(amount, child.id),
      db
        .prepare(
          `INSERT INTO credit_movements (reseller_id, delta, kind, counterpart_id, created_by, created_at, idempotency_key, response)
           VALUES (?, ?, 'transfer_out', ?, ?, ?, ?, ?)`,
        )
        .bind(from.id, -amount, child.id, `reseller:${from.id}`, now, idempotencyKey || null, JSON.stringify(response)),
      db
        .prepare(`INSERT INTO credit_movements (reseller_id, delta, kind, counterpart_id, created_by, created_at) VALUES (?, ?, 'transfer_in', ?, ?, ?)`)
        .bind(child.id, amount, from.id, `reseller:${from.id}`, now),
    ])
  } catch (err) {
    const again = await replay(db, from.id, idempotencyKey)
    if (again) return again
    if (/CHECK/i.test(String(err && err.message))) throw new ResellerError(402, 'Saldo de créditos insuficiente.')
    throw err
  }
  const fresh = await findReseller(db, from.id)
  return { ...response, credits: fresh.credits }
}
