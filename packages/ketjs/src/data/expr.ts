// Query expressions are values, not strings.
//
// That is the whole reason this layer exists rather than a tagged SQL literal: a
// query you can inspect can be checked against a function's declared effects before
// it runs, handed to an agent as data, and rendered for two dialects from one shape.

import { assertGroupInterval } from './time.ts'
import type { GroupInterval } from './time.ts'
import type { FieldBase } from '../types.ts'

export type Col = { readonly model: string; readonly name: string; readonly base: FieldBase }

export type Expr =
  | { readonly op: 'and'; readonly parts: Expr[] }
  | { readonly op: 'or'; readonly parts: Expr[] }
  | { readonly op: 'not'; readonly expr: Expr }
  | {
      readonly op: 'cmp'
      readonly col: Col
      readonly cmp: '=' | '<>' | '>' | '<' | '>=' | '<='
      readonly value: unknown
      readonly numeric?: boolean
    }
  | {
      readonly op: 'like'
      readonly col: Col
      readonly value: string
      readonly insensitive?: boolean
      readonly escape?: boolean
    }
  | { readonly op: 'in'; readonly col: Col; readonly values: unknown[] }
  | { readonly op: 'null'; readonly col: Col; readonly negated: boolean }
  | {
      readonly op: 'bucket'
      readonly col: Col
      readonly interval: GroupInterval
      readonly timezone: string
      readonly value: string
    }

const FIELD_BASES = new Set<FieldBase>([
  'id',
  'text',
  'int',
  'float',
  'decimal',
  'bool',
  'json',
  'date',
  'datetime',
  'ref',
])

export const assertCol = (candidate: unknown): Col => {
  const c = candidate as Partial<Col> | null
  if (
    !c ||
    typeof c !== 'object' ||
    typeof c.model !== 'string' ||
    typeof c.name !== 'string' ||
    !FIELD_BASES.has(c.base as FieldBase)
  )
    throw new Error(
      `expected a column from table(), got ${JSON.stringify(candidate)} — typed column metadata must include model, name, and base`,
    )
  return c as Col
}

const col = assertCol

export const eq = (c: Col, value: unknown): Expr => ({ op: 'cmp', col: col(c), cmp: '=', value })
export const ne = (c: Col, value: unknown): Expr => ({ op: 'cmp', col: col(c), cmp: '<>', value })
export const gt = (c: Col, value: unknown): Expr => ({ op: 'cmp', col: col(c), cmp: '>', value })
export const lt = (c: Col, value: unknown): Expr => ({ op: 'cmp', col: col(c), cmp: '<', value })
export const gte = (c: Col, value: unknown): Expr => ({ op: 'cmp', col: col(c), cmp: '>=', value })
export const lte = (c: Col, value: unknown): Expr => ({ op: 'cmp', col: col(c), cmp: '<=', value })
export const numericCompare = (c: Col, cmp: '=' | '<>' | '>' | '<' | '>=' | '<=', value: unknown): Expr => ({
  op: 'cmp',
  col: col(c),
  cmp,
  value,
  numeric: true,
})
export const like = (c: Col, value: string): Expr => ({ op: 'like', col: col(c), value })
export const ilike = (c: Col, value: string, escapePattern = false): Expr => ({
  op: 'like',
  col: col(c),
  value,
  insensitive: true,
  escape: escapePattern,
})
export const inArray = (c: Col, values: unknown[]): Expr => ({ op: 'in', col: col(c), values: [...values] })
export const isNull = (c: Col): Expr => ({ op: 'null', col: col(c), negated: false })
export const isNotNull = (c: Col): Expr => ({ op: 'null', col: col(c), negated: true })
export const bucketEq = (c: Col, interval: GroupInterval, timezone: string, value: string): Expr => ({
  op: 'bucket',
  col: col(c),
  // Rejected at construction as well as at toSQL: the type says GroupInterval, but
  // a value arriving as JSON has not been through the compiler.
  interval: assertGroupInterval(interval),
  timezone,
  value,
})

export const and = (...parts: Expr[]): Expr => ({ op: 'and', parts })
export const or = (...parts: Expr[]): Expr => ({ op: 'or', parts })

export const not = (expr: Expr): Expr => ({ op: 'not', expr })

// Every model an expression reads. This is what makes effect checking possible
// without executing anything.
export function exprTouches(e: Expr | null, out = new Set<string>()): Set<string> {
  if (!e) return out
  if (e.op === 'and' || e.op === 'or') {
    for (const p of e.parts) exprTouches(p, out)
    return out
  }
  if (e.op === 'not') return exprTouches(e.expr, out)
  out.add(e.col.model)
  return out
}
