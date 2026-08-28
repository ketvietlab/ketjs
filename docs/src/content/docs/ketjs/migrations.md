---
title: Migrations and adapters
description: Derive schemas, plan safe migrations, use SQLite or PostgreSQL, and migrate tenant fleets.
---

KetJS derives the datastore schema from the complete composed manifest. Every database in a deployment
moves toward that one known schema, and the same selected module set owns runtime behavior.

## Schema pipeline

```ts
// File: src/modules/example/models.ts
import { planMigration, renderSql, schemaFromManifest, sqliteAdapter } from '@ketvietlab/ketjs'

const next = schemaFromManifest(manifest)
const operations = planMigration(previous, next)
const adapter = sqliteAdapter()

for (const sql of renderSql(operations, adapter)) {
  console.log(`${sql};`)
}
```

Field provenance is retained in the schema. A destructive operation can therefore identify the module
that contributed the affected field. The derived schema includes framework-owned indexes for row scope
and declared `hasMany` relation keys; these appear as ordinary non-destructive migration operations.

## Non-destructive by default

`planMigration()` refuses data-losing operations unless explicitly allowed:

```ts
// File: src/modules/example/models.ts
const operations = planMigration(previous, next, {
  allowDestructive: true,
})
```

Without this flag, removing a table or column raises `DestructiveMigrationError` with code
`E_DESTRUCTIVE_MIGRATION`. Review the provenance and data migration before enabling destructive SQL.

Some changes cannot be derived safely from a manifest alone. Adding a required column to an existing
table needs a backfill, changing nullability needs inspection of existing rows, and changing a type needs
an explicit conversion. KetJS rejects these with `ManualMigrationRequiredError` and code
`E_MANUAL_MIGRATION_REQUIRED`; it never records the target schema for an operation it could not enforce.

Do not edit `ket_migration` directly after applying the SQL. Finish the DDL and backfill in one
application-owned transaction, then call `confirmManualMigration()` on that transaction's adapter. This
PostgreSQL example adds and backfills a required field:

```ts
// File: scripts/migrate-required-status.ts
import { confirmManualMigration } from '@ketvietlab/ketjs'

await adapter.tx(async (tx) => {
  await tx.exec('ALTER TABLE "orders_order" ADD COLUMN "status" TEXT')
  await tx.run('UPDATE "orders_order" SET "status" = $1 WHERE "status" IS NULL', ['draft'])
  await tx.exec('ALTER TABLE "orders_order" ALTER COLUMN "status" SET NOT NULL')
  await confirmManualMigration(tx, manifest)
})
```

Confirmation is not an escape hatch for the planner. It requires an existing marker and at least one
pending manual operation, then reads the physical database catalog. Every modelled table, column type,
nullability, primary key, and named index must match the target manifest. A mismatch raises
`ManualMigrationConfirmationError` (`E_MANUAL_MIGRATION_CONFIRMATION`). When it propagates from the shared
transaction shown above, the DDL rolls back and the marker remains unchanged. SQLite and PostgreSQL
catalogs are supported; a custom adapter is refused unless KetJS can verify it safely. A subsequent
`migrateOne(adapter, manifest)` returns no operations after a successful confirmation.

Installing or removing a module at runtime is not a destructive migration. Disabled module data stays
in place for a later reinstall.

## CLI planning

For a single datastore, `ket migrate` compares the current manifest schema to its local snapshot,
prints SQL, and updates `.ket/schema.<app>.json`:

```bash
# Run from: /path/to/ketjs
ket migrate --deployment backoffice --workspace dist/ket.workspace.js
ket migrate --deployment backoffice --allow-destructive --workspace dist/ket.workspace.js
```

Treat the snapshot as planning state, not proof that SQL was applied to an external database. Normal
development boot applies migrations by default; production should run an explicit deployment step and
set `KET_MIGRATE=0` for application pods after the fleet is current.

Programmatic code can apply one manifest with `migrateOne(adapter, manifest)`.

## SQLite

SQLite is built into `@ketvietlab/ketjs` and requires no driver package:

