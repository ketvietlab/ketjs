// Schema is derived from the manifest, never hand-written; migrations are generated
// as reviewable operations, never applied silently.
//
// The the domain contract lesson encoded as a rule: destructive operations are still generated so
// you can see them, but refused unless explicitly allowed. "Don't drop fields"
// stops being discipline someone has to remember and becomes something the tool enforces.

import { sqlTypeOf } from '../kernel/types.ts'
import type { Adapter, Manifest, FieldBase } from '../types.ts'

export type Column = { sql: string; base: FieldBase; optional: boolean; by: string; target: string | null }
export type Index = { fields: string[]; unique: boolean; by: string }
export type Table = {
  model: string
  owner: string
  columns: Record<string, Column>
  indexes: Record<string, Index>
}
export type Schema = { version: number; tables: Record<string, Table> }

export type MigrationOp =
  | { op: 'CREATE_TABLE'; table: string; columns: Record<string, Column>; destructive: false }
  | { op: 'ADD_COLUMN'; table: string; column: string; def: Column; destructive: false }
  | {
      op: 'ALTER_COLUMN_NULLABILITY'
      table: string
      column: string
      from: boolean
      to: boolean
      destructive: false
    }
  | { op: 'CREATE_INDEX'; table: string; name: string; def: Index; destructive: false }
  | { op: 'DROP_INDEX'; table: string; name: string; destructive: true }
  | { op: 'DROP_COLUMN'; table: string; column: string; by: string; destructive: true }
  | { op: 'ALTER_COLUMN_TYPE'; table: string; column: string; from: string; to: string; destructive: true }
  | { op: 'DROP_TABLE'; table: string; destructive: true }

export const tableNameFor = (modelKey: string): string =>
  modelKey
    .replace('.', '_')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()

const indexCovers = (indexes: Record<string, Index>, fields: string[]): boolean =>
  Object.values(indexes).some((index) => fields.every((field, position) => index.fields[position] === field))

const autoIndexName = (kind: 'scope' | 'relation', seed: string): string => {
  let hash = 2166136261
  for (let index = 0; index < seed.length; index++) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `ket_${kind}_${(hash >>> 0).toString(36)}`
}

const addAutoIndex = (indexes: Record<string, Index>, name: string, fields: string[]): void => {
  let candidate = name
  let suffix = 2
  while (indexes[candidate]) candidate = `${name}_${suffix++}`
  indexes[candidate] = { fields, unique: false, by: '(framework)' }
}

export function schemaFromManifest(manifest: Manifest): Schema {
  const tables: Record<string, Table> = {}
  for (const [modelKey, model] of Object.entries(manifest.models)) {
    const columns: Record<string, Column> = {}
    for (const [fname, f] of Object.entries(model.fields)) {
      columns[fname] = {
        sql: sqlTypeOf(f),
        base: f.base,
        optional: !!f.optional,
        by: f.by,
        target: f.target ?? null,
      }
    }
    const indexes = Object.fromEntries(
      Object.entries(model.indexes).map(([name, index]) => [name, { ...index, fields: [...index.fields] }]),
    )
    if (model.scope !== 'shared') {
      const fields = model.scope === 'company+branch' ? ['companyId', 'branchId'] : ['companyId']
      if (!indexCovers(indexes, fields)) {
        addAutoIndex(indexes, autoIndexName('scope', modelKey), fields)
      }
    }
    tables[tableNameFor(modelKey)] = { model: modelKey, owner: model.owner, columns, indexes }
  }
  for (const relations of Object.values(manifest.relations)) {
    for (const relation of Object.values(relations)) {
      if (relation.kind !== 'hasMany') continue
      const target = manifest.models[relation.target]
      const table = tables[tableNameFor(relation.target)]
      if (!target || !table) continue
      const fields = [...new Set([...(target.scope === 'shared' ? [] : ['companyId']), relation.by])]
      if (indexCovers(table.indexes, fields)) continue
      addAutoIndex(table.indexes, autoIndexName('relation', `${relation.target}:${relation.by}`), fields)
    }
  }
  return { version: 1, tables }
}

export class DestructiveMigrationError extends Error {
  code = 'E_DESTRUCTIVE_MIGRATION'
  ops: MigrationOp[]
  constructor(message: string, ops: MigrationOp[]) {
    super(message)
    this.ops = ops
  }
}

/**
 * A schema difference that cannot be applied safely from the manifest alone.
 *
 * Required columns need a deployment-specific backfill, nullability changes need
 * data inspection (and a table rebuild on SQLite), and type changes need an
 * explicit conversion expression. Treating any of those as applied would make the
 * migration marker disagree with the physical database.
 */
export class ManualMigrationRequiredError extends Error {
  code = 'E_MANUAL_MIGRATION_REQUIRED'
  ops: MigrationOp[]
  constructor(message: string, ops: MigrationOp[]) {
    super(message)
    this.ops = ops
  }
}

const manualMigrationReason = (op: MigrationOp): string | null => {
  if (op.op === 'ALTER_COLUMN_TYPE')
    return `${op.table}.${op.column} changes type from ${op.from} to ${op.to}`
  if (op.op === 'ALTER_COLUMN_NULLABILITY')
    return `${op.table}.${op.column} changes from ${op.from ? 'optional' : 'required'} to ${op.to ? 'optional' : 'required'}`
  if (op.op === 'ADD_COLUMN' && !op.def.optional)
    return `${op.table}.${op.column} is a required column and existing rows need a backfill`
  return null
}

