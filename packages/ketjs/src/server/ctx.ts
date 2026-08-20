// Request context. There is no module-scope database client anywhere in Ket: data
// access exists only on a ctx handed to a server function, and that ctx refuses any
// access the function did not declare in `effects`.
//
// This is what makes "the call forgot its context/permission" unrepresentable
// rather than merely discouraged.

import { tableNameFor } from '../data/migrate.ts'
import { table, type Query } from '../data/query.ts'
import { eq, inArray } from '../data/expr.ts'
import { from } from '../data/query.ts'
import { type Changeset, changeset, decimalText } from '../data/changeset.ts'
import { KetError } from '../kernel/errors.ts'
import { createQueue, queueFor, validateJobInput } from './queue.ts'
import type { Adapter, Ctx, Manifest, Row, Scope, WriteRecord } from '../types.ts'

export function createContext(o: {
  adapter: Adapter
  manifest: Manifest
  fnKey: string
  dryRun?: boolean
  actor?: string | null
  scope?: Scope
  kind?: 'function' | 'job'
  queueNotify?: boolean
  writes?: WriteRecord[]
}): Ctx {
  const { adapter, manifest, fnKey } = o
  const scope: Scope = o.scope ?? { company: null, branches: null }
  const dryRun = o.dryRun ?? false
  const operation = o.kind === 'job' ? manifest.jobs[fnKey] : manifest.functions[fnKey]
  if (!operation)
    throw new KetError({
      code: o.kind === 'job' ? 'E_UNKNOWN_JOB' : 'E_UNKNOWN_FUNCTION',
      message: `no ${o.kind === 'job' ? 'background job' : 'server function'} "${fnKey}"`,
    })

  const effects = new Set(operation.effects)
  const writes = o.writes ?? []

  const need = (effect: 'read' | 'write' | 'enqueue', target: string): void => {
    if (effects.has(`${effect}:${target}`)) return
    throw new KetError({
      code: 'E_EFFECT_NOT_DECLARED',
      module: operation.by,
      message: `"${fnKey}" attempted ${effect} on ${target} but declares effects [${[...effects].join(', ') || 'none'}]`,
      hint: `add "${effect}:${target}" to the ${o.kind === 'job' ? 'job' : 'function'}'s effects, or stop performing that operation`,
    })
  }

  // A query is a value, so what it touches is known before it runs. This is the
  // pay-off for not building a string-based query builder: effect enforcement
  // happens on the query itself, not on a guess about the SQL it produced.
  const relationOf = (model: string, name: string) => {
    const rel = manifest.relations[model]?.[name]
    if (!rel) {
      throw new KetError({
        code: 'E_UNKNOWN_RELATION',
        module: operation.by,
        message: `"${model}" has no relation "${name}"`,
        hint: `declared: ${Object.keys(manifest.relations[model] ?? {}).join(', ') || '(none)'}`,
      })
    }
    return rel
  }

  /**
   * What a query touches, checked before it runs — preloads included.
   *
   * The preload check used to live where the children are fetched, which meant it
   * only ran when the parent returned rows. An undeclared preload against an empty
   * table passed silently, so a test suite with empty fixtures would go green and
   * the same code would throw the first time a customer had data. A check that
   * depends on the data is not a check.
   */
  const checkQuery = (q: Query): void => {
    for (const model of q.touches) need(q.effect, model)
    for (const { name } of q.preloads) need('read', relationOf(q.model, name).target)
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
  // Writing somewhere you cannot read back is silent corruption: the row lands,
  // every later query filters it out, and nothing anywhere says why. So the two
  // halves of the scope have to agree before the first query runs.
  if (scope.company && scope.companies && !scope.companies.includes(scope.company)) {
    throw new KetError({
      code: 'E_WRITE_COMPANY_NOT_READABLE',
      module: operation.by,
      message: `the request writes to "${scope.company}" but may only read ${scope.companies.join(', ')}`,
      hint: 'scope.company must be one of scope.companies — otherwise a row is written and then invisible',
    })
  }

  const scopeOf = (model: string) => manifest.models[model]?.scope ?? 'shared'

  // ── decimal columns ────────────────────────────────────────────────────────
  //
  // Both adapters store and return a decimal as a string, which is what keeps it
  // exact across the round trip. Arithmetic still happens on numbers, as it does in
  // Odoo — the conversion is here, in the one place that knows both the model and
  // the row, rather than in the adapter, which sees only untyped columns.
  const decimalsOf = (model: string): string[] =>
    Object.entries(manifest.models[model]?.fields ?? {})
      .filter(([, f]) => f.base === 'decimal')
      .map(([n]) => n)

  const booleansOf = (model: string): string[] =>
    Object.entries(manifest.models[model]?.fields ?? {})
      .filter(([, f]) => f.base === 'bool')
      .map(([n]) => n)

  const jsonOf = (model: string): string[] =>
    Object.entries(manifest.models[model]?.fields ?? {})
      .filter(([, f]) => f.base === 'json')
      .map(([n]) => n)

  const encodeRow = (model: string, row: Row): Row => {
    const cols = decimalsOf(model)
    if (!cols.length) return row
    const out: Row = { ...row }
    // decimalText, not String: a raw db.update never passes through a changeset, so
    // this is the only place that can keep "1e-7" out of a decimal column.
    for (const c of cols) if (out[c] != null) out[c] = decimalText(out[c] as number | string)
    return out
  }

  const decodeRows = (model: string, rows: Row[]): Row[] => {
    const cols = decimalsOf(model)
    const bools = booleansOf(model)
    const json = dialect === 'sqlite' ? jsonOf(model) : []
    for (const row of rows) for (const c of cols) if (row[c] != null) row[c] = Number(row[c])
    for (const row of rows) for (const c of bools) if (row[c] != null) row[c] = Boolean(row[c])
    for (const row of rows)
      for (const c of json) if (typeof row[c] === 'string') row[c] = JSON.parse(row[c] as string)
    return rows
  }

  /**
   * The companies a read may see. Absent means just the one being written to.
   *
   * A request that names none is refused rather than answered, because the failure
   * mode of getting this wrong is silent: a missing filter does not throw, it
   * returns another legal entity's rows.
   */
  const readCompanies = (model: string): string[] => {
    const set = scope.companies ?? (scope.company ? [scope.company] : [])
    if (set.length) return set
    throw new KetError({
      code: 'E_NO_COMPANY_IN_SCOPE',
      module: operation.by,
      message: `"${fnKey}" touches ${model}, which is company-scoped, but the request carries no company`,
      hint: 'resolve a company for the request, or declare crossCompany: true if this really reads across legal entities',
    })
  }

  const requireCompany = (model: string): string => {
    if (scope.company) return scope.company
    const readable = scope.companies ?? []
    throw new KetError({
      code: 'E_NO_COMPANY_IN_SCOPE',
      module: operation.by,
      message: readable.length
        ? `"${fnKey}" writes ${model}, but the request names ${readable.length} readable compan${readable.length > 1 ? 'ies' : 'y'} and none to write to`
        : `"${fnKey}" touches ${model}, which is company-scoped, but the request carries no company`,
      hint: readable.length
        ? `set scope.company to one of: ${readable.join(', ')} — a row belongs to exactly one legal entity`
        : 'resolve a company for the request, or declare crossCompany: true if this really reads across legal entities',
    })
  }

  /** Narrow a query to the companies the caller may read, and to its branches. */
  const scoped = (q: Query): Query => {
    const kind = scopeOf(q.model)
    if (kind === 'shared') return q
    if (operation.crossCompany) return q // declared, and visible in the manifest

    const cs = readCompanies(q.model)
    const col = { model: q.model, name: 'companyId' }
    let out = q.where(cs.length === 1 ? eq(col, cs[0] as string) : inArray(col, cs))
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
          module: operation.by,
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
  const ph = () => {
    n++
    return dialect === 'postgres' ? `$${n}` : '?'
  }
  const fresh = () => {
    n = 0
  }

  /**
   * Fill in what a query asked to preload: one extra query per relation, never one
   * per row. The children go through the same scoped path as anything else, so a
   * relation cannot be a way around the company filter.
   */
  const fillPreloads = async (q: Query, rows: Row[]): Promise<Row[]> => {
    if (!q.preloads.length || !rows.length) return rows

    for (const { name } of q.preloads) {
      const rel = relationOf(q.model, name)

      if (rel.kind === 'belongsTo') {
        const ids = [...new Set(rows.map((r) => r[rel.by]).filter((v) => v != null))]
        if (!ids.length) {
          for (const r of rows) r[name] = null
          continue
        }
        const parents = await db.all(
          from(table(manifest, rel.target)).where(inArray({ model: rel.target, name: 'id' }, ids)),
        )
        const byId = new Map(parents.map((p) => [p.id, p]))
        for (const r of rows) r[name] = byId.get(r[rel.by]) ?? null
      } else {
        const ids = rows.map((r) => r.id).filter((v) => v != null)
        if (!ids.length) {
          for (const r of rows) r[name] = []
          continue
        }
        const children = await db.all(
          from(table(manifest, rel.target)).where(inArray({ model: rel.target, name: rel.by }, ids)),
        )
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
      return fillPreloads(q, decodeRows(q.model, await adapter.all(text, params)))
    },
    async one(q) {
      checkQuery(q)
      const { text, params } = scoped(q).limit(1).toSQL(dialect)
      const rows = await fillPreloads(q, decodeRows(q.model, await adapter.all(text, params)))
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
      // A select passed to del renders as a select and deletes nothing — and the
      // effect check sees 'read', so a function that correctly declared 'write'
      // is refused for an effect it never wanted. website_menu.removeMenuItem was
      // written that way and had therefore never once worked.
      if (q.kind !== 'delete') {
        throw new KetError({
          code: 'E_NOT_A_DELETE',
          module: operation.by,
          message: `"${fnKey}" passed a ${q.kind} query to db.del`,
          hint: 'build it with deleteFrom(table), not from(table)',
        })
      }
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
          module: operation.by,
          message: `${cs.model}: ${cs.errors.map((e) => `${e.field} ${e.message}`).join('; ')}`,
          hint: 'inspect changeset.errors for the structured form',
        })
      }
      if (cs.action === 'insert') return (await db.insert(cs.model, cs.changes)) as { changes: number }
      if (!where)
        throw new KetError({
          code: 'E_UPDATE_NEEDS_WHERE',
          message: `updating ${cs.model} requires a where clause`,
        })
      if (!Object.keys(cs.changes).length) return { changes: 0 }
      return (await db.update(cs.model, where, cs.changes)) as { changes: number }
    },
    async select(model, where = {}) {
      need('read', model)
      const t = adapter.quoteIdent(tableNameFor(model))
      const open = scopeOf(model) === 'shared' || operation.crossCompany
      const keys = Object.keys(where)
      fresh()
      const conds = keys.map((k) => `${adapter.quoteIdent(k)} = ${ph()}`)
      const params: unknown[] = keys.map((k) => where[k])
      if (!open) {
        // A set, not a value: this is the one place the convenience path has to
        // part company with a plain `column = ?` map.
        const cs = readCompanies(model)
        conds.push(`${adapter.quoteIdent('companyId')} IN (${cs.map(() => ph()).join(', ')})`)
        params.push(...cs)
      }
      const sql = `SELECT * FROM ${t}` + (conds.length ? ` WHERE ${conds.join(' AND ')}` : '')
      return decodeRows(model, await adapter.all(sql, params))
    },
    async insert(model, row) {
      need('write', model)
      const known = Object.keys(manifest.models[model]?.fields ?? {})
      const unknown = Object.keys(row).filter((k) => !known.includes(k))
      if (unknown.length) {
        throw new KetError({
          code: 'E_UNKNOWN_FIELD',
          message: `${model} has no field(s): ${unknown.join(', ')}`,
          hint: `fields: ${known.join(', ')}`,
        })
      }
      const stamped = encodeRow(model, stamp(model, row))
      writes.push({ op: 'insert', model, row: stamped })
      if (dryRun) return { dryRun: true }
      const ks = Object.keys(stamped)
      fresh()
      const sql = `INSERT INTO ${adapter.quoteIdent(tableNameFor(model))} (${ks.map((k) => adapter.quoteIdent(k)).join(', ')}) VALUES (${ks.map(() => ph()).join(', ')})`
      return adapter.run(
        sql,
        ks.map((k) => stamped[k]),
      )
    },
    async insertIfAbsent(model, row) {
      need('write', model)
      const known = Object.keys(manifest.models[model]?.fields ?? {})
      const unknown = Object.keys(row).filter((k) => !known.includes(k))
      if (unknown.length) {
        throw new KetError({
          code: 'E_UNKNOWN_FIELD',
          message: `${model} has no field(s): ${unknown.join(', ')}`,
          hint: `fields: ${known.join(', ')}`,
        })
      }
      const stamped = encodeRow(model, stamp(model, row))
      writes.push({ op: 'insert', model, row: stamped })
      if (dryRun) return { dryRun: true }
      const ks = Object.keys(stamped)
      fresh()
      const sql = `INSERT INTO ${adapter.quoteIdent(tableNameFor(model))} (${ks.map((k) => adapter.quoteIdent(k)).join(', ')}) VALUES (${ks.map(() => ph()).join(', ')}) ON CONFLICT DO NOTHING`
      const result = await adapter.run(
        sql,
        ks.map((k) => stamped[k]),
      )
      return { changes: result.changes, inserted: result.changes === 1 }
    },
    async update(model, where, patch) {
      need('write', model)
      writes.push({ op: 'update', model, where, patch })
      if (dryRun) return { dryRun: true }
      const where3 = encodeRow(
        model,
        scopeOf(model) === 'shared' || operation.crossCompany
          ? where
          : { ...where, companyId: requireCompany(model) },
      )
      const patch2 = encodeRow(model, patch)
      const pk = Object.keys(patch2),
        wk = Object.keys(where3)
      fresh()
      const sets = pk.map((k) => `${adapter.quoteIdent(k)} = ${ph()}`).join(', ')
      const conds = wk.map((k) => `${adapter.quoteIdent(k)} = ${ph()}`).join(' AND ')
      const sql =
        `UPDATE ${adapter.quoteIdent(tableNameFor(model))} SET ${sets}` + (wk.length ? ` WHERE ${conds}` : '')
      return adapter.run(sql, [...pk.map((k) => patch2[k]), ...wk.map((k) => where3[k])])
    },
    async compareAndSet(model, where, expected, patch) {
      const result = await db.update(model, { ...expected, ...where }, patch)
      if ('dryRun' in result) return result
      return { changes: result.changes, matched: result.changes === 1 }
    },
  }

  const ctx: Ctx = {
    fnKey,
    manifest,
    scope,
    actor: o.actor ?? null,
    dryRun,
    db,
    writes,
    effects: [...effects],
    jobs: {
      async enqueue(name, args, options) {
        const meta = manifest.jobs[name]
        if (!meta) throw new KetError({ code: 'E_UNKNOWN_JOB', message: `no background job "${name}"` })
        need('enqueue', name)
        if (manifest.disabledModules?.includes(meta.by)) {
          throw new KetError({
            code: 'E_APP_NOT_INSTALLED',
            module: meta.by,
            message: `job "${name}" belongs to a module that is not installed`,
          })
        }
        validateJobInput(name, manifest, args)
        const queue =
          o.queueNotify === undefined
            ? await queueFor(adapter)
            : await createQueue(adapter, { notify: o.queueNotify })
        return queue.enqueue(name, args, {
          ...options,
          queue: meta.queue,
          maxAttempts: meta.maxAttempts,
          actor: o.actor ?? null,
          scope,
        })
      },
    },
    // A transaction hands the body a ctx bound to the transaction's connection —
    // the same reason tx() takes a scoped adapter rather than assuming the pool
    // will hand back the session that issued BEGIN.
    tx: async <T>(body: (inner: Ctx) => Promise<T>): Promise<T> => {
      const transactionWrites: WriteRecord[] = []
      const value = await adapter.tx((txAdapter) =>
        body(createContext({ ...o, adapter: txAdapter, writes: transactionWrites })),
      )
      writes.push(...transactionWrites)
      return value
    },
    table: (model: string) => table(manifest, model),
    change: (model: string, params: Row, base: Row | null = null): Changeset =>
      changeset(manifest, model, params, base),
  }
  return ctx
}
