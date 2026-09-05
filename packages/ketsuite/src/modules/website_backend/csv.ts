/**
 * Rendering a spreadsheet file out of values strangers typed.
 *
 * Kept apart from the route so the escaping can be tested for what it is - a
 * security property - rather than inferred from a download nobody opens in a
 * test.
 */

/** Characters a spreadsheet reads as the start of a formula rather than text. */
const FORMULA_START = /^[=+\-@\t\r]/

/**
 * One cell, safe to hand to a spreadsheet.
 *
 * Quotes doubled, and anything carrying a comma, a quote or a newline quoted:
 * that is the ordinary half. The leading apostrophe is the half that matters.
 * A cell beginning `=`, `+`, `-` or `@` is executed as a formula by every
 * spreadsheet there is, and every value in this file was typed into a public
 * form by somebody we have never met. Escaping the delimiter without defusing
 * the formula produces a file that opens correctly and then runs.
 */
export const csvCell = (value: unknown): string => {
  const text = value == null ? '' : String(value)
  const defused = FORMULA_START.test(text) ? `'${text}` : text
  return /[",\n\r]/.test(defused) ? `"${defused.replace(/"/g, '""')}"` : defused
}

/** Header row, then one row per record, in the column order given. */
export const csvOf = (columns: readonly string[], rows: ReadonlyArray<Record<string, unknown>>): string =>
  [columns, ...rows.map((row) => columns.map((column) => row[column]))]
    .map((cells) => cells.map(csvCell).join(','))
    .join('\r\n')

/** A filename a browser will accept and a person can recognise. */
export const safeFilename = (value: string): string =>
  value.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'export'
