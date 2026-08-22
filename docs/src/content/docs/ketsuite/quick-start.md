---
title: Local development
description: Run, inspect, and test KetSuite from the monorepo or a standalone extension workspace.
---

KetSuite requires Node.js 24 or newer and ESM. Suite modules use the same public KetJS and KetJS View
package boundaries available to third-party modules.

## Work in the monorepo

Clone the repository, switch to the development branch, and install the locked dependencies:

```bash
# Run from: /path/to/ketjs
git clone https://github.com/ketvietlab/ketjs.git
cd ketjs
git switch develop
npm ci
npm run build
```

Start the composed repository application with file watching:

```bash
# Run from: /path/to/ketjs
npm run dev
```

The workspace entry is `ket.workspace.ts`; it exports the KetSuite app used by the CLI. Development
serves on `127.0.0.1:3000` unless `HOST` or `PORT` overrides it. The packaged SQLite default is
`.ket/ketsuite.db`.

Run a focused test after the first build:

```bash
# Run from: /path/to/ketjs
npm run test:one -- test/partner-e2e.test.ts
```

See [Testing KetSuite](/ketsuite/testing/) before running the full verification suite.

## Inspect the packaged application

The public app entry exposes the same composition used by the KetSuite CLI:

```ts
// File: ket.workspace.ts
import { createKetsuiteApp, ketsuite } from '@ketvietlab/ketsuite/app'
```

Use `ketsuite` when the packaged SQLite policy is correct. Use `createKetsuiteApp(openStore)` when a
deployment supplies another KetJS datastore while retaining KetSuite's module graph, bootstrap policy,
sessions, queues, and pages.

## Create an extension workspace

To test KetSuite as a package consumer rather than modify the monorepo, scaffold a standalone app:

```bash
# Run from: /path/to/projects
npx -y @ketvietlab/ketsuite@latest new my_suite
cd my_suite
npm install
npm run dev
```

The generated workspace re-exports `@ketvietlab/ketsuite/app`; it deliberately does not copy the module
list. Add private modules by creating your own app composition instead of editing generated package code.

For local-only inspection, open `http://127.0.0.1:3000/admin/login` and sign in with `admin` / `admin`.

The generated `dev` script explicitly runs `ketsuite serve --dev-admin`. On an empty SQLite database,
this creates the development company and the `admin` superuser. Repeated starts are idempotent. The
password is intentionally insecure: keep the server on its default loopback host, do not share the
database, and never expose this development credential to another machine.

## Provisioning behavior under test

`npm start` runs `ketsuite serve` and never creates `admin` / `admin`. To initialize a blank database
with a strong credential, pipe the provisioning payload through standard input so the password does
not appear in the process list:

```bash
# Run from: /path/to/ketjs
npm run provision <<'JSON'
{
  "companyName": "Example Company",
  "companyCode": "EXAMPLE",
  "currency": "VND",
  "adminLogin": "admin@example.com",
  "adminName": "Administrator",
  "adminEmail": "admin@example.com",
  "adminPassword": "replace-with-a-strong-password"
}
JSON
```

Provisioning succeeds only while both the company and user tables are empty. The normal password policy
still applies; the short `admin` password is accepted only through the explicit local development
bootstrap path. This distinction matters in CLI and deployment tests: `--dev-admin` is an explicit
development capability, not a fallback when production provisioning fails.

## Common commands

| Command | Developer use |
| --- | --- |
| `npm run build` | Emit `.build/`, package `dist/`, declarations, and non-code assets. |
| `npm run dev` | Watch source and serve the repository workspace. |
| `npm run check` | Type-check the authored workspace. |
| `npm run test:one -- test/name.test.ts` | Run targeted emitted tests after a build. |
| `npm run verify` | Run formatting, lint, audits, build, type checks, and all tests before handoff. |
| `npm run bench:<area>` | Run a named business benchmark after correctness tests pass. |

Read [Application architecture](/ketsuite/architecture/) next; then use
[Module development](/ketsuite/module-development/) before adding code to the app composition.
