/**
 * The arithmetic, kept apart from the database so it can be reasoned about and
 * tested on its own.
 *
 * Quantities are floats, as in Odoo. That is a decision with teeth: 0.1 + 0.2 is
 * not 0.3, and a stock figure that drifts by 1e-16 per movement compares unequal to
 * zero after enough of them, which is how "we have -0.0000000001 in stock" happens.
 * The defence is that every value crossing a boundary is rounded to its unit's
 * precision, and that comparisons go through helpers that respect it — never `===`.
 */

export type Unit = { id: string; categoryId: string; factor: number; rounding: number }

export class UomError extends Error {
  code: string
  hint: string | null
  constructor(d: { code: string; message: string; hint?: string }) {
    super(d.message)
    this.name = 'UomError'
    this.code = d.code
    this.hint = d.hint ?? null
  }
}

/**
 * Round to a multiple of `precision`, away from zero at the halfway point.
 *
 * Three things here are load-bearing, and the first version got two of them wrong:
 *
 * 1. `toPrecision(12)` before rounding. Dividing by a precision like 0.1 lands on
 *    2.9999999999999996 often enough that rounding would give 2 instead of 3.
 * 2. Half-away-from-zero, spelt out. `Math.round` rounds .5 toward positive
 *    infinity, so it sends -0.5 to -0 — which made 0.9995 compare *equal* to 1
 *    instead of less than it, silently, in one direction only.
 * 3. `toPrecision(15)` after multiplying back. Three times 0.1 is
 *    0.30000000000000004, so a rounding function that skipped this step returned a
 *    value that was not a multiple of its own precision.
 */
export function roundTo(value: number, precision: number): number {
  if (!(precision > 0)) throw new UomError({ code: 'E_UOM_BAD_PRECISION', message: `rounding precision must be positive, got ${precision}` })
  const scaled = Number((value / precision).toPrecision(12))
  const rounded = Math.sign(scaled) * Math.round(Math.abs(scaled))
  return Number((rounded * precision).toPrecision(15))
}

/** Compare two quantities at a given precision. Returns -1, 0 or 1. */
export function compareQty(a: number, b: number, precision: number): -1 | 0 | 1 {
  const delta = roundTo(a - b, precision)
  return delta < 0 ? -1 : delta > 0 ? 1 : 0
}

export const isZero = (value: number, precision: number): boolean => roundTo(value, precision) === 0

/**
 * Convert a quantity between two units of the same category.
 *
 * Crossing categories is refused rather than approximated: there is no number of
 * kilograms in a litre, and a framework that guessed one would be worse than one
 * that stopped.
 */
export function convertQty(qty: number, from: Unit, to: Unit): number {
  if (from.id === to.id) return roundTo(qty, to.rounding)
  if (from.categoryId !== to.categoryId) {
    throw new UomError({
      code: 'E_UOM_CATEGORY_MISMATCH',
      message: `cannot convert "${from.id}" to "${to.id}": they measure different things`,
      hint: 'units convert only within their category — weight to weight, count to count',
    })
  }
  if (!(from.factor > 0) || !(to.factor > 0)) {
    throw new UomError({ code: 'E_UOM_BAD_FACTOR', message: 'a unit factor must be greater than zero' })
  }
  // Through the reference: out of the source unit, then into the target.
  return roundTo((qty / from.factor) * to.factor, to.rounding)
}
