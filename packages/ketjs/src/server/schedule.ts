// Claiming a due tick, which is the one part a queue cannot help with.
//
// A schedule does not run anything: it decides that a tick is due and enqueues the
// ordinary job, which then goes through the machinery that already exists — leases,
// retries, timeouts, abort signals, records. That reuse is why this file is short.
//
// Several worker replicas looking at one schedule at the same moment must still
// produce exactly one run. The queue's `uniqueKey` is not enough: it holds only
// while a job is live and is released the moment one completes, so a tick that
// finished an hour ago would be enqueued again. The claim is therefore durable and
// monotonic — one row per job per tenant database holding the last tick anybody
// enqueued, moved forward with a compare-and-set. Whoever's update changes a row
// won, and there is no leader to elect.

import { tickAt, ticksBetween } from '../kernel/schedule.ts'
import type { Adapter, JobSchedule, Manifest } from '../types.ts'

// Text columns and no types either adapter spells differently, so one statement
// serves both — the same reason ket_job stores its timestamps as ISO text.
const DDL = `
CREATE TABLE IF NOT EXISTS ket_schedule (
  job        TEXT PRIMARY KEY,
  last_tick  TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`

const prepared = new WeakSet<Adapter>()

async function prepare(adapter: Adapter): Promise<void> {
  if (prepared.has(adapter)) return
  await adapter.run(DDL, [])
  prepared.add(adapter)
}

export type ScheduleClaim = { job: string; tick: string; skipped: number }

/**
 * Move every due schedule forward in one tenant database, and say which moved.
 *
 * The caller enqueues what comes back. Claiming before enqueueing means a crash
 * between the two loses one tick rather than running it twice, which is the right
 * way round for anything that touches money.
 */
export async function claimDue(
  adapter: Adapter,
  manifest: Manifest,
  o: { now: Date; timezone: string },
): Promise<ScheduleClaim[]> {
  const scheduled = Object.entries(manifest.jobs).filter(([, meta]) => meta.schedule)
  if (!scheduled.length) return []
  await prepare(adapter)

  const claims: ScheduleClaim[] = []
  const pg = adapter.name === 'postgres'
  const p = (n: number) => (pg ? `$${n}` : '?')
  for (const [job, meta] of scheduled) {
    const schedule = meta.schedule as JobSchedule
    const tick = tickAt(schedule, o.now, o.timezone)
    const at = o.now.toISOString()

    // A schedule seen for the first time does not fire for the tick it happened to
    // start inside: nobody asked for a run at deploy time, and a nightly job that
    // fires the moment it is installed is a surprise at the worst moment.
    const inserted = await adapter.run(
      `INSERT INTO ket_schedule (job, last_tick, updated_at) VALUES (${p(1)}, ${p(2)}, ${p(3)})
       ON CONFLICT DO NOTHING`,
      [job, tick, at],
    )
    if (inserted.changes > 0) continue

    const rows = await adapter.all(`SELECT last_tick FROM ket_schedule WHERE job = ${p(1)}`, [job])
    const last = rows[0] === undefined ? null : String((rows[0] as { last_tick: unknown }).last_tick)
    if (last === null || last >= tick) continue

    const moved = await adapter.run(
      `UPDATE ket_schedule SET last_tick = ${p(1)}, updated_at = ${p(2)}
       WHERE job = ${p(3)} AND last_tick = ${p(4)}`,
      [tick, at, job, last],
    )
    // Lost the compare-and-set: another replica claimed this tick. That is the
    // whole mutual exclusion, and losing it is the normal case rather than a fault.
    if (moved.changes === 0) continue
    claims.push({ job, tick, skipped: ticksBetween(schedule, last, tick) })
  }
  return claims
}
