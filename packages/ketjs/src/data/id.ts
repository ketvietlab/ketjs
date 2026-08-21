// Row ids: one number, sortable by the time it was made.
//
//   id = millisecondsSinceEpoch * 2048 + counter
//
// Sortable because the high bits are a clock. Numeric because a foreign key is
// compared and indexed far more often than it is read aloud. Not a sequence,
// because a sequence has to be asked — and a handler that must round-trip to the
// database to learn an id cannot build a graph of rows in one pass.
//
// Uniqueness is per database, which is the whole reason this fits in 53 bits: no
// node identifier has to be carved out of the number, so none can be misconfigured.
//
// What an id is NOT: a secret. It carries the millisecond it was made, and two rows
// written in the same millisecond are adjacent. Anything reachable by a stranger
// needs its own unguessable handle — see docs/00-decisions.md.

import { KetError } from '../kernel/errors.ts'

/**
 * 2026-01-01T00:00:00Z. Fixed forever: moving it would renumber the world, and
 * ids already written would collide with ids not yet written.
 */
export const ID_EPOCH_MS = Date.UTC(2026, 0, 1)

/** 11 bits. 2048 ids per millisecond per database is 2M rows/second. */
export const ID_COUNTER_BITS = 11
export const ID_COUNTER_RANGE = 2 ** ID_COUNTER_BITS

/**
 * A clock that jumps back further than this is a broken host, not NTP jitter.
 * Below it we hold the line; above it we refuse, because ids minted under a clock
 * nobody can explain are rows nobody can explain later.
 */
const MAX_CLOCK_REGRESSION_MS = 5_000

export type IdGenerator = {
  /** The next id. Never returns the same number twice in one process. */
  next(): number
  /** For diagnostics and support: what a valid id says about itself. */
  decode(id: number): { at: Date; counter: number }
}

export type IdGeneratorOptions = {
  /** Milliseconds since the Unix epoch. Injected so a clock can be tested. */
  now?: () => number
  /** [0, 1). Injected so collisions between writers can be tested. */
  random?: () => number
  /** Called once when the clock is seen to move backwards inside tolerance. */
  onClockRegression?: (byMs: number) => void
}

export const decodeId = (id: number): { at: Date; counter: number } => {
  if (!Number.isSafeInteger(id) || id < 0) {
    throw new KetError({
      code: 'E_INVALID_ID',
      message: `cannot decode invalid row id ${String(id)}`,
      hint: 'a row id must be a non-negative safe JavaScript integer',
    })
  }
  return {
    // Not `id >>> 11`: JavaScript's bitwise operators truncate to 32 bits, so a
    // shift would be wrong from the very first id. Division is the only correct
    // spelling above 2^31, and the reason this function exists rather than being
    // inlined at each call site.
    at: new Date(Math.floor(id / ID_COUNTER_RANGE) + ID_EPOCH_MS),
    counter: id % ID_COUNTER_RANGE,
  }
}

export function createIdGenerator(o: IdGeneratorOptions = {}): IdGenerator {
  const now = o.now ?? Date.now
  const random = o.random ?? Math.random

  let lastMs = -1
  let counter = 0
  /** How many of this millisecond's 2048 slots we have handed out. */
  let issued = 0
  let regressionActive = false

  const readClock = (): number => {
    const ms = now()
    if (!Number.isSafeInteger(ms)) {
      throw new KetError({
        code: 'E_INVALID_ID_CLOCK',
        message: `the id clock returned ${String(ms)}`,
        hint: 'the id clock must return an integer number of milliseconds since the Unix epoch',
      })
    }
    if (lastMs === -1 && ms < ID_EPOCH_MS) {
      throw new KetError({
        code: 'E_CLOCK_BEFORE_EPOCH',
        message: `the clock reads ${new Date(ms).toISOString()}, before the id epoch`,
        hint: 'the host clock is wrong, or someone moved ID_EPOCH_MS',
      })
    }
    if (ms >= lastMs) {
      regressionActive = false
      return ms
    }

    const behind = lastMs - ms
    if (behind > MAX_CLOCK_REGRESSION_MS) {
      throw new KetError({
        code: 'E_CLOCK_REGRESSION',
        message: `the clock moved back ${behind}ms; refusing to mint ids`,
        hint: 'check NTP on this host — ids minted across a large backwards jump cannot be ordered afterwards',
      })
    }
    // Inside tolerance the clock is treated as monotonic by fiat: we keep
    // issuing from where we were, so ids stay in the same time bucket and none
    // repeats. Report one warning per regression incident.
    if (!regressionActive) {
      regressionActive = true
      o.onClockRegression?.(behind)
    }
    return lastMs
  }

  const startOfMillisecond = (ms: number): void => {
    lastMs = ms
    // A random start rather than zero, and rather than a configured node id.
    // Two processes beginning every millisecond at zero would collide on their
    // first id; a node id read from the environment collides silently and forever
    // when two pods are given the same one. A random start makes a collision
    // unlikely and the primary key makes it loud — the database is the arbiter,
    // which is the only participant that cannot be misconfigured into agreeing.
    const entropy = random()
    if (!Number.isFinite(entropy) || entropy < 0 || entropy >= 1) {
      throw new KetError({
        code: 'E_INVALID_ID_ENTROPY',
        message: `the id entropy source returned ${String(entropy)}`,
        hint: 'the id entropy source must return a number in the range [0, 1)',
      })
    }
    counter = Math.floor(entropy * ID_COUNTER_RANGE)
    issued = 0
  }

  return {
    next(): number {
      const ms = readClock()

      if (ms !== lastMs) startOfMillisecond(ms)

      // The millisecond is full. Spilling into the next one's range would break
      // both ordering and uniqueness, so wait for the clock instead. At 2048 ids
      // per millisecond this is unreachable outside a benchmark.
      if (issued >= ID_COUNTER_RANGE) {
        let spin = readClock()
        while (spin <= lastMs) spin = readClock()
        startOfMillisecond(spin)
      }

      const value = (lastMs - ID_EPOCH_MS) * ID_COUNTER_RANGE + counter
      counter = (counter + 1) % ID_COUNTER_RANGE
      issued++

      if (!Number.isSafeInteger(value)) {
        throw new KetError({
          code: 'E_ID_EXHAUSTED',
          message: `id ${value} is past Number.MAX_SAFE_INTEGER`,
          hint: 'the 42-bit millisecond range ran out — this cannot happen before 2165 unless the epoch or the counter width changed',
        })
      }
      return value
    },

    decode: decodeId,
  }
}
