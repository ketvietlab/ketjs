/**
 * Exact money arithmetic for the ledger.
 *
 * Database decimals are strings. Routing them through JavaScript `Number` before
 * posting would throw away digits above 2^53 and can turn a half minor unit into
 * the value just below it. This module keeps decimal coefficients in `bigint`,
 * quantizes once with half-away-from-zero, and only formats text at the edge.
 */

/** Public accounting values are intentionally smaller than the database's generic decimal budget. */
export const MONEY_MAX_DIGITS = 38
export const MONEY_POLICY_VERSION = 'iso4217-half-away-v1'
const MONEY_MAX_INTERMEDIATE_SCALE = MONEY_MAX_DIGITS * 4

const PLAIN_DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/u
const POWERS_OF_TEN = new Map<number, bigint>([[0, 1n]])

const powerOfTen = (scale: number): bigint => {
  if (!Number.isInteger(scale) || scale < 0 || scale > MONEY_MAX_INTERMEDIATE_SCALE)
    throw new RangeError(`decimal scale must be between 0 and ${MONEY_MAX_INTERMEDIATE_SCALE}`)
  const held = POWERS_OF_TEN.get(scale)
  if (held !== undefined) return held
  const value = 10n ** BigInt(scale)
  POWERS_OF_TEN.set(scale, value)
  return value
}

export type ExactDecimal = Readonly<{ coefficient: bigint; scale: number }>

/** Parse one exact, exponent-free decimal string without a binary-number round trip. */
export const exactDecimal = (value: unknown): ExactDecimal => {
  if (typeof value !== 'string') throw new TypeError('money value must be a canonical decimal string')
  const source = value.trim()
  if (!PLAIN_DECIMAL.test(source)) throw new TypeError(`invalid canonical decimal: ${source}`)
  const negative = source.startsWith('-')
  const unsigned = source.replace(/^[+-]/u, '')
  const [rawWhole = '', fraction = ''] = unsigned.split('.')
  const whole = rawWhole || '0'
  const digits = `${whole}${fraction}`
  if (digits.length > MONEY_MAX_DIGITS)
    throw new RangeError(`money value exceeds the ${MONEY_MAX_DIGITS}-digit limit`)
  const magnitude = BigInt(digits || '0')
  return { coefficient: negative && magnitude !== 0n ? -magnitude : magnitude, scale: fraction.length }
}

export const decimalSign = (value: unknown): -1 | 0 | 1 => {
  const coefficient = exactDecimal(value).coefficient
  return coefficient < 0n ? -1 : coefficient > 0n ? 1 : 0
}

export const compareDecimals = (left: unknown, right: unknown): number => {
  const a = exactDecimal(left)
  const b = exactDecimal(right)
  const scale = Math.max(a.scale, b.scale)
  const av = a.coefficient * powerOfTen(scale - a.scale)
  const bv = b.coefficient * powerOfTen(scale - b.scale)
  return av < bv ? -1 : av > bv ? 1 : 0
}

/** Add exact decimal text while preserving no unnecessary fractional zeros. */
export const addDecimals = (left: unknown, right: unknown): string => {
  const a = exactDecimal(left)
  const b = exactDecimal(right)
  const scale = Math.max(a.scale, b.scale)
  return canonicalDecimalText(
    minorText(
      a.coefficient * powerOfTen(scale - a.scale) + b.coefficient * powerOfTen(scale - b.scale),
      scale,
    ),
  )
}

export const subtractDecimals = (left: unknown, right: unknown): string => {
  const b = exactDecimal(right)
  return addDecimals(left, minorText(-b.coefficient, b.scale))
}

export const negateDecimalText = (value: unknown): string => {
  const parsed = exactDecimal(value)
  return canonicalDecimalText(minorText(-parsed.coefficient, parsed.scale))
}

export const absDecimalText = (value: unknown): string => {
  const parsed = exactDecimal(value)
  return canonicalDecimalText(
    minorText(parsed.coefficient < 0n ? -parsed.coefficient : parsed.coefficient, parsed.scale),
  )
}

/** Divide to an integer, rounding a half away from zero. */
export const roundedQuotient = (numerator: bigint, denominator: bigint): bigint => {
  if (denominator <= 0n) throw new RangeError('exact division requires a positive denominator')
  const negative = numerator < 0n
  const magnitude = negative ? -numerator : numerator
  let result = magnitude / denominator
  if ((magnitude % denominator) * 2n >= denominator) result += 1n
  return negative && result !== 0n ? -result : result
}

/** Convert an exact decimal amount to integer minor units. */
export const moneyMinor = (value: unknown, scale: number): bigint => {
  const parsed = exactDecimal(value)
  if (parsed.scale <= scale) return parsed.coefficient * powerOfTen(scale - parsed.scale)
  return roundedQuotient(parsed.coefficient, powerOfTen(parsed.scale - scale))
}

/** Format integer minor units with the currency's fixed scale. */
export const minorText = (minor: bigint, scale: number): string => {
  powerOfTen(scale)
  if (minor === 0n) return scale === 0 ? '0' : `0.${'0'.repeat(scale)}`
  const negative = minor < 0n
  const magnitude = (negative ? -minor : minor).toString().padStart(scale + 1, '0')
  const unsigned = scale === 0 ? magnitude : `${magnitude.slice(0, -scale)}.${magnitude.slice(-scale)}`
  return negative ? `-${unsigned}` : unsigned
}

/** Normalize an exact decimal input without imposing a currency scale. */
export const canonicalDecimalText = (value: unknown): string => {
  const parsed = exactDecimal(value)
  const rendered = minorText(parsed.coefficient, parsed.scale)
  return rendered.includes('.') ? rendered.replace(/\.?0+$/u, '') : rendered
}

