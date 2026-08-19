// What a function is allowed to hand back.
//
// `output` was a comment: composed into the manifest and read by nothing, so a
// function could declare it returned three fields and return eight. That is not a
// small gap — a handler that preloads a relation to show a product's name hands
// back the whole product row, cost included, to whoever may call it.
//
// The mechanism to close it already existed and already ran: view models build a
// null-prototype frozen object holding exactly the declared fields, which is the
// boundary that stops a third-party theme reaching anything else. This is the same
// idea applied to the other boundary — the one between a function and its caller.
//
// Two properties, and they are worth telling apart:
//
//   Nothing undeclared escapes. This is picking, so it holds for every value,
//   every row, and an empty result — it cannot depend on the data.
//
//   Everything declared is present. This can only be checked where there is a row
//   to check, so an empty result proves nothing about it. It is a bug in the
//   handler rather than a hole in the boundary, and it is reported as one.

import { KetError } from '../kernel/errors.ts'

type Rec = Record<string, unknown>

const isPlain = (v: unknown): v is Rec =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Date)

const pick = (fnKey: string, output: Record<string, string>, row: Rec): Rec => {
  const out: Rec = {}
  for (const [f, type] of Object.entries(output)) {
    if (f in row) {
      out[f] = row[f]
      continue
    }
    // `?` means the same here as everywhere else: it may be absent. A function that
    // answers {ok:true, qty} or {ok:false, errors} needs it — the convention is a
    // union, and a flat record can only describe one without it.
    if (type.endsWith('?')) continue
    throw new KetError({
      code: 'E_OUTPUT_FIELD_MISSING',
      message: `"${fnKey}" declares output field "${f}" but returned a row without it`,
      hint: `mark it "${type}?" if it is sometimes absent, or build it — the handler returned: ${Object.keys(row).join(', ') || '(nothing)'}`,
    })
  }
  return out
}

/**
 * Narrow a handler's return value to the fields it declared.
 *
 * An undeclared output means no projection: every function would otherwise have to
 * be rewritten at once, and a gap that is visible in `ket permissions` is a better
 * trade than a migration nobody finishes. The count there is the progress bar.
 */
export function project(fnKey: string, output: Record<string, string>, value: unknown): unknown {
  const fields = Object.keys(output)
  if (!fields.length) return value
  if (value === null || value === undefined) return value
  if (Array.isArray(value)) return value.map((v) => project(fnKey, output, v))
  if (!isPlain(value)) {
    throw new KetError({
      code: 'E_OUTPUT_NOT_SHAPED',
      message: `"${fnKey}" declares an output shape but returned ${typeof value}`,
      hint: `declared fields: ${fields.join(', ')} — return an object with those, or a list of them`,
    })
  }
  return pick(fnKey, output, value)
}
