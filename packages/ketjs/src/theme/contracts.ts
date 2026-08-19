import { KetError } from '../kernel/errors.ts'
import { parseType } from '../kernel/types.ts'
import type { Manifest } from '../types.ts'

const scalarMatches = (base: string, value: unknown): boolean => {
  if (base === 'id' || base === 'text' || base === 'ref') return typeof value === 'string'
  if (base === 'int') return typeof value === 'number' && Number.isInteger(value)
  if (base === 'float' || base === 'decimal') return typeof value === 'number'
  if (base === 'bool') return typeof value === 'boolean'
  if (base === 'datetime') return typeof value === 'string' || value instanceof Date
  if (base === 'json') return typeof value === 'object'
  return false
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
    if (value == null) {
      if (value === null) out[name] = null
      continue
    }
    const scalar = parseType(spec)
    const view = spec.endsWith('?') ? spec.slice(0, -1) : spec
    const valid = scalar.ok
      ? scalarMatches(scalar.base, value)
      : !!manifest.views[view] && typeof value === 'object'
    if (!valid) {
      throw new KetError({
        code: kind === 'joint' ? 'E_JOINT_PROP' : 'E_ISLAND_PROP',
        message: `${kind} "${key}" prop "${name}" expects ${spec}`,
        hint: `received ${Array.isArray(value) ? 'array' : typeof value}`,
      })
    }
    out[name] = value
  }
  return Object.freeze(out)
}
