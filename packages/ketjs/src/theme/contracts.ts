import { KetError } from '../kernel/errors.ts'
import { isDateText, parseType } from '../kernel/types.ts'
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
): Record<string, unknown> {
  for (const [name, value] of Object.entries(input)) {
    if (typeof value === 'function') {
      throw new KetError({
        code: 'E_SCOPE_CALLABLE',
        message: `${kind} "${key}" scope key "${name}" is a function`,
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
    const valid = scalar.ok
      ? scalarMatches(scalar.base, value)
      : !!manifest.views[view] && typeof value === 'object'
    if (!valid || !dataOnly(value)) {
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
    out[name] = value
  }
  return Object.freeze(out)
}
