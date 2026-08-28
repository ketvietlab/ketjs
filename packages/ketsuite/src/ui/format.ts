import type { Translator } from '@ketvietlab/ketjs'

const DEFAULT_CURRENCY = 'VND'
const PSEUDO_LOCALE = 'qps'
const formatters = new Map<string, Intl.NumberFormat>()
const DECIMAL_TEXT = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/u

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

  if (typeof value === 'number' && !Number.isFinite(value)) return String(value)
  if (typeof value === 'string' && !DECIMAL_TEXT.test(value.trim())) return value
  if (!['string', 'number', 'bigint'].includes(typeof value)) return String(value)

  const formatter = formatterFor(localeCode(_.locale), currencyCode(currency), options?.compact === true)
  // ECMA-402 accepts a decimal string as an exact mathematical value. Keeping
  // database decimals as strings here avoids changing 9,007,199,254,740,993 to
  // 9,007,199,254,740,992 merely to add grouping and a currency sign. TypeScript's
  // older Intl declaration still lists only number/bigint, hence the narrow cast.
  const format = formatter.format as unknown as (amount: string | number | bigint) => string
  return format(typeof value === 'number' && Object.is(value, -0) ? 0 : (value as string | number | bigint))
}
