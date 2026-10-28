/**
 * Banco SQLite local (node:sqlite) com a mesma interface do Cloudflare D1: prepare(sql).bind(...).first/all/run e
 * batch([...]) (tudo ou nada, como no D1). O núcleo (license-core.mjs) só conhece essa interface; no Worker ele
 * recebe o D1 de verdade.
 */
import { DatabaseSync } from 'node:sqlite'

function statement(db, sql, args = []) {
  const runSync = () => {
    const r = db.prepare(sql).run(...args)
    return { meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } }
  }
  return {
    bind: (...values) => statement(db, sql, values),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => runSync(),
    runSync,
  }
}

/** Abre (ou cria) o arquivo do banco; ':memory:' para testes. */
export function openSqlite(path) {
  const db = new DatabaseSync(path)
  return {
    prepare: (sql) => statement(db, sql),
    batch: async (statements) => {
      db.exec('BEGIN')
      try {
        const results = statements.map((s) => s.runSync())
        db.exec('COMMIT')
        return results
      } catch (err) {
        db.exec('ROLLBACK')
        throw err
      }
    },
    close: () => db.close(),
  }
}
