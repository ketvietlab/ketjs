// Physical-schema verification for adopting an application-owned migration.
//
// The ordinary migration marker is intentionally declarative: it records the
// manifest KetJS actually applied. A hand-written migration is the one exception,
// and it may advance that marker only after the adapter's catalog proves every
// modelled table, column, constraint, and index is at the requested target.

import type { Adapter } from '../types.ts'
import type { Column, Schema } from './migrate.ts'

type PhysicalColumn = { type: string; nullable: boolean; primary: boolean }
type PhysicalIndex = {
  fields: string[]
  unique: boolean
  expression: boolean
  partial: boolean
  valid: boolean
  ready: boolean
  live: boolean
}
type PhysicalTable = {
  columns: Record<string, PhysicalColumn>
  indexes: Record<string, PhysicalIndex>
}

const truthy = (value: unknown): boolean =>
  value === true || value === 1 || value === '1' || value === 't' || value === 'true' || value === 'YES'

const normalizeType = (value: unknown): string => {
  const type = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\s+primary key$/, '')
  const aliases: Record<string, string> = {
    int8: 'bigint',
    float8: 'double precision',
    timestamptz: 'timestamp with time zone',
    decimal: 'numeric',
  }
  return aliases[type] ?? type
}

const expectedType = (adapter: Adapter, column: Column): string => normalizeType(adapter.columnSql(column))

async function inspectSqliteTable(adapter: Adapter, table: string): Promise<PhysicalTable | null> {
  const q = adapter.quoteIdent
  const rows = await adapter.all(`PRAGMA table_info(${q(table)})`)
  if (!rows.length) return null

  const columns: PhysicalTable['columns'] = {}
  for (const row of rows) {
    const name = String(row.name)
    const primary = truthy(row.pk)
    columns[name] = {
      type: normalizeType(row.type),
      // SQLite reports `notnull = 0` for a generated TEXT PRIMARY KEY. Treat the
      // primary-key contract as required while checking PK identity separately.
      nullable: !truthy(row.notnull) && !primary,
      primary,
    }
  }

  const indexes: PhysicalTable['indexes'] = {}
  for (const row of await adapter.all(`PRAGMA index_list(${q(table)})`)) {
    const name = String(row.name)
    const fieldRows = (await adapter.all(`PRAGMA index_info(${q(name)})`)).sort(
      (a, b) => Number(a.seqno) - Number(b.seqno),
    )
    const expression = fieldRows.some((field) => Number(field.cid) === -2)
    const fields = fieldRows.map((field) => (Number(field.cid) === -2 ? '<expression>' : String(field.name)))
    indexes[name] = {
      fields,
      unique: truthy(row.unique),
      expression,
      partial: truthy(row.partial),
      valid: true,
      ready: true,
      live: true,
    }
  }
  return { columns, indexes }
}

async function inspectPostgresTable(adapter: Adapter, table: string): Promise<PhysicalTable | null> {
  const rows = await adapter.all(
    `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position`,
    [table],
  )
  if (!rows.length) return null

  const primary = new Set(
    (
      await adapter.all(
        `SELECT kcu.column_name
           FROM information_schema.table_constraints tc
           JOIN information_schema.key_column_usage kcu
             ON kcu.constraint_name = tc.constraint_name
            AND kcu.constraint_schema = tc.constraint_schema
          WHERE tc.table_schema = 'public'
            AND tc.table_name = $1
            AND tc.constraint_type = 'PRIMARY KEY'
          ORDER BY kcu.ordinal_position`,
        [table],
      )
    ).map((row) => String(row.column_name)),
  )

  const columns: PhysicalTable['columns'] = {}
  for (const row of rows) {
    const name = String(row.column_name)
    columns[name] = {
      type: normalizeType(row.data_type),
      nullable: String(row.is_nullable).toUpperCase() === 'YES',
      primary: primary.has(name),
    }
  }

  const indexRows = await adapter.all(
    `SELECT index_class.relname AS index_name,
            index_meta.indisunique AS is_unique,
            index_meta.indpred IS NOT NULL AS is_partial,
            index_meta.indisvalid AS is_valid,
            index_meta.indisready AS is_ready,
            index_meta.indislive AS is_live,
            indexed_key.attnum = 0 AS is_expression,
            attribute.attname AS column_name,
            indexed_key.ordinality AS position
       FROM pg_class table_class
       JOIN pg_namespace namespace ON namespace.oid = table_class.relnamespace
       JOIN pg_index index_meta ON index_meta.indrelid = table_class.oid
       JOIN pg_class index_class ON index_class.oid = index_meta.indexrelid
       JOIN LATERAL unnest(index_meta.indkey) WITH ORDINALITY AS indexed_key(attnum, ordinality) ON true
       LEFT JOIN pg_attribute attribute
         ON attribute.attrelid = table_class.oid AND attribute.attnum = indexed_key.attnum
      WHERE namespace.nspname = 'public'
        AND table_class.relname = $1
        AND NOT index_meta.indisprimary
      ORDER BY index_class.relname, indexed_key.ordinality`,
    [table],
  )
  const indexes: PhysicalTable['indexes'] = {}
  for (const row of indexRows) {
    const name = String(row.index_name)
    const expression = truthy(row.is_expression)
    const index = (indexes[name] ??= {
      fields: [],
      unique: truthy(row.is_unique),
      expression: false,
      partial: truthy(row.is_partial),
      valid: truthy(row.is_valid),
      ready: truthy(row.is_ready),
      live: truthy(row.is_live),
    })
    index.expression ||= expression
    index.fields[Number(row.position) - 1] = expression ? '<expression>' : String(row.column_name)
  }
  return { columns, indexes }
}

