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
    /**
     * Claim a key. False means somebody else holds it; the primary key decides.
     *
     * A caller that dies between claiming and finishing would otherwise block the
     * key forever, so a claim older than `staleMs` is treated as abandoned and
     * taken over. This is a liveness/safety trade made explicit: too short and a
     * slow call gets run twice, too long and a stuck key blocks retries.
     */
    async claim(key: string, fn: string, staleMs = 5 * 60_000): Promise<boolean> {
      const r = await adapter.run(
        `INSERT INTO ket_idem (key, fn, state, created_at) VALUES (${p(1)}, ${p(2)}, 'pending', ${p(3)}) ON CONFLICT DO NOTHING`,
        [key, fn, now()])
      if (r.changes === 1) return true

      const cutoff = new Date(Date.parse(now()) - staleMs).toISOString()
      const taken = await adapter.run(
        `UPDATE ket_idem SET created_at = ${p(1)} WHERE key = ${p(2)} AND state = 'pending' AND created_at < ${p(3)}`,
        [now(), key, cutoff])
      return taken.changes === 1
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
    /** Drop a claim whose call then failed, so a retry is not locked out. */
    async release(key: string): Promise<void> {
      await adapter.run(`DELETE FROM ket_idem WHERE key = ${p(1)} AND state = 'pending'`, [key])
    },

    /**
     * Records are only useful for as long as a client might retry. Without this the
     * table grows forever, which is the quiet way a correctness feature becomes an
     * operational problem.
     */
    async sweep(olderThanMs = 24 * 60 * 60_000): Promise<number> {
      const cutoff = new Date(Date.parse(now()) - olderThanMs).toISOString()
      const r = await adapter.run(`DELETE FROM ket_idem WHERE created_at < ${p(1)}`, [cutoff])
      return r.changes
    },
  }
}
