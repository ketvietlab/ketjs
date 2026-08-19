// A query is an immutable value. Builder methods return a new query rather than
// mutating one, so a query can be passed through several modules and refined by
// each without any of them stepping on the others — Ecto's composability with a
// chainable surface.

import { exprTouches, and } from './expr.ts'
import type { Col, Expr } from './expr.ts'
import { tableNameFor } from './migrate.ts'
import { KetError } from '../kernel/errors.ts'
import type { Manifest } from '../types.ts'

export type Dialect = 'sqlite' | 'postgres'
export type Sql = { text: string; params: unknown[]; touches: string[] }
export type Order = { col: Col; dir: 'asc' | 'desc' }

export type Table<T = Record<string, Col>> = T & { readonly $model: string; readonly $columns: string[] }

// Column handles are built once from the manifest. No proxies, no magic: a column
// that does not exist simply is not there, and the expression helpers reject it.
export function table(manifest: Manifest, model: string): Table {
  const def = manifest.models[model]
  if (!def) {
    throw new KetError({
      code: 'E_UNKNOWN_MODEL',
      message: `no model "${model}"`,
      hint: `known models: ${Object.keys(manifest.models).join(', ') || '(none)'}`,
    })
  }
  const t = Object.create(null) as Record<string, unknown>
  for (const name of Object.keys(def.fields)) t[name] = Object.freeze({ model, name })
  t['$model'] = model
  t['$columns'] = Object.keys(def.fields)
  return Object.freeze(t) as Table
}

export type QueryKind = 'select' | 'count' | 'delete'

/** Related rows a query has asked for. Never populated by touching a property. */
export type Preload = { name: string }

export class Query {
  readonly kind: QueryKind
  readonly model: string
  readonly columns: readonly string[] | null
  readonly condition: Expr | null
  readonly order: readonly Order[]
  readonly limitN: number | null
  readonly offsetN: number | null
  readonly preloads: readonly Preload[]

  constructor(init: {
    kind: QueryKind
    model: string
    columns?: readonly string[] | null
    condition?: Expr | null
    order?: readonly Order[]
    limitN?: number | null
    offsetN?: number | null
    preloads?: readonly Preload[]
  }) {
    this.kind = init.kind
    this.model = init.model
    this.columns = init.columns ?? null
    this.condition = init.condition ?? null
    this.order = init.order ?? []
    this.limitN = init.limitN ?? null
    this.offsetN = init.offsetN ?? null
    this.preloads = init.preloads ?? []
    Object.freeze(this)
  }

  private with(patch: Partial<ConstructorParameters<typeof Query>[0]>): Query {
    return new Query({
      kind: this.kind,
      model: this.model,
      columns: this.columns,
      condition: this.condition,
      order: this.order,
      limitN: this.limitN,
      offsetN: this.offsetN,
      preloads: this.preloads,
      ...patch,
    })
  }

  select(...cols: Col[]): Query {
    return this.with({ columns: cols.map((c) => c.name) })
  }
  /** Additional conditions are ANDed, so a query can be narrowed by several callers. */
  where(...parts: Expr[]): Query {
    const next = parts.length === 1 ? parts[0]! : and(...parts)
    return this.with({ condition: this.condition ? and(this.condition, next) : next })
  }
  orderBy(...order: Order[]): Query {
    return this.with({ order: [...this.order, ...order] })
  }
  limit(n: number): Query {
    return this.with({ limitN: n })
  }
  offset(n: number): Query {
    return this.with({ offsetN: n })
  }
  count(): Query {
    return this.with({ kind: 'count', columns: null, order: [] })
  }

  /**
   * Ask for a declared relation alongside the rows. Two queries, not one per row:
   * the parents, then the children by id. There is no lazy alternative, which is
   * exactly why an accidental N+1 cannot be written here.
   */
  preload(...names: string[]): Query {
    return this.with({ preloads: [...this.preloads, ...names.map((name) => ({ name }))] })
  }

  /** Every model this query reads or writes. Checked against declared effects. */
  get touches(): string[] {
    const s = exprTouches(this.condition)
    s.add(this.model)
    return [...s].sort()
  }

  get effect(): 'read' | 'write' {
    return this.kind === 'delete' ? 'write' : 'read'
  }

  toSQL(dialect: Dialect = 'sqlite'): Sql {
    const params: unknown[] = []
    const q = (s: string) => `"${s.replace(/"/g, '""')}"`
    const ph = () => (dialect === 'postgres' ? `$${params.length}` : '?')
    const bind = (v: unknown) => {
      params.push(v)
      return ph()
    }
    const colSql = (c: Col) => `${q(tableNameFor(c.model))}.${q(c.name)}`

    const render = (e: Expr): string => {
      if (e.op === 'and' || e.op === 'or') {
        if (!e.parts.length) return e.op === 'and' ? '1 = 1' : '1 = 0'
        return '(' + e.parts.map(render).join(e.op === 'and' ? ' AND ' : ' OR ') + ')'
      }
      if (e.op === 'not') return `NOT (${render(e.expr)})`
      if (e.op === 'null') return `${colSql(e.col)} IS ${e.negated ? 'NOT ' : ''}NULL`
      if (e.op === 'like') return `${colSql(e.col)} LIKE ${bind(e.value)}`
      if (e.op === 'in') {
        if (!e.values.length) return '1 = 0'
        return `${colSql(e.col)} IN (${e.values.map(bind).join(', ')})`
      }
      return `${colSql(e.col)} ${e.cmp} ${bind(e.value)}`
    }

    const t = q(tableNameFor(this.model))
    let text: string
    if (this.kind === 'delete') text = `DELETE FROM ${t}`
    else if (this.kind === 'count') text = `SELECT COUNT(*) AS count FROM ${t}`
    else
      text = `SELECT ${this.columns ? this.columns.map((c) => `${t}.${q(c)}`).join(', ') : `${t}.*`} FROM ${t}`

    if (this.condition) text += ` WHERE ${render(this.condition)}`
    if (this.order.length)
      text += ` ORDER BY ${this.order.map((o) => `${colSql(o.col)} ${o.dir.toUpperCase()}`).join(', ')}`
    if (this.limitN != null) text += ` LIMIT ${bind(this.limitN)}`
    if (this.offsetN != null) text += ` OFFSET ${bind(this.offsetN)}`

    return { text, params, touches: this.touches }
  }

  toJSON() {
    return {
      kind: this.kind,
      model: this.model,
      columns: this.columns,
      where: this.condition,
      order: this.order,
      limit: this.limitN,
      offset: this.offsetN,
      preloads: this.preloads.map((p) => p.name),
      touches: this.touches,
    }
  }
}

export const from = (t: Table): Query => new Query({ kind: 'select', model: t.$model })
export const deleteFrom = (t: Table): Query => new Query({ kind: 'delete', model: t.$model })
export const asc = (col: Col): Order => ({ col, dir: 'asc' })
export const desc = (col: Col): Order => ({ col, dir: 'desc' })
