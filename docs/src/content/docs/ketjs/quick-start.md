---
title: Quick start
description: Scaffold, inspect, and run a minimal KetJS application.
---

This guide creates a headless notes application backed by SQLite. It exercises a real module, model,
function, route, migration, and HTTP call without adding a database server.

:::caution[Unreleased package]
The repository currently identifies KetJS as `0.0.0`. The commands below describe the intended
package workflow. When working from this monorepo, use its existing workspace install and root
scripts instead of expecting a stable public npm release.
:::

## Requirements

- Node.js 24 or later
- npm bundled with Node.js

## Scaffold an application

Run the `ket` binary from the `ketjs` package:

```bash
npx --package ketjs ket new notes
cd notes
npm install
npm run dev
```

The generated app listens on `http://127.0.0.1:3000`. Its first boot creates `.ket/app.db`, applies
the composed schema, installs the bootstrap module, and serves the workspace's first servable app.

The scaffold contains:

```text
notes/
├── ket.workspace.ts
├── modules/
│   └── notes.ts
├── test/
│   └── app.test.ts
├── tools/
│   └── dev.mjs
├── package.json
└── tsconfig.json
```

## The module

`modules/notes.ts` declares its data and callable surface together:

```ts
import { defineModule, from } from 'ketjs'

export default defineModule({
  name: 'notes',
  app: true,
  title: 'Notes',
  install: 'manual',
  models: {
    Note: {
      scope: 'company',
      fields: {
        id: 'id',
        title: 'text',
        body: 'text?',
      },
    },
  },
  functions: {
    list: {
      agent: true,
      effects: ['read:notes.Note'],
      handler: (ctx) => ctx.db.all(from(ctx.table('notes.Note'))),
    },
  },
})
```

Model and function keys become qualified in the manifest: `notes.Note` and `notes.list`. The
function cannot read another model unless its effects declare that model.

## The workspace

`ket.workspace.ts` makes the module deployable:

```ts
import { defineApp, defineWorkspace, json } from 'ketjs'
import notes from './modules/notes.ts'

export const app = defineApp({
  name: 'notes',
  modules: [notes],
  headless: true,
  serve: {
    bootstrap: ['notes'],
    routes: (ctx) => ({
      '/': async (url, request) => json(await ctx.call('notes.list', {}, url, request)),
    }),
  },
})

export default defineWorkspace({ apps: [app] })
```

`bootstrap` applies only to an empty database. It does not reinstall modules that an operator has
explicitly removed.

## Call the application

Open the route:

```bash
curl -H 'X-Ket-Company: demo' http://127.0.0.1:3000/
```

Or call the function transport directly:

```bash
npx ket call notes.list \
  --against http://127.0.0.1:3000 \
  --company demo
```

Until an application enables sessions, the development identity shim reads company context from
request headers. It is a development convenience, not production authentication.

## Inspect the composed application

Build before using production-style CLI commands:

```bash
npm run build
npx ket check --workspace dist/ket.workspace.js
npx ket manifest --workspace dist/ket.workspace.js
npx ket permissions --workspace dist/ket.workspace.js
```

- `check` composes every app and reports contract violations.
- `manifest` prints the single derived artifact.
- `permissions` inventories callable functions and their data reach.

## Run the test

```bash
npm test
```

The generated test boots the real app on an ephemeral port with an isolated SQLite database. See
[Testing](/ketjs/testing/) for fixtures, sessions, tenants, cookie jars, and worker draining.

## Next steps

1. Model the deployment with [Workspaces and apps](/ketjs/workspaces/).
2. Learn the extension rules in [Modules and manifest](/ketjs/modules/).
3. Add validated writes with [Queries and changesets](/ketjs/data/).
4. Replace the header identity shim using [Sessions and tenants](/ketjs/sessions-tenants/).