/** Quantize exact decimal text and return the one stored spelling. */
export const moneyText = (value: unknown, scale: number): string => minorText(moneyMinor(value, scale), scale)

/** Sum already monetary decimal strings without loss. */
export const sumMoneyMinor = (values: Iterable<unknown>, scale: number): bigint => {
  let total = 0n
  for (const value of values) total += moneyMinor(value, scale)
  return total
}

/** Multiply decimal text without imposing a currency scale or using binary floating point. */
export const multiplyDecimals = (...values: readonly unknown[]): string => {
  let coefficient = 1n
  let scale = 0
  for (const value of values) {
    const parsed = exactDecimal(value)
    coefficient *= parsed.coefficient
    scale += parsed.scale
  }
  return canonicalDecimalText(minorText(coefficient, scale))
}

/** Multiply arbitrary exact decimal factors and quantize the result as money. */
export const multiplyToMinor = (values: readonly unknown[], scale: number): bigint => {
  let coefficient = 1n
  let decimalScale = 0
  for (const value of values) {
    const parsed = exactDecimal(value)
    coefficient *= parsed.coefficient
    decimalScale += parsed.scale
  }
  if (decimalScale <= scale) return coefficient * powerOfTen(scale - decimalScale)
  return roundedQuotient(coefficient, powerOfTen(decimalScale - scale))
}

/** Quantity × unit price × (1 - discount / 100), rounded once to minor units. */
export const discountedLineMinor = (
  quantity: unknown,
  priceUnit: unknown,
  discount: unknown,
  scale: number,
): bigint => {
  const qty = exactDecimal(quantity)
  const price = exactDecimal(priceUnit)
  const reduction = exactDecimal(discount)
  const hundred = 100n * powerOfTen(reduction.scale)
  const factor = hundred - reduction.coefficient
  const numerator = qty.coefficient * price.coefficient * factor * powerOfTen(scale)
  const denominator = powerOfTen(qty.scale + price.scale) * hundred
  return roundedQuotient(numerator, denominator)
}

/** A percentage of an amount already expressed in minor units. */
export const percentOfMinor = (base: bigint, percent: unknown): bigint => {
  const rate = exactDecimal(percent)
  return roundedQuotient(base * rate.coefficient, 100n * powerOfTen(rate.scale))
}

/** Division-tax share: base / (1 - rate) - base. */
export const divisionTaxMinor = (base: bigint, percent: unknown): bigint => {
  const rate = exactDecimal(percent)
  const hundred = 100n * powerOfTen(rate.scale)
  const denominator = hundred - rate.coefficient
  if (denominator <= 0n) throw new RangeError('division tax rate must be below 100 percent')
  return roundedQuotient(base * rate.coefficient, denominator)
}

/** Net base when a percentage tax is already included in the gross amount. */
export const includedPercentBaseMinor = (gross: bigint, percent: unknown): bigint => {
  const rate = exactDecimal(percent)
  const hundred = 100n * powerOfTen(rate.scale)
  const denominator = hundred + rate.coefficient
  if (denominator <= 0n) throw new RangeError('included percentage tax has no positive divisor')
  return roundedQuotient(gross * hundred, denominator)
}

/** Net base when a division tax is already included in the gross amount. */
export const includedDivisionBaseMinor = (gross: bigint, percent: unknown): bigint => {
  const rate = exactDecimal(percent)
  const hundred = 100n * powerOfTen(rate.scale)
  const factor = hundred - rate.coefficient
  if (factor <= 0n) throw new RangeError('division tax rate must be below 100 percent')
  return roundedQuotient(gross * factor, hundred)
}

/** ISO 4217 exponents that differ from the two-decimal majority. */
const EXPONENTS: Readonly<Record<string, number>> = {
  BIF: 0,
  CLP: 0,
  DJF: 0,
  GNF: 0,
  ISK: 0,
  JPY: 0,
  KMF: 0,
  KRW: 0,
  PYG: 0,
  RWF: 0,
  UGX: 0,
  UYI: 0,
  VND: 0,
  VUV: 0,
  XAF: 0,
  XOF: 0,
  XPF: 0,
  BHD: 3,
  IQD: 3,
  JOD: 3,
  KWD: 3,
  LYD: 3,
  OMR: 3,
  TND: 3,
  CLF: 4,
  UYW: 4,
}

const SUPPORTED_CURRENCIES = new Set(Intl.supportedValuesOf('currency'))

/** Decimal places from ISO 4217. Unknown or non-currency codes fail closed. */
export const scaleOf = (currency: unknown): number => {
  const code = String(currency ?? '')
    .trim()
    .toUpperCase()
  if (!SUPPORTED_CURRENCIES.has(code)) throw new RangeError(`unsupported currency: ${code || '(empty)'}`)
  return EXPONENTS[code] ?? 2
}

/**
 * Compatibility helper for non-ledger callers. Core Accounting never uses this
 * number-returning API; values that cannot be represented safely are refused.
 */
export const roundMoney = (value: number, scale: number): number => {
  if (!Number.isFinite(value)) throw new TypeError('money value must be finite')
  const rendered = moneyText(String(value), scale)
  const rounded = Number(rendered)
  if (!Number.isSafeInteger(rounded * 10 ** scale))
    throw new RangeError('rounded money exceeds JavaScript safe-integer precision')
  return rounded
}

/** Deprecated: exact ledger comparisons use integer minor units and need no tolerance. */
export const toleranceOf = (_scale: number): number => 0
