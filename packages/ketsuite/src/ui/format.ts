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

const formatterFor = (locale: string, currency: string, compact: boolean): Intl.NumberFormat => {
  const key = `${locale}\0${currency}\0${compact}`
  const existing = formatters.get(key)
  if (existing) return existing

  const formatter = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
    ...(compact ? { notation: 'compact' as const, maximumFractionDigits: 1 } : {}),
  })
  formatters.set(key, formatter)
  return formatter
}

/**
 * Format a major-unit business amount with the active UI locale and its ISO currency.
 *
 * `compact` rounds to the locale's own magnitude word — "286,4 Tr ₫" in Vietnamese,
 * "₫286.4M" in English. It is for a caption under a figure, where the exact đồng is
 * neither readable nor the point; anything a person reconciles against keeps every
 * digit, which is why exact is the default and compact has to be asked for.
 */
export const formatMoney = (
  _: Pick<Translator, 'locale'>,
  value: unknown,
  currency?: unknown,
  options?: { compact?: boolean },
): string => {
  if (value === null || value === undefined || value === '') return '—'

  const amount = Number(value)
  if (!Number.isFinite(amount)) return String(value)

  return formatterFor(localeCode(_.locale), currencyCode(currency), options?.compact === true).format(
    Object.is(amount, -0) ? 0 : amount,
  )
}
