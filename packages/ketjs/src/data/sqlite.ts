// SQLite adapter on node:sqlite. Zero dependencies - this ships inside Node.
import { DatabaseSync } from 'node:sqlite'
import { AsyncLocalStorage } from 'node:async_hooks'
import { assertAdapter } from './adapter.ts'
import type { Adapter, FieldBase, Row } from '../types.ts'
import { dateBucket } from './time.ts'
import { canonicalDecimal, DECIMAL_MAX_CHARS, decimalText } from './changeset.ts'

// Binding rules belong to the adapter, not to the layers above it: SQLite has no
// boolean and no JSON, Postgres has both. Normalising here means every call path —
// query builder, changeset, raw run — is covered once.
const bind = (v: unknown): unknown => {
  if (typeof v === 'boolean') return v ? 1 : 0
  if (v === undefined) return null
  if (v !== null && typeof v === 'object') return JSON.stringify(v)
  return v
}

const SQL: Record<FieldBase, string> = {
  id: 'TEXT PRIMARY KEY',
  text: 'TEXT',
  int: 'INTEGER',
  float: 'REAL',
  decimal: 'TEXT',
  bool: 'INTEGER',
  json: 'TEXT',
  date: 'TEXT',
  datetime: 'TEXT',
  ref: 'TEXT',
}

type DecimalParts = { sign: -1 | 0 | 1; exponent: number; digits: string }
const PLAIN_DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/

/**
 * Exact scientific parts without ever passing through a binary float.
 *
 * `exponent` is the number of integer digits in the normalized value and
 * `digits` has neither leading nor trailing zeroes. Together they let SQLite
 * compare arbitrarily large or finely scaled decimal text exactly while the
 * selected column itself remains TEXT and therefore decodes byte for byte.
 */
const decimalParts = (value: unknown): DecimalParts | null => {
  if (value == null) return null
  if (typeof value !== 'string' && typeof value !== 'number') return null
  let held = typeof value === 'number' ? decimalText(value) : String(value).trim()
  if (held.length > DECIMAL_MAX_CHARS) return null
  if (!PLAIN_DECIMAL.test(held)) return null
  const negative = held.startsWith('-')
  held = held.replace(/^[+-]/, '')
  const [rawWhole = '', fraction = ''] = held.split('.')
  const whole = rawWhole || '0'
  const combined = whole + fraction
  const first = combined.search(/[1-9]/)
  if (first < 0) return { sign: 0, exponent: 0, digits: '' }
  let last = combined.length - 1
  while (combined[last] === '0') last--
  return {
    sign: negative ? -1 : 1,
    exponent: whole.length - first,
    digits: combined.slice(first, last + 1),
  }
}

const compareDecimals = (left: unknown, right: unknown): number | null => {
  const a = decimalParts(left)
  const b = decimalParts(right)
  if (!a || !b) return null
  if (a.sign !== b.sign) return a.sign < b.sign ? -1 : 1
  if (a.sign === 0) return 0
  let magnitude = 0
  if (a.exponent !== b.exponent) magnitude = a.exponent < b.exponent ? -1 : 1
  else if (a.digits !== b.digits) magnitude = a.digits < b.digits ? -1 : 1
  return a.sign === -1 ? -magnitude : magnitude
}

/** One canonical spelling for SQL equality/grouping without losing precision. */
const decimalKey = canonicalDecimal

type ScaledDecimal = { coefficient: bigint; scale: number }

const scaledDecimal = (value: unknown): ScaledDecimal | null => {
  const parts = decimalParts(value)
  if (!parts) return null
  if (parts.sign === 0) return { coefficient: 0n, scale: 0 }
  const coefficient = BigInt(parts.digits) * BigInt(parts.sign)
  return { coefficient, scale: parts.digits.length - parts.exponent }
}

const renderScaledDecimal = ({ coefficient, scale }: ScaledDecimal): string => {
  if (coefficient === 0n) return '0'
  while (coefficient % 10n === 0n) {
    coefficient /= 10n
    scale--
  }
  const sign = coefficient < 0n ? '-' : ''
  const digits = (coefficient < 0n ? -coefficient : coefficient).toString()
  const exponent = digits.length - scale
  if (exponent <= 0) return `${sign}0.${'0'.repeat(-exponent)}${digits}`
  if (exponent >= digits.length) return `${sign}${digits}${'0'.repeat(exponent - digits.length)}`
  return `${sign}${digits.slice(0, exponent)}.${digits.slice(exponent)}`
}

const addDecimals = (left: unknown, right: unknown): string | null => {
  const a = scaledDecimal(left)
  const b = scaledDecimal(right)
  if (!a || !b) return null
  const scale = Math.max(a.scale, b.scale)
  const coefficient =
    a.coefficient * 10n ** BigInt(scale - a.scale) + b.coefficient * 10n ** BigInt(scale - b.scale)
  return renderScaledDecimal({ coefficient, scale })
}

