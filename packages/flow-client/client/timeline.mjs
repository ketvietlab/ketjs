const DAY = 86400000
export function parseDay(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) return null
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(+date) && date.toISOString().slice(0, 10) === value ? date : null
}
const iso = (date) => date.toISOString().slice(0, 10)
export const addDays = (value, amount) => iso(new Date(+parseDay(value) + amount * DAY))
export function todayDate(timezone = 'Asia/Ho_Chi_Minh') {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const part = (name) => parts.find((p) => p.type === name)?.value
  return `${part('year')}-${part('month')}-${part('day')}`
}
export function shiftPeriod(value, mode, direction) {
  if (mode === 'week') return addDays(value, direction * 7)
  const date = parseDay(value),
    day = date.getUTCDate()
  date.setUTCDate(1)
  date.setUTCMonth(date.getUTCMonth() + direction)
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()
  date.setUTCDate(Math.min(day, last))
  return iso(date)
}
