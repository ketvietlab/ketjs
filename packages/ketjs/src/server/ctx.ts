// Request context. There is no module-scope database client anywhere in Ket: data
// access exists only on a ctx handed to a server function, and that ctx refuses any
// access the function did not declare in `effects`.
//
// This is what makes "the call forgot its context/permission" unrepresentable
// rather than merely discouraged.

import { tableNameFor } from '../data/migrate.ts'
import { table, type Query } from '../data/query.ts'
import { eq, inArray, makeCol } from '../data/expr.ts'
import { from } from '../data/query.ts'
import {
  canonicalDecimal,
  type Changeset,
  changeset,
  DECIMAL_MAX_CHARS,
  parseDecimal,
} from '../data/changeset.ts'
import { KetError } from '../kernel/errors.ts'
import { createLogger } from './log/logger.ts'
import type { Logger } from './log/logger.ts'
import { nullLog } from './log/types.ts'
import { createQueue, queueFor, validateJobInput } from './queue.ts'
import type { Adapter, Ctx, Manifest, Row, Scope, WriteRecord } from '../types.ts'

/** What a sensitive value is replaced by everywhere a write record travels. */
export const SENSITIVE_MASK = '[sensitive]'

export function createContext(o: {
  adapter: Adapter
  manifest: Manifest
  fnKey: string
  dryRun?: boolean
  actor?: string | null
  correlationId?: string | null
  scope?: Scope
  kind?: 'function' | 'job'
  queueNotify?: boolean
  writes?: WriteRecord[]
  /**
   * Where this call's operational log goes. Absent discards: a ctx built outside a
   * booted runtime — a migration, a script — has no deployment to attribute records
   * to, and inventing one would be worse than dropping them.
   */
  log?: Logger
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

  /**
   * A write record is observational, and it travels: it is returned to the caller,
   * shown by a dry-run, and stored verbatim in the durable idempotency row that
   * answers a retry. A field declared `sensitive` must not make that trip, so its
   * value is replaced before the record is kept rather than after.
   */
  const record = (write: WriteRecord): void => {
    const model = manifest.models[write.model]
    const mask = (row: Row | undefined): Row | undefined => {
      if (!row || !model) return row
      let masked: Row | undefined
      for (const key of Object.keys(row)) {
        if (!model.fields[key]?.sensitive) continue
        masked ??= { ...row }
        masked[key] = SENSITIVE_MASK
      }
      return masked ?? row
    }
    writes.push({
      ...write,
      ...(write.row === undefined ? {} : { row: mask(write.row) }),
      ...(write.where === undefined ? {} : { where: mask(write.where) }),
      ...(write.patch === undefined ? {} : { patch: mask(write.patch) }),
    })
  }

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
  // ordinary, so null means unrestricted. An explicit empty set still means
  // "none": treating it like null would turn a caller with no readable branches
  // into one that can read every branch.
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

  const validateFields = (model: string, row: Row, operationName: 'filter' | 'update'): void => {
    const def = manifest.models[model]
    if (!def) {
      throw new KetError({
        code: 'E_UNKNOWN_MODEL',
        module: operation.by,
        message: `no model "${model}"`,
      })
    }
    const unknown = Object.keys(row).filter((key) => !def.fields[key])
    if (unknown.length) {
      throw new KetError({
        code: 'E_UNKNOWN_FIELD',
        module: operation.by,
        message: `${model} has no field(s): ${unknown.join(', ')}`,
        hint: `fields: ${Object.keys(def.fields).join(', ')}`,
      })
    }
    if (operationName !== 'update') return
    const protectedFields = def.scope === 'company+branch' ? ['companyId', 'branchId'] : ['companyId']
    const attempted = protectedFields.filter((key) => key in row)
    if (def.scope !== 'shared' && attempted.length) {
      throw new KetError({
        code: 'E_SCOPE_FIELD_WRITTEN',
        module: operation.by,
        message: `"${fnKey}" attempted to update ${model}.${attempted.join(', ')}`,
        hint: 'scope columns are immutable after insert — move data with an explicitly cross-company administrative workflow',
      })
    }
  }

  // ── decimal columns ────────────────────────────────────────────────────────
  //
  // Both adapters store and return a decimal as a string, and it stays one all the
  // way out. A write may hand in a number — arithmetic happens on numbers — and
  // encodeRow renders it; a read never converts.
  //
  // It used to convert, and that quietly rewrote stored data. `{ ...row, note }`
  // is how everyone edits one field, and it carries every other column along with
  // it. With the decimal decoded to a number, an edit that never mentioned the
  // amount wrote it back rounded: 12.50 became 12.5, and 1234567890123456.78
  // became …6.8. Nothing failed. The column simply held a different number
  // afterwards, which is the worst way for a ledger to be wrong.
  const decimalsOf = (model: string): string[] =>
    Object.entries(manifest.models[model]?.fields ?? {})
      .filter(([, f]) => f.base === 'decimal')
      .map(([n]) => n)

  const normalizeDecimal = (model: string, field: string, value: unknown): string => {
    const parsed = parseDecimal(value)
    if (parsed.ok) return parsed.value
    throw new KetError({
      code: parsed.reason === 'size' ? 'E_DECIMAL_TOO_LONG' : 'E_INVALID_DECIMAL',
      module: operation.by,
      message:
        parsed.reason === 'size'
          ? `${model}.${field} exceeds the ${DECIMAL_MAX_CHARS}-character decimal limit`
          : `${model}.${field} requires a finite number or plain decimal string`,
    })
  }

  const booleansOf = (model: string): string[] =>
    Object.entries(manifest.models[model]?.fields ?? {})
      .filter(([, f]) => f.base === 'bool')
      .map(([n]) => n)

  const datetimesOf = (model: string): string[] =>
    Object.entries(manifest.models[model]?.fields ?? {})
      .filter(([, f]) => f.base === 'datetime')
      .map(([n]) => n)

  const jsonOf = (model: string): string[] =>
    Object.entries(manifest.models[model]?.fields ?? {})
      .filter(([, f]) => f.base === 'json')
      .map(([n]) => n)

  const encodeRow = (model: string, row: Row): Row => {
    const cols = decimalsOf(model)
    const stamps = datetimesOf(model)
    if (!cols.length && !stamps.length) return row
    const out: Row = { ...row }
    // A raw db.insert/update never passes through a changeset. Validate as well as
    // render here so it cannot store exponent syntax or bypass the public budget.
    for (const c of cols) if (out[c] != null) out[c] = normalizeDecimal(model, c, out[c])
    /**
     * One instant, one spelling.
     *
     * Postgres normalises a TIMESTAMPTZ to UTC whether or not it is asked, so a
     * caller passing "+07:00" would leave a different string in SQLite than in
     * Postgres for the same moment. Normalising here — the one place every write
     * passes through — keeps the two datastores byte-identical, and makes the
     * stored text sort chronologically, which is what a range query compares.
     */
    for (const c of stamps) {
      const held = out[c]
      if (held == null) continue
      const at = held instanceof Date ? held : new Date(String(held))
      if (!Number.isNaN(at.getTime())) out[c] = at.toISOString()
    }
    return out
  }

  const validateDecimalRow = (model: string, row: Row): void => {
    for (const field of decimalsOf(model)) if (row[field] != null) normalizeDecimal(model, field, row[field])
  }

  const decodeRows = (model: string, rows: Row[]): Row[] => {
    const bools = booleansOf(model)
    const json = dialect === 'sqlite' ? jsonOf(model) : []
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
    const col = makeCol(q.model, 'companyId', 'text')
    let out = q.where(cs.length === 1 ? eq(col, cs[0] as string) : inArray(col, cs))
    if (kind === 'company+branch' && scope.branches != null) {
      out = out.where(inArray(makeCol(q.model, 'branchId', 'text'), scope.branches))
    }
    return out
  }

  /** Stamp a row on the way in, and refuse an attempt to write another company's. */
  const stamp = (model: string, row: Row): Row => {
    const kind = scopeOf(model)
    if (kind === 'shared') return row
    const protectedScopeFields = kind === 'company+branch' ? ['companyId', 'branchId'] : ['companyId']
    for (const key of protectedScopeFields) {
      if (key in row) {
        throw new KetError({
          code: 'E_SCOPE_FIELD_WRITTEN',
          module: operation.by,
          message: `"${fnKey}" set ${model}.${key} itself`,
          hint: 'the scope columns come from the request, not from the caller — otherwise a write could be aimed at another company',
        })
      }
    }
    const company = requireCompany(model)
    const out: Row = { ...row, companyId: company }
    if (kind === 'company+branch') {
      const branch = scope.branch ?? null
      if (!branch) {
        throw new KetError({
          code: 'E_NO_BRANCH_IN_SCOPE',
          module: operation.by,
          message: `"${fnKey}" writes ${model}, but the request names no branch to write to`,
          hint: 'set scope.branch to one readable branch; scope.branches is only the read set',
        })
      }
      if (scope.branches && !scope.branches.includes(branch)) {
        throw new KetError({
          code: 'E_WRITE_BRANCH_NOT_READABLE',
          module: operation.by,
          message: `"${fnKey}" would write to branch "${branch}", which is not in its readable branch set`,
          hint: 'the write branch must be one of scope.branches',
        })
      }
      out.branchId = branch
    }
    return out
  }

  const timestamped = (model: string, row: Row, action: 'insert' | 'update'): Row => {
    if (!manifest.models[model]?.timestamps) return row
    const now = new Date().toISOString()
    const clean = { ...row }
    delete clean.createdAt
    delete clean.updatedAt
    return action === 'insert' ? { ...clean, createdAt: now, updatedAt: now } : { ...clean, updatedAt: now }
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
  const equalPredicate = (model: string, field: string, value: unknown): string => {
    const column = adapter.quoteIdent(field)
    if (value === null) return `${column} IS NULL`
    const placeholder = ph()
    return dialect === 'sqlite' && manifest.models[model]?.fields[field]?.base === 'decimal'
      ? `ket_decimal_cmp(${column}, ${placeholder}) = 0`
      : `${column} = ${placeholder}`
  }

  /**
   * Fill in what a query asked to preload: one extra query per relation, never one
   * per row. The children go through the same scoped path as anything else, so a
   * relation cannot be a way around the company filter.
   */
  const fillPreloads = async (q: Query, rows: Row[]): Promise<Row[]> => {
    if (!q.preloads.length || !rows.length) return rows
    const chunks = <T>(values: T[], size = 500): T[][] => {
      const out: T[][] = []
      for (let index = 0; index < values.length; index += size) out.push(values.slice(index, index + size))
      return out
    }
    const loadChunks = async (model: string, field: string, values: unknown[]): Promise<Row[]> => {
      const loaded: Row[] = []
      const base = manifest.models[model]?.fields[field]?.base
      if (!base)
        throw new KetError({
          code: 'E_UNKNOWN_FIELD',
          module: operation.by,
          message: `${model} has no field "${field}"`,
        })
      for (const batch of chunks(values)) {
        loaded.push(
          ...(await db.all(from(table(manifest, model)).where(inArray(makeCol(model, field, base), batch)))),
        )
      }
      return loaded
    }

    for (const { name } of q.preloads) {
      const rel = relationOf(q.model, name)

      if (rel.kind === 'belongsTo') {
        const ids = [...new Set(rows.map((r) => r[rel.by]).filter((v) => v != null))]
        if (!ids.length) {
          for (const r of rows) r[name] = null
          continue
        }
        const parents = await loadChunks(rel.target, 'id', ids)
        const byId = new Map(parents.map((p) => [p.id, p]))
        for (const r of rows) r[name] = byId.get(r[rel.by]) ?? null
      } else {
        const ids = rows.map((r) => r.id).filter((v) => v != null)
        if (!ids.length) {
          for (const r of rows) r[name] = []
          continue
        }
        const children = await loadChunks(rel.target, rel.by, ids)
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
    async group(q) {
      if (q.kind !== 'group')
        throw new KetError({ code: 'E_NOT_A_GROUP', message: 'db.group requires query.groupBy(...)' })
      checkQuery(q)
      const grouped = scoped(q)
      const { text, params } = grouped.toSQL(dialect)
      const rows = await adapter.all(text, params)
      return rows.map((row) => {
        const aggregates: Record<string, unknown> = {}
        for (const aggregate of grouped.aggregates) {
          const value = row[aggregate.as]
          const computedDecimal =
            aggregate.col?.base === 'decimal' && aggregate.fn !== 'count' && aggregate.fn !== 'countDistinct'
          aggregates[aggregate.as] =
            value == null || !computedDecimal
              ? value
              : (canonicalDecimal(value) ?? normalizeDecimal(grouped.model, aggregate.col!.name, value))
        }
        return {
          key: grouped.groups.map((group, index) => {
            const value = row[`__group${index}`]
            return value == null || group.interval || group.col.base !== 'decimal'
              ? value
              : (canonicalDecimal(value) ?? normalizeDecimal(grouped.model, group.col.name, value))
          }),
          count: Number(row.__count),
          aggregates,
        }
      })
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
      record({ op: 'update', model: q.model, where: {} })
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
      const kind = scopeOf(model)
      const open = kind === 'shared' || operation.crossCompany
      const keys = Object.keys(where)
      fresh()
      const conds = keys.map((k) => equalPredicate(model, k, where[k]))
      const params: unknown[] = keys
        .filter((k) => where[k] !== null)
        .map((k) =>
          manifest.models[model]?.fields[k]?.base === 'decimal'
            ? normalizeDecimal(model, k, where[k])
            : where[k],
        )
      if (!open) {
        // A set, not a value: this is the one place the convenience path has to
        // part company with a plain `column = ?` map.
        const cs = readCompanies(model)
        conds.push(`${adapter.quoteIdent('companyId')} IN (${cs.map(() => ph()).join(', ')})`)
        params.push(...cs)
        if (kind === 'company+branch' && scope.branches != null) {
          if (scope.branches.length) {
            conds.push(`${adapter.quoteIdent('branchId')} IN (${scope.branches.map(() => ph()).join(', ')})`)
            params.push(...scope.branches)
          } else {
            conds.push('1 = 0')
          }
        }
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
      const stamped = encodeRow(model, stamp(model, timestamped(model, row, 'insert')))
      record({ op: 'insert', model, row: stamped })
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
      const stamped = encodeRow(model, stamp(model, timestamped(model, row, 'insert')))
      record({ op: 'insert', model, row: stamped })
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
      validateFields(model, where, 'filter')
      validateFields(model, patch, 'update')
      if (!Object.keys(where).length) {
        throw new KetError({
          code: 'E_UPDATE_NEEDS_WHERE',
          module: operation.by,
          message: `updating ${model} requires a non-empty where clause`,
        })
      }
      if (!Object.keys(patch).length) return { changes: 0 }
      // Dry-run returns before SQL encoding, but it is still a public write path and
      // must reject values a real call could not store.
      validateDecimalRow(model, where)
      validateDecimalRow(model, patch)
      record({ op: 'update', model, where, patch })
      if (dryRun) return { dryRun: true }
      const kind = scopeOf(model)
      const open = kind === 'shared' || operation.crossCompany
      const where3 = encodeRow(model, open ? where : { ...where, companyId: requireCompany(model) })
      const patch2 = encodeRow(model, timestamped(model, patch, 'update'))
      const pk = Object.keys(patch2),
        wk = Object.keys(where3)
      fresh()
      const sets = pk.map((k) => `${adapter.quoteIdent(k)} = ${ph()}`).join(', ')
      const boundWhere = wk.filter((k) => where3[k] !== null)
      const conds = wk.map((k) => equalPredicate(model, k, where3[k]))
      const branchParams = !open && kind === 'company+branch' ? scope.branches : null
      if (branchParams != null) {
        if (branchParams.length) {
          conds.push(`${adapter.quoteIdent('branchId')} IN (${branchParams.map(() => ph()).join(', ')})`)
        } else {
          conds.push('1 = 0')
        }
      }
      const sql =
        `UPDATE ${adapter.quoteIdent(tableNameFor(model))} SET ${sets}` +
        (conds.length ? ` WHERE ${conds.join(' AND ')}` : '')
      return adapter.run(sql, [
        ...pk.map((k) => patch2[k]),
        ...boundWhere.map((k) => where3[k]),
        ...(branchParams ?? []),
      ])
    },
    async compareAndSet(model, where, expected, patch) {
      const result = await db.update(model, { ...expected, ...where }, patch)
      if ('dryRun' in result) return result
      return { changes: result.changes, matched: result.changes === 1 }
    },
  }

  const log = o.log ?? createLogger(nullLog(), { deployment: 'ketjs', process: 'cli', fn: fnKey, dryRun })

  const ctx: Ctx = {
    fnKey,
    correlationId: o.correlationId ?? null,
    log,
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
        validateJobInput(name, manifest, args)
        const queue =
          o.queueNotify === undefined
            ? await queueFor(adapter)
            : await createQueue(adapter, { notify: o.queueNotify })
        // Enqueueing into another company is the fan-out a scheduled job has to
        // perform: the schedule runs once per tenant with no company, and the work
        // belongs to legal entities. It is gated on the same declaration that let
        // this operation see more than one company in the first place, so the
        // capability is in the manifest rather than in this call.
        const { company: target, ...rest } = options ?? {}
        const named = target?.trim()
        if (named && !operation.crossCompany) {
          throw new KetError({
            code: 'E_ENQUEUE_COMPANY_NOT_ALLOWED',
            module: operation.by,
            message: `"${fnKey}" enqueued "${name}" into company "${named}" without declaring crossCompany`,
            hint: 'declare crossCompany: true if this really acts across legal entities, or drop the company',
          })
        }
        return queue.enqueue(name, args, {
          ...rest,
          queue: meta.queue,
          maxAttempts: meta.maxAttempts,
          actor: o.actor ?? null,
          scope: named ? { company: named, companies: [named], branch: null, branches: null } : scope,
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