/** Exact division with PostgreSQL NUMERIC's tie-breaking rule. */
const averageDecimal = (held: ScaledDecimal, count: bigint, requestedScale: unknown): string | null => {
  const divisor = count
  const scale = Number(requestedScale)
  if (!Number.isSafeInteger(scale) || scale < 0 || scale > DECIMAL_MAX_CHARS)
    throw new Error(`decimal average scale must be an integer from 0 to ${DECIMAL_MAX_CHARS}`)
  if (divisor === 0n) return null
  if (divisor < 0n) throw new Error('decimal average count must not be negative')

  let numerator = held.coefficient
  let denominator = divisor
  const shift = scale - held.scale
  if (shift >= 0) numerator *= 10n ** BigInt(shift)
  else denominator *= 10n ** BigInt(-shift)

  let rounded = numerator / denominator
  const remainder = numerator % denominator
  const magnitude = remainder < 0n ? -remainder : remainder
  if (magnitude * 2n >= denominator) rounded += numerator < 0n ? -1n : 1n
  const result = renderScaledDecimal({ coefficient: rounded, scale })
  if (result.length > DECIMAL_MAX_CHARS)
    throw new Error('decimal average exceeds the decimal character limit')
  return result
}

type DecimalAverageState = {
  coefficient: bigint
  sumScale: number
  count: bigint
  requestedScale: number | null
}

const decodeDecimalAverageState = (value: unknown): DecimalAverageState => {
  const held = String(value ?? '')
  if (!held) return { coefficient: 0n, sumScale: 0, count: 0n, requestedScale: null }
  const first = held.indexOf('|')
  const second = held.indexOf('|', first + 1)
  const third = held.indexOf('|', second + 1)
  if (first < 0 || second < 0 || third < 0) throw new Error('invalid decimal average state')
  return {
    requestedScale: Number(held.slice(0, first)),
    count: BigInt(held.slice(first + 1, second)),
    sumScale: Number(held.slice(second + 1, third)),
    coefficient: BigInt(held.slice(third + 1)),
  }
}

const encodeDecimalAverageState = (state: DecimalAverageState): string =>
  `${String(state.requestedScale)}|${state.count}|${state.sumScale}|${state.coefficient}`

