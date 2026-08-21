import type { Translator } from '@ketvietlab/ketjs'

const DEFAULT_CURRENCY = 'VND'
const PSEUDO_LOCALE = 'qps'
const formatters = new Map<string, Intl.NumberFormat>()

const currencyCode = (value: unknown): string => {
  const code = String(value ?? '')
    .trim()
    .toUpperCase()
  return /^[A-Z]{3}$/.test(code) ? code : DEFAULT_CURRENCY
}

const localeCode = (value: string): string => (value === PSEUDO_LOCALE ? 'en' : value || 'vi')

const formatterFor = (locale: string, currency: string): Intl.NumberFormat => {
  const key = `${locale}\0${currency}`
  const existing = formatters.get(key)
  if (existing) return existing

  const formatter = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
  })
  formatters.set(key, formatter)
  return formatter
}

/** Format a major-unit business amount with the active UI locale and its ISO currency. */
export const formatMoney = (_: Pick<Translator, 'locale'>, value: unknown, currency?: unknown): string => {
  if (value === null || value === undefined || value === '') return '—'

  const amount = Number(value)
  if (!Number.isFinite(amount)) return String(value)

  return formatterFor(localeCode(_.locale), currencyCode(currency)).format(Object.is(amount, -0) ? 0 : amount)
}
