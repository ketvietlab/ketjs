import type { FieldBase, ParsedType, TypeParse } from '../types.ts'

export const SCALARS = new Set(['id', 'text', 'int', 'float', 'decimal', 'bool', 'json', 'datetime'])

export function parseType(spec: string): TypeParse {
  if (typeof spec !== 'string') return { ok: false, reason: 'type must be a string' }
  let s = spec
  let optional = false
  if (s.endsWith('?')) { optional = true; s = s.slice(0, -1) }
  if (s.startsWith('ref:')) {
    const target = s.slice(4)
    if (!/^[a-z][a-z0-9_]*\.[A-Z][A-Za-z0-9]*$/.test(target))
      return { ok: false, reason: `ref target must be "module.Model", got "${target}"` }
    return { ok: true, base: 'ref', target, optional }
  }
  if (!SCALARS.has(s)) return { ok: false, reason: `unknown type "${spec}"` }
  return { ok: true, base: s as FieldBase, optional }
}

// decimal is a number in TypeScript because it is a number in arithmetic; only
// its storage is exact.
const TS: Record<FieldBase, string> = { id: 'string', text: 'string', int: 'number', float: 'number', decimal: 'number', bool: 'boolean', json: 'unknown', datetime: 'Date', ref: 'string' }
export const tsTypeOf = (t: ParsedType): string => TS[t.base] + (t.optional ? ' | null' : '')

// SQLite has no exact decimal at all: NUMERIC affinity silently becomes REAL.
// TEXT is the only storage that gives it back unchanged.
const SQL: Record<FieldBase, string> = { id: 'TEXT PRIMARY KEY', text: 'TEXT', int: 'INTEGER', float: 'REAL', decimal: 'TEXT', bool: 'INTEGER', json: 'TEXT', datetime: 'TEXT', ref: 'TEXT' }
export const sqlTypeOf = (t: ParsedType): string => SQL[t.base]
