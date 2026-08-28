---
title: Upgrading KetJS
description: Audit compatibility, physical schemas, queries, and tenant sessions before changing a KetJS version.
---

Treat a KetJS version change as an application and datastore upgrade. Pin an exact released version or
commit, read the changed contracts, and rehearse the deployment against a recent production copy before
moving the application lock.

## Preflight

From the application built with the candidate framework:

```bash
# Run from: /path/to/example-app
ket check --workspace dist/ket.workspace.js
ket schema verify --deployment backoffice --workspace dist/ket.workspace.js
ket migrate --deployment backoffice --workspace dist/ket.workspace.js

# Tenant fleets
ket schema verify --deployment erp --all --workspace dist/ket.workspace.js
ket migrate --deployment erp --all --dry-run --workspace dist/ket.workspace.js
```

`schema verify` is read-only and checks the physical catalog as well as `ket_migration`. This matters for
databases migrated by older framework versions: a marker can claim that a field is required even when the
physical column is still nullable. A schema diff alone cannot discover that legacy drift.
For tenant fleets, implement the non-mutating `serve.tenants.exists(key, config)` hook before running the
preflight; verification refuses to call a potentially creating adapter factory without it.

Back up the datastore before DDL. Apply required-column backfills and other manual transitions in an
application-owned transaction, then use `confirmManualMigration()` to verify and record the result. Do not
edit the migration marker directly. The schema planner is deliberately data-independent, so adding a
required column to a table already present in the marker requires this manual path even when that table is
currently empty. Model fields do not carry SQL defaults that could make the transition automatic.

## Query compatibility

Review queries whose observable result depends on any of these contracts:

- Generated ascending order places nulls last; descending order places nulls first on SQLite and
  PostgreSQL. Audit nullable sorts combined with `LIMIT`, `OFFSET`, or cursor pagination.
- Decimal `avg` requires both a finite `scale` and `rounding: 'half-away-from-zero'`. Use `sum` and `count`
  and divide in the domain when another rounding policy is required.
- Column handles are opaque values from `table()` or `ctx.table()`. Replace hand-built or persisted
  `{ model, name }`/`{ model, name, base }` objects with handles resolved from the current manifest.

Run the same boundary fixtures against SQLite and PostgreSQL when the deployment supports both adapters.
Include nulls, equivalent decimal spellings, values beyond JavaScript's safe integer range, grouping,
aggregates, and pagination boundaries.

## Tenant session compatibility

Shared session stores bind every session to its tenant key. Legacy unbound rows fail closed and users must
sign in again. Keep the session signing secret, cookie policy, anonymous scope, tenant binding, and backing
store identity stable when a pooled tenant adapter is evicted and recreated; KetJS rejects policy drift
rather than silently changing authentication behavior.

`AdapterPool.close()` is terminal and idempotent. Create a new pool after shutdown; queued, concurrent,
or later acquisitions are rejected so no adapter can escape the deployment lifecycle.

## Rollout

1. Verify every physical datastore and review every reported difference.
2. Apply and confirm manual migrations before starting the new application code.
3. Run adapter-specific integration tests and nullable ordering regressions.
4. Start application processes with `KET_MIGRATE=0` when migrations are managed by the deployment step.
5. Monitor authentication failures, schema-verification output, and paginated list boundaries during the
   rollout.
