# KetJS

KetJS is a module-composable, SSR-first full-stack framework for Node.js. It provides models,
migrations, typed functions, jobs, themes, fragment navigation, and persistent islands without a
required application-server dependency.

> KetJS 0.x is preview software. APIs and deployment contracts may change before 1.0.

## Requirements

- Node.js 24 or newer
- npm

## Create an application

```bash
# Run from: /path/to/projects
npx -y @ketvietlab/ketjs@latest new notes
cd notes
npm install
npm run dev
```

The generated project uses SQLite by default, contains a real module and integration test, and runs
at `http://127.0.0.1:3000`.

Application names use lowercase letters, digits, and underscores and must start with a letter. Use
`--dir ./my-app` when the filesystem directory should have a different name.

Keep `@latest` when scaffolding inside another project so npm does not reuse an older locally
installed KetJS CLI. Use an exact tag such as `@0.1.3` for reproducible generation.

## Install in an existing project

```bash
# Run from: notes
npm install @ketvietlab/ketjs
```

```ts
// File: notes/ket.workspace.ts
import { defineDeployment, defineModule, defineWorkspace } from '@ketvietlab/ketjs'
```

## Generate API contracts

`ket openapi --deployment NAME --out openapi/NAME.json` generates an OpenAPI 3.1 document from the compiled
workspace without starting a server or database. Use `--profile` when the contract profile differs from the
deployment name and `--options FILE` for JSON metadata and security definitions. See the
[HTTP contracts and OpenAPI guide](https://ketjs.dev/ketjs/openapi/#generating-openapi) for protected operations.

Documentation and source: [github.com/ketvietlab/ketjs](https://github.com/ketvietlab/ketjs)

## Transactional form actions

`defineFormAction(contract, { effects, handler })` declares an ordinary permission- and scope-checked
function. It validates shared nested values, requires an idempotency key, and commits database writes
and the accepted receipt in one transaction. Returned invalid/conflict outcomes unwind earlier writes.
The domain handler must check and advance the aggregate revision using the supplied transaction
context; all writers must participate. External effects need staging or an outbox.

`transactional: true` is the underlying opt-in function contract and requires `idempotent: true` and a
real execution with a key. Existing functions keep their execution semantics. Read the
[form contract guide](../docs/content/docs/form-validation.md) for client sessions, keyed rows, retries,
native routes, and a complete revision-guarded save example.
