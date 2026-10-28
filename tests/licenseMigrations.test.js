import { describe, it, expect } from 'vitest'
import { openSqlite } from '../server/license/sqlite-d1.mjs'
import { migrate } from '../server/license/license-db.mjs'

/** RFC-019 G14: migrações só acrescentam e preservam os dados da RFC-018; batch é tudo ou nada. */

const columns = async (db, table) => (await db.prepare(`PRAGMA table_info(${table})`).all()).results.map((c) => c.name)

describe('migrações da RFC-019', () => {
  it('rodar duas vezes não quebra e cria as tabelas e colunas novas', async () => {
    const db = openSqlite(':memory:')
    await migrate(db)
    await migrate(db)
    expect(await columns(db, 'resellers')).toEqual(expect.arrayContaining(['id', 'parent_id', 'name', 'contact', 'key_hash', 'key_hint', 'credits', 'active', 'created_at']))
    expect(await columns(db, 'credit_movements')).toEqual(expect.arrayContaining(['reseller_id', 'delta', 'kind', 'device_code', 'counterpart_id', 'amount_cents', 'idempotency_key', 'response']))
    expect(await columns(db, 'device_events')).toEqual(expect.arrayContaining(['device_key', 'action', 'detail', 'actor', 'created_at']))
    expect(await columns(db, 'devices')).toEqual(expect.arrayContaining(['blocked_at', 'note']))
    expect(await columns(db, 'activations')).toEqual(expect.arrayContaining(['reseller_id']))
  })

  it('um banco que já tinha dados da RFC-018 continua com eles depois da migração', async () => {
    const db = openSqlite(':memory:')
    await db.prepare('CREATE TABLE devices (device_key TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, platform TEXT NOT NULL, first_seen_at INTEGER NOT NULL, trial_ends_at INTEGER NOT NULL)').run()
    await db.prepare("INSERT INTO devices VALUES ('k1', 'ABCDEFGH', 'android', 1, 2)").run()
    await migrate(db)
    expect(await db.prepare('SELECT code, blocked_at, note FROM devices').first()).toEqual({ code: 'ABCDEFGH', blocked_at: null, note: null })
  })

  it('o saldo de créditos nunca fica negativo (CHECK no banco)', async () => {
    const db = openSqlite(':memory:')
    await migrate(db)
    await db.prepare("INSERT INTO resellers (name, key_hash, credits, created_at) VALUES ('R', 'h', 0, 1)").run()
    await expect(db.prepare('UPDATE resellers SET credits = credits - 1').run()).rejects.toThrow()
  })
})

describe('batch (mesma garantia do D1: tudo ou nada)', () => {
  it('aplica todos os comandos juntos', async () => {
    const db = openSqlite(':memory:')
    await db.prepare('CREATE TABLE t (v INTEGER CHECK (v >= 0))').run()
    await db.batch([db.prepare('INSERT INTO t VALUES (?)').bind(1), db.prepare('INSERT INTO t VALUES (?)').bind(2)])
    expect((await db.prepare('SELECT COUNT(*) AS n FROM t').first()).n).toBe(2)
  })

  it('se um comando falha, nenhum vale', async () => {
    const db = openSqlite(':memory:')
    await db.prepare('CREATE TABLE t (v INTEGER CHECK (v >= 0))').run()
    await expect(db.batch([db.prepare('INSERT INTO t VALUES (?)').bind(1), db.prepare('INSERT INTO t VALUES (?)').bind(-1)])).rejects.toThrow()
    expect((await db.prepare('SELECT COUNT(*) AS n FROM t').first()).n).toBe(0)
  })
})
