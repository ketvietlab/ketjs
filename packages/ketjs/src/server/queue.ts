// Durable jobs. PostgreSQL/SQLite are the source of truth; notifications merely
// shorten the time between commit and claim. Nothing here assumes the worker is
// in the same process as the code that enqueued the job.

import { randomUUID } from 'node:crypto'
import { KetError } from '../kernel/errors.ts'
import { isDateText, parseType } from '../kernel/types.ts'
import type { Adapter, JobEnqueueOptions, JobEnqueueResult, Manifest, Row, Scope } from '../types.ts'

export const JOB_CHANNEL = 'ket_job_ready'

export type JobState =
  | 'available'
  | 'scheduled'
  | 'executing'
  | 'retryable'
  | 'completed'
  | 'discarded'
  | 'cancelled'

export type DurableJob = {
  id: string
  job: string
  queue: string
  args: Record<string, unknown>
  /** Compatibility spelling retained for the original createQueue callers. */
  payload: unknown
  state: JobState
  priority: number
  attempt: number
  attempts: number
  maxAttempts: number
  scheduledAt: string
  attemptedAt: string | null
  completedAt: string | null
  workerId: string | null
  leaseUntil: string | null
  actor: string | null
  scope: Scope
  uniqueKey: string | null
  errors: Array<{ at: string; attempt: number; message: string }>
  insertedAt: string
  updatedAt: string
}

export type EnqueueJobOptions = JobEnqueueOptions & {
  queue?: string
  maxAttempts?: number
  actor?: string | null
  scope?: Scope
}

export type QueueListOptions = { state?: JobState; queue?: string; limit?: number }

export type Queue = {
  enqueue(job: string, args: Record<string, unknown>, options?: EnqueueJobOptions): Promise<JobEnqueueResult>
  claim(queue: string): Promise<DurableJob | null>
  claimBatch(
    queue: string,
    options: { limit?: number; workerId: string; leaseMs?: number },
  ): Promise<DurableJob[]>
  heartbeat(id: string, workerId: string, leaseMs?: number): Promise<boolean>
  complete(id: string, workerId?: string): Promise<boolean>
  retry(id: string, error: unknown, runAt: Date, workerId?: string): Promise<boolean>
  discard(id: string, error: unknown, workerId?: string): Promise<boolean>
  cancel(id: string): Promise<boolean>
  /** Operator retry for retryable/discarded jobs; preserves attempt history. */
  retryNow(id: string): Promise<boolean>
  rescue(options?: { limit?: number }): Promise<{ retried: number; discarded: number }>
  get(id: string): Promise<DurableJob | null>
  list(options?: QueueListOptions): Promise<DurableJob[]>
  prune(options?: { completedBefore?: Date; discardedBefore?: Date }): Promise<number>
  pending(queue: string): Promise<number>
  fail(id: string): Promise<void>
  release(id: string): Promise<void>
}

const DDL_SQLITE = `
CREATE TABLE IF NOT EXISTS ket_job (
  id            TEXT PRIMARY KEY,
  job           TEXT NOT NULL,
  queue         TEXT NOT NULL,
  args          TEXT NOT NULL,
  state         TEXT NOT NULL,
  priority      INTEGER NOT NULL DEFAULT 0,
  attempt       INTEGER NOT NULL DEFAULT 0,
  max_attempts  INTEGER NOT NULL,
  scheduled_at  TEXT NOT NULL,
  attempted_at  TEXT,
  completed_at  TEXT,
  worker_id     TEXT,
  lease_until   TEXT,
  actor         TEXT,
  company_id    TEXT,
  companies     TEXT,
  branch        TEXT,
  branches      TEXT,
  unique_key    TEXT,
  errors        TEXT NOT NULL DEFAULT '[]',
  inserted_at   TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
`

