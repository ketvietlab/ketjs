---
title: CLI and configuration
description: Inspect, build, run, migrate, and configure KetJS applications from the ket command line.
---

The `ket` CLI uses the same workspace resolution and composition code as the runtime. Inspection commands
therefore validate the deployment artifact rather than maintaining a separate configuration model.

## Workspace selection

Commands look for emitted workspace files in this order:

1. `dist/ket.workspace.js`;
2. `ket.workspace.js`;
3. `workspace.js`.

Override discovery with `--workspace FILE`. Use `--deployment NAME` in multi-app workspaces and repeat
`--module-path DIR` to add module roots. `KET_MODULE_PATH` accepts the platform path separator.

Production commands execute emitted JavaScript. Compile `ket.workspace.ts`, modules, routes, jobs, and tests
before invoking them.

## Compose and inspect

| Command | Purpose |
| --- | --- |
| `ket check` | Resolve and compose every app; report contract violations. |
| `ket manifest --deployment NAME` | Print one composed manifest. |
| `ket workspace` | Show deployments, datastores, shared modules, and deployment-only modules. |
| `ket modules` | Show resolved modules and their source paths. |
| `ket types --deployment NAME` | Generate `.ket/types.d.ts` from the manifest. |
| `ket agent --deployment NAME` | Print the machine-readable agent capability descriptor. |
| `ket permissions` | List grantable functions and the data/effect reach of a grant set, module, or stored role. |
| `ket permissions --json [--all]` | Emit a deterministic module/function inventory for one or every deployment. |

Run `ket check` in CI before migrations or deployment. It catches dependency, extension, layout, route,
queue, theme, model, and function-contract conflicts without starting a server.

```bash
# Run from: /path/to/example-app
ket check --workspace dist/ket.workspace.js
ket workspace --workspace dist/ket.workspace.js
ket permissions --deployment backoffice --grant order.list,order.create
ket permissions --json --all --workspace dist/ket.workspace.js
```

The JSON permission inventory is read-only and contains composition metadata only: module name/version and
function exposure, anonymous/provision flags, effects, input/output declarations, and replay/agent markers. It
includes modules with zero functions so CI can distinguish an intentionally non-callable module from a missing
module. It never serializes handlers, application rows, credentials, or process environment. Use `--deployment`
for one deployment or `--all` for the complete workspace; those selectors are mutually exclusive.

## Compare manifests

Store a reviewed manifest at a release boundary and compare future composition output:

```bash
# Run from: /path/to/example-app
ket snapshot --deployment backoffice --workspace dist/ket.workspace.js
ket diff --deployment backoffice \
  --workspace dist/ket.workspace.js \
  --against .ket/manifest.backoffice.json
```

`ket diff` describes contract changes. Database migration planning remains a separate check because schema
state belongs to a datastore, not to a JSON snapshot.

## Database commands

```bash
# Run from: /path/to/ketjs
ket migrate --deployment backoffice --workspace dist/ket.workspace.js
ket migrate --deployment backoffice --allow-destructive
ket migrate --deployment erp --all --dry-run
ket schema verify --deployment backoffice --workspace dist/ket.workspace.js
ket schema verify --deployment erp --tenant acme
ket schema verify --deployment erp --all
```

For one datastore, the command plans against `.ket/schema.<app>.json`, prints SQL, and updates that local
snapshot; it does not prove that an external database was migrated. `--dry-run` prints the plan without
creating `.ket` state or updating that snapshot. For tenant databases, `--all` uses the deployment's tenant
catalogue and applies each plan unless `--dry-run` is set. A workspace with multiple tenant-fleet deployments
must pass `--deployment`; the CLI never chooses a product implicitly. Destructive changes always require
`--allow-destructive`. See [Migrations and adapters](/ketjs/migrations/).

`ket schema verify` is a read-only catalog audit. It checks that the physical tables, columns,
nullability, primary keys, and indexes satisfy both the applied marker and current manifest, and exits
non-zero on drift. Use `--tenant KEY` for one tenant database or `--all` for the complete tenant fleet.
The built-in SQLite path must already exist; verification does not create a missing database.
Tenant verification requires the non-mutating `serve.tenants.exists(key, config)` hook and skips
`open()` when that check reports a missing datastore.

## Runtime commands

```bash
# Run from: /path/to/example-app
ket serve --deployment backoffice --workspace dist/ket.workspace.js
ket worker --deployment backoffice --workspace dist/ket.workspace.js
ket dev --all --deployment backoffice --workspace dist/ket.workspace.js
```

`serve` owns HTTP traffic. `worker` consumes durable queues. `dev` watches emitted artifacts and restarts the
selected roles; it does not turn the production process into a TypeScript loader. For `dev --all`, restart
shutdown stops accepting HTTP connections before draining the worker and is serialized across repeated file
events. The next process can therefore bind the same port without racing the previous listener.

Operational commands include:

```bash
# Run from: /path/to/example-app
ket provision bootstrap.admin --input -
ket call order.list --against http://127.0.0.1:3000 --input '{}'
ket test dist/test
ket jobs list --state retryable --queue mail
ket jobs retry JOB_ID
ket jobs cancel JOB_ID
ket jobs prune
```

`ket provision` reads input from standard input so secrets need not appear in shell history. Tenant deployments
require `--tenant KEY` for provisioning and job operations.

## Scaffold

```bash
# Run from: /path/to/projects
npx -y @ketvietlab/ketjs@latest new inventory --dir ./inventory
cd inventory
npm install
npm run dev
```

