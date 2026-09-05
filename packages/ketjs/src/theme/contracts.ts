import { KetError } from '../kernel/errors.ts'
import { isDateText, parseType } from '../kernel/types.ts'
import { findCallable, projectFields, visibleFields } from './viewmodel.ts'
import type { Manifest } from '../types.ts'

const scalarMatches = (base: string, value: unknown): boolean => {
  if (base === 'id' || base === 'text' || base === 'ref') return typeof value === 'string'
  if (base === 'int') return typeof value === 'number' && Number.isInteger(value)
  if (base === 'float' || base === 'decimal') return typeof value === 'number' && Number.isFinite(value)
  if (base === 'bool') return typeof value === 'boolean'
  if (base === 'date') return isDateText(value)
  if (base === 'datetime')
    return (
      (typeof value === 'string' && !Number.isNaN(Date.parse(value))) ||
      (value instanceof Date && !Number.isNaN(value.getTime()))
    )
  if (base === 'json') return typeof value === 'object'
  return false
}

const dataOnly = (value: unknown, seen = new WeakSet<object>()): boolean => {
  if (value == null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'object') return false
  if (value instanceof Date) return !Number.isNaN(value.getTime())
  if (seen.has(value)) return false
  const prototype = Object.getPrototypeOf(value)
  if (!Array.isArray(value) && prototype !== null && prototype !== Object.prototype) return false
  seen.add(value)
  const valid = Object.values(value as Record<string, unknown>).every((item) => dataOnly(item, seen))
  seen.delete(value)
  return valid
}

/** Project a surrounding scope through a declared joint/island prop contract. */
export function contractProps(
  manifest: Manifest,
  kind: 'joint' | 'island',
  key: string,
  schema: Record<string, string>,
  input: Record<string, unknown>,
  /** The module whose template is about to read these props. See `visibleFields`. */
  reader?: string,
): Record<string, unknown> {
  for (const [name, value] of Object.entries(input)) {
    const callable = findCallable(value, name)
    if (callable !== null) {
      throw new KetError({
        code: 'E_SCOPE_CALLABLE',
        message: `${kind} "${key}" scope key "${callable}" is a function`,
        hint: 'extension scopes receive data only',
      })
    }
  }

  const out = Object.create(null) as Record<string, unknown>
  for (const [name, spec] of Object.entries(schema)) {
    const value = input[name]
    const scalar = parseType(spec)
    const optional = scalar.ok ? scalar.optional : spec.endsWith('?')
    if (value == null) {
      if (optional) {
        if (value === null) out[name] = null
        continue
      }
      throw new KetError({
        code: kind === 'joint' ? 'E_JOINT_PROP' : 'E_ISLAND_PROP',
        message: `${kind} "${key}" prop "${name}" expects ${spec}`,
        hint: `received ${value === null ? 'null' : 'missing value'}`,
      })
    }
    const view = spec.endsWith('?') ? spec.slice(0, -1) : spec
    const isView = !scalar.ok && !!manifest.views[view]
    const valid = scalar.ok
      ? scalarMatches(scalar.base, value)
      : isView && typeof value === 'object' && !Array.isArray(value)
    // A view-typed prop is projected, not merely type-checked. Declaring
    // `product: 'catalog.product'` used to admit any object at all, so whatever
    // row the caller happened to hold — vat number, cost price, internal notes —
    // crossed into the theme intact. The declaration says which fields a theme may
    // read; the only way for that to be true is for the other fields not to arrive.
    const projected =
      isView && valid
        ? projectFields(value as Record<string, unknown>, visibleFields(manifest, view, reader))
        : value
    if (!valid || !dataOnly(projected)) {
      throw new KetError({
        code: kind === 'joint' ? 'E_JOINT_PROP' : 'E_ISLAND_PROP',
        message: valid
          ? `${kind} "${key}" prop "${name}" contains a non-data value`
          : `${kind} "${key}" prop "${name}" expects ${spec}`,
        hint: valid
          ? 'extension props must contain plain, finite data only'
          : `received ${Array.isArray(value) ? 'array' : typeof value}`,
      })
    }
    out[name] = projected
  }
  return Object.freeze(out)
}

/**
 * A section placement's settings, projected to what the section declared.
 *
 * The write path already validates a layout against this schema
 * (`validateLayout`), so this is the boundary rather than a second gate: a stored
 * layout that predates a schema change, or one an import wrote straight into the
 * database, still reaches the theme carrying only declared keys. Missing values
 * arrive as null, exactly as a drop's do, so a template branches on absence
 * instead of on undefined.
 */
export function sectionSettings(
  schema: Record<string, string>,
  settings: Record<string, unknown>,
): Record<string, unknown> {
  const out = Object.create(null) as Record<string, unknown>
  for (const name of Object.keys(schema)) out[name] = settings[name] ?? null
  return Object.freeze(out)
}
