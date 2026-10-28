/**
 * Tabelas e consultas da licença (RFC-018 §2). SQL compatível com SQLite e Cloudflare D1.
 * Horários em milissegundos desde 1970 (UTC); datas de ciclo em 'YYYY-MM-DD' (Brasília).
 */

export const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS devices (
    device_key TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    platform TEXT NOT NULL,
    first_seen_at INTEGER NOT NULL,
    trial_ends_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS activations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_key TEXT NOT NULL,
    starts_at INTEGER NOT NULL,
    ends_at INTEGER NOT NULL,
    source TEXT NOT NULL,
    note TEXT,
    created_by TEXT,
    revoked_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS activations_device ON activations (device_key)`,
  `CREATE TABLE IF NOT EXISTS partners (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    started_on TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS partner_hosts (
    host TEXT PRIMARY KEY,
    partner_id INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS partner_cycle_entries (
    device_key TEXT NOT NULL,
    partner_id INTEGER NOT NULL,
    cycle_start TEXT NOT NULL,
    first_at INTEGER NOT NULL,
    last_at INTEGER NOT NULL,
    PRIMARY KEY (device_key, partner_id, cycle_start)
  )`,
]

export async function migrate(db) {
  for (const sql of MIGRATIONS) await db.prepare(sql).run()
}

export const findDevice = (db, deviceKey) => db.prepare('SELECT * FROM devices WHERE device_key = ?').bind(deviceKey).first()

export const findDeviceByCode = (db, code) => db.prepare('SELECT * FROM devices WHERE code = ?').bind(code).first()

/** Cria o aparelho; se a chave já existe (dois hello juntos) ou o código colidir, não faz nada. */
export async function insertDevice(db, { deviceKey, code, platform, now, trialEndsAt }) {
  await db
    .prepare('INSERT OR IGNORE INTO devices (device_key, code, platform, first_seen_at, trial_ends_at) VALUES (?, ?, ?, ?, ?)')
    .bind(deviceKey, code, platform, now, trialEndsAt)
    .run()
}

/** Fim da ativação mais longa não revogada (null se nunca ativou). */
export async function activationEndsAt(db, deviceKey) {
  const row = await db
    .prepare('SELECT MAX(ends_at) AS ends_at FROM activations WHERE device_key = ? AND revoked_at IS NULL')
    .bind(deviceKey)
    .first()
  return row && row.ends_at != null ? row.ends_at : null
}

export const partnerForHost = (db, host) =>
  db
    .prepare('SELECT p.* FROM partner_hosts h JOIN partners p ON p.id = h.partner_id WHERE h.host = ?')
    .bind(host)
    .first()

/** Guarda prometida na PRIVACY.md: 24 meses. */
export const RETENTION_MS = 730 * 24 * 3600 * 1000

/** Apaga entradas e ativações encerradas há mais de 24 meses e os aparelhos que ficaram sem nenhuma das duas. */
export async function purgeExpired(db, now) {
  const cutoff = now - RETENTION_MS
  await db.prepare('DELETE FROM partner_cycle_entries WHERE last_at < ?').bind(cutoff).run()
  await db.prepare('DELETE FROM activations WHERE COALESCE(revoked_at, ends_at) < ?').bind(cutoff).run()
  await db
    .prepare(
      `DELETE FROM devices WHERE first_seen_at < ?
       AND device_key NOT IN (SELECT device_key FROM activations)
       AND device_key NOT IN (SELECT device_key FROM partner_cycle_entries)`,
    )
    .bind(cutoff)
    .run()
}

/** Grava a entrada: a primeira do ciclo fica, a última é atualizada (repetir não infla nada). */
export async function upsertEntry(db, { deviceKey, partnerId, cycleStart, at }) {
  await db
    .prepare(
      `INSERT INTO partner_cycle_entries (device_key, partner_id, cycle_start, first_at, last_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (device_key, partner_id, cycle_start) DO UPDATE SET last_at = MAX(last_at, excluded.last_at)`,
    )
    .bind(deviceKey, partnerId, cycleStart, at, at)
    .run()
}
