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

export function createLog(adapter: Adapter, o: { now?: () => string } = {}) {
  const now = o.now ?? (() => new Date().toISOString())
  adapter.exec(LOG_DDL)

  const nextSeq = (topic: string): number => {
    const r = adapter.all(`SELECT COALESCE(MAX(seq), -1) AS m FROM ket_log WHERE topic = ?`, [topic])
    return Number((r[0] as { m: number }).m) + 1
  }

  return {
    append(topic: string, kind: string, data: unknown, state = 'ready'): number {
      const seq = nextSeq(topic)
      adapter.run(`INSERT INTO ket_log (topic, seq, kind, data, state, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
        [topic, seq, kind, data == null ? null : JSON.stringify(data), state, now()])
      return seq
    },
    read(topic: string, fromSeq = 0): LogEntry[] {
      const rows = adapter.all(`SELECT seq, kind, data, state FROM ket_log WHERE topic = ? AND seq >= ? ORDER BY seq`, [topic, fromSeq])
      return rows.map(r => ({
        seq: Number(r.seq), kind: String(r.kind), state: String(r.state),
        data: r.data == null ? null : JSON.parse(String(r.data)),
      }))
    },
    head(topic: string): number { return nextSeq(topic) },
    setState(topic: string, seq: number, state: string): void {
      adapter.run(`UPDATE ket_log SET state = ? WHERE topic = ? AND seq = ?`, [state, topic, seq])
    },
    claim(topic: string): { seq: number; data: unknown } | null {
      const rows = adapter.all(`SELECT seq, data FROM ket_log WHERE topic = ? AND state = 'ready' ORDER BY seq LIMIT 1`, [topic])
      const first = rows[0]
      if (!first) return null
      const seq = Number(first.seq)
      const r = adapter.run(`UPDATE ket_log SET state = 'claimed' WHERE topic = ? AND seq = ? AND state = 'ready'`, [topic, seq])
      if (r.changes !== 1) return null
      return { seq, data: first.data == null ? null : JSON.parse(String(first.data)) }
    },
  }
}
