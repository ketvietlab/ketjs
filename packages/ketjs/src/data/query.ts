// A query is an immutable value. Builder methods return a new query rather than
// mutating one, so a query can be passed through several modules and refined by
// each without any of them stepping on the others — Ecto's composability with a
// chainable surface.

import { assertCol, exprTouches, and, makeCol } from './expr.ts'
import type { Col, Expr } from './expr.ts'
import { tableNameFor } from './migrate.ts'
import { KetError } from '../kernel/errors.ts'
import type { Manifest } from '../types.ts'
import { assertGroupInterval, assertTimezone } from './time.ts'
import type { GroupInterval } from './time.ts'
import { DECIMAL_MAX_CHARS, parseDecimal } from './changeset.ts'

export type Dialect = 'sqlite' | 'postgres'
export type Sql = { text: string; params: unknown[]; touches: string[] }
export type Order = { col: Col; dir: 'asc' | 'desc' }
export type GroupSpec = { col: Col; interval?: GroupInterval; timezone?: string }
export type AggregateSpec =
  | { fn: 'count'; col?: Col; as: string }
  | { fn: 'countDistinct' | 'sum' | 'min' | 'max'; col: Col; as: string }
  | {
      fn: 'avg'
      col: Col
      as: string
      /** Required for decimal columns so both adapters return the same finite value. */
      scale?: number
      /** Decimal averages currently support PostgreSQL-compatible half-away-from-zero rounding. */
      rounding?: 'half-away-from-zero'
    }
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
  for (const [name, field] of Object.entries(def.fields)) t[name] = makeCol(model, name, field.base)
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
    return this.with({ columns: cols.map((c) => assertCol(c).name) })
  }
  /** Additional conditions are ANDed, so a query can be narrowed by several callers. */
  where(...parts: Expr[]): Query {
    const next = parts.length === 1 ? parts[0]! : and(...parts)
    return this.with({ condition: this.condition ? and(this.condition, next) : next })
  }
  orderBy(...order: Order[]): Query {
    for (const item of order) assertCol(item.col)
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
      assertCol(group.col)
      if (group.col.model !== this.model)
        throw new KetError({
          code: 'E_GROUP_MODEL',
          message: `cannot group ${this.model} by ${group.col.model}`,
        })
      if (group.interval) assertGroupInterval(group.interval)
      if (group.interval && group.timezone) assertTimezone(group.timezone)
    }
    return this.with({ kind: 'group', columns: null, groups: [...this.groups, ...groups] })
  }
  aggregate(...aggregates: AggregateSpec[]): Query {
    for (const aggregate of aggregates) {
      if (aggregate.col) assertCol(aggregate.col)
      if (aggregate.col && aggregate.col.model !== this.model)
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
    for (const aggregate of this.aggregates) if (aggregate.col) s.add(aggregate.col.model)
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
    const colSql = (candidate: Col) => {
      const c = assertCol(candidate)
      return `${q(tableNameFor(c.model))}.${q(c.name)}`
    }
    const isDecimal = (c: Col): boolean => assertCol(c).base === 'decimal'
    const isSqliteDecimal = (c: Col): boolean => dialect === 'sqlite' && isDecimal(c)
    const nulls = (dir: 'asc' | 'desc'): 'FIRST' | 'LAST' => (dir === 'asc' ? 'LAST' : 'FIRST')
    const orderTerm = (sql: string, dir: 'asc' | 'desc'): string =>
      `${sql} ${dir.toUpperCase()} NULLS ${nulls(dir)}`
    const bindDecimal = (c: Col, value: unknown): string => {
      if (!isDecimal(c) || value === null) return bind(value)
      const parsed = parseDecimal(value)
      if (!parsed.ok)
        throw new KetError({
          code: parsed.reason === 'size' ? 'E_DECIMAL_TOO_LONG' : 'E_INVALID_DECIMAL',
          message:
            parsed.reason === 'size'
              ? `${c.model}.${c.name} query value exceeds the ${DECIMAL_MAX_CHARS}-character decimal limit`
              : `${c.model}.${c.name} query value must be a finite number or plain decimal string`,
        })
      return bind(parsed.value)
    }
    const decimalOrderSql = (column: string, dir: 'asc' | 'desc'): string => {
      const sign = `ket_decimal_sign(${column})`
      const exponent = `ket_decimal_exponent(${column})`
      const digits = `ket_decimal_digits(${column})`
      const reverse = dir === 'asc' ? 'desc' : 'asc'
      // SQLite keeps decimal columns as TEXT for exact decoding. These components
      // sort normalized scientific parts instead of coercing the value through
      // REAL, including magnitudes beyond Number.MAX_SAFE_INTEGER.
      return [
        orderTerm(sign, dir),
        orderTerm(`CASE WHEN ${sign} < 0 THEN ${exponent} END`, reverse),
        orderTerm(`CASE WHEN ${sign} < 0 THEN ${digits} END`, reverse),
        orderTerm(`CASE WHEN ${sign} > 0 THEN ${exponent} END`, dir),
        orderTerm(`CASE WHEN ${sign} > 0 THEN ${digits} END`, dir),
      ].join(', ')
    }
    const decimalOrder = (c: Col, dir: 'asc' | 'desc'): string => decimalOrderSql(colSql(c), dir)

    const render = (e: Expr): string => {
      if (e.op === 'and' || e.op === 'or') {
        if (!e.parts.length) return e.op === 'and' ? '1 = 1' : '1 = 0'
        return '(' + e.parts.map(render).join(e.op === 'and' ? ' AND ' : ' OR ') + ')'
      }
      if (e.op === 'not') return `NOT (${render(e.expr)})`
      if (e.op === 'null') return `${colSql(e.col)} IS ${e.negated ? 'NOT ' : ''}NULL`
      if (e.op === 'bucket') {
        const column = colSql(e.col)
        // Interpolated into DATE_TRUNC below, so it must be a member of the closed
        // set and nothing else — the value reaches here straight from JSON.
        const interval = assertGroupInterval(e.interval)
        if (dialect === 'postgres') {
          const format =
            interval === 'quarter'
              ? 'YYYY-"Q"Q'
              : interval === 'year'
                ? 'YYYY'
                : interval === 'month'
                  ? 'YYYY-MM'
                  : 'YYYY-MM-DD'
          return `TO_CHAR(DATE_TRUNC('${interval}', ${column} AT TIME ZONE ${bind(e.timezone)}), '${format}') = ${bind(e.value)}`
        }
        return `ket_date_bucket(${column}, ${bind(interval)}, ${bind(e.timezone)}) = ${bind(e.value)}`
      }
      if (e.op === 'like')
        return `${colSql(e.col)} ${e.insensitive && dialect === 'postgres' ? 'ILIKE' : 'LIKE'} ${bind(e.value)}${e.escape ? ` ESCAPE '\\'` : ''}`
      if (e.op === 'in') {
        if (!e.values.length) return '1 = 0'
        if (isSqliteDecimal(e.col))
          return `(${e.values.map((value) => `ket_decimal_cmp(${colSql(e.col)}, ${bindDecimal(e.col, value)}) = 0`).join(' OR ')})`
        return `${colSql(e.col)} IN (${e.values.map((value) => bindDecimal(e.col, value)).join(', ')})`
      }
      if (isSqliteDecimal(e.col))
        return `ket_decimal_cmp(${colSql(e.col)}, ${bindDecimal(e.col, e.value)}) ${e.cmp} 0`
      const compared = e.numeric && dialect === 'sqlite' ? `CAST(${colSql(e.col)} AS REAL)` : colSql(e.col)
      return `${compared} ${e.cmp} ${bindDecimal(e.col, e.value)}`
    }

    const t = q(tableNameFor(this.model))
    let text: string
    if (this.kind === 'delete') text = `DELETE FROM ${t}`
    else if (this.kind === 'count') text = `SELECT COUNT(*) AS count FROM ${t}`
    else if (this.kind === 'group') {
      const groupSql = this.groups.map((group) => {
        const column = colSql(group.col)
        if (!group.interval) return isSqliteDecimal(group.col) ? `ket_decimal_key(${column})` : column
        // Same boundary as the bucket expression: interpolated into DATE_TRUNC, so
        // it is validated here rather than trusted from the caller.
        const interval = assertGroupInterval(group.interval)
        const timezone = group.timezone ?? 'UTC'
        if (dialect === 'postgres') {
          if (interval === 'quarter')
            return `TO_CHAR(DATE_TRUNC('quarter', ${column} AT TIME ZONE ${bind(timezone)}), 'YYYY-"Q"Q')`
          const format = interval === 'year' ? 'YYYY' : interval === 'month' ? 'YYYY-MM' : 'YYYY-MM-DD'
          return `TO_CHAR(DATE_TRUNC('${interval}', ${column} AT TIME ZONE ${bind(timezone)}), '${format}')`
        }
        return `ket_date_bucket(${column}, ${bind(interval)}, ${bind(timezone)})`
      })
      const aggregateSql = this.aggregates.map((aggregate) => {
        if (aggregate.fn === 'count')
          return `COUNT(${aggregate.col ? colSql(aggregate.col) : '*'}) AS ${q(aggregate.as)}`
        if (aggregate.fn === 'avg' && isDecimal(aggregate.col)) {
          if (aggregate.rounding !== 'half-away-from-zero' || aggregate.scale === undefined)
            throw new KetError({
              code: 'E_DECIMAL_AVG_ROUNDING_REQUIRED',
              message: 'a decimal average requires an explicit finite scale and rounding rule',
              hint: `add scale and rounding: 'half-away-from-zero', or request sum and count and divide in the domain`,
            })
          if (
            !Number.isSafeInteger(aggregate.scale) ||
            aggregate.scale < 0 ||
            aggregate.scale > DECIMAL_MAX_CHARS
          )
            throw new KetError({
              code: 'E_DECIMAL_AVG_SCALE',
              message: `decimal average scale must be an integer from 0 to ${DECIMAL_MAX_CHARS}`,
            })
          const column = colSql(aggregate.col)
          let average: string
          if (dialect === 'sqlite') average = `ket_decimal_avg(${column}, ${bind(aggregate.scale)})`
          else {
            // PostgreSQL's numeric AVG divides before ROUND and chooses a finite
            // internal result scale, so high requested scales can no longer
            // recover the discarded digits. Scale the exact SUM first, then use
            // integer quotient/remainder arithmetic for half-away-from-zero.
            const scale = bind(aggregate.scale)
            const factor = `CAST(('1e' || CAST(${scale} AS TEXT)) AS NUMERIC)`
            const sum = `SUM(${column})`
            const count = `COUNT(${column})`
            const shifted = `ABS(${sum}) * ${factor}`
            const rounded = `DIV(${shifted}, ${count}) + CASE WHEN MOD(${shifted}, ${count}) * 2 >= ${count} THEN 1 ELSE 0 END`
            average = `CASE WHEN ${count} = 0 THEN NULL ELSE SIGN(${sum}) * (${rounded}) / ${factor} END`
          }
          return `${average} AS ${q(aggregate.as)}`
        }
        if (isSqliteDecimal(aggregate.col)) {
          const column = colSql(aggregate.col)
          if (aggregate.fn === 'countDistinct')
            return `COUNT(DISTINCT ket_decimal_key(${column})) AS ${q(aggregate.as)}`
          return `ket_decimal_${aggregate.fn}(${column}) AS ${q(aggregate.as)}`
        }
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
        const aliases = new Map(this.aggregates.map((aggregate) => [aggregate.as, aggregate]))
        text += ` ORDER BY ${this.groupOrder
          .map((order) => {
            const aggregate = aliases.get(order.by)
            const by =
              order.by === 'key'
                ? q('__group0')
                : order.by === 'count'
                  ? q('__count')
                  : aggregate
                    ? q(order.by)
                    : null
            if (!by)
              throw new KetError({ code: 'E_GROUP_ORDER', message: `unknown group order "${order.by}"` })
            const decimal =
              (order.by === 'key' && !this.groups[0]!.interval && isSqliteDecimal(this.groups[0]!.col)) ||
              (aggregate !== undefined &&
                aggregate.fn !== 'count' &&
                aggregate.fn !== 'countDistinct' &&
                isSqliteDecimal(aggregate.col))
            if (decimal) return decimalOrderSql(by, order.dir)
            return orderTerm(by, order.dir)
          })
          .join(', ')}`
      }
    } else if (this.order.length)
      text += ` ORDER BY ${this.order
        .map((o) => (isSqliteDecimal(o.col) ? decimalOrder(o.col, o.dir) : orderTerm(colSql(o.col), o.dir)))
        .join(', ')}`
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
export const asc = (col: Col): Order => ({ col: assertCol(col), dir: 'asc' })
export const desc = (col: Col): Order => ({ col: assertCol(col), dir: 'desc' })