const DDL_POSTGRES = `
CREATE TABLE IF NOT EXISTS ket_job (
  id            TEXT PRIMARY KEY,
  job           TEXT NOT NULL,
  queue         TEXT NOT NULL,
  args          TEXT NOT NULL,
  state         TEXT NOT NULL,
  priority      INTEGER NOT NULL DEFAULT 0,
  attempt       INTEGER NOT NULL DEFAULT 0,
  max_attempts  INTEGER NOT NULL,
  scheduled_at  TIMESTAMPTZ NOT NULL,
  attempted_at  TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  worker_id     TEXT,
  lease_until   TIMESTAMPTZ,
  actor         TEXT,
  company_id    TEXT,
  companies     TEXT,
  branch        TEXT,
  branches      TEXT,
  unique_key    TEXT,
  errors        TEXT NOT NULL DEFAULT '[]',
  inserted_at   TIMESTAMPTZ NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL
);
`

// Only runnable states belong in the fetch and uniqueness indexes. This both
// gives claim a single ordering path across states and releases a unique key as
// soon as its job reaches a terminal state. Business idempotency remains the
// handler's responsibility; queue uniqueness only coalesces active delivery.
const INDEX_DDL = `
DROP INDEX IF EXISTS ket_job_fetch;
DROP INDEX IF EXISTS ket_job_unique;
CREATE INDEX IF NOT EXISTS ket_job_fetch_active
  ON ket_job (queue, priority, scheduled_at, id)
  WHERE state IN ('available', 'scheduled', 'retryable');
CREATE INDEX IF NOT EXISTS ket_job_rescue
  ON ket_job (state, lease_until);
CREATE UNIQUE INDEX IF NOT EXISTS ket_job_unique_active
  ON ket_job (job, unique_key)
  WHERE unique_key IS NOT NULL AND state IN ('available', 'scheduled', 'executing', 'retryable');
`

