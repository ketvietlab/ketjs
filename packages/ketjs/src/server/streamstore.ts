// Where stream chunks live.
//
// The earlier design put them in the same append-only table as jobs and
// idempotency records, on the grounds that all three are logs. Measured, that was
// wrong: chunks are the hottest and shortest-lived rows in the system, and sharing
// a table and an index with the coldest ones costs far more than the tidiness saves.
//
// Chunks still need to be durable — losing them on restart is the exact failure
// resumable streams exist to prevent — but the store is pluggable, so a single
// instance can stay in memory and only a multi-instance deployment pays for a table.

import { EventEmitter } from 'node:events'
import type { Adapter } from '../types.ts'

export type Batch = { seq: number; chunks: unknown[] }
export type SinceResult = { batches: Batch[]; done: boolean; summary: unknown; nextSeq: number }

export type StreamStore = {
  readonly name: string
  init(): Promise<void>
  append(topic: string, seq: number, chunks: unknown[]): Promise<void>
  markEnd(topic: string, seq: number, summary: unknown): Promise<void>
  since(topic: string, fromSeq: number): Promise<SinceResult>
  /** Highest batch sequence written, recovered once when a writer opens. */
  head(topic: string): Promise<number>
  subscribe(topic: string, cb: () => void): () => void
  /**
   * Whether `subscribe` reaches every writer this deployment has.
   *
   * A reader polls because it cannot be told. When the store can tell it, the
   * poll stops being the mechanism and becomes the safety net, and `tail` may
   * wait far longer between reads. False — or absent — keeps the tight poll,
   * which is what a store whose notifications end at the process boundary
   * needs.
   */
  readonly notifies?: boolean
  /** Delete finished streams older than the grace period. Returns rows removed. */
  sweep(olderThanMs: number): Promise<number>
}

// Local notification, so a reader on the same instance never polls at all.
class Notifier {
  private bus = new EventEmitter().setMaxListeners(0)
  subscribe(topic: string, cb: () => void): () => void {
    this.bus.on(topic, cb)
    return () => {
      this.bus.off(topic, cb)
    }
  }
  notify(topic: string): void {
    this.bus.emit(topic)
  }
  /** Wake everyone, for the moment when what was missed is not known. */
  notifyEveryone(): void {
    for (const topic of this.bus.eventNames()) this.bus.emit(topic)
  }
}

export function memoryStreamStore(): StreamStore {
  const topics = new Map<
    string,
    { batches: Batch[]; done: boolean; summary: unknown; endedAt: number | null }
  >()
  const notifier = new Notifier()
  const slot = (t: string) => {
    let s = topics.get(t)
    if (!s) {
      s = { batches: [], done: false, summary: null, endedAt: null }
      topics.set(t, s)
    }
    return s
  }
  return {
    name: 'memory',
    async init() {},
    async append(topic, seq, chunks) {
      slot(topic).batches.push({ seq, chunks })
      notifier.notify(topic)
    },
    async markEnd(topic, _seq, summary) {
      const s = slot(topic)
      s.done = true
      s.summary = summary
      s.endedAt = Date.now()
      notifier.notify(topic)
    },
    async since(topic, fromSeq) {
      const s = slot(topic)
      const batches = s.batches.filter((b) => b.seq >= fromSeq)
      const head = s.batches.length ? (s.batches[s.batches.length - 1] as Batch).seq + 1 : 0
      return { batches, done: s.done, summary: s.summary, nextSeq: head }
    },
    async head(topic) {
      const s = slot(topic)
      return s.batches.length ? (s.batches[s.batches.length - 1] as Batch).seq + 1 : 0
    },
    subscribe: (t, cb) => notifier.subscribe(t, cb),
    // One process holds the whole store, so the local bus is every writer there is.
    notifies: true,
    async sweep(olderThanMs) {
      const cutoff = Date.now() - olderThanMs
      let n = 0
      for (const [t, s] of topics)
        if (s.endedAt != null && s.endedAt <= cutoff) {
          topics.delete(t)
          n++
        }
      return n
    },
  }
}

export const STREAM_DDL = `
CREATE TABLE IF NOT EXISTS ket_stream (
  topic      TEXT    NOT NULL,
  seq        INTEGER NOT NULL,
  chunks     TEXT    NOT NULL,
  ended      INTEGER NOT NULL DEFAULT 0,
  summary    TEXT,
  created_at TEXT    NOT NULL,
  PRIMARY KEY (topic, seq)
);
CREATE INDEX IF NOT EXISTS ket_stream_ended ON ket_stream (ended, created_at);
`

/**
 * The channel every stream notification travels on, with the topic as payload.
 *
 * One channel rather than one per topic, because a topic is chosen by the
 * application and a PostgreSQL channel is an identifier: sixty-three bytes, and
 * quoting rules a caller should not have to know. A payload has neither limit
 * that matters here. The cost is that each process wakes for every stream and
 * filters, which is the right trade while streams are counted in tens.
 */
const STREAM_CHANNEL = 'ket_stream'

