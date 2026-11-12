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

/** RFC-019: tabelas novas (só acrescentam; o banco de produção já tem dados da RFC-018). */
MIGRATIONS.push(
  `CREATE TABLE IF NOT EXISTS resellers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    parent_id INTEGER,
    name TEXT NOT NULL,
    contact TEXT,
    key_hash TEXT NOT NULL UNIQUE,
    key_hint TEXT,
    credits INTEGER NOT NULL DEFAULT 0 CHECK (credits >= 0),
    active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS resellers_parent ON resellers (parent_id)`,
  `CREATE TABLE IF NOT EXISTS credit_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reseller_id INTEGER NOT NULL,
    delta INTEGER NOT NULL,
    kind TEXT NOT NULL,
    device_code TEXT,
    counterpart_id INTEGER,
    amount_cents INTEGER,
    note TEXT,
    created_by TEXT,
    created_at INTEGER NOT NULL,
    idempotency_key TEXT,
    response TEXT,
    UNIQUE (reseller_id, idempotency_key)
  )`,
  `CREATE INDEX IF NOT EXISTS credit_movements_reseller ON credit_movements (reseller_id, id)`,
  `CREATE TABLE IF NOT EXISTS device_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_key TEXT NOT NULL,
    action TEXT NOT NULL,
    detail TEXT,
    actor TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS device_events_device ON device_events (device_key, id)`,
  // RFC-021: listas enviadas pelo site, só texto cifrado, até a TV buscar (no máximo 7 dias).
  `CREATE TABLE IF NOT EXISTS inbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_key TEXT NOT NULL,
    box TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS inbox_device ON inbox (device_key, id)`,
  // RFC-020: pedidos pagos pelo Mercado Pago. E-mail e CPF do pagador vão direto ao Mercado Pago, nunca para cá.
  `CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    method TEXT NOT NULL,
    device_code TEXT,
    reseller_id INTEGER,
    buyer_name TEXT,
    buyer_contact TEXT,
    quantity INTEGER NOT NULL,
    amount_cents INTEGER NOT NULL,
    status TEXT NOT NULL,
    mp_order_id TEXT UNIQUE,
    view_secret_hash TEXT NOT NULL,
    delivery TEXT,
    created_at INTEGER NOT NULL,
    paid_at INTEGER,
    expires_at INTEGER NOT NULL
  )`,
  // RFC-020 etapa 4: assinatura anual no cartão (id = id do pedido de adesão) e trava de entrega única das parcelas.
  `CREATE TABLE IF NOT EXISTS subscriptions (
    id TEXT PRIMARY KEY,
    device_code TEXT NOT NULL,
    mp_preapproval_id TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    cancelled_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS mp_deliveries (
    mp_ref TEXT PRIMARY KEY,
    subscription_id TEXT NOT NULL,
    delivered_at INTEGER NOT NULL
  )`,
  // Limites que valem entre isolates do Worker (a memória de cada um zera e não é compartilhada): novos aparelhos,
  // checkout e senha errada no painel. `key` = rede do cliente (IPv6 por /64) ou '*' para o teto geral.
  `CREATE TABLE IF NOT EXISTS rate_limits (
    bucket TEXT NOT NULL,
    key TEXT NOT NULL,
    window_start INTEGER NOT NULL,
    count INTEGER NOT NULL,
    PRIMARY KEY (bucket, key)
  )`,
)

