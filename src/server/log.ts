// One append-only log with a cursor, serving three needs that would otherwise be
// three subsystems: resumable streams, the job queue, and the cache-invalidation
// outbox. Fullstack adds work; this is one of the places it gives some back.

import type { Adapter } from '../types.ts'

export const LOG_DDL = `
CREATE TABLE IF NOT EXISTS ket_log (
  topic      TEXT    NOT NULL,
  seq        INTEGER NOT NULL,
  kind       TEXT    NOT NULL,
  data       TEXT,
  state      TEXT    NOT NULL DEFAULT 'ready',
  created_at TEXT    NOT NULL,
  PRIMARY KEY (topic, seq)
);
CREATE INDEX IF NOT EXISTS ket_log_topic_state ON ket_log (topic, state, seq);
`

export type LogEntry = { seq: number; kind: string; state: string; data: unknown }

export type Log = Awaited<ReturnType<typeof createLog>>

export async function createLog(adapter: Adapter, o: { now?: () => string } = {}) {
  const now = o.now ?? (() => new Date().toISOString())
  await adapter.exec(LOG_DDL)
  const ph = adapter.name === 'postgres'
    ? (n: number) => `${n}`
    : () => '?'
  const q = (...n: number[]) => n.map(ph)

  const nextSeq = async (topic: string): Promise<number> => {
    const r = await adapter.all(`SELECT COALESCE(MAX(seq), -1) AS m FROM ket_log WHERE topic = ${ph(1)}`, [topic])
    return Number((r[0] as { m: number }).m) + 1
  }

  return {
    async append(topic: string, kind: string, data: unknown, state = 'ready'): Promise<number> {
      const seq = await nextSeq(topic)
      const [a, b, c, d, e, f] = q(1, 2, 3, 4, 5, 6)
      await adapter.run(`INSERT INTO ket_log (topic, seq, kind, data, state, created_at) VALUES (${a}, ${b}, ${c}, ${d}, ${e}, ${f})`,
        [topic, seq, kind, data == null ? null : JSON.stringify(data), state, now()])
      return seq
    },
    async read(topic: string, fromSeq = 0): Promise<LogEntry[]> {
      const [a, b] = q(1, 2)
      const rows = await adapter.all(`SELECT seq, kind, data, state FROM ket_log WHERE topic = ${a} AND seq >= ${b} ORDER BY seq`, [topic, fromSeq])
      return rows.map(r => ({
        seq: Number(r.seq), kind: String(r.kind), state: String(r.state),
        data: r.data == null ? null : JSON.parse(String(r.data)),
      }))
    },
    head(topic: string): Promise<number> { return nextSeq(topic) },
    /**
     * Claim a topic exactly once. Returns false if somebody already holds it.
     * ON CONFLICT DO NOTHING is supported by both SQLite and Postgres, so the
     * race is settled by the primary key rather than by a check-then-insert.
     */
    async putOnce(topic: string, kind: string, data: unknown, state = 'pending'): Promise<boolean> {
      const [a, b, c, d, e] = q(1, 2, 3, 4, 5)
      const r = await adapter.run(
        `INSERT INTO ket_log (topic, seq, kind, data, state, created_at) VALUES (${a}, 0, ${b}, ${c}, ${d}, ${e}) ON CONFLICT DO NOTHING`,
        [topic, kind, data == null ? null : JSON.stringify(data), state, now()])
      return r.changes === 1
    },
    async readOne(topic: string): Promise<LogEntry | null> {
      const [a] = q(1)
      const rows = await adapter.all(`SELECT seq, kind, data, state FROM ket_log WHERE topic = ${a} AND seq = 0`, [topic])
      const r = rows[0]
      if (!r) return null
      return { seq: 0, kind: String(r.kind), state: String(r.state), data: r.data == null ? null : JSON.parse(String(r.data)) }
    },
    async complete(topic: string, data: unknown): Promise<void> {
      const [a, b] = q(1, 2)
      await adapter.run(`UPDATE ket_log SET state = 'done', data = ${a} WHERE topic = ${b} AND seq = 0`, [JSON.stringify(data), topic])
    },
    async setState(topic: string, seq: number, state: string): Promise<void> {
      const [a, b, c] = q(1, 2, 3)
      await adapter.run(`UPDATE ket_log SET state = ${a} WHERE topic = ${b} AND seq = ${c}`, [state, topic, seq])
    },
    async claim(topic: string): Promise<{ seq: number; data: unknown } | null> {
      const [a] = q(1)
      const rows = await adapter.all(`SELECT seq, data FROM ket_log WHERE topic = ${a} AND state = 'ready' ORDER BY seq LIMIT 1`, [topic])
      const first = rows[0]
      if (!first) return null
      const seq = Number(first.seq)
      const [x, y] = q(1, 2)
      const r = await adapter.run(`UPDATE ket_log SET state = 'claimed' WHERE topic = ${x} AND seq = ${y} AND state = 'ready'`, [topic, seq])
      if (r.changes !== 1) return null
      return { seq, data: first.data == null ? null : JSON.parse(String(first.data)) }
    },
  }
}
