// Request context. There is no module-scope database client anywhere in Ket: data
// access exists only on a ctx handed to a server function, and that ctx refuses any
// access the function did not declare in `effects`.
//
// This is what makes "the call forgot its context/permission" unrepresentable
// rather than merely discouraged.

import { tableNameFor } from '../data/migrate.ts'
import { table, Query } from '../data/query.ts'
import { eq, inArray } from '../data/expr.ts'
import { from } from '../data/query.ts'
import { Changeset, changeset } from '../data/changeset.ts'
import { KetError } from '../kernel/errors.ts'
import type { Adapter, Ctx, Manifest, Row, Scope, WriteRecord } from '../types.ts'

export function createContext(o: { adapter: Adapter; manifest: Manifest; fnKey: string; dryRun?: boolean; actor?: string | null; scope?: Scope }): Ctx {
  const { adapter, manifest, fnKey } = o
  const scope: Scope = o.scope ?? { company: null, branches: null }
  const dryRun = o.dryRun ?? false
  const fn = manifest.functions[fnKey]
  if (!fn) throw new KetError({ code: 'E_UNKNOWN_FUNCTION', message: `no server function "${fnKey}"` })

  const effects = new Set(fn.effects)
  const writes: WriteRecord[] = []

  const need = (effect: 'read' | 'write', model: string): void => {
    if (effects.has(`${effect}:${model}`)) return
    throw new KetError({
      code: 'E_EFFECT_NOT_DECLARED',
      module: fn.by,
      message: `"${fnKey}" attempted ${effect} on ${model} but declares effects [${[...effects].join(', ') || 'none'}]`,
      hint: `add "${effect}:${model}" to the function's effects, or stop touching that model`,
    })
  }

  // A query is a value, so what it touches is known before it runs. This is the
  // pay-off for not building a string-based query builder: effect enforcement
  // happens on the query itself, not on a guess about the SQL it produced.
  const checkQuery = (q: Query): void => {
    for (const model of q.touches) need(q.effect, model)
  }
  const dialect = adapter.name === 'postgres' ? 'postgres' : 'sqlite'

  // ── row-level scope ────────────────────────────────────────────────────────
  //
  // Company isolation used to be a database boundary; here it is a WHERE clause,
  // so a miss does not fail loudly — it quietly returns another legal entity's
  // rows. That is why the filter is applied here, on the query value, rather than
  // left to each module to remember: the one place data passes through is the one
  // place that can guarantee it.
  //
  // Branch is not a security boundary. Reading every branch of one company is
  // ordinary, so an empty branch list means "all of them" rather than "none".
  const scopeOf = (model: string) => manifest.models[model]?.scope ?? 'shared'

  const requireCompany = (model: string): string => {
    if (scope.company) return scope.company
    throw new KetError({
      code: 'E_NO_COMPANY_IN_SCOPE',
      module: fn.by,
      message: `"${fnKey}" touches ${model}, which is company-scoped, but the request carries no company`,
      hint: 'resolve a company for the request, or declare crossCompany: true if this really reads across legal entities',
    })
  }

  /** Narrow a query to the caller's company and branches. */
  const scoped = (q: Query): Query => {
    const kind = scopeOf(q.model)
    if (kind === 'shared') return q
    if (fn.crossCompany) return q       // declared, and visible in the manifest

    let out = q.where(eq({ model: q.model, name: 'companyId' }, requireCompany(q.model)))
    if (kind === 'company+branch' && scope.branches && scope.branches.length > 0) {
      out = out.where(inArray({ model: q.model, name: 'branchId' }, scope.branches))
    }
    return out
  }

  /** Stamp a row on the way in, and refuse an attempt to write another company's. */
  const stamp = (model: string, row: Row): Row => {
    const kind = scopeOf(model)
    if (kind === 'shared') return row
    for (const key of ['companyId', 'branchId']) {
      if (key in row) {
        throw new KetError({
          code: 'E_SCOPE_FIELD_WRITTEN',
          module: fn.by,
          message: `"${fnKey}" set ${model}.${key} itself`,
          hint: 'the scope columns come from the request, not from the caller — otherwise a write could be aimed at another company',
        })
      }
    }
    const out: Row = { ...row, companyId: requireCompany(model) }
    if (kind === 'company+branch' && scope.branches?.length === 1) out.branchId = scope.branches[0]
    return out
  }
  // Placeholders are dialect-specific. The query builder already knew this; these
  // direct helpers did not, which is a bug only a second dialect could reveal.
  let n = 0
  const ph = () => (dialect === 'postgres' ? `$${++n}` : (n++, '?'))
  const fresh = () => { n = 0 }

  /**
   * Fill in what a query asked to preload: one extra query per relation, never one
   * per row. The children go through the same scoped path as anything else, so a
   * relation cannot be a way around the company filter.
   */
  const fillPreloads = async (q: Query, rows: Row[]): Promise<Row[]> => {
    if (!q.preloads.length || !rows.length) return rows

    for (const { name } of q.preloads) {
      const rel = manifest.relations[q.model]?.[name]
      if (!rel) {
        throw new KetError({
          code: 'E_UNKNOWN_RELATION',
          module: fn.by,
          message: `"${q.model}" has no relation "${name}"`,
          hint: `declared: ${Object.keys(manifest.relations[q.model] ?? {}).join(', ') || '(none)'}`,
        })
      }
      need('read', rel.target)

      if (rel.kind === 'belongsTo') {
        const ids = [...new Set(rows.map(r => r[rel.by]).filter(v => v != null))]
        if (!ids.length) { for (const r of rows) r[name] = null; continue }
        const parents = await db.all(from(table(manifest, rel.target)).where(inArray({ model: rel.target, name: 'id' }, ids)))
        const byId = new Map(parents.map(p => [p.id, p]))
        for (const r of rows) r[name] = byId.get(r[rel.by]) ?? null
      } else {
        const ids = rows.map(r => r.id).filter(v => v != null)
        if (!ids.length) { for (const r of rows) r[name] = []; continue }
        const children = await db.all(from(table(manifest, rel.target)).where(inArray({ model: rel.target, name: rel.by }, ids)))
        const grouped = new Map<unknown, Row[]>()
        for (const child of children) {
          const key = child[rel.by]
          const list = grouped.get(key)
          if (list) list.push(child)
          else grouped.set(key, [child])
        }
        for (const r of rows) r[name] = grouped.get(r.id) ?? []
      }
    }
    return rows
  }

  const db: Ctx['db'] = {
    async all(q) {
      checkQuery(q)
      const { text, params } = scoped(q).toSQL(dialect)
      return fillPreloads(q, await adapter.all(text, params))
    },
    async one(q) {
      checkQuery(q)
      const { text, params } = scoped(q).limit(1).toSQL(dialect)
      const rows = await fillPreloads(q, await adapter.all(text, params))
      return rows[0] ?? null
    },
    async count(q) {
      const c = scoped(q).count()
      checkQuery(c)
      const { text, params } = c.toSQL(dialect)
      const rows = await adapter.all(text, params)
      return Number((rows[0] as { count: number }).count)
    },
    async del(q) {
      checkQuery(q)
      writes.push({ op: 'update', model: q.model, where: {} })
      if (dryRun) return { changes: 0 }
      const { text, params } = scoped(q).toSQL(dialect)
      return adapter.run(text, params)
    },
    async commit(cs, where) {
      if (!cs.valid) {
        throw new KetError({
          code: 'E_INVALID_CHANGESET',
          module: fn.by,
          message: `${cs.model}: ${cs.errors.map(e => `${e.field} ${e.message}`).join('; ')}`,
          hint: 'inspect changeset.errors for the structured form',
        })
      }
      if (cs.action === 'insert') return await db.insert(cs.model, cs.changes) as { changes: number }
      if (!where) throw new KetError({ code: 'E_UPDATE_NEEDS_WHERE', message: `updating ${cs.model} requires a where clause` })
      if (!Object.keys(cs.changes).length) return { changes: 0 }
      return await db.update(cs.model, where, cs.changes) as { changes: number }
    },
    async select(model, where = {}) {
      need('read', model)
      const t = adapter.quoteIdent(tableNameFor(model))
      const where2 = scopeOf(model) === 'shared' || fn.crossCompany ? where : { ...where, companyId: requireCompany(model) }
      const keys = Object.keys(where2)
      fresh()
      const sql = `SELECT * FROM ${t}` + (keys.length ? ` WHERE ${keys.map(k => `${adapter.quoteIdent(k)} = ${ph()}`).join(' AND ')}` : '')
      return adapter.all(sql, keys.map(k => where2[k]))
    },
    async insert(model, row) {
      need('write', model)
      const known = Object.keys(manifest.models[model]?.fields ?? {})
      const unknown = Object.keys(row).filter(k => !known.includes(k))
      if (unknown.length) {
        throw new KetError({ code: 'E_UNKNOWN_FIELD', message: `${model} has no field(s): ${unknown.join(', ')}`, hint: `fields: ${known.join(', ')}` })
      }
      const stamped = stamp(model, row)
      writes.push({ op: 'insert', model, row: stamped })
      if (dryRun) return { dryRun: true }
      const ks = Object.keys(stamped)
      fresh()
      const sql = `INSERT INTO ${adapter.quoteIdent(tableNameFor(model))} (${ks.map(k => adapter.quoteIdent(k)).join(', ')}) VALUES (${ks.map(() => ph()).join(', ')})`
      return adapter.run(sql, ks.map(k => stamped[k]))
    },
    async update(model, where, patch) {
      need('write', model)
      writes.push({ op: 'update', model, where, patch })
      if (dryRun) return { dryRun: true }
      const where3 = scopeOf(model) === 'shared' || fn.crossCompany ? where : { ...where, companyId: requireCompany(model) }
      const pk = Object.keys(patch), wk = Object.keys(where3)
      fresh()
      const sets = pk.map(k => `${adapter.quoteIdent(k)} = ${ph()}`).join(', ')
      const conds = wk.map(k => `${adapter.quoteIdent(k)} = ${ph()}`).join(' AND ')
      const sql = `UPDATE ${adapter.quoteIdent(tableNameFor(model))} SET ${sets}` + (wk.length ? ` WHERE ${conds}` : '')
      return adapter.run(sql, [...pk.map(k => patch[k]), ...wk.map(k => where3[k])])
    },
  }

  const ctx: Ctx = {
    fnKey, manifest, scope, actor: o.actor ?? null, dryRun, db, writes, effects: [...effects],
    // A transaction hands the body a ctx bound to the transaction's connection —
    // the same reason tx() takes a scoped adapter rather than assuming the pool
    // will hand back the session that issued BEGIN.
    tx: <T,>(body: (inner: Ctx) => Promise<T>): Promise<T> =>
      adapter.tx(txAdapter => body(createContext({ ...o, adapter: txAdapter }))),
    table: (model: string) => table(manifest, model),
    change: (model: string, params: Row, base: Row | null = null): Changeset => changeset(manifest, model, params, base),
  }
  return ctx
}
