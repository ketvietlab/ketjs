// The JSON Schema an HTTP binding may author, and the validator that enforces it.
//
// A contract that promises a constraint the server never checks is worse than no
// contract: a client written against it is right until the day it is not. So the
// accepted vocabulary is exactly what `validateJson` enforces, and a keyword outside
// it is a composition error rather than documentation nobody honours.

import { isDateText } from './types.ts'
import type { JsonSchema } from '../types.ts'

const JSON_TYPES = new Set(['null', 'boolean', 'object', 'array', 'number', 'integer', 'string'])

/** Every keyword the subset accepts. `$ref`, combinators and `default` are deliberately absent. */
export const SCHEMA_KEYWORDS: ReadonlySet<string> = new Set([
  'type',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'enum',
  'const',
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'pattern',
  'format',
  'minItems',
  'maxItems',
  'title',
  'description',
  'examples',
])

/** A failed check: where in the value, and which keyword refused it. Never the value itself. */
export type SchemaViolation = { pointer: string; rule: string }

type Rec = Record<string, unknown>

const isRecord = (value: unknown): value is Rec =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** One JSON pointer segment (RFC 6901). */
export const pointerSegment = (name: string): string => name.replaceAll('~', '~0').replaceAll('/', '~1')

const COUNTS = new Set(['minLength', 'maxLength', 'minItems', 'maxItems'])

/**
 * Why a schema is outside the supported subset, or null when it is inside.
 * The answer names a JSON pointer into the schema, so the author can find it.
 */
export function schemaProblem(schema: unknown, at = ''): string | null {
  if (!isRecord(schema)) return `${at || '/'}: a schema is a JSON object`
  for (const [key, value] of Object.entries(schema)) {
    const here = `${at}/${pointerSegment(key)}`
    if (!SCHEMA_KEYWORDS.has(key)) return `${here}: keyword "${key}" is not supported`
    if (key === 'type') {
      const list = Array.isArray(value) ? value : [value]
      if (
        !list.length ||
        list.some((t) => typeof t !== 'string' || !JSON_TYPES.has(t)) ||
        new Set(list).size !== list.length
      )
        return `${here}: a JSON type name or a list of distinct names`
    } else if (key === 'properties') {
      if (!isRecord(value)) return `${here}: an object of schemas`
      for (const [name, sub] of Object.entries(value)) {
        const problem = schemaProblem(sub, `${here}/${pointerSegment(name)}`)
        if (problem) return problem
      }
    } else if (key === 'items') {
      const problem = schemaProblem(value, here)
      if (problem) return problem
    } else if (key === 'required') {
      if (
        !Array.isArray(value) ||
        value.some((name) => typeof name !== 'string') ||
        new Set(value).size !== value.length
      )
        return `${here}: a list of distinct property names`
    } else if (key === 'additionalProperties') {
      if (typeof value !== 'boolean') return `${here}: only true or false is supported`
    } else if (key === 'enum') {
      if (!Array.isArray(value) || !value.length) return `${here}: a non-empty list`
    } else if (COUNTS.has(key)) {
      if (!Number.isSafeInteger(value) || (value as number) < 0) return `${here}: a non-negative integer`
    } else if (key === 'minimum' || key === 'maximum') {
      if (typeof value !== 'number' || !Number.isFinite(value)) return `${here}: a finite number`
    } else if (key === 'pattern') {
      if (typeof value !== 'string' || !compiles(value)) return `${here}: a valid regular expression`
    } else if (key === 'format') {
      if (value !== 'date' && value !== 'date-time') return `${here}: "date" or "date-time"`
    } else if (key === 'title' || key === 'description') {
      if (typeof value !== 'string') return `${here}: a string`
    } else if (key === 'examples') {
      if (!Array.isArray(value)) return `${here}: a list`
    }
  }
  return null
}

const patterns = new Map<string, RegExp | null>()
const regex = (source: string): RegExp | null => {
  if (!patterns.has(source)) {
    try {
      patterns.set(source, new RegExp(source, 'u'))
    } catch {
      patterns.set(source, null)
    }
  }
  return patterns.get(source) ?? null
}
const compiles = (source: string): boolean => regex(source) !== null

