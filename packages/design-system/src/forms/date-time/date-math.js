// @ts-check
// UTC is only a stable axis for civil-date arithmetic, never a timezone conversion.
/** @param {string} value */
export const parseDate = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [year, month, day] = value.split('-').map(Number)
  if (year < 1 || year > 9999) return null
  const date = new Date(0)
  date.setUTCFullYear(year, month - 1, day)
  date.setUTCHours(0, 0, 0, 0)
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? date
    : null
}
/** @param {Date} date */
export const dateText = (date) =>
  [
    String(date.getUTCFullYear()).padStart(4, '0'),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-')
/** @param {string} value @param {number} days */
export const addDays = (value, days) => {
  const date = parseDate(value)
  if (!date) return ''
  date.setUTCDate(date.getUTCDate() + days)
  const result = dateText(date)
  return parseDate(result) ? result : ''
}
/** @param {string} value @param {number} offset */
export const moveMonth = (value, offset) => {
  const date = parseDate(value)
  if (!date) return ''
  const day = date.getUTCDate()
  date.setUTCDate(1)
  date.setUTCMonth(date.getUTCMonth() + offset)
  const last = new Date(date)
  last.setUTCMonth(last.getUTCMonth() + 1, 0)
  date.setUTCDate(Math.min(day, last.getUTCDate()))
  const result = dateText(date)
  return parseDate(result) ? result : ''
}
/** @param {string} value */
export const monthStart = (value) => `${value.slice(0, 7)}-01`
/** @param {string} value */
export const monthEnd = (value) => {
  const date = parseDate(value)
  if (!date) return ''
  date.setUTCMonth(date.getUTCMonth() + 1, 0)
  return dateText(date)
}
export const presetIds = ['today', 'yesterday', 'last7', 'thisMonth', 'lastMonth', 'last30', 'last90']
/** @param {string} id @param {string} today @returns {[string, string] | null} */
export const presetRange = (id, today) => {
  if (!parseDate(today)) return null
  if (id === 'today') return [today, today]
  if (id === 'yesterday') {
    const day = addDays(today, -1)
    return day ? [day, day] : null
  }
  if (id === 'thisMonth') return [monthStart(today), monthEnd(today)]
  if (id === 'lastMonth') {
    const day = moveMonth(today, -1)
    return day ? [monthStart(day), monthEnd(day)] : null
  }
  const days = { last7: 7, last30: 30, last90: 90 }[/** @type {'last7'|'last30'|'last90'} */ (id)]
  const start = days ? addDays(today, 1 - days) : ''
  return start ? [start, today] : null
}
/** @param {string} value @param {string} [min] @param {string} [max] */
export const withinBounds = (value, min = '', max = '') =>
  !!parseDate(value) && (!parseDate(min) || value >= min) && (!parseDate(max) || value <= max)
/** @param {string} start @param {string} end @returns {[string, string]} */
export const orderedRange = (start, end) => (start <= end ? [start, end] : [end, start])

/** Compact display keeps the shared year once; submitted values remain ISO civil dates.
 * @param {string} start @param {string} end */
export const formatRange = (start, end) => {
  if (!parseDate(start) || !parseDate(end)) return ''
  const date = (/** @type {string} */ value, /** @type {boolean} */ year = true) =>
    `${value.slice(8, 10)}/${value.slice(5, 7)}${year ? `/${value.slice(0, 4)}` : ''}`
  return `${date(start, start.slice(0, 4) !== end.slice(0, 4))} – ${date(end)}`
}
