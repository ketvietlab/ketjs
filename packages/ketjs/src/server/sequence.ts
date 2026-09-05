// Document numbers.
//
// Every ERP needs them and every module was writing its own: a counter row, a
// read, a compare-and-set, a retry loop. Written twice already, correctly both
// times but not identically — one of the two retries thirty-two times with no
// backoff, which spins hottest exactly when the counter is contended. That is the
// shape of a primitive that should exist once.
//
// The framework returns a number and never a string. How a number becomes
// "S00001" or "POS/00042" is the domain's, and a framework that decided it would
// be deciding an invoice format for a tax authority it has never heard of.

import { KetError } from '../kernel/errors.ts'
import type { Adapter, Scope } from '../types.ts'

const DDL = `
CREATE TABLE IF NOT EXISTS ket_sequence (
  id     TEXT PRIMARY KEY,
  next   INTEGER NOT NULL
)`

const prepared = new WeakSet<Adapter>()

async function prepare(adapter: Adapter): Promise<void> {
  if (prepared.has(adapter)) return
  await adapter.run(DDL, [])
  prepared.add(adapter)
}

export type SequenceOptions = {
  /**
   * Where the count starts, the first time anybody asks. Defaults to 1.
   */
  start?: number
  /**
   * Count once for the whole tenant instead of once per company.
   *
   * The default is per company because that is what an ERP means by a document
   * number, and because a shared counter reached by forgetting to scope one is a
   * bug nobody sees until two legal entities have issued the same invoice number.
   */
  shared?: boolean
}

const NAME = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*$/

export const sequenceKey = (name: string, scope: Scope, shared: boolean): string =>
  shared ? `-\n${name}` : `${scope.company ?? '-'}\n${name}`

/**
 * Take the next number in a named sequence.
 *
 * The read and the compare-and-set are retried with jittered backoff, because
 * every document of one kind funnels through one row: a bulk import is a stampede
 * by design, and losing the race there is normal rather than exceptional. What must
 * not happen is giving up while the row is live, which would turn a perfectly good
 * order into a spurious failure.
 *
 * Whether the numbers are gapless is decided by the caller, not here. Taken inside
 * the transaction that writes the document, a rollback takes the number back with
 * it. Taken outside, a later failure leaves a gap, and no counter can know that
 * happened.
 */
export async function nextSequenceNumber(
  adapter: Adapter,
  name: string,
  o: { scope: Scope; dryRun?: boolean; random?: () => number } & SequenceOptions,
): Promise<number> {
  if (!NAME.test(name)) {
    throw new KetError({
      code: 'E_SEQUENCE_NAME',
      message: `"${name}" is not a sequence name`,
      hint: 'use a qualified lowercase identifier, for example "sale.order"',
    })
  }
  const start = Math.max(1, Math.floor(o.start ?? 1))
  const id = sequenceKey(name, o.scope, o.shared === true)
  await prepare(adapter)

  const pg = adapter.name === 'postgres'
  const p = (n: number) => (pg ? `$${n}` : '?')
  const random = o.random ?? Math.random
  const read = async (): Promise<number | null> => {
    const rows = await adapter.all(`SELECT next FROM ket_sequence WHERE id = ${p(1)}`, [id])
    return rows[0] === undefined ? null : Number((rows[0] as { next: unknown }).next)
  }

  // A preview must not consume a number: the real command that follows would then
  // skip one, and the caller would have been shown a number nobody ever used.
  if (o.dryRun) return (await read()) ?? start

  for (let attempt = 0; attempt < 64; attempt += 1) {
    const current = await read()
    if (current === null) {
      const inserted = await adapter.run(
        `INSERT INTO ket_sequence (id, next) VALUES (${p(1)}, ${p(2)}) ON CONFLICT DO NOTHING`,
        [id, start + 1],
      )
      if (inserted.changes > 0) return start
      continue
    }
    const moved = await adapter.run(
      `UPDATE ket_sequence SET next = ${p(1)} WHERE id = ${p(2)} AND next = ${p(3)}`,
      [current + 1, id, current],
    )
    if (moved.changes > 0) return current
    // Spread the herd instead of letting it collide again at full speed.
    if (attempt >= 2) {
      const ceiling = Math.min(100, 2 ** (attempt - 2))
      await new Promise((resolve) => setTimeout(resolve, ceiling * (0.5 + random())))
    }
  }
  throw new KetError({
    code: 'E_SEQUENCE_CONTENDED',
    message: `sequence "${name}" did not settle after 64 concurrent updates`,
    hint: 'one row is carrying more concurrent allocation than it can; split the sequence',
  })
}

/** What a sequence stands at, without taking a number. */
export async function peekSequenceNumber(
  adapter: Adapter,
  name: string,
  o: { scope: Scope; shared?: boolean; start?: number },
): Promise<number> {
  await prepare(adapter)
  const pg = adapter.name === 'postgres'
  const rows = await adapter.all(`SELECT next FROM ket_sequence WHERE id = ${pg ? '$1' : '?'}`, [
    sequenceKey(name, o.scope, o.shared === true),
  ])
  return rows[0] === undefined
    ? Math.max(1, Math.floor(o.start ?? 1))
    : Number((rows[0] as { next: unknown }).next)
}
