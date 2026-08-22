import { KetError } from '../kernel/errors.ts'

export type GroupInterval = 'day' | 'week' | 'month' | 'quarter' | 'year'

/**
 * The closed set of bucketing intervals.
 *
 * `GroupInterval` is only a compile-time type: a value that arrives as JSON — a
 * `listState.groupBy[].interval` an agent or a form sends — has never been checked
 * against it by the time it reaches the query builder. The Postgres dialect
 * interpolates the interval into `DATE_TRUNC('<interval>', …)` (SQLite binds it),
 * so an unchecked string there is SQL, not data. This is the guard that keeps the
 * type's promise at runtime, at the one boundary where being wrong is an injection.
 */
export const GROUP_INTERVALS: readonly GroupInterval[] = ['day', 'week', 'month', 'quarter', 'year']

export const isGroupInterval = (value: unknown): value is GroupInterval =>
  typeof value === 'string' && (GROUP_INTERVALS as readonly string[]).includes(value)

export const assertGroupInterval = (value: unknown): GroupInterval => {
  if (!isGroupInterval(value))
    throw new KetError({
      code: 'E_GROUP_INTERVAL',
      message: `invalid group interval ${JSON.stringify(value)}`,
      hint: `interval must be one of ${GROUP_INTERVALS.join(', ')}`,
    })
  return value
}

export const isTimezone = (value: string): boolean => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format()
    return true
  } catch {
    return false
  }
}

export const assertTimezone = (value: string): string => {
  if (!isTimezone(value))
    throw new KetError({ code: 'E_TIMEZONE', message: `invalid IANA timezone "${value}"` })
  return value
}

const partsIn = (value: unknown, timezone: string): { year: number; month: number; day: number } | null => {
  if (value == null) return null
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value))
  if (dateOnly) return { year: Number(dateOnly[1]), month: Number(dateOnly[2]), day: Number(dateOnly[3]) }
  const date = new Date(String(value))
  if (Number.isNaN(date.getTime())) return null
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: assertTimezone(timezone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value)
  return { year: get('year'), month: get('month'), day: get('day') }
}

const ymd = (year: number, month: number, day: number): string =>
  `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`

/** Stable local-calendar bucket key shared by SQLite and application tests. */
export function dateBucket(value: unknown, interval: GroupInterval, timezone = 'UTC'): string | null {
  const local = partsIn(value, timezone)
  if (!local) return null
  if (interval === 'year') return String(local.year).padStart(4, '0')
  if (interval === 'quarter') return `${local.year}-Q${Math.floor((local.month - 1) / 3) + 1}`
  if (interval === 'month') return ymd(local.year, local.month, 1).slice(0, 7)
  if (interval === 'day') return ymd(local.year, local.month, local.day)
  const at = new Date(Date.UTC(local.year, local.month - 1, local.day))
  const isoDay = at.getUTCDay() || 7
  at.setUTCDate(at.getUTCDate() - isoDay + 1)
  return ymd(at.getUTCFullYear(), at.getUTCMonth() + 1, at.getUTCDate())
}

const localPartsAt = (instant: number, timezone: string) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: assertTimezone(timezone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(instant))
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value)
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  }
}

/** Convert a user-local wall time to its UTC instant without relying on the server timezone. */
export function localDateTimeToUtc(value: string, timezone = 'UTC'): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2})(?::(\d{2}))?(?::(\d{2}))?)?$/.exec(value)
  if (!match) throw new KetError({ code: 'E_LOCAL_DATETIME', message: `invalid local datetime "${value}"` })
  const wanted = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4] ?? 0),
    minute: Number(match[5] ?? 0),
    second: Number(match[6] ?? 0),
  }
  const wall = Date.UTC(wanted.year, wanted.month - 1, wanted.day, wanted.hour, wanted.minute, wanted.second)
  let instant = wall
  for (let attempt = 0; attempt < 3; attempt++) {
    const actual = localPartsAt(instant, timezone)
    const shown = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
    )
    const correction = wall - shown
    instant += correction
    if (correction === 0) break
  }
  return new Date(instant).toISOString()
}

export function localDayRange(value: string, timezone = 'UTC'): [string, string] {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) throw new KetError({ code: 'E_LOCAL_DATETIME', message: `invalid local date "${value}"` })
  const next = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + 1))
  const nextText = ymd(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate())
  return [localDateTimeToUtc(value, timezone), localDateTimeToUtc(nextText, timezone)]
}
