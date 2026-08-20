// A query is an immutable value. Builder methods return a new query rather than
// mutating one, so a query can be passed through several modules and refined by
// each without any of them stepping on the others — Ecto's composability with a
// chainable surface.

import { exprTouches, and } from './expr.ts'
import type { Col, Expr } from './expr.ts'
import { tableNameFor } from './migrate.ts'
import { KetError } from '../kernel/errors.ts'
import type { Manifest } from '../types.ts'
import { assertTimezone } from './time.ts'
import type { GroupInterval } from './time.ts'

export type Dialect = 'sqlite' | 'postgres'
export type Sql = { text: string; params: unknown[]; touches: string[] }
export type Order = { col: Col; dir: 'asc' | 'desc' }
export type GroupSpec = { col: Col; interval?: GroupInterval; timezone?: string }
export type AggregateSpec =
  | { fn: 'count'; as: string }
  | { fn: 'countDistinct' | 'sum' | 'avg' | 'min' | 'max'; col: Col; as: string }
export type GroupOrder = { by: 'key' | 'count' | string; dir: 'asc' | 'desc' }
export type GroupRow = { key: unknown[]; count: number; aggregates: Record<string, unknown> }

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

export type QueryKind = 'select' | 'count' | 'delete' | 'group'

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
  readonly groups: readonly GroupSpec[]
  readonly aggregates: readonly AggregateSpec[]
  readonly groupOrder: readonly GroupOrder[]

  constructor(init: {
    kind: QueryKind
    model: string
    columns?: readonly string[] | null
    condition?: Expr | null
    order?: readonly Order[]
    limitN?: number | null
    offsetN?: number | null
    preloads?: readonly Preload[]
    groups?: readonly GroupSpec[]
    aggregates?: readonly AggregateSpec[]
    groupOrder?: readonly GroupOrder[]
  }) {
    this.kind = init.kind
    this.model = init.model
    this.columns = init.columns ?? null
    this.condition = init.condition ?? null
    this.order = init.order ?? []
    this.limitN = init.limitN ?? null
    this.offsetN = init.offsetN ?? null
    this.preloads = init.preloads ?? []
    this.groups = init.groups ?? []
    this.aggregates = init.aggregates ?? []
    this.groupOrder = init.groupOrder ?? []
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
      groups: this.groups,
      aggregates: this.aggregates,
      groupOrder: this.groupOrder,
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
  groupBy(...groups: GroupSpec[]): Query {
    if (!groups.length) throw new KetError({ code: 'E_GROUP_EMPTY', message: 'groupBy requires a field' })
    for (const group of groups) {
      if (group.col.model !== this.model)
        throw new KetError({
          code: 'E_GROUP_MODEL',
          message: `cannot group ${this.model} by ${group.col.model}`,
        })
      if (group.interval && group.timezone) assertTimezone(group.timezone)
    }
    return this.with({ kind: 'group', columns: null, groups: [...this.groups, ...groups] })
  }
  aggregate(...aggregates: AggregateSpec[]): Query {
    for (const aggregate of aggregates) {
      if (aggregate.fn !== 'count' && aggregate.col.model !== this.model)
        throw new KetError({
          code: 'E_GROUP_MODEL',
          message: `cannot aggregate ${aggregate.col.model} on ${this.model}`,
        })
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(aggregate.as) || aggregate.as === 'count')
        throw new KetError({
          code: 'E_AGGREGATE_ALIAS',
          message: `invalid aggregate alias "${aggregate.as}"`,
        })
    }
    return this.with({ aggregates: [...this.aggregates, ...aggregates] })
  }
  orderGroupsBy(...order: GroupOrder[]): Query {
    return this.with({ groupOrder: [...this.groupOrder, ...order] })
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
    for (const group of this.groups) s.add(group.col.model)
    for (const aggregate of this.aggregates) if (aggregate.fn !== 'count') s.add(aggregate.col.model)
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
      if (e.op === 'bucket') {
        const column = colSql(e.col)
        if (dialect === 'postgres') {
          const format =
            e.interval === 'quarter'
              ? 'YYYY-"Q"Q'
              : e.interval === 'year'
                ? 'YYYY'
                : e.interval === 'month'
                  ? 'YYYY-MM'
                  : 'YYYY-MM-DD'
          return `TO_CHAR(DATE_TRUNC('${e.interval}', ${column} AT TIME ZONE ${bind(e.timezone)}), '${format}') = ${bind(e.value)}`
        }
        return `ket_date_bucket(${column}, ${bind(e.interval)}, ${bind(e.timezone)}) = ${bind(e.value)}`
      }
      if (e.op === 'like')
        return `${colSql(e.col)} ${e.insensitive && dialect === 'postgres' ? 'ILIKE' : 'LIKE'} ${bind(e.value)}${e.escape ? ` ESCAPE '\\'` : ''}`
      if (e.op === 'in') {
        if (!e.values.length) return '1 = 0'
        return `${colSql(e.col)} IN (${e.values.map(bind).join(', ')})`
      }
      const compared = e.numeric && dialect === 'sqlite' ? `CAST(${colSql(e.col)} AS REAL)` : colSql(e.col)
      return `${compared} ${e.cmp} ${bind(e.value)}`
    }

    const t = q(tableNameFor(this.model))
    let text: string
    if (this.kind === 'delete') text = `DELETE FROM ${t}`
    else if (this.kind === 'count') text = `SELECT COUNT(*) AS count FROM ${t}`
    else if (this.kind === 'group') {
      const groupSql = this.groups.map((group) => {
        const column = colSql(group.col)
        if (!group.interval) return column
        const timezone = group.timezone ?? 'UTC'
        if (dialect === 'postgres') {
          if (group.interval === 'quarter')
            return `TO_CHAR(DATE_TRUNC('quarter', ${column} AT TIME ZONE ${bind(timezone)}), 'YYYY-"Q"Q')`
          const format =
            group.interval === 'year' ? 'YYYY' : group.interval === 'month' ? 'YYYY-MM' : 'YYYY-MM-DD'
          return `TO_CHAR(DATE_TRUNC('${group.interval}', ${column} AT TIME ZONE ${bind(timezone)}), '${format}')`
        }
        return `ket_date_bucket(${column}, ${bind(group.interval)}, ${bind(timezone)})`
      })
      const aggregateSql = this.aggregates.map((aggregate) => {
        if (aggregate.fn === 'count') return `COUNT(*) AS ${q(aggregate.as)}`
        const fn = aggregate.fn === 'countDistinct' ? 'COUNT' : aggregate.fn.toUpperCase()
        const body =
          aggregate.fn === 'countDistinct' ? `DISTINCT ${colSql(aggregate.col)}` : colSql(aggregate.col)
        return `${fn}(${body}) AS ${q(aggregate.as)}`
      })
      text = `SELECT ${groupSql.map((sql, i) => `${sql} AS ${q(`__group${i}`)}`).join(', ')}, COUNT(*) AS ${q('__count')}${aggregateSql.length ? `, ${aggregateSql.join(', ')}` : ''} FROM ${t}`
    } else
      text = `SELECT ${this.columns ? this.columns.map((c) => `${t}.${q(c)}`).join(', ') : `${t}.*`} FROM ${t}`

    if (this.condition) text += ` WHERE ${render(this.condition)}`
    if (this.kind === 'group') {
      text += ` GROUP BY ${this.groups.map((_, i) => String(i + 1)).join(', ')}`
      if (this.groupOrder.length) {
        const aliases = new Set(this.aggregates.map((a) => a.as))
        text += ` ORDER BY ${this.groupOrder
          .map((order) => {
            const by =
              order.by === 'key'
                ? q('__group0')
                : order.by === 'count'
                  ? q('__count')
                  : aliases.has(order.by)
                    ? q(order.by)
                    : null
            if (!by)
              throw new KetError({ code: 'E_GROUP_ORDER', message: `unknown group order "${order.by}"` })
            return `${by} ${order.dir.toUpperCase()}`
          })
          .join(', ')}`
      }
    } else if (this.order.length)
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
      groups: this.groups,
      aggregates: this.aggregates,
      groupOrder: this.groupOrder,
      touches: this.touches,
    }
  }
}

export const from = (t: Table): Query => new Query({ kind: 'select', model: t.$model })
export const deleteFrom = (t: Table): Query => new Query({ kind: 'delete', model: t.$model })
export const asc = (col: Col): Order => ({ col, dir: 'asc' })
export const desc = (col: Col): Order => ({ col, dir: 'desc' })
