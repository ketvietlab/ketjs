// Migrating many databases from one manifest.
//
// the domain contract lets each database install a different set of modules, so there is no single
// schema to reason about and every fleet upgrade is N unknown migrations. Ket takes
// the opposite position: one manifest, many databases, the same target schema
// everywhere. Each database records the schema it is actually on, so a tenant
// created last year and one created today converge on the same shape.

import { ManualMigrationRequiredError, schemaFromManifest, planMigration, renderSql } from './migrate.ts'
import type { Schema, MigrationOp } from './migrate.ts'
import { physicalSchemaIssues } from './physical.ts'
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

/** A manual migration was not eligible to advance the recorded schema. */
export class ManualMigrationConfirmationError extends Error {
  code = 'E_MANUAL_MIGRATION_CONFIRMATION'
  issues: string[]
  constructor(message: string, issues: string[] = []) {
    super(issues.length ? `${message}:\n${issues.map((issue) => `  - ${issue}`).join('\n')}` : message)
    this.issues = issues
  }
}

async function readApplied(adapter: Adapter, ensureTable: boolean): Promise<Schema | null> {
  const pg = adapter.name === 'postgres'
  if (ensureTable) await adapter.exec(pg ? MIGRATION_DDL_PG : MIGRATION_DDL)
  else if (!Object.hasOwn(await adapter.introspect(), 'ket_migration')) return null
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
  if (o.dryRun) {
    const applied = await readApplied(adapter, false)
    return planMigration(applied, target, { allowDestructive: o.allowDestructive ?? false })
  }

  const apply = async (tx: Adapter): Promise<MigrationOp[]> => {
    const applied = await readApplied(tx, true)
    const ops = planMigration(applied, target, { allowDestructive: o.allowDestructive ?? false })
    const sql = renderSql(ops, tx)
    for (const statement of sql) await tx.exec(statement)
    await writeApplied(tx, target, (o.now ?? (() => new Date().toISOString()))())
    return ops
  }

  // DDL and the schema marker are one unit. Without this, a failed later
  // statement leaves earlier columns/indexes in place while the old marker makes
  // a retry replay them and fail on duplicates.
  return adapter.transaction ? apply(adapter) : adapter.tx(apply)
}

/**
 * Confirm an application-owned migration after checking the physical database.
 *
 * Call this on the transaction-scoped adapter after the manual DDL and backfill.
 * The migration marker advances in that same transaction only when every modelled
 * table, column type/nullability/primary key, and named index matches `manifest`.
 */
export async function confirmManualMigration(
  adapter: Adapter,
  manifest: Manifest,
  o: { now?: () => string } = {},
): Promise<MigrationOp[]> {
  const target = schemaFromManifest(manifest)
  const confirm = async (tx: Adapter): Promise<MigrationOp[]> => {
    const applied = await readApplied(tx, false)
    if (!applied)
      throw new ManualMigrationConfirmationError(
        'no applied-schema marker exists; run migrateOne before confirming a manual transition',
      )

    let manual: MigrationOp[]
    try {
      const generated = planMigration(applied, target, { allowDestructive: true })
      throw new ManualMigrationConfirmationError(
        generated.length
          ? 'the pending schema difference contains no operation that requires a manual migration'
          : 'the recorded schema already matches the target manifest',
      )
    } catch (error) {
      if (!(error instanceof ManualMigrationRequiredError)) throw error
      manual = error.ops
    }

    let issues: string[]
    try {
      issues = await physicalSchemaIssues(tx, applied, target)
    } catch (error) {
      throw new ManualMigrationConfirmationError((error as Error).message)
    }
    if (issues.length)
      throw new ManualMigrationConfirmationError(
        'the physical database does not match the target manifest; the applied-schema marker was not changed',
        issues,
      )

    await writeApplied(tx, target, (o.now ?? (() => new Date().toISOString()))())
    return manual
  }

  return adapter.transaction ? confirm(adapter) : adapter.tx(confirm)
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