export function planMigration(
  prev: Schema | null,
  next: Schema,
  opts: { allowDestructive?: boolean } = {},
): MigrationOp[] {
  const ops: MigrationOp[] = []
  const prevTables = prev?.tables ?? {}

  for (const [t, def] of Object.entries(next.tables)) {
    const before = prevTables[t]
    if (!before) {
      ops.push({ op: 'CREATE_TABLE', table: t, columns: def.columns, destructive: false })
      for (const [name, index] of Object.entries(def.indexes ?? {}))
        ops.push({ op: 'CREATE_INDEX', table: t, name, def: index, destructive: false })
      continue
    }
    for (const [c, cd] of Object.entries(def.columns)) {
      const bc = before.columns[c]
      if (!bc) {
        ops.push({ op: 'ADD_COLUMN', table: t, column: c, def: cd, destructive: false })
        continue
      }
      if (bc.base !== cd.base)
        ops.push({
          op: 'ALTER_COLUMN_TYPE',
          table: t,
          column: c,
          from: bc.base,
          to: cd.base,
          destructive: true,
        })
      else if (bc.optional !== cd.optional)
        ops.push({
          op: 'ALTER_COLUMN_NULLABILITY',
          table: t,
          column: c,
          from: bc.optional,
          to: cd.optional,
          destructive: false,
        })
    }
    // Indexes are dropped before the columns and created after them. Postgres
    // drops any index covering a dropped column as part of ALTER TABLE, so a
    // DROP_INDEX emitted afterwards would fail on an index that is already gone
    // and abort the migration halfway through.
    const creates: MigrationOp[] = []
    for (const [name, index] of Object.entries(def.indexes ?? {})) {
      const old = before.indexes?.[name]
      if (!old) creates.push({ op: 'CREATE_INDEX', table: t, name, def: index, destructive: false })
      else if (old.unique !== index.unique || old.fields.join('\0') !== index.fields.join('\0')) {
        ops.push({ op: 'DROP_INDEX', table: t, name, destructive: true })
        creates.push({ op: 'CREATE_INDEX', table: t, name, def: index, destructive: false })
      }
    }
    for (const name of Object.keys(before.indexes ?? {})) {
      if (!def.indexes?.[name]) ops.push({ op: 'DROP_INDEX', table: t, name, destructive: true })
    }
    for (const [c, bc] of Object.entries(before.columns)) {
      if (!def.columns[c]) ops.push({ op: 'DROP_COLUMN', table: t, column: c, by: bc.by, destructive: true })
    }
    ops.push(...creates)
  }
  for (const t of Object.keys(prevTables)) {
    if (!next.tables[t]) ops.push({ op: 'DROP_TABLE', table: t, destructive: true })
  }

  const manual = ops.flatMap((op) => {
    const reason = manualMigrationReason(op)
    return reason ? [{ op, reason }] : []
  })
  if (manual.length) {
    const list = manual.map(({ reason }) => `  - ${reason}`).join('\n')
    throw new ManualMigrationRequiredError(
      `migration contains ${manual.length} operation(s) that require a hand-written data migration:\n${list}\n\n` +
        'Apply the DDL and backfill in an application-owned transaction, then call confirmManualMigration(tx, manifest). KetJS will verify the physical schema before recording it.',
      manual.map(({ op }) => op),
    )
  }

  const destructive = ops.filter((o) => o.destructive)
  if (destructive.length && !opts.allowDestructive) {
    const list = destructive
      .map((o) => {
        const col = 'column' in o ? '.' + o.column : ''
        const by = 'by' in o ? ` (contributed by ${o.by})` : ''
        return `  - ${o.op} ${o.table}${col}${by}`
      })
      .join('\n')
    throw new DestructiveMigrationError(
      `migration contains ${destructive.length} destructive operation(s):\n${list}\n\n` +
        `Re-run with --allow-destructive if this is intended. Data in these columns is lost.`,
      destructive,
    )
  }
  return ops
}

export function renderSql(ops: MigrationOp[], adapter: Adapter): string[] {
  const q = (s: string) => adapter.quoteIdent(s)
  const out: string[] = []
  for (const o of ops) {
    if (o.op === 'CREATE_TABLE') {
      const cols = Object.entries(o.columns).map(
        ([n, c]) => `${q(n)} ${adapter.columnSql(c)}${c.optional || c.base === 'id' ? '' : ' NOT NULL'}`,
      )
      out.push(`CREATE TABLE ${q(o.table)} (\n  ${cols.join(',\n  ')}\n)`)
    } else if (o.op === 'ADD_COLUMN') {
      out.push(`ALTER TABLE ${q(o.table)} ADD COLUMN ${q(o.column)} ${adapter.columnSql(o.def)}`)
    } else if (o.op === 'ALTER_COLUMN_NULLABILITY') {
      throw new ManualMigrationRequiredError(
        `migration operation ${o.op} ${o.table}.${o.column} requires a hand-written data migration`,
        [o],
      )
    } else if (o.op === 'CREATE_INDEX') {
      const name = `${o.table}__${o.name}`
      out.push(
        `CREATE ${o.def.unique ? 'UNIQUE ' : ''}INDEX ${q(name)} ON ${q(o.table)} (${o.def.fields.map(q).join(', ')})`,
      )
    } else if (o.op === 'DROP_INDEX') {
      out.push(`DROP INDEX ${q(`${o.table}__${o.name}`)}`)
    } else if (o.op === 'DROP_COLUMN') {
      out.push(`ALTER TABLE ${q(o.table)} DROP COLUMN ${q(o.column)}`)
    } else if (o.op === 'ALTER_COLUMN_TYPE') {
      throw new ManualMigrationRequiredError(
        `migration operation ${o.op} ${o.table}.${o.column} requires a hand-written data migration`,
        [o],
      )
    } else {
      out.push(`DROP TABLE ${q(o.table)}`)
    }
  }
  return out
}
