// Where sessions live.
//
// The store is an interface for the same reason the stream store is: a single
// process is happy in memory, and a deployment behind more than one pod is not.
// Sessions in memory across three pods means a login lands on one and the next
// request is anonymous on another — a bug that only appears once you scale, which
// is the worst moment to discover it.
//
// The database-backed store already solves that, because the database is shared.
// Redis would be faster, and it belongs in its own package the way the Postgres
// driver does — the framework cannot depend on a client without spending the one
// exception it has already spent.

import type { Adapter } from '../types.ts'

/** What a session carries. Everything a request needs to know who it is. */
export type SessionRecord = {
  id: string
  userId: string
  /** Companies this session may read — becomes scope.companies (D32). */
  companies: string[]
  /** The one it writes to — becomes scope.company. Always in `companies`. */
  company: string | null
  /** The one operational branch new company+branch rows are stamped with. */
  branch: string | null
  branches: string[] | null
  /** Invalidates sessions after credential or account-state changes. */
  securityVersion: number
  /** Compare-and-set revision for context switches and live reconciliation. */
  revision: number
  createdAt: number
  /** Refreshed while in use, never past createdAt + absoluteTtl. */
  expiresAt: number
}

export type SessionStore = {
  readonly name: string
  init(): Promise<void>
  create(record: SessionRecord): Promise<void>
  read(id: string): Promise<SessionRecord | null>
  /** Extend a live session. Returns the new expiry, or null if it was already gone. */
  touch(id: string, expiresAt: number): Promise<number | null>
  /** Replace identity scope only if nobody changed this session since it was read. */
  updateContext(id: string, expectedRevision: number, context: SessionContext): Promise<SessionRecord | null>
  destroy(id: string): Promise<void>
  /** List live sessions for profile/admin screens. */
  listUser(userId: string): Promise<SessionRecord[]>
  /** Every session of one user — logging out everywhere, or revoking an account. */
  destroyUser(userId: string): Promise<number>
  /** Rotate credentials while keeping the session that performed the change. */
  destroyUserExcept(userId: string, keepId: string): Promise<number>
  /** Remove what has expired. Returns rows removed. */
  sweep(now: number): Promise<number>
}

export type SessionContext = Pick<
  SessionRecord,
  'companies' | 'company' | 'branches' | 'branch' | 'securityVersion'
>

const alive = (r: SessionRecord, now: number): boolean => r.expiresAt > now

export function memorySessionStore(o: { now?: () => number } = {}): SessionStore {
  const now = o.now ?? (() => Date.now())
  const rows = new Map<string, SessionRecord>()
  return {
    name: 'memory',
    async init() {},
    async create(r) {
      rows.set(r.id, { ...r })
    },
    async read(id) {
      const r = rows.get(id)
      if (!r) return null
      // Expired is gone, not merely stale: reading it back would be a session
      // that outlived its own expiry for as long as nothing swept.
      if (!alive(r, now())) {
        rows.delete(id)
        return null
      }
      return { ...r }
    },
    async touch(id, expiresAt) {
      const r = rows.get(id)
      if (!r || !alive(r, now())) return null
      r.expiresAt = expiresAt
      return expiresAt
    },
    async updateContext(id, expectedRevision, context) {
      const r = rows.get(id)
      if (!r || !alive(r, now()) || r.revision !== expectedRevision) return null
      const next = { ...r, ...context, revision: r.revision + 1 }
      rows.set(id, next)
      return { ...next, companies: [...next.companies], branches: next.branches ? [...next.branches] : null }
    },
    async destroy(id) {
      rows.delete(id)
    },
    async listUser(userId) {
      const out: SessionRecord[] = []
      for (const [id, r] of rows) {
        if (!alive(r, now())) {
          rows.delete(id)
          continue
        }
        if (r.userId === userId)
          out.push({ ...r, companies: [...r.companies], branches: r.branches ? [...r.branches] : null })
      }
      return out.sort((a, b) => b.createdAt - a.createdAt)
    },
    async destroyUser(userId) {
      let n = 0
      for (const [id, r] of rows)
        if (r.userId === userId) {
          rows.delete(id)
          n++
        }
      return n
    },
    async destroyUserExcept(userId, keepId) {
      let n = 0
      for (const [id, r] of rows)
        if (r.userId === userId && id !== keepId) {
          rows.delete(id)
          n++
        }
      return n
    },
    async sweep(at) {
      let n = 0
      for (const [id, r] of rows)
        if (r.expiresAt <= at) {
          rows.delete(id)
          n++
        }
      return n
    },
  }
}

const DDL = `
CREATE TABLE IF NOT EXISTS ket_session (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  companies   TEXT NOT NULL,
  company     TEXT,
  branch      TEXT,
  branches    TEXT,
  security_version INTEGER NOT NULL DEFAULT 0,
  revision    INTEGER NOT NULL DEFAULT 0,
  created_at  BIGINT NOT NULL,
  expires_at  BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS ket_session_user ON ket_session (user_id);
CREATE INDEX IF NOT EXISTS ket_session_expiry ON ket_session (expires_at);
`

/**
 * One row per session, in whatever database the app already has.
 *
 * This is the store that makes several pods work at all, and it needs no extra
 * infrastructure to do it — which is the point. Reach for Redis when the read
 * traffic justifies it, not before.
 */