const isJsonObject = (value: unknown): value is Rec => {
  if (!isRecord(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

const jsonType = (value: unknown): string | null => {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'string' || typeof value === 'boolean') return typeof value
  if (typeof value === 'number') return Number.isFinite(value) ? 'number' : null
  return isJsonObject(value) ? 'object' : null
}

const hasType = (value: unknown, type: string): boolean => {
  const actual = jsonType(value)
  if (type === 'integer') return actual === 'number' && Number.isInteger(value)
  return actual === type
}

const equal = (a: unknown, b: unknown): boolean => {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((held, i) => equal(held, b[i]))
  if (isRecord(a) && isRecord(b)) {
    const keys = Object.keys(a)
    return (
      keys.length === Object.keys(b).length && keys.every((k) => Object.hasOwn(b, k) && equal(a[k], b[k]))
    )
  }
  return false
}

const DATE_TIME = /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/

const hasFormat = (value: string, format: unknown): boolean => {
  if (format === 'date') return isDateText(value)
  if (format === 'date-time') {
    const match = DATE_TIME.exec(value)
    return !!match && isDateText(match[1]) && Number.isFinite(Date.parse(value))
  }
  return true
}

/**
 * Check a value against a schema from the subset. Returns the first violation, or
 * null. Keywords apply only to values of the type they describe, as in JSON Schema.
 */
export function validateJson(schema: JsonSchema, value: unknown, at = ''): SchemaViolation | null {
  const fail = (rule: string): SchemaViolation => ({ pointer: at || '/', rule })
  if (jsonType(value) === null) return fail('type')
  if (schema['type'] !== undefined) {
    const types = Array.isArray(schema['type']) ? schema['type'] : [schema['type']]
    if (!types.some((t) => hasType(value, String(t)))) return fail('type')
  }
  if (Object.hasOwn(schema, 'const') && !equal(value, schema['const'])) return fail('const')
  if (Array.isArray(schema['enum']) && !schema['enum'].some((option) => equal(value, option)))
    return fail('enum')

  if (typeof value === 'string') {
    const length = [...value].length
    if (typeof schema['minLength'] === 'number' && length < schema['minLength']) return fail('minLength')
    if (typeof schema['maxLength'] === 'number' && length > schema['maxLength']) return fail('maxLength')
    if (typeof schema['pattern'] === 'string' && !regex(schema['pattern'])?.test(value))
      return fail('pattern')
    if (!hasFormat(value, schema['format'])) return fail('format')
  }
  if (typeof value === 'number') {
    if (typeof schema['minimum'] === 'number' && value < schema['minimum']) return fail('minimum')
    if (typeof schema['maximum'] === 'number' && value > schema['maximum']) return fail('maximum')
  }
  if (Array.isArray(value)) {
    if (typeof schema['minItems'] === 'number' && value.length < schema['minItems']) return fail('minItems')
    if (typeof schema['maxItems'] === 'number' && value.length > schema['maxItems']) return fail('maxItems')
    if (isRecord(schema['items'])) {
      for (const [i, held] of value.entries()) {
        const found = validateJson(schema['items'] as JsonSchema, held, `${at}/${i}`)
        if (found) return found
      }
    }
  }
  if (isJsonObject(value)) {
    // An undefined property is absent: JSON has no way to write it.
    const present = (name: string) => Object.hasOwn(value, name) && value[name] !== undefined
    for (const name of Array.isArray(schema['required']) ? (schema['required'] as string[]) : []) {
      if (!present(name)) return { pointer: `${at}/${pointerSegment(name)}`, rule: 'required' }
    }
    const properties = isRecord(schema['properties']) ? schema['properties'] : {}
    for (const [name, held] of Object.entries(value)) {
      if (held === undefined) continue
      const sub = properties[name]
      if (sub === undefined) {
        if (schema['additionalProperties'] === false)
          return { pointer: `${at}/${pointerSegment(name)}`, rule: 'additionalProperties' }
        continue
      }
      const found = validateJson(sub as JsonSchema, held, `${at}/${pointerSegment(name)}`)
      if (found) return found
    }
  }
  return null
}