export function sqliteAdapter(path = ':memory:'): Adapter {
  let db: DatabaseSync | null = null
  // node:sqlite has one synchronous connection. Promise-shaped adapter methods can
  // still interleave while a transaction body awaits, so every root operation joins
  // this queue. The adapter handed to tx() bypasses it on purpose: those calls are
  // already inside the queue slot owned by that transaction.
  let operationTail: Promise<void> = Promise.resolve()
  const transactionContext = new AsyncLocalStorage<{ active: boolean }>()
  const need = (): DatabaseSync => {
    if (!db) throw new Error('adapter is not open()')
    return db
  }

  const serialize = <T>(work: () => T | Promise<T>): Promise<T> => {
    // Calling the root adapter from its own transaction callback would otherwise
    // enqueue work behind the callback that is currently awaiting it. Refuse the
    // misuse immediately and point callers at the scoped adapter/ctx passed to the
    // callback; outside work still queues normally behind the transaction.
    if (transactionContext.getStore()?.active)
      return Promise.reject(
        new Error('root SQLite adapter used inside its transaction; use the transaction-scoped adapter'),
      )
    const result = operationTail.then(work)
    operationTail = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  const quoteIdent = (name: string): string => `"${String(name).replace(/"/g, '""')}"`
  const columnSql = (column: { base: FieldBase }): string => SQL[column.base] ?? 'TEXT'
  const execDirect = (sql: string): void => need().exec(sql)
  const allDirect = (sql: string, params: unknown[] = []): Row[] =>
    need()
      .prepare(sql)
      .all(...(params.map(bind) as never[])) as Row[]
  const runDirect = (sql: string, params: unknown[] = []): { changes: number } => {
    const result = need()
      .prepare(sql)
      .run(...(params.map(bind) as never[]))
    return { changes: Number(result.changes) }
  }
  const introspectDirect = (): Record<string, Record<string, string>> => {
    const tables: Record<string, Record<string, string>> = {}
    const names = need()
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`)
      .all() as Array<{ name: string }>
    for (const table of names) {
      tables[table.name] = {}
      const columns = need()
        .prepare(`PRAGMA table_info(${quoteIdent(table.name)})`)
        .all() as Array<{ name: string; type: string }>
      for (const column of columns) tables[table.name]![column.name] = column.type
    }
    return tables
  }

  const scopedTransactionAdapter = (): { adapter: Adapter; deactivate: () => void } => {
    let active = true
    const within = <T>(work: () => T): T => {
      if (!active) throw new Error('transaction-scoped adapter used after its transaction ended')
      return work()
    }
    return {
      adapter: {
        name: 'sqlite',
        transaction: true,
        async open() {
          throw new Error('a transaction-scoped adapter is already open')
        },
        async close() {
          throw new Error('a transaction-scoped adapter cannot close its root connection')
        },
        async exec(sql) {
          within(() => execDirect(sql))
        },
        async all(sql, params = []) {
          return within(() => allDirect(sql, params))
        },
        async run(sql, params = []) {
          return within(() => runDirect(sql, params))
        },
        async tx() {
          throw new Error('nested transactions are not supported')
        },
        quoteIdent,
        columnSql,
        async introspect() {
          return within(introspectDirect)
        },
      },
      deactivate: () => {
        active = false
      },
    }
  }

  const a: Adapter = {
    name: 'sqlite',
    async open() {
      await serialize(() => {
        db = new DatabaseSync(path)
        db.function('ket_date_bucket', (value, interval, timezone) =>
          dateBucket(value, String(interval) as Parameters<typeof dateBucket>[1], String(timezone)),
        )
        db.function('ket_decimal_cmp', compareDecimals)
        db.function('ket_decimal_key', decimalKey)
        db.function('ket_decimal_sign', (value) => decimalParts(value)?.sign ?? null)
        db.function('ket_decimal_exponent', (value) => decimalParts(value)?.exponent ?? null)
        db.function('ket_decimal_digits', (value) => decimalParts(value)?.digits ?? null)
        db.aggregate('ket_decimal_avg', {
          start: '',
          step: (encoded, value, scale) => {
            const state = decodeDecimalAverageState(encoded)
            const requestedScale = Number(scale)
            if (state.requestedScale !== null && state.requestedScale !== requestedScale)
              throw new Error('decimal average scale changed within one aggregate')
            if (value == null) return encodeDecimalAverageState({ ...state, requestedScale })
            const next = scaledDecimal(value)
            if (!next) throw new Error('invalid or over-budget decimal value')
            if (state.count === 0n)
              return encodeDecimalAverageState({
                coefficient: next.coefficient,
                sumScale: next.scale,
                count: 1n,
                requestedScale,
              })
            const sumScale = Math.max(state.sumScale, next.scale)
            const coefficient =
              state.coefficient * 10n ** BigInt(sumScale - state.sumScale) +
              next.coefficient * 10n ** BigInt(sumScale - next.scale)
            return encodeDecimalAverageState({
              coefficient,
              sumScale,
              count: state.count + 1n,
              requestedScale,
            })
          },
          result: (encoded) => {
            const state = decodeDecimalAverageState(encoded)
            return state.count === 0n || state.requestedScale === null
              ? null
              : averageDecimal(
                  { coefficient: state.coefficient, scale: state.sumScale },
                  state.count,
                  state.requestedScale,
                )
          },
        })
        db.aggregate('ket_decimal_sum', {
          start: '',
          step: (sum, value) => {
            if (value == null) return String(sum)
            const next = decimalKey(value)
            if (next == null) throw new Error('invalid or over-budget decimal value')
            if (sum === '') return next
            const added = addDecimals(sum, next)
            if (added == null) throw new Error('invalid decimal aggregate state')
            return added
          },
          result: (sum) => (sum === '' ? null : String(sum)),
        })
        db.aggregate('ket_decimal_min', {
          start: '',
          step: (minimum, value) => {
            if (value == null) return String(minimum)
            const next = decimalKey(value)
            if (next == null) throw new Error('invalid or over-budget decimal value')
            if (minimum === '') return next
            return (compareDecimals(next, minimum) ?? 0) < 0 ? next : String(minimum)
          },
          result: (minimum) => (minimum === '' ? null : String(minimum)),
        })
        db.aggregate('ket_decimal_max', {
          start: '',
          step: (maximum, value) => {
            if (value == null) return String(maximum)
            const next = decimalKey(value)
            if (next == null) throw new Error('invalid or over-budget decimal value')
            if (maximum === '') return next
            return (compareDecimals(next, maximum) ?? 0) > 0 ? next : String(maximum)
          },
          result: (maximum) => (maximum === '' ? null : String(maximum)),
        })
        db.exec('PRAGMA journal_mode = WAL')
        db.exec('PRAGMA foreign_keys = ON')
      })
    },
    async close() {
      await serialize(() => {
        db?.close()
        db = null
      })
    },
    async exec(sql) {
      await serialize(() => execDirect(sql))
    },
    async all(sql, params = []) {
      return serialize(() => allDirect(sql, params))
    },
    async run(sql, params = []) {
      return serialize(() => runDirect(sql, params))
    },
    async tx(fn) {
      return serialize(async () => {
        const connection = need()
        let began = false
        let deactivate = () => {}
        const marker = { active: true }
        try {
          connection.exec('BEGIN')
          began = true
          const scoped = scopedTransactionAdapter()
          deactivate = scoped.deactivate
          const result = await transactionContext.run(marker, () => fn(scoped.adapter))
          connection.exec('COMMIT')
          return result
        } catch (error) {
          if (began) {
            try {
              connection.exec('ROLLBACK')
            } catch {
              // Preserve the failure from the body or COMMIT; it is the actionable one.
            }
          }
          throw error
        } finally {
          marker.active = false
          deactivate()
        }
      })
    },
    quoteIdent,
    columnSql,
    async introspect() {
      return serialize(introspectDirect)
    },
  }
  return assertAdapter(a)
}
