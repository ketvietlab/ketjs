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

Override discovery with `--workspace FILE`. Use `--app NAME` in multi-app workspaces and repeat
`--module-path DIR` to add module roots. `KET_MODULE_PATH` accepts the platform path separator.

Production commands execute emitted JavaScript. Compile `ket.workspace.ts`, modules, routes, jobs, and tests
before invoking them.

## Compose and inspect

| Command | Purpose |
| --- | --- |
| `ket check` | Resolve and compose every app; report contract violations. |
| `ket manifest --app NAME` | Print one composed manifest. |
| `ket workspace` | Show apps, datastores, shared modules, and app-only modules. |
| `ket modules` | Show resolved modules and their source paths. |
| `ket types --app NAME` | Generate `.ket/types.d.ts` from the manifest. |
| `ket agent --app NAME` | Print the machine-readable agent capability descriptor. |
| `ket permissions` | List grantable functions and the data/effect reach of a grant set, module, or stored role. |

Run `ket check` in CI before migrations or deployment. It catches dependency, extension, layout, route,
queue, theme, model, and function-contract conflicts without starting a server.

```bash
ket check --workspace dist/ket.workspace.js
ket workspace --workspace dist/ket.workspace.js
ket permissions --app backoffice --grant order.list,order.create
```

## Compare manifests

Store a reviewed manifest at a release boundary and compare future composition output:

```bash
ket snapshot --app backoffice --workspace dist/ket.workspace.js
ket diff --app backoffice \
  --workspace dist/ket.workspace.js \
  --against .ket/manifest.backoffice.json
```

`ket diff` describes contract changes. Database migration planning remains a separate check because schema
state belongs to a datastore, not to a JSON snapshot.

## Database commands

```bash
ket migrate --app backoffice --workspace dist/ket.workspace.js
ket migrate --app backoffice --allow-destructive
ket migrate --app erp --all --dry-run
```

For one datastore, the command plans against `.ket/schema.<app>.json`, prints SQL, and updates that local
snapshot; it does not prove that an external database was migrated. For tenant databases, `--all` uses the
app's tenant catalogue and applies each plan unless `--dry-run` is set. Destructive changes always require
`--allow-destructive`. See [Migrations and adapters](/ketjs/migrations/).

## Runtime commands

```bash
ket serve --app backoffice --workspace dist/ket.workspace.js
ket worker --app backoffice --workspace dist/ket.workspace.js
ket dev --all --app backoffice --workspace dist/ket.workspace.js
```

`serve` owns HTTP traffic. `worker` consumes durable queues. `dev` watches emitted artifacts and restarts the
selected roles; it does not turn the production process into a TypeScript loader. Use `--no-auto-install`
when new auto-install modules should remain disabled during development.

Operational commands include:

```bash
ket provision bootstrap.admin --input -
ket call order.list --against http://127.0.0.1:3000 --input '{}'
ket test dist/test
ket jobs list --state retryable --queue mail
ket jobs retry JOB_ID
ket jobs cancel JOB_ID
ket jobs prune
```

`ket provision` reads input from standard input so secrets need not appear in shell history. Tenant apps
require `--tenant KEY` for provisioning and job operations.

## Scaffold

```bash
ket new inventory --dir ./inventory
cd inventory
npm install
npm run dev
```

The generated application includes a workspace, module, model, function, TypeScript build, and development
watcher. Read [Quick start](/ketjs/quick-start/) for the file-by-file walkthrough.

## Runtime environment

`readConfig()` reads environment variables once and returns a validated `RuntimeConfig` value.

### Server and database

| Variable | Default | Meaning |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | HTTP bind address. |
| `PORT` | `3000` | HTTP port. `0` selects an ephemeral port. |
| `DATABASE_URL` | unset | Non-SQLite connection value interpreted by the app's `openStore`. |
| `KET_SQLITE` | `.ket/app.db` | SQLite file when no external datastore is configured. |
| `KET_MIGRATE` | enabled | Set to `0` to disable migration on boot. |
| `KET_APPS` | app bootstrap set | Comma-separated modules installed into an empty database. |
| `KET_AUTO_INSTALL` | enabled | Set to `0` to hold back modules declaring `install: 'auto'`. |

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
| `KET_S3_ENDPOINT` | provider default | Optional S3-compatible endpoint. |
| `KET_S3_REGION` | `us-east-1` | S3 signing region. |
| `KET_S3_BUCKET` | unset | S3 bucket name. |
| `KET_S3_KEY` | unset | S3 access-key ID. |
| `KET_S3_SECRET` | unset | S3 secret access key. |
| `KET_S3_PATH_STYLE` | disabled | Set to a non-zero value for path-style requests. |

## Programmatic configuration

Use defaults for embedded runtimes or tests without mutating `process.env`:

```ts
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
