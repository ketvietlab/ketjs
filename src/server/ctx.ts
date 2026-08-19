// Request context. There is no module-scope database client anywhere in Ket: data
// access exists only on a ctx handed to a server function, and that ctx refuses any
// access the function did not declare in `effects`.
//
// This is what makes "the call forgot its context/permission" unrepresentable
// rather than merely discouraged.

import { tableNameFor } from '../data/migrate.ts'
import { table, Query } from '../data/query.ts'
import { Changeset, changeset } from '../data/changeset.ts'
import { KetError } from '../kernel/errors.ts'
import type { Adapter, Ctx, Manifest, Row, WriteRecord } from '../types.ts'

export function createContext(o: { adapter: Adapter; manifest: Manifest; fnKey: string; dryRun?: boolean; actor?: string | null }): Ctx {
  const { adapter, manifest, fnKey } = o
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
  // Placeholders are dialect-specific. The query builder already knew this; these
  // direct helpers did not, which is a bug only a second dialect could reveal.
  let n = 0
  const ph = () => (dialect === 'postgres' ? `$${++n}` : (n++, '?'))
  const fresh = () => { n = 0 }

  const db: Ctx['db'] = {
    async all(q) {
      checkQuery(q)
      const { text, params } = q.toSQL(dialect)
      return adapter.all(text, params)
    },
    async one(q) {
      checkQuery(q)
      const { text, params } = q.limit(1).toSQL(dialect)
      return (await adapter.all(text, params))[0] ?? null
    },
    async count(q) {
      const c = q.count()
      checkQuery(c)
      const { text, params } = c.toSQL(dialect)
      const rows = await adapter.all(text, params)
      return Number((rows[0] as { count: number }).count)
    },
    async del(q) {
      checkQuery(q)
      writes.push({ op: 'update', model: q.model, where: {} })
      if (dryRun) return { changes: 0 }
      const { text, params } = q.toSQL(dialect)
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
      const keys = Object.keys(where)
      fresh()
      const sql = `SELECT * FROM ${t}` + (keys.length ? ` WHERE ${keys.map(k => `${adapter.quoteIdent(k)} = ${ph()}`).join(' AND ')}` : '')
      return adapter.all(sql, keys.map(k => where[k]))
    },
    async insert(model, row) {
      need('write', model)
      const known = Object.keys(manifest.models[model]?.fields ?? {})
      const unknown = Object.keys(row).filter(k => !known.includes(k))
      if (unknown.length) {
        throw new KetError({ code: 'E_UNKNOWN_FIELD', message: `${model} has no field(s): ${unknown.join(', ')}`, hint: `fields: ${known.join(', ')}` })
      }
      writes.push({ op: 'insert', model, row })
      if (dryRun) return { dryRun: true }
      const ks = Object.keys(row)
      fresh()
      const sql = `INSERT INTO ${adapter.quoteIdent(tableNameFor(model))} (${ks.map(k => adapter.quoteIdent(k)).join(', ')}) VALUES (${ks.map(() => ph()).join(', ')})`
      return adapter.run(sql, ks.map(k => row[k]))
    },
    async update(model, where, patch) {
      need('write', model)
      writes.push({ op: 'update', model, where, patch })
      if (dryRun) return { dryRun: true }
      const pk = Object.keys(patch), wk = Object.keys(where)
      fresh()
      const sets = pk.map(k => `${adapter.quoteIdent(k)} = ${ph()}`).join(', ')
      const conds = wk.map(k => `${adapter.quoteIdent(k)} = ${ph()}`).join(' AND ')
      const sql = `UPDATE ${adapter.quoteIdent(tableNameFor(model))} SET ${sets}` + (wk.length ? ` WHERE ${conds}` : '')
      return adapter.run(sql, [...pk.map(k => patch[k]), ...wk.map(k => where[k])])
    },
  }

  return {
    fnKey, actor: o.actor ?? null, dryRun, db, writes, effects: [...effects],
    table: (model: string) => table(manifest, model),
    change: (model: string, params: Row, base: Row | null = null): Changeset => changeset(manifest, model, params, base),
  }
}
