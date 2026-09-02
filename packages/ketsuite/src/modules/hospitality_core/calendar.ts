// Calendar dates belong to the property's timezone, not the server process.
// These helpers use Intl only, so they work in both Node and the browser build.

import { dateTimeFormatter } from '@ketvietlab/ketjs'

const partsIn = (value: Date, timezone: string, time: boolean): Record<string, string> =>
  Object.fromEntries(
    dateTimeFormatter('en', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      ...(time ? { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' as const } : {}),
    })
      .formatToParts(value)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  )

export const dateKeyIn = (value: Date, timezone: string): string => {
  const parts = partsIn(value, timezone, false)
  return `${parts.year}-${parts.month}-${parts.day}`
}

export const addCalendarDays = (key: string, count: number): string => {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(Date.UTC(year!, month! - 1, day! + count)).toISOString().slice(0, 10)
}

export const zonedDateTime = (key: string, hour: number, minute: number, timezone: string): Date => {
  const [year, month, day] = key.split('-').map(Number)
  const desired = Date.UTC(year!, month! - 1, day!, hour, minute)
  let guess = desired
  for (let attempt = 0; attempt < 2; attempt++) {
    const actual = partsIn(new Date(guess), timezone, true)
    const actualAsUtc = Date.UTC(
      Number(actual.year),
      Number(actual.month) - 1,
      Number(actual.day),
      Number(actual.hour),
      Number(actual.minute),
      Number(actual.second),
    )
    guess += desired - actualAsUtc
  }
  return new Date(guess)
}

export const zonedMidnight = (key: string, timezone: string): Date => zonedDateTime(key, 0, 0, timezone)

export const calendarRange = (
  value: string | null | undefined,
  length: number,
  timezone: string,
): { from: string; to: string } => {
  const supplied = value?.slice(0, 10)
  const key = supplied && /^\d{4}-\d{2}-\d{2}$/.test(supplied) ? supplied : dateKeyIn(new Date(), timezone)
  return {
    from: zonedMidnight(key, timezone).toISOString(),
    to: zonedMidnight(addCalendarDays(key, length), timezone).toISOString(),
  }
}