export function dbStreamStore(adapter: Adapter, o: { now?: () => string } = {}): StreamStore {
  const now = o.now ?? (() => new Date().toISOString())
  const pg = adapter.name === 'postgres'
  const p = (n: number) => (pg ? `$${n}` : '?')
  const notifier = new Notifier()
  const notifications = adapter.notifications
  /**
   * Tell the other processes, and let the database decide when.
   *
   * A job runs in a worker; the reader tailing it is in a web process. The local
   * bus never crosses that boundary, which is why a reader used to find out only
   * on its next poll. Inside a transaction the database holds the notification
   * until commit, so a reader is never woken to read a row that is not there yet.
   */
  const announce = (topic: string): void => {
    notifier.notify(topic)
    // A failed announcement is not a failed write: the poll is still underneath,
    // so the reader is late rather than wrong. Throwing here would fail the
    // append instead.
    void notifications?.publish(STREAM_CHANNEL, topic).catch(() => {})
  }
  // Listening costs a connection, so it is opened by the first reader and never
  // by a process that only writes.
  let listening: Promise<void> | null = null
  const listen = (): Promise<void> => {
    if (!notifications?.subscribe) return Promise.resolve()
    return (listening ??= notifications
      .subscribe(
        STREAM_CHANNEL,
        (topic) => notifier.notify(topic),
        // Also called after the driver reconnects its listener. Whatever was
        // announced while the connection was down is gone, and which topics
        // those were is not knowable, so every reader reads once.
        () => notifier.notifyEveryone(),
      )
      .then(() => undefined)
      .catch(() => {
        // The poll remains. Clearing the promise lets a later reader try again
        // rather than leaving the process permanently deaf after one bad moment.
        listening = null
      }))
  }

  return {
    name: `db:${adapter.name}`,
    async init() {
      await adapter.exec(STREAM_DDL)
    },

    async append(topic, seq, chunks) {
      await adapter.run(
        `INSERT INTO ket_stream (topic, seq, chunks, created_at) VALUES (${p(1)}, ${p(2)}, ${p(3)}, ${p(4)})`,
        [topic, seq, JSON.stringify(chunks), now()],
      )
      announce(topic)
    },

    async markEnd(topic, seq, summary) {
      await adapter.run(
        `INSERT INTO ket_stream (topic, seq, chunks, ended, summary, created_at) VALUES (${p(1)}, ${p(2)}, ${p(3)}, 1, ${p(4)}, ${p(5)})`,
        [topic, seq, '[]', summary == null ? null : JSON.stringify(summary), now()],
      )
      announce(topic)
    },

    // One query, and only the rows the reader has not seen.
    //
    // It used to read the whole topic and drop the old rows in JavaScript, which
    // a tail pays for on every pass: a stream that has written a thousand chunks
    // re-read and re-parsed all thousand to learn there was nothing new. The end
    // marker is exempt from the cursor because `done` and the summary live on it,
    // and a reader that resumes past it still has to be told the stream is over.
    async since(topic, fromSeq) {
      const rows = await adapter.all(
        `SELECT seq, chunks, ended, summary FROM ket_stream WHERE topic = ${p(1)} AND (seq >= ${p(2)} OR ended = 1) ORDER BY seq`,
        [topic, fromSeq],
      )
      let done = false
      let summary: unknown = null
      // The cursor is the floor: with the older rows no longer read, "nothing
      // newer than where you already are" has to resume where the reader is.
      let head = fromSeq
      const batches: Batch[] = []
      for (const r of rows) {
        const seq = Number(r.seq)
        head = Math.max(head, seq + 1)
        if (Number(r.ended) === 1) {
          done = true
          summary = r.summary == null ? null : JSON.parse(String(r.summary))
          continue
        }
        if (seq >= fromSeq) batches.push({ seq, chunks: JSON.parse(String(r.chunks)) as unknown[] })
      }
      return { batches, done, summary, nextSeq: head }
    },

    async head(topic) {
      const r = await adapter.all(
        `SELECT COALESCE(MAX(seq), -1) AS m FROM ket_stream WHERE topic = ${p(1)}`,
        [topic],
      )
      return Number((r[0] as { m: number }).m) + 1
    },

    subscribe(t, cb) {
      void listen()
      return notifier.subscribe(t, cb)
    },
    // Only when the database can carry a notification to the other processes.
    // SQLite cannot, and a reader there keeps the tight poll it has always had.
    notifies: Boolean(notifications?.subscribe),

    async sweep(olderThanMs) {
      const cutoff = new Date(Date.now() - olderThanMs).toISOString()
      const ended = await adapter.all(
        `SELECT topic FROM ket_stream WHERE ended = 1 AND created_at <= ${p(1)}`,
        [cutoff],
      )
      let n = 0
      for (const row of ended) {
        const r = await adapter.run(`DELETE FROM ket_stream WHERE topic = ${p(1)}`, [String(row.topic)])
        n += r.changes
      }
      return n
    },
  }
}
