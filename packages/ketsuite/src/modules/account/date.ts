import { dateBucket, isDateText } from '@ketvietlab/ketjs'

export const DEFAULT_ACCOUNTING_TIMEZONE = 'Asia/Ho_Chi_Minh'

export const assertAccountingTimezone = (value: unknown): string => {
  const timezone = String(value ?? '').trim()
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone }).format()
  } catch {
    throw new RangeError(`invalid IANA accounting timezone: ${timezone || '(empty)'}`)
  }
  return timezone
}

/** Convert an audit instant to the company's Gregorian civil accounting day. */
export const civilDateAt = (value: unknown, timezone: unknown): string => {
  if (isDateText(value)) return value
  const held = dateBucket(value, 'day', assertAccountingTimezone(timezone))
  if (!held || !isDateText(held)) throw new TypeError(`invalid accounting date source: ${String(value)}`)
  return held
}

export const accountingDateText = (value: unknown, timezone: unknown): string => {
  if (isDateText(value)) return value
  if (typeof value === 'string' && !value.includes('T'))
    throw new TypeError(`invalid accounting date: ${value}`)
  return civilDateAt(value, timezone)
}

/**
 * Normalize a report cutoff during the datetime-to-civil API transition.
 *
 * New callers send YYYY-MM-DD. Older callers sent UTC start/end instants that
 * encoded a day chosen in a date picker, so their leading calendar date is the
 * intended accounting cutoff; converting that instant through the company
 * timezone would move an old `23:59:59.999Z` upper bound into the next day.
 */
export const accountingFilterDateText = (value: unknown): string | null => {
  if (value == null || value === '') return null
  if (isDateText(value)) return value
  const text = String(value)
  const prefix = text.slice(0, 10)
  if (isDateText(prefix) && !Number.isNaN(new Date(text).getTime())) return prefix
  throw new TypeError(`invalid accounting report date: ${text}`)
}

/** A stored move's immutable civil day, with a legacy datetime fallback. */
export const moveAccountingDate = (move: Record<string, unknown>, timezone: unknown): string =>
  accountingDateText(move.accountingDate ?? move.date, timezone)

export const periodKey = (value: unknown): string => {
  if (!isDateText(value)) throw new TypeError(`invalid accounting date: ${String(value)}`)
  return value.slice(0, 7)
}

export const quarterKey = (value: unknown): string => {
  if (!isDateText(value)) throw new TypeError(`invalid accounting date: ${String(value)}`)
  const quarter = Math.floor((Number(value.slice(5, 7)) - 1) / 3) + 1
  return `${value.slice(0, 4)}-Q${quarter}`
}

export const fiscalYearKey = (value: unknown): string => {
  if (!isDateText(value)) throw new TypeError(`invalid accounting date: ${String(value)}`)
  return value.slice(0, 4)
}

export const addCivilDays = (value: unknown, days: number): string => {
  if (!isDateText(value) || !Number.isInteger(days))
    throw new TypeError('civil-day arithmetic requires YYYY-MM-DD and an integer day count')
  const at = new Date(`${value}T00:00:00.000Z`)
  at.setUTCDate(at.getUTCDate() + days)
  return at.toISOString().slice(0, 10)
}
