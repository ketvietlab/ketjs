/**
 * Money arithmetic for the ledger.
 *
 * Every stored amount is rounded to the minor unit of the currency that owns it.
 * A two-decimal default would leave sub-đồng residuals on every VND invoice, and
 * an open item that carries 0.7 đồng can never be settled by the amount the
 * screen shows the user — `formatMoney` renders VND with no decimals at all.
 */

/** ISO 4217 exponents that are not the two-decimal default. */
const EXPONENTS: Record<string, number> = {
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
}

/** Decimal places the currency actually uses. Unknown codes fall back to two. */
export const scaleOf = (currency: unknown): number => {
  const code = String(currency ?? '')
    .trim()
    .toUpperCase()
  return /^[A-Z]{3}$/.test(code) ? (EXPONENTS[code] ?? 2) : 2
}

/**
 * Round half away from zero at the currency's minor unit. The epsilon nudge keeps
 * binary representation from shaving a half unit down — 1.005 is stored as
 * 1.00499999999999989 and would otherwise round to 1.00.
 */
export const roundMoney = (value: number, scale: number): number => {
  if (!Number.isFinite(value)) return 0
  const factor = 10 ** scale
  const magnitude = Math.round(Math.abs(value) * factor + Number.EPSILON) / factor
  return value < 0 ? -magnitude : magnitude
}

/** The stored decimal text for an amount, always carrying the currency's own scale. */
export const moneyText = (value: number, scale: number): string => {
  const rounded = roundMoney(value, scale)
  return (Object.is(rounded, -0) ? 0 : rounded).toFixed(scale)
}

/**
 * Slack for comparing two amounts that are both already rounded to `scale`.
 * Well below a minor unit, so it only absorbs floating point noise.
 */
export const toleranceOf = (scale: number): number => 10 ** -(scale + 6)