/** Colunas novas em tabelas existentes: ALTER TABLE não tem IF NOT EXISTS, então "já existe" é ignorado. */
export const COLUMN_MIGRATIONS = [
  'ALTER TABLE devices ADD COLUMN blocked_at INTEGER',
  'ALTER TABLE devices ADD COLUMN note TEXT',
  'ALTER TABLE activations ADD COLUMN reseller_id INTEGER',
  'ALTER TABLE devices ADD COLUMN inbox_pub TEXT',
  // RFC-020: última vez que a consulta da tela perguntou ao Mercado Pago (cobre webhook perdido).
  'ALTER TABLE orders ADD COLUMN checked_at INTEGER',
  // Conferência periódica do estorno das parcelas do cartão (auditoria 2026-11-11, item 5).
  'ALTER TABLE mp_deliveries ADD COLUMN checked_at INTEGER',
  // Índices das consultas por revenda, aparelho e parceiro (auditoria 2026-11-11, item 7). Aqui e não em MIGRATIONS
  // porque `activations.reseller_id` nasce no ALTER acima.
  'CREATE INDEX IF NOT EXISTS activations_reseller ON activations (reseller_id, id)',
  'CREATE INDEX IF NOT EXISTS subscriptions_device ON subscriptions (device_code)',
  'CREATE INDEX IF NOT EXISTS partner_cycle_entries_partner ON partner_cycle_entries (partner_id, cycle_start)',
]

/**
 * Versão do esquema = quantas migrações existem (as listas só crescem, então acrescentar uma já sobe a versão).
 * Fica numa tabela própria: o D1 não aceita `PRAGMA user_version`.
 */
export const SCHEMA_VERSION = MIGRATIONS.length + COLUMN_MIGRATIONS.length

/**
 * Banco já em dia custa uma consulta. Antes, cada isolate novo do Worker rodava as 25 migrações em sequência antes da
 * primeira resposta (auditoria de 2026-11-11, item 2). Rodar tudo de novo continua seguro (IF NOT EXISTS).
 */
