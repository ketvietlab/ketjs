// Request context. There is no module-scope database client anywhere in Ket: data
// access exists only on a ctx handed to a server function, and that ctx refuses any
// access the function did not declare in `effects`.
//
// This is what makes "the call forgot its context/permission" unrepresentable
// rather than merely discouraged.

import { tableNameFor } from '../data/migrate.ts'
import { KetError } from '../kernel/errors.ts'
import type { Adapter, Ctx, Manifest, Row, WriteRecord } from '../types.ts'

const normalize = (v: unknown): unknown =>
  typeof v === 'boolean' ? (v ? 1 : 0) : v && typeof v === 'object' ? JSON.stringify(v) : v

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

  const db: Ctx['db'] = {
    select(model, where = {}) {
      need('read', model)
      const t = adapter.quoteIdent(tableNameFor(model))
      const keys = Object.keys(where)
      const sql = `SELECT * FROM ${t}` + (keys.length ? ` WHERE ${keys.map(k => `${adapter.quoteIdent(k)} = ?`).join(' AND ')}` : '')
      return adapter.all(sql, keys.map(k => where[k]))
    },
    insert(model, row) {
      need('write', model)
      const known = Object.keys(manifest.models[model]?.fields ?? {})
      const unknown = Object.keys(row).filter(k => !known.includes(k))
      if (unknown.length) {
        throw new KetError({ code: 'E_UNKNOWN_FIELD', message: `${model} has no field(s): ${unknown.join(', ')}`, hint: `fields: ${known.join(', ')}` })
      }
      writes.push({ op: 'insert', model, row })
      if (dryRun) return { dryRun: true }
      const ks = Object.keys(row)
      const sql = `INSERT INTO ${adapter.quoteIdent(tableNameFor(model))} (${ks.map(k => adapter.quoteIdent(k)).join(', ')}) VALUES (${ks.map(() => '?').join(', ')})`
      return adapter.run(sql, ks.map(k => normalize(row[k])))
    },
    update(model, where, patch) {
      need('write', model)
      writes.push({ op: 'update', model, where, patch })
      if (dryRun) return { dryRun: true }
      const pk = Object.keys(patch), wk = Object.keys(where)
      const sql = `UPDATE ${adapter.quoteIdent(tableNameFor(model))} SET ${pk.map(k => `${adapter.quoteIdent(k)} = ?`).join(', ')}` +
        (wk.length ? ` WHERE ${wk.map(k => `${adapter.quoteIdent(k)} = ?`).join(' AND ')}` : '')
      return adapter.run(sql, [...pk.map(k => normalize(patch[k])), ...wk.map(k => where[k])])
    },
  }

  return { fnKey, actor: o.actor ?? null, dryRun, db, writes, effects: [...effects] }
}