The generated project includes a workspace, deployment, module, model, function, TypeScript build, and development
watcher. Read [Quick start](/ketjs/quick-start/) for the file-by-file walkthrough.

## Runtime environment

`readConfig()` reads environment variables once and returns a validated `RuntimeConfig` value.

### Server and database

| Variable | Default | Meaning |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | HTTP bind address. |
| `PORT` | `3000` | HTTP port. `0` selects an ephemeral port. |
| `DATABASE_URL` | unset | Non-SQLite connection value interpreted by the deployment's `openStore`. |
| `KET_SQLITE` | `.ket/deployment.db` | SQLite file when no external datastore is configured. |
| `KET_MIGRATE` | enabled | Set to `0` to disable migration on boot. |

KetJS ships `sqliteStore`. An app using `DATABASE_URL` must provide `serve.openStore`, typically with
`postgresAdapter()` from `@ketvietlab/ketjs-postgres`.

### Identity and localization

| Variable | Default | Meaning |
| --- | --- | --- |
| `KET_LOCALE` | `en` | Default locale. |
| `KET_FALLBACK_LOCALE` | default locale | Translation fallback locale. |
| `KET_TIMEZONE` | `UTC` | IANA timezone used when an application or viewer has no timezone. |
| `KET_COMPANY` | `default` | Development company when sessions are not configured. |
| `KET_SECRET` | ephemeral | Session-cookie signing key. Must be stable and shared across pods. |
| `KET_WEBHOOK_SECRET` | unset | Dedicated HMAC secret for anonymous provider callbacks. |

Never reuse `KET_SECRET` as a webhook or provider secret.

### Workers and storage

| Variable | Default | Meaning |
| --- | --- | --- |
| `KET_QUEUE_NOTIFY` | enabled | PostgreSQL notification accelerator; polling remains the guarantee. |
| `KET_STORAGE` | `local` | `local` or `s3`. |
| `KET_STORAGE_DIR` | `.ket/storage` | Local storage directory. |
| `KET_UPLOAD_MAX` | `26214400` | Maximum upload size in bytes. |
| `KET_S3_ENDPOINT` | unset | Required S3-compatible endpoint when `KET_STORAGE=s3`. |
| `KET_S3_REGION` | `us-east-1` | S3 signing region. |
| `KET_S3_BUCKET` | unset | S3 bucket name. |
| `KET_S3_KEY` | unset | S3 access-key ID. |
| `KET_S3_SECRET` | unset | S3 secret access key. |
| `KET_S3_PATH_STYLE` | disabled | Set to a non-zero value for path-style requests. |
| `KET_STORAGE_PUBLIC_DIR` | unset | Opt into a second local backend; must not overlap `KET_STORAGE_DIR`. |
| `KET_S3_PUBLIC_BUCKET` | unset | Opt into a second S3 bucket; the original `KET_S3_BUCKET` remains private/default. |
| `KET_S3_PUBLIC_KEY` | unset | Public-bucket access-key ID; required for the second S3 backend. |
| `KET_S3_PUBLIC_SECRET` | unset | Public-bucket secret; required, never inherited from the private backend. |
| `KET_S3_PUBLIC_ENDPOINT` | `KET_S3_ENDPOINT` | Optional separate public-bucket endpoint. |
| `KET_S3_PUBLIC_REGION` | `KET_S3_REGION` | Optional separate public-bucket signing region. |
| `KET_S3_PUBLIC_PATH_STYLE` | `KET_S3_PATH_STYLE` | Optional public-bucket addressing override; `0` disables path-style. |
| `KET_STORAGE_PUBLIC_URL` | unset | Optional unsigned HTTP(S) base URL for the public bucket/directory, without credentials, query, or fragment. |
| `KET_LOG` | `auto` | Operational sink: `auto`, `console`, `pretty`, `file` or `null`. `auto` reads a terminal as `pretty`. |
| `KET_LOG_LEVEL` | `info` | Lowest level kept: `debug`, `info`, `warn` or `error`. |
| `KET_LOG_STREAM` | `stderr` | Which stream records go to. stdout carries command output; keep logs off it. |
| `KET_LOG_DIR` | `.ket/log` | Directory for `KET_LOG=file`. |
| `KET_LOG_BUFFER` | `10000` | Records a batching driver may hold before it drops and reports the gap. |

Leave all public-backend variables unset for the existing single-backend behavior. Public S3 variables
require `KET_STORAGE=s3`; public local-directory configuration requires `KET_STORAGE=local`. A public
URL alone cannot expose the private backend. Configure matching backends for serve and worker roles;
the public backend does not provision access policies or a CDN. See
[optional private and public buckets](/ketjs/integrations/#optional-private-and-public-buckets) for
attachment publication, migration, and deletion semantics.

Log variables are validated on boot, so a misspelt driver fails with `E_LOG_CONFIG` rather than at
the first record. See [operational logging](/ketjs/logging/) for the driver contract, the event
catalogue, and what is redacted.

## Programmatic configuration

Use defaults for embedded runtimes or tests without mutating `process.env`:

```ts
// File: ket.workspace.ts
import { readConfig } from '@ketvietlab/ketjs'

const config = readConfig(process.env, {
  host: '0.0.0.0',
  port: 8080,
  migrateOnBoot: false,
  defaultLocale: 'en',
})
```

Environment values override programmatic defaults. Invalid storage kinds and upload limits fail during
configuration, before the runtime opens a database or socket.