const inspectTable = (adapter: Adapter, table: string): Promise<PhysicalTable | null> => {
  if (adapter.name === 'sqlite') return inspectSqliteTable(adapter, table)
  if (adapter.name === 'postgres') return inspectPostgresTable(adapter, table)
  throw new Error(
    `adapter "${adapter.name}" cannot verify a physical schema safely; catalog verification supports sqlite and postgres`,
  )
}

const describeFields = (fields: string[]): string => `(${fields.join(', ')})`

/** Return every modelled difference between the physical database and `target`. */
export async function physicalSchemaIssues(
  adapter: Adapter,
  previous: Schema,
  target: Schema,
): Promise<string[]> {
  const issues: string[] = []
  const tableNames = new Set([...Object.keys(previous.tables), ...Object.keys(target.tables)])

  for (const tableName of [...tableNames].sort()) {
    const before = previous.tables[tableName]
    const expected = target.tables[tableName]
    const actual = await inspectTable(adapter, tableName)
    if (!expected) {
      if (actual) issues.push(`table ${tableName} still exists; expected it to be removed`)
      continue
    }
    if (!actual) {
      issues.push(`table ${tableName} is missing`)
      continue
    }

    for (const [columnName, column] of Object.entries(expected.columns)) {
      const held = actual.columns[columnName]
      const path = `${tableName}.${columnName}`
      if (!held) {
        issues.push(`column ${path} is missing`)
        continue
      }
      const type = expectedType(adapter, column)
      if (held.type !== type)
        issues.push(`column ${path} has type ${held.type || '(none)'}; expected ${type}`)
      if (held.nullable !== column.optional)
        issues.push(
          `column ${path} is ${held.nullable ? 'nullable' : 'NOT NULL'}; expected ${column.optional ? 'nullable' : 'NOT NULL'}`,
        )
      const primary = column.base === 'id'
      if (held.primary !== primary)
        issues.push(`column ${path} is ${held.primary ? '' : 'not '}the expected primary key`)
    }
    for (const columnName of Object.keys(before?.columns ?? {})) {
      if (!expected.columns[columnName] && actual.columns[columnName])
        issues.push(`column ${tableName}.${columnName} still exists; expected it to be removed`)
    }

    for (const [name, index] of Object.entries(expected.indexes ?? {})) {
      const physicalName = `${tableName}__${name}`
      const held = actual.indexes[physicalName]
      if (!held) {
        issues.push(`index ${physicalName} is missing`)
        continue
      }
      if (held.unique !== index.unique)
        issues.push(
          `index ${physicalName} is ${held.unique ? 'unique' : 'non-unique'}; expected ${index.unique ? 'unique' : 'non-unique'}`,
        )
      if (held.expression)
        issues.push(`index ${physicalName} contains expressions; expected only model fields`)
      if (held.partial) issues.push(`index ${physicalName} is partial; expected an unfiltered index`)
      if (!held.valid) issues.push(`index ${physicalName} is invalid`)
      if (!held.ready) issues.push(`index ${physicalName} is not ready for inserts`)
      if (!held.live) issues.push(`index ${physicalName} is being dropped`)
      if (held.fields.join('\0') !== index.fields.join('\0'))
        issues.push(
          `index ${physicalName} covers ${describeFields(held.fields)}; expected ${describeFields(index.fields)}`,
        )
    }
    for (const name of Object.keys(before?.indexes ?? {})) {
      const physicalName = `${tableName}__${name}`
      if (!expected.indexes?.[name] && actual.indexes[physicalName])
        issues.push(`index ${physicalName} still exists; expected it to be removed`)
    }
  }
  return issues
}
