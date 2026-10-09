---
title: "Evolve the schema and try PostgreSQL"
description: "Plan a schema change, distinguish planning from application, and preserve adapter contracts when changing databases."
stage: "Verify and operate"
duration: 50
lab: "Node + optional PostgreSQL"
order: 30
---

Before you start: complete [Test the deployment you actually ship](/learn/testing/), or make sure you can pass its checkpoint.

## Begin with a reversible lab change

Use a copy of the lab database. Add an optional description field to Todo and build the workspace. Inspect the planned migration before applying it. Adding an optional field is a better first experiment than dropping a populated column.

```bash
# Run from: learn_api
npm run build
npx ket migrate --deployment learn_api --workspace dist/ket.workspace.js
npx ket schema verify --deployment learn_api --workspace dist/ket.workspace.js
```

The migration snapshot is planning state. It is not proof that an external database has been updated. Development boot can apply migrations; production should use an explicit migration step and verify the resulting physical schema.

## Protect a release boundary

Record the current manifest/schema before changing it. Review destructive changes separately, and keep a backup with a tested restore path. Do not pass a destructive override merely to make a startup error disappear.

For tenant fleets, migration status belongs to each tenant datastore. A successful migration on one database does not establish that the fleet is current. Stage the rollout and observe failures before enabling code that requires the new schema everywhere.

## Add PostgreSQL deliberately

The adapter is a separate package. In a disposable extension of the lab:

```bash
# Run from: learn_api
npm install @ketvietlab/ketjs-postgres@0.4.0 postgres
```

Configure `serve.openStore` to create and open `postgresAdapter(config.databaseUrl ?? '')`, as shown in the adapter reference. Set `DATABASE_URL` to a local disposable database. Keep credentials outside source control.

Run the same CRUD, transaction and scope cases against that deployment. Add decimal, date and ordering cases if your domain uses those types. SQLite passing does not establish PostgreSQL compatibility for your application's complete behavior.

## Verify the worker datastore too

HTTP and worker processes must use the same selected backend. PostgreSQL notifications can accelerate wake-up; polling and leases remain part of durability. Test restart and retry behavior rather than relying only on a single successful job.

This lesson's PostgreSQL section requires a running PostgreSQL instance and is an explicit extension; the downloadable baseline and its three checkpoints use SQLite.

## Checkpoint

Explain whether a command planned, applied or verified a migration. For the optional adapter lab, rerun the relevant cases on an actual PostgreSQL database.

## Practice on your own

Write an expand/backfill/contract plan for renaming a populated field without breaking the previous application version during rollout.

## Reference

For the complete API contract, read [Migrations](/docs/migrations/).
