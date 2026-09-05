// Operational logging. Not audit, and the difference is the whole design.
//
// An audit trail is durable business evidence: it lives in the tenant's database,
// it is queryable by the application, it is part of a domain contract, and it rolls
// back with the transaction that wrote it. KetSuite already has one.
//
// A log is none of those things. It is ephemeral operational telemetry for whoever
// is holding the pager, it leaves the process immediately, the application can never
// read it back, and a log written inside a transaction that later rolls back must
// still go out — the attempt was real, and knowing it failed is the entire point.
//
// Building either one with the other's machinery is the mistake this file exists to
// prevent, so nothing here writes to a database and nothing here is transactional.

/**
 * Four levels, for filtering.
 *
 * No `trace`: that is a tracer's job, and a duration on every record answers most
 * of what a span is opened for. No `fatal`: that is an error plus a decision to end
 * the process, and the second half is not a logging concern.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

export const atLeast = (level: LogLevel, min: LogLevel): boolean => ORDER[level] >= ORDER[min]

export const isLogLevel = (value: string): value is LogLevel => Object.hasOwn(ORDER, value)

/** Which built-in sink to open. `auto` decides by whether stderr is a terminal. */
export type LogDriverName = 'auto' | 'console' | 'pretty' | 'file' | 'null'

const DRIVER_NAMES: readonly string[] = ['auto', 'console', 'pretty', 'file', 'null']

export const isLogDriverName = (value: string): value is LogDriverName => DRIVER_NAMES.includes(value)

/** Which process role emitted a record. Low cardinality on purpose: it is a label. */
export type LogProcess = 'http' | 'worker' | 'cli' | 'test'

/**
 * Extra fields on a record.
 *
 * Scalars only, and that restriction is the point rather than a limitation: the
 * usual way a customer payload reaches a log aggregator is somebody writing
 * `log.info('saved', { input })`. Here that does not typecheck. Values arriving
 * from JavaScript callers or from `catch (e)` are still sanitized at runtime by
 * `redactLog`, because a type cannot check what never had a type.
 */
export type LogFields = Readonly<Record<string, string | number | boolean | null>>

/**
 * A failure, reduced to what is worth keeping.
 *
 * `stack` is present only on error-level records and is truncated: it is the whole
 * value of an `unhandled` record, and worthless everywhere else.
 */
export type LogError = { code: string; message: string; module: string | null; stack?: string }

/**
 * One event, already carrying enough context to be read without grepping elsewhere.
 *
 * `at` is filled by the pipeline rather than by each driver, so every driver
 * reporting the same batch reports the same instant.
 */
export type LogRecord = {
  at: string
  level: LogLevel
  /**
   * A stable noun that can be counted, not a sentence: `fn_error`, not
   * "the function failed". Framework events come from `CoreEvent`; a module's
   * own events must be namespaced `<module>.<event>`.
   */
  event: string
  /** For a human. Optional, because event plus fields is usually already enough. */
  message?: string
  deployment: string
  process: LogProcess
  /** Null for a single-tenant deployment. Never promoted to a log label: unbounded. */
  tenant: string | null
  /**
   * Correlation, already hashed. The raw value never reaches a record: the
   * framework does not persist or export it, and a log aggregator is an export.
   */
  trace: string | null
  fn?: string
  /** Hashed, by the same rule as `trace`. */
  actor?: string | null
  company?: string | null
  durationMs?: number
  /** A preview is not an execution, and a dashboard must not count it as one. */
  dryRun?: boolean
  /** An idempotent replay is not a second execution either. */
  replayed?: boolean
  error?: LogError
  fields?: LogFields
}

/**
 * A sink.
 *
 * `write` returns nothing rather than a promise, deliberately. An await inside the
 * request path changes interleaving and produces bugs that only appear under load,
 * and a logging call that can be forgotten with a missing `await` is a logging call
 * that will be. A driver needing I/O buffers internally and exposes `flush`.
 *
 * The cost, stated: a driver cannot apply backpressure to its caller. That is the
 * intended trade — dropping records is better than stalling the work being logged —
 * and every buffering driver here therefore has a bound and reports what it dropped.
 */
export type LogDriver = {
  name: string
  write(records: readonly LogRecord[]): void
  /** Push everything held. Called on shutdown, and by tests. */
  flush?(): Promise<void>
  close?(): Promise<void>
}

/** How a deployment opens a sink the framework does not own. Mirrors OpenStore. */
export type OpenLog = (config: import('../config.ts').RuntimeConfig) => LogDriver | Promise<LogDriver>

/**
 * Every event the framework itself emits.
 *
 * A closed list rather than free strings because an event name is a contract:
 * dashboards and alerts key on it, and renaming one breaks an alert silently —
 * the same failure mode, and so the same care, as renaming a permission. It is a
 * value as well as a type so that a test can check the documented catalogue
 * against it rather than trusting that both were updated.
 */
export const CORE_EVENTS = [
  'boot',
  'shutdown',
  'http_request',
  'unhandled',
  'fn_call',
  'fn_error',
  'fn_denied',
  'policy_denied',
  'job_started',
  'job_completed',
  'job_retrying',
  'job_discarded',
  'job_cancelled',
  'job_ignored_abort',
  'rate_limited',
  'rate_pruned',
  'schedule_fired',
  'schedule_error',
  'worker_tick_error',
  'queue_notifier_unavailable',
  'log_dropped',
  'log_driver_failed',
] as const

export type CoreEvent = (typeof CORE_EVENTS)[number]

/** `<module>.<event>`, the same shape a domain policy key must have. */
export const MODULE_EVENT = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/

/** Discards everything. */
export function nullLog(): LogDriver {
  return { name: 'null', write: () => {} }
}
