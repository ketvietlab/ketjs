// Drivers stay primitive; behaviour is composed. This is where "several drivers"
// actually lives, so that a fan-out, a level filter, a bound on memory and an
// isolation boundary are four small things that can be reasoned about separately
// rather than four flags on every driver.

import type { LogDriver, LogFields, LogLevel, LogRecord } from './types.ts'
import { atLeast } from './types.ts'

/** Keys whose value is never worth the risk, matched as a lower-case substring. */
const DENY = [
  'password',
  'passwd',
  'secret',
  'token',
  'authorization',
  'cookie',
  'apikey',
  'api_key',
  'privatekey',
  'private_key',
  'credential',
  'card',
  'cvv',
  'ssn',
  'otp',
  'pin',
]

const VALUE_MAX = 512
const MESSAGE_MAX = 1_000

/**
 * Fan out to several sinks.
 *
 * A driver that throws must not stop the drivers after it, so this catches as a
 * last resort. It reports nothing: wrap the risky driver in `isolatedLog` when a
 * failure should be visible rather than merely survivable.
 */
export function multiLog(drivers: readonly LogDriver[]): LogDriver {
  return {
    name: `multi(${drivers.map((d) => d.name).join(',')})`,
    write(records) {
      for (const driver of drivers) {
        try {
          driver.write(records)
        } catch {
          /* a sink is never allowed to break the work it is describing */
        }
      }
    },
    async flush() {
      for (const driver of drivers) {
        try {
          await driver.flush?.()
        } catch {}
      }
    },
    async close() {
      for (const driver of drivers) {
        try {
          await driver.close?.()
        } catch {}
      }
    },
  }
}

/** Drop anything below `min`. Cheapest when it is the outermost wrapper. */
export function leveledLog(driver: LogDriver, min: LogLevel): LogDriver {
  return {
    name: `leveled(${driver.name},${min})`,
    write(records) {
      const kept = records.filter((r) => atLeast(r.level, min))
      if (kept.length) driver.write(kept)
    },
    flush: driver.flush ? () => driver.flush!() : undefined,
    close: driver.close ? () => driver.close!() : undefined,
  }
}

const dropNotice = (like: LogRecord, count: number, sinceMs: number, reason: string): LogRecord => ({
  at: new Date().toISOString(),
  level: 'warn',
  event: 'log_dropped',
  deployment: like.deployment,
  process: like.process,
  tenant: null,
  trace: null,
  fields: { count, sinceMs, reason },
})

/**
 * Batch, with a bound on memory and a visible gap when that bound is reached.
 *
 * Newest is dropped rather than oldest: in a cascade the first failure is the
 * cause and the tail is repetition. A slice of the bound is reserved for
 * error-level records, so a flood of `info` can never bury the errors explaining
 * it. Whatever is dropped is announced — a silent gap in a log is worse than a
 * gap, because it cannot be distinguished from nothing having happened.
 */
export function bufferedLog(
  driver: LogDriver,
  options: { max?: number; everyMs?: number; errorReserve?: number; batch?: number } = {},
): LogDriver {
  const max = Math.max(1, options.max ?? 10_000)
  const everyMs = Math.max(1, options.everyMs ?? 1_000)
  const reserve = Math.min(0.9, Math.max(0, options.errorReserve ?? 0.25))
  const softMax = Math.max(1, Math.floor(max * (1 - reserve)))
  // Batching exists to amortise I/O, not to hold records back, and a few hundred
  // already amortises it. Waiting for the bound instead would mean a burst inside
  // one interval gets dropped by a buffer the sink could have drained twice over.
  const batch = Math.max(1, Math.min(options.batch ?? 512, max))

  let queue: LogRecord[] = []
  let dropped = 0
  let droppedSince = Date.now()
  let last: LogRecord | null = null

  const drain = (): void => {
    if (!queue.length && !dropped) return
    const pending = queue
    queue = []
    if (dropped && last) {
      pending.unshift(dropNotice(last, dropped, Date.now() - droppedSince, 'buffer_full'))
      dropped = 0
      droppedSince = Date.now()
    }
    if (!pending.length) return
    try {
      driver.write(pending)
    } catch {
      // drain() runs from a timer, where a throw is an uncaught exception and the
      // end of the process. Note that a sink wrapped from the outside cannot help
      // here: this call is beneath that wrapper, not through it.
    }
  }

  // Unreferenced: a log timer must never be the reason a process stays alive.
  const timer = setInterval(drain, everyMs)
  timer.unref?.()

  return {
    name: `buffered(${driver.name})`,
    write(records) {
      for (const record of records) {
        last = record
        const limit = record.level === 'error' ? max : softMax
        if (queue.length >= limit) {
          if (!dropped) droppedSince = Date.now()
          dropped++
          continue
        }
        queue.push(record)
      }
      if (queue.length >= batch) drain()
    },
    async flush() {
      drain()
      await driver.flush?.()
    },
    async close() {
      clearInterval(timer)
      drain()
      await driver.flush?.()
      await driver.close?.()
    },
  }
}

