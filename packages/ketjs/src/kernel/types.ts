import type { FieldBase, ParsedType, TypeParse } from '../types.ts'

export const SCALARS = new Set(['id', 'text', 'int', 'float', 'decimal', 'bool', 'json', 'date', 'datetime'])

/** A calendar date with no time or timezone, encoded canonically as YYYY-MM-DD. */
export function isDateText(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (year === 0 || month < 1 || month > 12 || day < 1) return false
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return day <= days[month - 1]!
}

export function parseType(spec: string): TypeParse {
  if (typeof spec !== 'string') return { ok: false, reason: 'type must be a string' }
  let s = spec
  let optional = false
  if (s.endsWith('?')) {
    optional = true
    s = s.slice(0, -1)
  }
  if (s.startsWith('ref:')) {
    const target = s.slice(4)
    if (!/^[a-z][a-z0-9_]*\.[A-Z][A-Za-z0-9]*$/.test(target))
      return { ok: false, reason: `ref target must be "module.Model", got "${target}"` }
    return { ok: true, base: 'ref', target, optional }
  }
  if (!SCALARS.has(s)) return { ok: false, reason: `unknown type "${spec}"` }
  return { ok: true, base: s as FieldBase, optional }
}

// decimal is a string in TypeScript because that is the only shape that survives
// the round trip unchanged. Arithmetic still happens on numbers — coerce where you
// compute, and a write accepts either — but reading one back never rounds it.
const TS: Record<FieldBase, string> = {
  id: 'string',
  text: 'string',
  int: 'number',
  float: 'number',
  decimal: 'string',
  bool: 'boolean',
  json: 'unknown',
  date: 'string',
  datetime: 'Date',
  ref: 'string',
}
export const tsTypeOf = (t: ParsedType): string => TS[t.base] + (t.optional ? ' | null' : '')

// SQLite has no exact decimal at all: NUMERIC affinity silently becomes REAL.
// TEXT is the only storage that gives it back unchanged.
const SQL: Record<FieldBase, string> = {
  id: 'TEXT PRIMARY KEY',
  text: 'TEXT',
  int: 'INTEGER',
  float: 'REAL',
  decimal: 'TEXT',
  bool: 'INTEGER',
  json: 'TEXT',
  date: 'TEXT',
  datetime: 'TEXT',
  ref: 'TEXT',
}
export const sqlTypeOf = (t: ParsedType): string => SQL[t.base]
