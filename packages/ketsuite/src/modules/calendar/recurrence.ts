import { KetError } from '@ketvietlab/ketjs'
import type { Row } from '@ketvietlab/ketjs'
import { RECURRENCE_FREQUENCIES, WEEKDAYS } from './types.ts'

const calendarError = (code: string, message: string): never => {
  throw new KetError({ code, module: 'calendar', message })
}

export const validTimezone = (timezone: string): boolean => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date())
    return true
  } catch {
    return false
  }
}

export const datePartsIn = (instant: string | Date, timezone: string) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant instanceof Date ? instant : new Date(instant))
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0)
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
    second: value('second'),
  }
}

/** Convert a local wall time to UTC without adding a timezone dependency. */
export const zonedToUtc = (
  local: { year: number; month: number; day: number; hour: number; minute: number; second: number },
  timezone: string,
): Date => {
  if (!validTimezone(timezone)) calendarError('E_CALENDAR_TIMEZONE', `invalid IANA timezone "${timezone}"`)
  const desired = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second)
  let guess = desired
  for (let attempt = 0; attempt < 4; attempt++) {
    const actual = datePartsIn(new Date(guess), timezone)
    const represented = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
    )
    const delta = desired - represented
    if (delta === 0) return new Date(guess)
    guess += delta
  }
  const final = datePartsIn(new Date(guess), timezone)
  if (Object.keys(local).some((key) => local[key as keyof typeof local] !== final[key as keyof typeof final]))
    calendarError('E_CALENDAR_DST_GAP', 'local event time does not exist in the selected timezone')
  return new Date(guess)
}

const dateAt = (date: string): Date => new Date(`${date}T00:00:00.000Z`)
const textOf = (date: Date): string => date.toISOString().slice(0, 10)
const addDays = (date: string, amount: number): string => {
  const value = dateAt(date)
  value.setUTCDate(value.getUTCDate() + amount)
  return textOf(value)
}
const dayDiff = (a: string, b: string): number =>
  Math.floor((dateAt(a).getTime() - dateAt(b).getTime()) / 86_400_000)
const weekDay = (date: string): string => WEEKDAYS[(dateAt(date).getUTCDay() + 6) % 7] as string
const jsonArray = (value: unknown): unknown[] => {
  if (Array.isArray(value)) return value
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

export type Occurrence = Row & {
  occurrenceId: string
  occurrenceDate: string
  occurrenceStartAt?: string
  occurrenceStopAt?: string
}

export const validateRecurrence = (recurrence: Row): void => {
  if (!RECURRENCE_FREQUENCIES.includes(String(recurrence.frequency) as never))
    calendarError('E_CALENDAR_FREQUENCY', `unknown recurrence frequency "${String(recurrence.frequency)}"`)
  if (!Number.isInteger(recurrence.interval) || Number(recurrence.interval) < 1)
    calendarError('E_CALENDAR_INTERVAL', 'recurrence interval must be a positive whole number')
  if (recurrence.count != null && (!Number.isInteger(recurrence.count) || Number(recurrence.count) < 1))
    calendarError('E_CALENDAR_COUNT', 'recurrence count must be a positive whole number')
  if (recurrence.count != null && recurrence.until != null)
    calendarError('E_CALENDAR_RECURRENCE_END', 'recurrence uses count or until, not both')
  if (!validTimezone(String(recurrence.timezone)))
    calendarError('E_CALENDAR_TIMEZONE', `invalid IANA timezone "${String(recurrence.timezone)}"`)
  const weekdays = recurrence.weekdays == null ? [] : jsonArray(recurrence.weekdays)
  if (weekdays.some((day) => !WEEKDAYS.includes(String(day) as never)))
    calendarError('E_CALENDAR_WEEKDAYS', 'recurrence weekdays must contain MO through SU')
}

const matches = (date: string, anchor: string, recurrence: Row): boolean => {
  const diff = dayDiff(date, anchor)
  if (diff < 0) return false
  const interval = Number(recurrence.interval)
  if (recurrence.frequency === 'daily') return diff % interval === 0
  if (recurrence.frequency === 'weekly') {
    const values = jsonArray(recurrence.weekdays)
    const weekdays = values.length ? values.map(String) : [weekDay(anchor)]
    return Math.floor(diff / 7) % interval === 0 && weekdays.includes(weekDay(date))
  }
  const current = dateAt(date)
  const base = dateAt(anchor)
  const monthDiff =
    (current.getUTCFullYear() - base.getUTCFullYear()) * 12 + current.getUTCMonth() - base.getUTCMonth()
  if (recurrence.frequency === 'monthly')
    return monthDiff >= 0 && monthDiff % interval === 0 && current.getUTCDate() === base.getUTCDate()
  return (
    (current.getUTCFullYear() - base.getUTCFullYear()) % interval === 0 &&
    current.getUTCMonth() === base.getUTCMonth() &&
    current.getUTCDate() === base.getUTCDate()
  )
}

export const expandRecurringEvent = (
  event: Row,
  recurrence: Row,
  rangeStart: string,
  rangeStop: string,
  suppressedDates: ReadonlySet<string> = new Set(),
  limit = 366,
): Occurrence[] => {
  validateRecurrence(recurrence)
  const timezone = String(event.timezone)
  const local = event.allDay
    ? { date: String(event.startDate), parts: null }
    : (() => {
        const parts = datePartsIn(String(event.startAt), timezone)
        return {
          date: `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`,
          parts,
        }
      })()
  const duration = event.allDay
    ? dayDiff(String(event.stopDate), String(event.startDate))
    : new Date(String(event.stopAt)).getTime() - new Date(String(event.startAt)).getTime()
  const out: Occurrence[] = []
  let matched = 0
  let cursor = local.date
  const hardStop = recurrence.until ? String(recurrence.until) : rangeStop
  for (let scanned = 0; scanned < 36_600 && cursor < rangeStop && cursor <= hardStop; scanned++) {
    if (matches(cursor, local.date, recurrence)) {
      matched++
      if (recurrence.count != null && matched > Number(recurrence.count)) break
      if (cursor >= rangeStart && !suppressedDates.has(cursor)) {
        if (out.length >= limit)
          calendarError(
            'E_CALENDAR_EXPANSION_LIMIT',
            `recurrence exceeds the ${limit} occurrence query limit`,
          )
        if (event.allDay)
          out.push({
            ...event,
            occurrenceId: `${String(event.id)}:${cursor}`,
            occurrenceDate: cursor,
            startDate: cursor,
            stopDate: addDays(cursor, duration),
          })
        else {
          const [year, month, day] = cursor.split('-').map(Number)
          const start = zonedToUtc(
            {
              year: year!,
              month: month!,
              day: day!,
              hour: local.parts!.hour,
              minute: local.parts!.minute,
              second: local.parts!.second,
            },
            timezone,
          )
          out.push({
            ...event,
            occurrenceId: `${String(event.id)}:${cursor}`,
            occurrenceDate: cursor,
            occurrenceStartAt: start.toISOString(),
            occurrenceStopAt: new Date(start.getTime() + duration).toISOString(),
            startAt: start.toISOString(),
            stopAt: new Date(start.getTime() + duration).toISOString(),
          })
        }
      }
    }
    cursor = addDays(cursor, 1)
  }
  return out
}