/**
 * Swallow a driver's failures, and say so exactly once.
 *
 * Once, because a sink that fails usually fails for every record, and a fallback
 * flooded with reports of the first sink's failure is a second outage.
 */
export function isolatedLog(driver: LogDriver, fallback?: LogDriver): LogDriver {
  let reported = false
  const report = (like: LogRecord | undefined, cause: unknown): void => {
    if (reported || !fallback || !like) return
    reported = true
    try {
      fallback.write([
        {
          at: new Date().toISOString(),
          level: 'error',
          event: 'log_driver_failed',
          deployment: like.deployment,
          process: like.process,
          tenant: null,
          trace: null,
          error: {
            code: 'E_LOG_DRIVER',
            message: cause instanceof Error ? cause.message : String(cause),
            module: null,
          },
          fields: { driver: driver.name },
        },
      ])
    } catch {}
  }

  return {
    name: `isolated(${driver.name})`,
    write(records) {
      try {
        driver.write(records)
      } catch (cause) {
        report(records[0], cause)
      }
    },
    async flush() {
      try {
        await driver.flush?.()
      } catch (cause) {
        report(undefined, cause)
      }
    },
    async close() {
      try {
        await driver.close?.()
      } catch {}
    },
  }
}

const scalar = (value: unknown): value is string | number | boolean | null =>
  value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'

const clip = (value: string, max: number): string => (value.length <= max ? value : `${value.slice(0, max)}…`)

function redactFields(fields: LogFields | undefined): LogFields | undefined {
  if (!fields) return undefined
  const out: Record<string, string | number | boolean | null> = {}
  for (const [key, value] of Object.entries(fields)) {
    const lower = key.toLowerCase()
    if (DENY.some((needle) => lower.includes(needle))) {
      out[key] = '[redacted]'
      continue
    }
    if (!scalar(value)) {
      // The type forbids this; JavaScript callers do not have the type.
      out[key] = '[dropped: non-scalar]'
      continue
    }
    out[key] = typeof value === 'string' ? clip(value, VALUE_MAX) : value
  }
  return out
}

/**
 * The mandatory outermost wrapper, applied by the runtime and not optional.
 *
 * The type system already refuses a non-scalar field, which stops the common way a
 * customer payload reaches an aggregator. This handles what the type system cannot
 * see: values arriving from JavaScript callers, and from `catch (e)`.
 */
export function redactLog(driver: LogDriver): LogDriver {
  return {
    name: `redacted(${driver.name})`,
    write(records) {
      driver.write(
        records.map((record) => {
          const fields = redactFields(record.fields)
          return {
            ...record,
            ...(record.message === undefined ? {} : { message: clip(record.message, MESSAGE_MAX) }),
            ...(record.error === undefined
              ? {}
              : { error: { ...record.error, message: clip(record.error.message, MESSAGE_MAX) } }),
            ...(fields === undefined ? {} : { fields }),
          }
        }),
      )
    },
    flush: driver.flush ? () => driver.flush!() : undefined,
    close: driver.close ? () => driver.close!() : undefined,
  }
}
