// The job queue gets its own table. It shared one with stream chunks before, which
// meant the coldest rows in the system contended with the hottest for the same
// index pages.

import type { Adapter } from '../types.ts'

export const QUEUE_DDL = `
CREATE TABLE IF NOT EXISTS ket_job (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  queue      TEXT    NOT NULL,
  payload    TEXT,
  state      TEXT    NOT NULL DEFAULT 'ready',
  attempts   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS ket_job_ready ON ket_job (queue, state, id);
`

export const QUEUE_DDL_PG = `
CREATE TABLE IF NOT EXISTS ket_job (
  id         BIGSERIAL PRIMARY KEY,
  queue      TEXT        NOT NULL,
  payload    TEXT,
  state      TEXT        NOT NULL DEFAULT 'ready',
  attempts   INTEGER     NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS ket_job_ready ON ket_job (queue, state, id);
`

export type Job = { id: number; payload: unknown; attempts: number }

export async function createQueue(adapter: Adapter, o: { now?: () => string } = {}) {
  const now = o.now ?? (() => new Date().toISOString())
  const pg = adapter.name === 'postgres'
  const p = (n: number) => (pg ? `$${n}` : '?')
  await adapter.exec(pg ? QUEUE_DDL_PG : QUEUE_DDL)

  return {
    async enqueue(queue: string, payload: unknown): Promise<void> {
      await adapter.run(
        `INSERT INTO ket_job (queue, payload, created_at) VALUES (${p(1)}, ${p(2)}, ${p(3)})`,
        [queue, payload == null ? null : JSON.stringify(payload), now()],
      )
    },

    /**
     * Postgres claims with FOR UPDATE SKIP LOCKED so N workers never queue behind
     * each other on the same row. SQLite has a single writer, so the guarded
     * UPDATE is already exclusive there.
     */
    async claim(queue: string): Promise<Job | null> {
      if (pg) {
        const rows = await adapter.all(
          `UPDATE ket_job SET state = 'claimed', attempts = attempts + 1
           WHERE id = (SELECT id FROM ket_job WHERE queue = $1 AND state = 'ready' ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED)
           RETURNING id, payload, attempts`,
          [queue],
        )
        const r = rows[0]
        return r
          ? {
              id: Number(r.id),
              payload: r.payload == null ? null : JSON.parse(String(r.payload)),
              attempts: Number(r.attempts),
            }
          : null
      }
      const rows = await adapter.all(
        `SELECT id, payload, attempts FROM ket_job WHERE queue = ? AND state = 'ready' ORDER BY id LIMIT 1`,
        [queue],
      )
      const r = rows[0]
      if (!r) return null
      const upd = await adapter.run(
        `UPDATE ket_job SET state = 'claimed', attempts = attempts + 1 WHERE id = ? AND state = 'ready'`,
        [r.id],
      )
      if (upd.changes !== 1) return null
      return {
        id: Number(r.id),
        payload: r.payload == null ? null : JSON.parse(String(r.payload)),
        attempts: Number(r.attempts) + 1,
      }
    },

    async complete(id: number): Promise<void> {
      await adapter.run(`UPDATE ket_job SET state = 'done' WHERE id = ${p(1)}`, [id])
    },
    async fail(id: number): Promise<void> {
      await adapter.run(`UPDATE ket_job SET state = 'failed' WHERE id = ${p(1)}`, [id])
    },
    async release(id: number): Promise<void> {
      await adapter.run(`UPDATE ket_job SET state = 'ready' WHERE id = ${p(1)}`, [id])
    },
    async pending(queue: string): Promise<number> {
      const r = await adapter.all(
        `SELECT COUNT(*) AS c FROM ket_job WHERE queue = ${p(1)} AND state = 'ready'`,
        [queue],
      )
      return Number((r[0] as { c: number }).c)
    },
  }
}
