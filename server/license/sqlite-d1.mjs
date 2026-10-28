/**
 * Banco SQLite local (node:sqlite) com a mesma interface do Cloudflare D1: prepare(sql).bind(...).first/all/run.
 * O núcleo (license-core.mjs) só conhece essa interface; no Worker ele recebe o D1 de verdade.
 */
import { DatabaseSync } from 'node:sqlite'

function statement(db, sql, args = []) {
  return {
    bind: (...values) => statement(db, sql, values),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => {
      const r = db.prepare(sql).run(...args)
      return { meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } }
    },
  }
}

/** Abre (ou cria) o arquivo do banco; ':memory:' para testes. */
export function openSqlite(path) {
  const db = new DatabaseSync(path)
  return { prepare: (sql) => statement(db, sql), close: () => db.close() }
}
