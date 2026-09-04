// A logger is a driver plus the context every record from this call site carries.
//
// Context is bound, not ambient. There is no AsyncLocalStorage here and that is a
// decision, not an omission: ctx.ts exists so that "the call forgot its context"
// cannot be written down, and a module-scope `log.info()` picking up its tenant
// from ambient state is exactly the pattern that file rejects for data. Everything
// in KetJS is already handed a ctx, so ambient propagation would buy nothing and
// cost the invariant.

import { createHash, createHmac } from 'node:crypto'
import { KetError } from '../../kernel/errors.ts'
import type { LogDriver, LogError, LogFields, LogLevel, LogProcess, LogRecord } from './types.ts'

const STACK_MAX = 2_000

/** What a logger knows without being told again. */
export type LogContext = {
  deployment: string
  process: LogProcess
  tenant?: string | null
  /** Already hashed — see `traceOf`. */
  trace?: string | null
  fn?: string
  /** Already hashed. */
  actor?: string | null
  company?: string | null
  dryRun?: boolean
}

/** The general form, for call sites that set several fields at once. */
export type LogEntry = {
  level: LogLevel
  event: string
  message?: string
  fn?: string
  durationMs?: number
  dryRun?: boolean
  replayed?: boolean
  error?: unknown
  fields?: LogFields
}

export type Logger = {
  log(entry: LogEntry): void
  debug(event: string, fields?: LogFields): void
  info(event: string, fields?: LogFields): void
  warn(event: string, fields?: LogFields): void
  /** The cause is `unknown` because that is what `catch` gives you. */
  error(event: string, cause?: unknown, fields?: LogFields): void
  child(context: Partial<LogContext>): Logger
}

/**
 * Pseudonymise a correlation id or an actor id for export.
 *
 * HMAC rather than a bare digest, and the key is the deployment secret for two
 * reasons. A correlation id is often a client-chosen command key — POS sets it to
 * the idempotency key — so a bare SHA-256 of `order-42` is recovered by guessing,
 * which is acceptable inside one tenant's own database and is not acceptable in a
 * log aggregator shared by every tenant. And `config.secret` is already required to
 * be identical on every pod, so the web process and the worker process derive the
 * same value for the same request, which is the only reason this field is useful.
 *
 * Truncated to 64 bits: enough to correlate within an incident, not a durable
 * identifier for anything.
 */
export function traceOf(value: string | null | undefined, secret: string | null): string | null {
  const held = String(value ?? '').trim()
  if (!held) return null
  const digest = secret
    ? createHmac('sha256', secret).update(held).digest('hex')
    : createHash('sha256').update(`ketjs:trace\n${held}`).digest('hex')
  return digest.slice(0, 16)
}

export function describeError(cause: unknown, withStack: boolean): LogError {
  if (cause instanceof KetError) {
    return {
      code: cause.code,
      message: cause.message,
      module: cause.module,
      ...(withStack && cause.stack ? { stack: cause.stack.slice(0, STACK_MAX) } : {}),
    }
  }
  if (cause instanceof Error) {
    return {
      code: 'E_UNEXPECTED',
      message: `${cause.name}: ${cause.message}`,
      module: null,
      ...(withStack && cause.stack ? { stack: cause.stack.slice(0, STACK_MAX) } : {}),
    }
  }
  return { code: 'E_UNEXPECTED', message: String(cause), module: null }
}

export function createLogger(
  driver: LogDriver,
  context: LogContext,
  now: () => Date = () => new Date(),
): Logger {
  const emit = (entry: LogEntry): void => {
    const fn = entry.fn ?? context.fn
    const dryRun = entry.dryRun ?? context.dryRun
    const record: LogRecord = {
      at: now().toISOString(),
      level: entry.level,
      event: entry.event,
      deployment: context.deployment,
      process: context.process,
      tenant: context.tenant ?? null,
      trace: context.trace ?? null,
      ...(entry.message === undefined ? {} : { message: entry.message }),
      ...(fn === undefined ? {} : { fn }),
      ...(context.actor === undefined || context.actor === null ? {} : { actor: context.actor }),
      ...(context.company === undefined || context.company === null ? {} : { company: context.company }),
      ...(entry.durationMs === undefined ? {} : { durationMs: entry.durationMs }),
      ...(dryRun ? { dryRun: true } : {}),
      ...(entry.replayed ? { replayed: true } : {}),
      ...(entry.error === undefined ? {} : { error: describeError(entry.error, entry.level === 'error') }),
      ...(entry.fields === undefined ? {} : { fields: entry.fields }),
    }
    // One record per call rather than a batch, because a caller that had a batch
    // would have to hold it, and holding is what `bufferedLog` is for.
    driver.write([record])
  }

  return {
    log: emit,
    debug: (event, fields) => emit({ level: 'debug', event, ...(fields ? { fields } : {}) }),
    info: (event, fields) => emit({ level: 'info', event, ...(fields ? { fields } : {}) }),
    warn: (event, fields) => emit({ level: 'warn', event, ...(fields ? { fields } : {}) }),
    error: (event, cause, fields) =>
      emit({
        level: 'error',
        event,
        ...(cause === undefined ? {} : { error: cause }),
        ...(fields ? { fields } : {}),
      }),
    child: (extra) => createLogger(driver, { ...context, ...extra }, now),
  }
}
