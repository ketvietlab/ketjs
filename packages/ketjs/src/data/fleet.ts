// Migrating many databases from one manifest.
//
// the domain contract lets each database install a different set of modules, so there is no single
// schema to reason about and every fleet upgrade is N unknown migrations. Ket takes
// the opposite position: one manifest, many databases, the same target schema
// everywhere. Each database records the schema it is actually on, so a tenant
// created last year and one created today converge on the same shape.

import { schemaFromManifest, planMigration, renderSql } from './migrate.ts'
import type { Schema, MigrationOp } from './migrate.ts'
import type { AdapterPool } from './pool.ts'
import type { Adapter, Manifest } from '../types.ts'

export const MIGRATION_DDL = `
CREATE TABLE IF NOT EXISTS ket_migration (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  schema     TEXT NOT NULL,
  applied_at TEXT NOT NULL
);
`
export const MIGRATION_DDL_PG = `
CREATE TABLE IF NOT EXISTS ket_migration (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  schema     TEXT        NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL
);
`

export type MigrationResult = { datastore: string; ops: MigrationOp[]; applied: boolean; error?: string }

async function readApplied(adapter: Adapter): Promise<Schema | null> {
  const pg = adapter.name === 'postgres'
  await adapter.exec(pg ? MIGRATION_DDL_PG : MIGRATION_DDL)
  const rows = await adapter.all(`SELECT schema FROM ket_migration WHERE id = 1`)
  const r = rows[0]
  return r ? (JSON.parse(String(r.schema)) as Schema) : null
}

async function writeApplied(adapter: Adapter, schema: Schema, now: string): Promise<void> {
  const pg = adapter.name === 'postgres'
  const p = (n: number) => (pg ? `$${n}` : '?')
  const json = JSON.stringify(schema)
  const upd = await adapter.run(
    `UPDATE ket_migration SET schema = ${p(1)}, applied_at = ${p(2)} WHERE id = 1`,
    [json, now],
  )
  if (upd.changes === 0) {
    await adapter.run(`INSERT INTO ket_migration (id, schema, applied_at) VALUES (1, ${p(1)}, ${p(2)})`, [
      json,
      now,
    ])
  }
}

export async function migrateOne(
  adapter: Adapter,
  manifest: Manifest,
  o: { allowDestructive?: boolean; dryRun?: boolean; now?: () => string } = {},
): Promise<MigrationOp[]> {
  const target = schemaFromManifest(manifest)
  const applied = await readApplied(adapter)
  const ops = planMigration(applied, target, { allowDestructive: o.allowDestructive ?? false })
  if (o.dryRun) return ops
  for (const sql of renderSql(ops, adapter)) await adapter.exec(sql)
  await writeApplied(adapter, target, (o.now ?? (() => new Date().toISOString()))())
  return ops
}

/**
 * Migrate every named database. One failure does not stop the fleet — the result
 * says exactly which databases moved and which did not, because a half-migrated
 * fleet you cannot see is worse than one you can.
 */
export async function migrateFleet(
  pool: AdapterPool,
  datastores: string[],
  manifest: Manifest,
  o: { allowDestructive?: boolean; dryRun?: boolean; now?: () => string } = {},
): Promise<MigrationResult[]> {
  const out: MigrationResult[] = []
  for (const datastore of datastores) {
    try {
      const ops = await pool.with(datastore, (adapter) => migrateOne(adapter, manifest, o))
      out.push({ datastore, ops, applied: !o.dryRun })
    } catch (e) {
      out.push({ datastore, ops: [], applied: false, error: (e as Error).message })
    }
  }
  return out
}

export function formatFleet(results: MigrationResult[]): string {
  return results
    .map((r) => {
      if (r.error) return `FAIL  ${r.datastore.padEnd(24)} ${r.error.split('\n')[0]}`
      if (!r.ops.length) return `ok    ${r.datastore.padEnd(24)} already up to date`
      return `ok    ${r.datastore.padEnd(24)} ${r.ops.length} operation(s): ${r.ops.map((op) => op.op).join(', ')}`
    })
    .join('\n')
}
