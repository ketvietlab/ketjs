// Idempotency records: durable, shared between instances, and cold. This is the one
// use that genuinely belongs in the database and always did — it is a keyed lookup,
// not a log, so it gets a keyed table.

import type { Adapter } from '../types.ts'

export const IDEM_DDL = `
CREATE TABLE IF NOT EXISTS ket_idem (
  key        TEXT PRIMARY KEY,
  fn         TEXT NOT NULL,
  state      TEXT NOT NULL,
  result     TEXT,
  created_at TEXT NOT NULL
);
`

export const IDEM_DDL_PG = IDEM_DDL.replace('created_at TEXT NOT NULL', 'created_at TIMESTAMPTZ NOT NULL')

export type IdemRecord = { state: 'pending' | 'done'; result: unknown }

export async function createIdempotency(adapter: Adapter, o: { now?: () => string } = {}) {
  const now = o.now ?? (() => new Date().toISOString())
  const pg = adapter.name === 'postgres'
  const p = (n: number) => (pg ? `$${n}` : '?')
  await adapter.exec(pg ? IDEM_DDL_PG : IDEM_DDL)

  return {
    /** Claim a key. False means somebody else holds it; the primary key decides. */
    async claim(key: string, fn: string): Promise<boolean> {
      const r = await adapter.run(
        `INSERT INTO ket_idem (key, fn, state, created_at) VALUES (${p(1)}, ${p(2)}, 'pending', ${p(3)}) ON CONFLICT DO NOTHING`,
        [key, fn, now()])
      return r.changes === 1
    },
    async read(key: string): Promise<IdemRecord | null> {
      const rows = await adapter.all(`SELECT state, result FROM ket_idem WHERE key = ${p(1)}`, [key])
      const r = rows[0]
      if (!r) return null
      return { state: String(r.state) as IdemRecord['state'], result: r.result == null ? null : JSON.parse(String(r.result)) }
    },
    async complete(key: string, result: unknown): Promise<void> {
      await adapter.run(`UPDATE ket_idem SET state = 'done', result = ${p(1)} WHERE key = ${p(2)}`, [JSON.stringify(result), key])
    },
    /** A claim whose caller died would block the key forever without this. */
    async release(key: string): Promise<void> {
      await adapter.run(`DELETE FROM ket_idem WHERE key = ${p(1)} AND state = 'pending'`, [key])
    },
  }
}