export async function migrate(db) {
  const current = await db.prepare('SELECT version FROM schema_version').first().catch(() => null)
  if (current && current.version >= SCHEMA_VERSION) return
  for (const sql of MIGRATIONS) await db.prepare(sql).run()
  for (const sql of COLUMN_MIGRATIONS) {
    try {
      await db.prepare(sql).run()
    } catch (err) {
      if (!/duplicate column/i.test(String(err && err.message))) throw err
    }
  }
  await db.prepare('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)').run()
  await db.batch([
    db.prepare('DELETE FROM schema_version'),
    db.prepare('INSERT INTO schema_version (version) VALUES (?)').bind(SCHEMA_VERSION),
  ])
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

/**
 * Conta uma tentativa no balde e diz quantos segundos esperar (0 = liberado). Atômico (um único UPSERT com RETURNING),
 * então duas chamadas juntas nunca leem a mesma contagem. Janela fixa; a contagem para em limit + 1.
 */
export async function hitLimit(db, { bucket, key, limit, windowMs, now }) {
  const row = await db
    .prepare(
      `INSERT INTO rate_limits (bucket, key, window_start, count) VALUES (?, ?, ?, 1)
       ON CONFLICT (bucket, key) DO UPDATE SET
         count = CASE WHEN ? - window_start >= ? THEN 1 WHEN count > ? THEN count ELSE count + 1 END,
         window_start = CASE WHEN ? - window_start >= ? THEN ? ELSE window_start END
       RETURNING window_start, count`,
    )
    .bind(bucket, key, now, now, windowMs, limit, now, windowMs, now)
    .first()
  if (row.count <= limit) return 0
  return Math.max(1, Math.ceil((row.window_start + windowMs - now) / 1000))
}

/**
 * Comandos (para um db.batch) que revogam `revokeIds` do aparelho e puxam para trás as ativações empilhadas depois
 * delas. Cada compra soma 12 meses a partir do fim vigente (extendActivation); sem refazer a fila, MAX(ends_at)
 * continuaria contando o período estornado (auditoria RFC-025, item 1).
 */
export async function revokeActivationStatements(db, deviceKey, revokeIds, at) {
  const revoke = new Set(revokeIds)
  const rows = (
    await db.prepare('SELECT id, starts_at, ends_at FROM activations WHERE device_key = ? AND revoked_at IS NULL ORDER BY id').bind(deviceKey).all()
  ).results
  const statements = []
  let prevOld = 0
  let prevNew = 0
  for (const row of rows) {
    // Quanto esta ativação somou ao fim que existia quando ela foi criada.
    const own = Math.max(0, row.ends_at - Math.max(row.starts_at, prevOld))
    // Liberação "até a data" que não esticou o fim vigente: vale por si, não anda com a fila.
    if (!revoke.has(row.id) && row.ends_at <= prevOld) {
      prevNew = Math.max(prevNew, row.ends_at)
      continue
    }
    prevOld = Math.max(prevOld, row.ends_at)
    if (revoke.has(row.id)) {
      statements.push(db.prepare('UPDATE activations SET revoked_at = ? WHERE id = ?').bind(at, row.id))
      continue
    }
    const endsAt = Math.max(row.starts_at, prevNew) + own
    prevNew = Math.max(prevNew, endsAt)
    if (endsAt !== row.ends_at) statements.push(db.prepare('UPDATE activations SET ends_at = ? WHERE id = ?').bind(endsAt, row.id))
  }
  return statements
}

/** Segundos de espera se o bucket já chegou ao limite, sem contar mais uma (travas de "erros demais"); 0 = livre. */
export async function lockedFor(db, { bucket, key, limit, windowMs, now }) {
  const row = await db.prepare('SELECT window_start, count FROM rate_limits WHERE bucket = ? AND key = ?').bind(bucket, key).first()
  if (!row || row.count < limit || now - row.window_start >= windowMs) return 0
  return Math.max(1, Math.ceil((row.window_start + windowMs - now) / 1000))
}

/** Guarda prometida na PRIVACY.md: 24 meses. */
export const RETENTION_MS = 730 * 24 * 3600 * 1000

/** Apaga entradas e ativações encerradas há mais de 24 meses e os aparelhos que ficaram sem nenhuma das duas. */
export async function purgeExpired(db, now) {
  const cutoff = now - RETENTION_MS
  await db.prepare('DELETE FROM inbox WHERE expires_at <= ?').bind(now).run()
  await db.prepare('DELETE FROM rate_limits WHERE window_start < ?').bind(now - 2 * 24 * 3600 * 1000).run()
  // Chave de revenda que o comprador não buscou a tempo não fica guardada em texto (license-checkout.mjs, KEY_VISIBLE_MS).
  await db
    .prepare("UPDATE orders SET delivery = json_remove(delivery, '$.resellerKey', '$.keyUntil') WHERE json_extract(delivery, '$.keyUntil') < ?")
    .bind(now)
    .run()
  // Pedidos seguem a mesma guarda de 24 meses (decisão do dono, 2026-11-03): somem inteiros, com nome e contato.
  // A assinatura não depende do pedido de adesão (só o atualiza se ele existir), então renovações seguem valendo.
  // Menos o pedido de adesão de assinatura: a parcela compara com o valor contratado nele (sem ele, valeria o preço de hoje).
  await db.prepare('DELETE FROM orders WHERE created_at < ? AND id NOT IN (SELECT id FROM subscriptions)').bind(cutoff).run()
  await db.prepare('DELETE FROM partner_cycle_entries WHERE last_at < ?').bind(cutoff).run()
  await db.prepare('DELETE FROM activations WHERE COALESCE(revoked_at, ends_at) < ?').bind(cutoff).run()
  await db
    .prepare(
      `DELETE FROM devices WHERE first_seen_at < ?
       AND blocked_at IS NULL -- suspenso fica: apagado, voltaria sem bloqueio e com teste novo (auditoria RFC-025, item 4)
       AND device_key NOT IN (SELECT device_key FROM activations)
       AND device_key NOT IN (SELECT device_key FROM partner_cycle_entries)
       AND code NOT IN (SELECT device_code FROM subscriptions WHERE status <> 'cancelled') -- assinou e espera a 1ª parcela`,
    )
    .bind(cutoff)
    .run()
  await db.prepare('DELETE FROM device_events WHERE device_key NOT IN (SELECT device_key FROM devices)').run()
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
