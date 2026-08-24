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
receive an adapter bound to the transaction's connection. Optional notifications must never be the
only job-delivery guarantee.

## Tenant fleets

Apps with `serve.tenants` expose a database list and an opener. Migrate every tenant with:

```bash
# Run from: /path/to/ketjs
ket migrate --all --workspace dist/ket.workspace.js
ket migrate --all --dry-run --workspace dist/ket.workspace.js
ket migrate --all --allow-destructive --workspace dist/ket.workspace.js
```

The fleet runner uses a bounded adapter pool, continues after an individual tenant failure, and
reports every result. A partial fleet is visible and retryable instead of being hidden behind the first
exception.

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