export function dbSessionStore(adapter: Adapter, o: { now?: () => number } = {}): SessionStore {
  // Injectable, because a store that reaches for Date.now cannot be tested for
  // expiry without sleeping — and a test that sleeps is a test that flakes.
  const now = o.now ?? (() => Date.now())
  const pg = adapter.name === 'postgres'
  const p = (n: number) => (pg ? `$${n}` : '?')
  const decode = (row: Record<string, unknown>): SessionRecord => ({
    id: String(row.id),
    userId: String(row.user_id),
    companies: JSON.parse(String(row.companies)) as string[],
    company: row.company === null || row.company === undefined ? null : String(row.company),
    branch: row.branch === null || row.branch === undefined ? null : String(row.branch),
    branches:
      row.branches === null || row.branches === undefined
        ? null
        : (JSON.parse(String(row.branches)) as string[]),
    securityVersion: Number(row.security_version ?? 0),
    revision: Number(row.revision ?? 0),
    createdAt: Number(row.created_at),
    expiresAt: Number(row.expires_at),
  })

  return {
    name: adapter.name,
    async init() {
      await adapter.exec(DDL)
      const columns = (await adapter.introspect()).ket_session ?? {}
      for (const [name, sql] of [
        ['branch', 'TEXT'],
        ['security_version', 'INTEGER NOT NULL DEFAULT 0'],
        ['revision', 'INTEGER NOT NULL DEFAULT 0'],
      ] as const)
        if (pg) await adapter.exec(`ALTER TABLE ket_session ADD COLUMN IF NOT EXISTS ${name} ${sql}`)
        else if (!columns[name]) await adapter.exec(`ALTER TABLE ket_session ADD COLUMN ${name} ${sql}`)
    },

    async create(r) {
      await adapter.run(
        `INSERT INTO ket_session
           (id, user_id, companies, company, branch, branches, security_version, revision, created_at, expires_at)
         VALUES (${p(1)}, ${p(2)}, ${p(3)}, ${p(4)}, ${p(5)}, ${p(6)}, ${p(7)}, ${p(8)}, ${p(9)}, ${p(10)})`,
        [
          r.id,
          r.userId,
          JSON.stringify(r.companies),
          r.company,
          r.branch,
          r.branches ? JSON.stringify(r.branches) : null,
          r.securityVersion,
          r.revision,
          r.createdAt,
          r.expiresAt,
        ],
      )
    },

    async read(id) {
      const rows = await adapter.all(`SELECT * FROM ket_session WHERE id = ${p(1)}`, [id])
      if (!rows.length) return null
      const r = decode(rows[0] as Record<string, unknown>)
      if (r.expiresAt <= now()) {
        await adapter.run(`DELETE FROM ket_session WHERE id = ${p(1)}`, [id])
        return null
      }
      return r
    },

    async touch(id, expiresAt) {
      // The expiry guard is in the statement, so a session that lapsed between the
      // read and the write is not quietly revived by the refresh.
      const res = (await adapter.run(
        `UPDATE ket_session SET expires_at = ${p(1)} WHERE id = ${p(2)} AND expires_at > ${p(3)}`,
        [expiresAt, id, now()],
      )) as { changes?: number }
      return res.changes ? expiresAt : null
    },

    async updateContext(id, expectedRevision, context) {
      const res = (await adapter.run(
        `UPDATE ket_session SET
           companies = ${p(1)}, company = ${p(2)}, branch = ${p(3)}, branches = ${p(4)},
           security_version = ${p(5)}, revision = revision + 1
         WHERE id = ${p(6)} AND revision = ${p(7)} AND expires_at > ${p(8)}`,
        [
          JSON.stringify(context.companies),
          context.company,
          context.branch,
          context.branches ? JSON.stringify(context.branches) : null,
          context.securityVersion,
          id,
          expectedRevision,
          now(),
        ],
      )) as { changes?: number }
      if (!res.changes) return null
      const rows = await adapter.all(`SELECT * FROM ket_session WHERE id = ${p(1)}`, [id])
      return rows.length ? decode(rows[0] as Record<string, unknown>) : null
    },

    async destroy(id) {
      await adapter.run(`DELETE FROM ket_session WHERE id = ${p(1)}`, [id])
    },

    async listUser(userId) {
      await adapter.run(`DELETE FROM ket_session WHERE user_id = ${p(1)} AND expires_at <= ${p(2)}`, [
        userId,
        now(),
      ])
      const rows = await adapter.all(
        `SELECT * FROM ket_session WHERE user_id = ${p(1)} ORDER BY created_at DESC`,
        [userId],
      )
      return rows.map((row) => decode(row as Record<string, unknown>))
    },

    async destroyUser(userId) {
      const res = (await adapter.run(`DELETE FROM ket_session WHERE user_id = ${p(1)}`, [userId])) as {
        changes?: number
      }
      return res.changes ?? 0
    },

    async destroyUserExcept(userId, keepId) {
      const res = (await adapter.run(`DELETE FROM ket_session WHERE user_id = ${p(1)} AND id <> ${p(2)}`, [
        userId,
        keepId,
      ])) as { changes?: number }
      return res.changes ?? 0
    },

    async sweep(at) {
      const res = (await adapter.run(`DELETE FROM ket_session WHERE expires_at <= ${p(1)}`, [at])) as {
        changes?: number
      }
      return res.changes ?? 0
    },
  }
}
