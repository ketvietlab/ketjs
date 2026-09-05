// A durable ceiling on how often something may be done.
//
// Durable, because the alternative is a Map in one process: two replicas then
// enforce two independent limits and the ceiling is whatever the load balancer
// decides. The state lives in the tenant's own database for the same reason every
// other piece of framework state does — a tenant's limits are that tenant's.
//
// What this is not: protection from volume. Every check costs a database round
// trip, so pointing it at all traffic makes an attacker's job easier rather than
// harder. It exists to bound what one identified caller may repeat — sign-in
// attempts, token refreshes, an expensive report — and a volumetric flood belongs
// to whatever sits in front of the process.
//
// Fixed window rather than a token bucket, because `limit per windowMs` is what a
// person means and a bucket quietly changes it. The cost is stated: a caller can
// spend a full allowance at the end of one window and another at the start of the
// next, so the real worst case across a boundary is twice the limit.

import { createHash } from 'node:crypto'
import type { Adapter } from '../types.ts'

const DDL = `
CREATE TABLE IF NOT EXISTS ket_rate (
  id           TEXT PRIMARY KEY,
  action       TEXT NOT NULL,
  window_start TEXT NOT NULL,
  count        INTEGER NOT NULL
)`

const prepared = new WeakSet<Adapter>()

async function prepare(adapter: Adapter): Promise<void> {
  if (prepared.has(adapter)) return
  await adapter.run(DDL, [])
  prepared.add(adapter)
}

/**
 * What the caller is allowed, and how it is counted.
 *
 * `key` identifies who is being limited — an account id, a hashed address, a
 * device. It is hashed together with the action before it is stored, so the table
 * holds no identity of its own: a rate-limit row is a counter, and there is no
 * reason for it to also be a record of who was somewhere.
 */
export type RatePolicy = {
  /** A stable, low-cardinality name for the thing being limited. */
  action: string
  key: string
  limit: number
  windowMs: number
}

export type RateVerdict = {
  ok: boolean
  /** Allowance left in this window. Zero when refused. */
  remaining: number
  /** How long until the window resets. Answer a refusal with it. */
  retryAfterMs: number
}

const idOf = (action: string, key: string): string =>
  createHash('sha256').update(`ketrate\n${action}\n${key}`).digest('hex').slice(0, 32)

/**
 * Spend one slot, or refuse.
 *
 * The read-then-compare-and-set is retried because losing the race is the normal
 * case under exactly the load this exists for: every replica checking the same
 * counter at once is not a fault, it is Tuesday. Running out of attempts refuses
 * rather than allows — under contention the safe answer is the closed one.
 */
export async function claimRateSlot(
  adapter: Adapter,
  policy: RatePolicy,
  o: { now?: Date } = {},
): Promise<RateVerdict> {
  const limit = Math.max(1, Math.floor(policy.limit))
  const windowMs = Math.max(1, Math.floor(policy.windowMs))
  const now = o.now ?? new Date()
  const action = policy.action.slice(0, 120)
  const id = idOf(action, policy.key)
  await prepare(adapter)

  const pg = adapter.name === 'postgres'
  const p = (n: number) => (pg ? `$${n}` : '?')
  const refused = (startedAt: number): RateVerdict => ({
    ok: false,
    remaining: 0,
    retryAfterMs: Math.max(1, startedAt + windowMs - now.getTime()),
  })

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const rows = await adapter.all(`SELECT window_start, count FROM ket_rate WHERE id = ${p(1)}`, [id])
    const held = rows[0] as { window_start: unknown; count: unknown } | undefined

    if (!held) {
      const inserted = await adapter.run(
        `INSERT INTO ket_rate (id, action, window_start, count) VALUES (${p(1)}, ${p(2)}, ${p(3)}, 1)
         ON CONFLICT DO NOTHING`,
        [id, action, now.toISOString()],
      )
      if (inserted.changes > 0) return { ok: true, remaining: limit - 1, retryAfterMs: 0 }
      continue
    }

    const startedAt = Date.parse(String(held.window_start))
    const count = Number(held.count)
    const inWindow = Number.isFinite(startedAt) && now.getTime() - startedAt < windowMs
    if (inWindow && count >= limit) return refused(startedAt)

    const nextStart = inWindow ? String(held.window_start) : now.toISOString()
    const nextCount = inWindow ? count + 1 : 1
    const moved = await adapter.run(
      `UPDATE ket_rate SET window_start = ${p(1)}, count = ${p(2)}
       WHERE id = ${p(3)} AND window_start = ${p(4)} AND count = ${p(5)}`,
      [nextStart, nextCount, id, String(held.window_start), count],
    )
    if (moved.changes > 0) {
      return { ok: true, remaining: Math.max(0, limit - nextCount), retryAfterMs: 0 }
    }
  }
  // Eight lost races means the counter is genuinely hot, which is the situation a
  // limit is for. Refusing is the honest answer; allowing would make contention a
  // way through it. The wait offered is short, though: losing a race is this
  // process's problem, and charging the caller a full window for it would be
  // punishing them for somebody else's traffic.
  return { ok: false, remaining: 0, retryAfterMs: 1_000 }
}

/**
 * Drop counters nobody has touched for a while.
 *
 * A row for an active key is reused rather than added to, so growth comes only
 * from keys never seen again — a one-off address, a deleted account. Left alone
 * that is unbounded, which is why this exists and why the worker calls it.
 */
export async function pruneRateSlots(
  adapter: Adapter,
  o: { olderThanMs?: number; now?: Date } = {},
): Promise<{ removed: number }> {
  const now = o.now ?? new Date()
  const olderThanMs = Math.max(60_000, o.olderThanMs ?? 24 * 3_600_000)
  await prepare(adapter)
  const pg = adapter.name === 'postgres'
  const cutoff = new Date(now.getTime() - olderThanMs).toISOString()
  const removed = await adapter.run(`DELETE FROM ket_rate WHERE window_start < ${pg ? '$1' : '?'}`, [cutoff])
  return { removed: removed.changes }
}
