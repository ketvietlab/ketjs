// When a job runs on its own, computed rather than stored.
//
// Pure: a schedule is manifest data, so deciding what it means has to be possible
// with nothing but the manifest — `ket check` validates one without a database and
// a test computes a tick without a clock.

import { KetError } from './errors.ts'
import { dateBucket, localDateTimeToUtc } from '../data/time.ts'
import type { JobSchedule } from '../types.ts'

const UNITS: Record<string, number> = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }
const EVERY = /^(\d+)(s|m|h|d)$/
const AT = /^([01]\d|2[0-3]):([0-5]\d)$/

/** The shortest interval worth having. Below this the sweep costs more than the work. */
export const MIN_EVERY_MS = 10_000

export function parseEvery(value: string): number {
  const match = EVERY.exec(value)
  if (!match) {
    throw new KetError({
      code: 'E_BAD_SCHEDULE',
      message: `"${value}" is not an interval`,
      hint: 'write a count and a unit, one of s m h d — "30s", "15m", "6h", "1d"',
    })
  }
  const ms = Number(match[1]) * (UNITS[match[2] as string] as number)
  if (ms < MIN_EVERY_MS) {
    throw new KetError({
      code: 'E_BAD_SCHEDULE',
      message: `interval "${value}" is shorter than the ${MIN_EVERY_MS / 1000}s minimum`,
      hint: 'a job that has to run more often than this wants a queue, not a schedule',
    })
  }
  return ms
}

/** Validate a schedule at composition time, so a typo is a build error. */
export function validateSchedule(schedule: JobSchedule): void {
  if ('every' in schedule) {
    parseEvery(schedule.every)
    return
  }
  if (!AT.exec(schedule.dailyAt)) {
    throw new KetError({
      code: 'E_BAD_SCHEDULE',
      message: `"${schedule.dailyAt}" is not a time of day`,
      hint: 'write 24-hour HH:MM, for example "03:00"',
    })
  }
}

/**
 * The most recent tick at or before `now`, as an ISO instant.
 *
 * An instant rather than a counter, in both forms, so that the stored value orders
 * lexicographically — which is the same reason every datetime in this framework is
 * ISO-8601 UTC text.
 */
export function tickAt(schedule: JobSchedule, now: Date, defaultTimezone: string): string {
  if ('every' in schedule) {
    const ms = parseEvery(schedule.every)
    return new Date(Math.floor(now.getTime() / ms) * ms).toISOString()
  }
  const timezone = schedule.timezone ?? defaultTimezone
  const today = dateBucket(now.toISOString(), 'day', timezone)
  if (!today) throw new KetError({ code: 'E_BAD_SCHEDULE', message: `cannot read a date in "${timezone}"` })
  const todays = localDateTimeToUtc(`${today}T${schedule.dailyAt}`, timezone)
  if (Date.parse(todays) <= now.getTime()) return todays
  // Before today's time: the occurrence that has actually passed is yesterday's.
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
  return localDateTimeToUtc(`${yesterday}T${schedule.dailyAt}`, timezone)
}

/**
 * How many ticks were passed over between two instants. Reported, never replayed.
 *
 * A daily count treats every day as 24 hours, so a span crossing a DST boundary can
 * be off by one. This is a number in a record, not a control value: nothing decides
 * anything by it, and rounding it correctly would cost a calendar walk.
 */
export function ticksBetween(schedule: JobSchedule, from: string, to: string): number {
  const span = Date.parse(to) - Date.parse(from)
  if (!(span > 0)) return 0
  const ms = 'every' in schedule ? parseEvery(schedule.every) : 86_400_000
  return Math.max(0, Math.round(span / ms) - 1)
}
