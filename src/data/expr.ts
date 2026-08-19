// Query expressions are values, not strings.
//
// That is the whole reason this layer exists rather than a tagged SQL literal: a
// query you can inspect can be checked against a function's declared effects before
// it runs, handed to an agent as data, and rendered for two dialects from one shape.

export type Col = { readonly model: string; readonly name: string }

export type Expr =
  | { readonly op: 'and'; readonly parts: Expr[] }
  | { readonly op: 'or'; readonly parts: Expr[] }
  | { readonly op: 'not'; readonly expr: Expr }
  | { readonly op: 'cmp'; readonly col: Col; readonly cmp: '=' | '<>' | '>' | '<' | '>=' | '<='; readonly value: unknown }
  | { readonly op: 'like'; readonly col: Col; readonly value: string }
  | { readonly op: 'in'; readonly col: Col; readonly values: unknown[] }
  | { readonly op: 'null'; readonly col: Col; readonly negated: boolean }

const isCol = (c: unknown): c is Col =>
  !!c && typeof c === 'object' && typeof (c as Col).model === 'string' && typeof (c as Col).name === 'string'

const col = (c: Col): Col => {
  if (!isCol(c)) throw new Error(`expected a column from table(), got ${JSON.stringify(c)} — did you use a plain string?`)
  return c
}

export const eq = (c: Col, value: unknown): Expr => ({ op: 'cmp', col: col(c), cmp: '=', value })
export const ne = (c: Col, value: unknown): Expr => ({ op: 'cmp', col: col(c), cmp: '<>', value })
export const gt = (c: Col, value: unknown): Expr => ({ op: 'cmp', col: col(c), cmp: '>', value })
export const lt = (c: Col, value: unknown): Expr => ({ op: 'cmp', col: col(c), cmp: '<', value })
export const gte = (c: Col, value: unknown): Expr => ({ op: 'cmp', col: col(c), cmp: '>=', value })
export const lte = (c: Col, value: unknown): Expr => ({ op: 'cmp', col: col(c), cmp: '<=', value })
export const like = (c: Col, value: string): Expr => ({ op: 'like', col: col(c), value })
export const inArray = (c: Col, values: unknown[]): Expr => ({ op: 'in', col: col(c), values: [...values] })
export const isNull = (c: Col): Expr => ({ op: 'null', col: col(c), negated: false })
export const isNotNull = (c: Col): Expr => ({ op: 'null', col: col(c), negated: true })

export const and = (...parts: Expr[]): Expr => ({ op: 'and', parts })
export const or = (...parts: Expr[]): Expr => ({ op: 'or', parts })

export const not = (expr: Expr): Expr => ({ op: 'not', expr })

// Every model an expression reads. This is what makes effect checking possible
// without executing anything.
export function exprTouches(e: Expr | null, out = new Set<string>()): Set<string> {
  if (!e) return out
  if (e.op === 'and' || e.op === 'or') { for (const p of e.parts) exprTouches(p, out); return out }
  if (e.op === 'not') return exprTouches(e.expr, out)
  out.add(e.col.model)
  return out
}