const encode = (value: unknown): string => JSON.stringify(value ?? null)
let lastIdMs = -1
let idSequence = 0
const nextJobId = (at: Date): string => {
  const milliseconds = at.getTime()
  idSequence = milliseconds === lastIdMs ? idSequence + 1 : 0
  lastIdMs = milliseconds
  // The timestamp and per-process sequence retain FIFO for jobs inserted in one
  // producer at the same priority/due time; UUID entropy keeps ids collision-safe
  // across producers and nodes.
  return `${milliseconds.toString(36).padStart(10, '0')}-${idSequence.toString(36).padStart(4, '0')}-${randomUUID()}`
}
const decode = <T>(value: unknown, fallback: T): T => {
  if (value == null) return fallback
  if (typeof value !== 'string') return value as T
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

const iso = (value: unknown): string | null => {
  if (value == null) return null
  return (value instanceof Date ? value : new Date(String(value))).toISOString()
}

const toJob = (r: Row): DurableJob => {
  const args = decode<Record<string, unknown>>(r.args, {})
  const attempt = Number(r.attempt)
  const companies = decode<string[] | null>(r.companies, null)
  const branches = decode<string[] | null>(r.branches, null)
  return {
    id: String(r.id),
    job: String(r.job),
    queue: String(r.queue),
    args,
    payload: args,
    state: String(r.state) as JobState,
    priority: Number(r.priority),
    attempt,
    attempts: attempt,
    maxAttempts: Number(r.max_attempts),
    scheduledAt: iso(r.scheduled_at) as string,
    attemptedAt: iso(r.attempted_at),
    completedAt: iso(r.completed_at),
    workerId: r.worker_id == null ? null : String(r.worker_id),
    leaseUntil: iso(r.lease_until),
    actor: r.actor == null ? null : String(r.actor),
    scope: {
      company: r.company_id == null ? null : String(r.company_id),
      ...(companies === null ? {} : { companies }),
      ...(r.branch == null ? {} : { branch: String(r.branch) }),
      ...(branches === null ? {} : { branches }),
    },
    uniqueKey: r.unique_key == null ? null : String(r.unique_key),
    errors: decode(r.errors, []),
    insertedAt: iso(r.inserted_at) as string,
    updatedAt: iso(r.updated_at) as string,
  }
}

const JS_OF: Record<string, string> = {
  id: 'string',
  text: 'string',
  ref: 'string',
  int: 'number',
  float: 'number',
  decimal: 'number',
  bool: 'boolean',
  date: 'string',
  datetime: 'string',
  json: 'object',
}

export function validateJobInput(job: string, manifest: Manifest, args: Record<string, unknown>): void {
  const signature = manifest.jobs[job]?.input
  if (!signature) throw new KetError({ code: 'E_UNKNOWN_JOB', message: `no background job "${job}"` })
  const errors: string[] = []
  for (const [name, spec] of Object.entries(signature)) {
    const type = parseType(spec)
    const value = args[name]
    if (value == null) {
      if (type.ok && !type.optional) errors.push(`missing required input "${name}" (${spec})`)
      continue
    }
    if (!type.ok) continue
    const want = JS_OF[type.base]
    if (want && typeof value !== want) errors.push(`input "${name}" expects ${want}, got ${typeof value}`)
    if (type.base === 'int' && typeof value === 'number' && !Number.isInteger(value))
      errors.push(`input "${name}" expects an integer`)
    if (type.base === 'date' && !isDateText(value))
      errors.push(`input "${name}" expects a calendar date (YYYY-MM-DD)`)
  }
  for (const name of Object.keys(args)) if (!(name in signature)) errors.push(`unknown input "${name}"`)
  if (errors.length)
    throw new KetError({
      code: 'E_INVALID_JOB_INPUT',
      message: `${job}: ${errors.join('; ')}`,
      hint: `signature: ${JSON.stringify(signature)}`,
    })
}

const initialized = new WeakMap<Adapter, Promise<void>>()

async function ensureSchema(adapter: Adapter): Promise<void> {
  let ready = initialized.get(adapter)
  if (!ready) {
    ready = (async () => {
      const initialize = async (target: Adapter): Promise<void> => {
        // Every PostgreSQL replica takes the same transaction-scoped lock before it
        // inspects or renames the legacy table. The lock and DDL share one reserved
        // connection, so two pods cannot both decide they own the migration.
        if (target.name === 'postgres') await target.all('SELECT pg_advisory_xact_lock(1262835793)')
        const before = await target.introspect()
        let migrateLegacy = false
        if (before.ket_job && !before.ket_job.job) {
          if (before.ket_job_legacy)
            throw new Error(
              'legacy ket_job and ket_job_legacy both exist; finish the queue migration manually',
            )
          await target.exec('ALTER TABLE ket_job RENAME TO ket_job_legacy')
          migrateLegacy = true
        }
        await target.exec(target.name === 'postgres' ? DDL_POSTGRES : DDL_SQLITE)
        if (before.ket_job?.job && !before.ket_job.branch)
          await target.exec('ALTER TABLE ket_job ADD COLUMN branch TEXT')
        await target.exec(INDEX_DDL)
        if (migrateLegacy) {
          // V1 used queue as both routing key and operation name. Preserve its rows
          // under stable string ids; workers will execute a still-declared qualified
          // name or safely discard one whose code no longer exists.
          await target.exec(`INSERT INTO ket_job
          (id, job, queue, args, state, priority, attempt, max_attempts, scheduled_at,
           completed_at, errors, inserted_at, updated_at)
          SELECT 'legacy-' || CAST(id AS TEXT), queue, queue, COALESCE(payload, '{}'),
            CASE state
              WHEN 'ready' THEN 'available'
              WHEN 'claimed' THEN 'retryable'
              WHEN 'done' THEN 'completed'
              ELSE 'retryable'
            END,
            0, attempts, 20, created_at,
            CASE WHEN state = 'done' THEN created_at ELSE NULL END,
            '[]', created_at, created_at
          FROM ket_job_legacy WHERE true
          ON CONFLICT DO NOTHING`)
        }
      }
      if (adapter.transaction) await initialize(adapter)
      else await adapter.tx(initialize)
    })()
    initialized.set(adapter, ready)
    ready.catch(() => initialized.delete(adapter))
  }
  return ready
}

const workerGuard = (pg: boolean, parameter: number, workerId?: string | null) => {
  if (workerId === undefined) return { sql: '', params: [] }
  if (workerId === null) return { sql: ' AND worker_id IS NULL', params: [] }
  return { sql: ` AND worker_id = ${pg ? `$${parameter}` : '?'}`, params: [workerId] }
}

export async function createQueue(
  adapter: Adapter,
  options: { now?: () => Date; notify?: boolean } = {},
): Promise<Queue> {
  await ensureSchema(adapter)
  const now = options.now ?? (() => new Date())
  const pg = adapter.name === 'postgres'
  const p = (n: number) => (pg ? `$${n}` : '?')

  const get = async (id: string): Promise<DurableJob | null> => {
    const rows = await adapter.all(`SELECT * FROM ket_job WHERE id = ${p(1)}`, [id])
    return rows[0] ? toJob(rows[0]) : null
  }

  const errorHistory = async (id: string, error: unknown, known?: DurableJob): Promise<string> => {
    const current = known ?? (await get(id))
    const message = error instanceof Error ? error.message : String(error)
    return encode(
      [
        ...(current?.errors ?? []),
        { at: now().toISOString(), attempt: current?.attempt ?? 0, message },
      ].slice(-20),
    )
  }

  const retryExecuting = async (
    id: string,
    error: unknown,
    runAt: Date,
    workerId?: string | null,
    known?: DurableJob,
  ): Promise<boolean> => {
    const at = now().toISOString()
    const errors = await errorHistory(id, error, known)
    const guard = workerGuard(pg, 5, workerId)
    const result = await adapter.run(
      `UPDATE ket_job SET state = 'retryable', scheduled_at = ${p(1)}, errors = ${p(2)},
       lease_until = NULL, worker_id = NULL, updated_at = ${p(3)}
       WHERE id = ${p(4)} AND state = 'executing'${guard.sql}`,
      [runAt.toISOString(), errors, at, id, ...guard.params],
    )
    return result.changes === 1
  }

  const discardExecuting = async (
    id: string,
    error: unknown,
    workerId?: string | null,
    known?: DurableJob,
  ): Promise<boolean> => {
    const at = now().toISOString()
    const errors = await errorHistory(id, error, known)
    const guard = workerGuard(pg, 5, workerId)
    const result = await adapter.run(
      `UPDATE ket_job SET state = 'discarded', errors = ${p(1)}, completed_at = ${p(2)},
       lease_until = NULL, worker_id = NULL, updated_at = ${p(3)}
       WHERE id = ${p(4)} AND state = 'executing'${guard.sql}`,
      [errors, at, at, id, ...guard.params],
    )
    return result.changes === 1
  }

  const queue: Queue = {
    async enqueue(job, args, o = {}) {
      const at = now()
      const runAt = o.runAt ?? at
      if (Number.isNaN(runAt.getTime())) throw new Error('job runAt must be a valid date')
      if (!Number.isInteger(o.priority ?? 0) || (o.priority ?? 0) < 0)
        throw new Error('job priority must be an integer >= 0 (zero is highest)')
      if (!Number.isInteger(o.maxAttempts ?? 20) || (o.maxAttempts ?? 20) < 1)
        throw new Error('job maxAttempts must be an integer >= 1')
      const state: JobState = runAt.getTime() > at.getTime() ? 'scheduled' : 'available'
      const id = nextJobId(at)
      const scope = o.scope ?? { company: null }
      const values = [
        id,
        job,
        o.queue ?? job,
        encode(args),
        state,
        o.priority ?? 0,
        o.maxAttempts ?? 20,
        runAt.toISOString(),
        o.actor ?? null,
        scope.company,
        scope.companies == null ? null : encode(scope.companies),
        scope.branch ?? null,
        scope.branches == null ? null : encode(scope.branches),
        o.uniqueKey ?? null,
        at.toISOString(),
        at.toISOString(),
      ]
      const placeholders = values.map((_, index) => p(index + 1)).join(', ')
      const insert = () =>
        adapter.run(
          `INSERT INTO ket_job
           (id, job, queue, args, state, priority, max_attempts, scheduled_at, actor,
            company_id, companies, branch, branches, unique_key, inserted_at, updated_at)
           VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
          values,
        )
      let inserted = await insert()
      let existing = false
      let actualId: string = id
      if (o.uniqueKey) {
        // The conflicting job may reach a terminal state between INSERT and
        // SELECT, releasing the partial unique key. Retry the insert in that
        // window instead of returning no job (or throwing) for valid work.
        for (let attempt = 0; inserted.changes === 0 && attempt < 3; attempt++) {
          const rows = await adapter.all(
            `SELECT id FROM ket_job
             WHERE job = ${p(1)} AND unique_key = ${p(2)}
               AND state IN ('available', 'scheduled', 'executing', 'retryable')
             LIMIT 1`,
            [job, o.uniqueKey],
          )
          if (rows[0]) {
            existing = true
            actualId = String(rows[0].id)
            break
          }
          inserted = await insert()
        }
        if (inserted.changes === 0 && !existing)
          throw new Error(`could not resolve unique job ${job}:${o.uniqueKey}`)
      }
      if (inserted.changes === 0 && !o.uniqueKey)
        throw new Error(`job id collision while enqueueing "${job}"`)
      if (!existing && options.notify !== false && adapter.notifications)
        await adapter.notifications.publish(JOB_CHANNEL, o.queue ?? job)
      return { id: actualId, existing }
    },

    async claim(name) {
      return (
        (await queue.claimBatch(name, { limit: 1, workerId: `compat-${process.pid}`, leaseMs: 60_000 }))[0] ??
        null
      )
    },

    async claimBatch(name, o) {
      const at = now()
      const until = new Date(at.getTime() + (o.leaseMs ?? 60_000)).toISOString()
      const limit = Math.max(1, Math.min(100, o.limit ?? 10))
      if (pg) {
        const rows = await adapter.all(
          `WITH picked AS (
             SELECT id FROM ket_job
             WHERE queue = $1
               AND state IN ('available', 'scheduled', 'retryable')
               AND scheduled_at <= $2
             ORDER BY priority, scheduled_at, id
             FOR UPDATE SKIP LOCKED
             LIMIT $3
           )
           UPDATE ket_job AS job
           SET state = 'executing', attempt = attempt + 1, attempted_at = $2,
               worker_id = $4, lease_until = $5, updated_at = $2
           FROM picked WHERE job.id = picked.id RETURNING job.*`,
          [name, at.toISOString(), limit, o.workerId, until],
        )
        return rows.map(toJob)
      }
      return adapter.tx(async (tx) => {
        const ids = await tx.all(
          `SELECT id FROM ket_job
           WHERE queue = ? AND state IN ('available', 'scheduled', 'retryable') AND scheduled_at <= ?
           ORDER BY priority, scheduled_at, id LIMIT ?`,
          [name, at.toISOString(), limit],
        )
        const claimed: DurableJob[] = []
        for (const row of ids) {
          const result = await tx.run(
            `UPDATE ket_job SET state = 'executing', attempt = attempt + 1, attempted_at = ?,
             worker_id = ?, lease_until = ?, updated_at = ?
             WHERE id = ? AND state IN ('available', 'scheduled', 'retryable') AND scheduled_at <= ?`,
            [at.toISOString(), o.workerId, until, at.toISOString(), row.id, at.toISOString()],
          )
          if (result.changes !== 1) continue
          const found = await tx.all('SELECT * FROM ket_job WHERE id = ?', [row.id])
          if (found[0]) claimed.push(toJob(found[0]))
        }
        return claimed
      })
    },

    async heartbeat(id, workerId, leaseMs = 60_000) {
      const at = now()
      const result = await adapter.run(
        `UPDATE ket_job SET lease_until = ${p(1)}, updated_at = ${p(2)}
         WHERE id = ${p(3)} AND state = 'executing' AND worker_id = ${p(4)}`,
        [new Date(at.getTime() + leaseMs).toISOString(), at.toISOString(), id, workerId],
      )
      return result.changes === 1
    },

    async complete(id, workerId) {
      const at = now().toISOString()
      const guard = workerGuard(pg, 4, workerId)
      const result = await adapter.run(
        `UPDATE ket_job SET state = 'completed', completed_at = ${p(1)}, lease_until = NULL,
         worker_id = NULL, updated_at = ${p(2)} WHERE id = ${p(3)} AND state = 'executing'${guard.sql}`,
        [at, at, id, ...guard.params],
      )
      return result.changes === 1
    },

    async retry(id, error, runAt, workerId) {
      return retryExecuting(id, error, runAt, workerId)
    },

    async discard(id, error, workerId) {
      return discardExecuting(id, error, workerId)
    },

    async cancel(id) {
      const at = now().toISOString()
      const result = await adapter.run(
        `UPDATE ket_job SET state = 'cancelled', completed_at = ${p(1)}, updated_at = ${p(2)}
         WHERE id = ${p(3)} AND state NOT IN ('completed', 'discarded', 'cancelled')`,
        [at, at, id],
      )
      return result.changes === 1
    },

    async retryNow(id) {
      const at = now().toISOString()
      const result = await adapter.run(
        `UPDATE ket_job SET state = 'available', scheduled_at = ${p(1)}, completed_at = NULL,
         worker_id = NULL, lease_until = NULL,
         max_attempts = CASE WHEN max_attempts <= attempt THEN attempt + 1 ELSE max_attempts END,
         updated_at = ${p(2)}
         WHERE id = ${p(3)} AND state IN ('retryable', 'discarded')`,
        [at, at, id],
      )
      if (result.changes === 1 && options.notify !== false && adapter.notifications)
        await adapter.notifications.publish(JOB_CHANNEL, (await get(id))?.queue ?? '')
      return result.changes === 1
    },

    async rescue(o = {}) {
      const at = now()
      const limit = Math.max(1, Math.min(1_000, o.limit ?? 100))
      const rows = await adapter.all(
        `SELECT * FROM ket_job
         WHERE state = 'executing' AND lease_until < ${p(1)}
         ORDER BY lease_until, id LIMIT ${p(2)}`,
        [at.toISOString(), limit],
      )
      let retried = 0
      let discarded = 0
      for (const job of rows.map(toJob)) {
        // The observed worker id acts as the lease token. Concurrent rescuers can
        // both see this row, but only one guarded transition can still own it.
        if (job.attempt >= job.maxAttempts) {
          if (await discardExecuting(job.id, new Error('worker lease expired'), job.workerId, job))
            discarded++
        } else {
          if (await retryExecuting(job.id, new Error('worker lease expired'), at, job.workerId, job))
            retried++
        }
      }
      return { retried, discarded }
    },

    get,

    async list(o = {}) {
      const conditions: string[] = []
      const params: unknown[] = []
      if (o.state) {
        params.push(o.state)
        conditions.push(`state = ${p(params.length)}`)
      }
      if (o.queue) {
        params.push(o.queue)
        conditions.push(`queue = ${p(params.length)}`)
      }
      params.push(Math.max(1, Math.min(1_000, o.limit ?? 100)))
      const rows = await adapter.all(
        `SELECT * FROM ket_job${conditions.length ? ` WHERE ${conditions.join(' AND ')}` : ''}
         ORDER BY inserted_at DESC LIMIT ${p(params.length)}`,
        params,
      )
      return rows.map(toJob)
    },

    async prune(o = {}) {
      const completed = (o.completedBefore ?? new Date(now().getTime() - 7 * 86_400_000)).toISOString()
      const discarded = (o.discardedBefore ?? new Date(now().getTime() - 30 * 86_400_000)).toISOString()
      const result = await adapter.run(
        `DELETE FROM ket_job
         WHERE (state IN ('completed', 'cancelled') AND completed_at < ${p(1)})
            OR (state = 'discarded' AND completed_at < ${p(2)})`,
        [completed, discarded],
      )
      return result.changes
    },

    async pending(name) {
      const rows = await adapter.all(
        `SELECT COUNT(*) AS count FROM ket_job
         WHERE queue = ${p(1)} AND state IN ('available', 'scheduled', 'retryable')`,
        [name],
      )
      return Number(rows[0]?.count ?? 0)
    },

    async fail(id) {
      await queue.retry(id, new Error('released after failure'), now())
    },

    async release(id) {
      const at = now().toISOString()
      await adapter.run(
        `UPDATE ket_job SET state = 'available', scheduled_at = ${p(1)}, worker_id = NULL,
         lease_until = NULL, updated_at = ${p(2)} WHERE id = ${p(3)} AND state = 'executing'`,
        [at, at, id],
      )
    },
  }
  return queue
}

const cache = new WeakMap<Adapter, Promise<Queue>>()

export function queueFor(adapter: Adapter): Promise<Queue> {
  let queue = cache.get(adapter)
  if (!queue) {
    queue = createQueue(adapter)
    cache.set(adapter, queue)
  }
  return queue
}