```ts
// File: src/modules/example/models.ts
import { sqliteAdapter } from '@ketvietlab/ketjs'

const adapter = sqliteAdapter('.ket/deployment.db')
await adapter.open()
```

Most deployments need no explicit `openStore`; `sqliteStore` reads `KET_SQLITE` and is the default runtime
factory.

Useful settings:

```bash
# Run from: /path/to/example-app
KET_SQLITE=.ket/orders.db ket serve
KET_SQLITE=:memory: ket call public.health --isolated
```

Use a file-backed database when HTTP and workers open separate adapters. An in-memory database belongs
to one connection and cannot represent cross-process visibility.

## PostgreSQL

Install the separate adapter and its optional driver:

```bash
# Run from: /path/to/ketjs
npm install @ketvietlab/ketjs-postgres postgres
```

Wire it at the application boundary:

```ts
// File: src/app.ts
import { defineDeployment } from '@ketvietlab/ketjs'
import { postgresAdapter } from '@ketvietlab/ketjs-postgres'

export const app = defineDeployment({
  name: 'orders',
  modules: [orders],
  headless: true,
  serve: {
    openStore: async (config) => {
      const adapter = postgresAdapter(config.databaseUrl ?? '')
      await adapter.open()
      return adapter
    },
  },
})
```

Then configure the connection:

```bash
# Run from: /path/to/example-app
DATABASE_URL=postgres://app:secret@db.example/orders ket serve
```

`@ketvietlab/ketjs-postgres` is separate so the core cannot accidentally require a database driver. PostgreSQL
transactions reserve one connection. Queue notifications use `LISTEN/NOTIFY` as a wake-up accelerator;
leases and polling remain the durability guarantee.

## Adapter contract

Custom adapters implement the public `Adapter` interface:

```ts
// File: src/modules/example/models.ts
type Adapter = {
  name: string
  readonly transaction?: boolean
  open(): Promise<void>
  close(): Promise<void>
  exec(sql: string): Promise<void>
  all(sql: string, params?: unknown[]): Promise<Record<string, unknown>[]>
  run(sql: string, params?: unknown[]): Promise<{ changes: number }>
  tx<T>(fn: (tx: Adapter) => Promise<T>): Promise<T>
  quoteIdent(name: string): string
  columnSql(field: { base: FieldBase }): string
  introspect(): Promise<Record<string, Record<string, string>>>
  notifications?: DatabaseNotifications
}
```

Call `assertAdapter()` during construction to catch missing methods. A transaction callback must
receive an adapter bound to the transaction's connection and mark it with `transaction: true`; this
lets framework operations join that transaction instead of trying to nest another one. Optional
notifications must never be the only job-delivery guarantee.

## Tenant fleets

Apps with `serve.tenants` expose a database list and an opener. Migrate every tenant with:

```bash
# Run from: /path/to/ketjs
ket migrate --deployment erp --all --workspace dist/ket.workspace.js
ket migrate --deployment erp --all --dry-run --workspace dist/ket.workspace.js
ket migrate --deployment erp --all --allow-destructive --workspace dist/ket.workspace.js
```

When a workspace has more than one tenant-fleet deployment, `--deployment` is required rather than
guessing which product to migrate. The fleet runner uses a bounded adapter pool, continues after an
individual tenant failure, and reports every result. Each tenant's DDL and applied-schema marker commit in
one transaction, so a partial fleet is visible and retryable instead of being hidden behind the first
exception. `--dry-run` reads the marker and plan without creating framework or application tables.

Programmatic tooling can use `createAdapterPool()`, `migrateFleet()`, and `formatFleet()`.

## Deployment sequence

For a production release:

1. Build the emitted workspace and modules.
2. Run `ket check` and compare a manifest snapshot.
3. Plan migrations and review destructive operations.
4. Back up the datastore or tenant fleet.
5. Apply migrations before starting new HTTP and worker processes.
6. Start processes with `KET_MIGRATE=0` when migrations are managed externally.
7. Verify the live manifest and worker queues.

See [Deployment](/ketjs/deployment/) for the complete runtime checklist.
