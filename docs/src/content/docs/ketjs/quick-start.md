---
title: Quick start
description: Scaffold, inspect, and run a minimal KetJS application.
---

This guide creates a headless notes application backed by SQLite. It exercises a real module, model,
function, route, migration, and HTTP call without adding a database server.

:::caution[Preview release]
KetJS `0.1.x` is preview software. The package workflow below is verified before each release, but APIs and
deployment contracts may still change before 1.0.
:::

## Requirements

- Node.js 24 or later
- npm bundled with Node.js

## Scaffold an application

Run the `ket` binary from the `@ketvietlab/ketjs` package:

```bash
npx -y @ketvietlab/ketjs@latest new notes
cd notes
npm install
npm run dev
```

Use an exact version such as `@ketvietlab/ketjs@0.1.2` when the scaffold must be reproducible. App
names accept lowercase letters, digits, and underscores and must start with a letter. To separate
the app identifier from its directory name:

```bash
npx -y @ketvietlab/ketjs@latest new my_app --dir ./my-app
```

Keep `@latest` even though npm normally defaults to the latest tag. When invoked inside an existing
KetJS project, `npx` can reuse that project's locally installed older CLI when no tag is present.

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
├── tsconfig.json
├── biome.json
└── .gitignore
```

:::note[Projects generated with 0.1.1]
The `0.1.1` scaffold wrote the old unscoped CLI path into `tools/dev.mjs`. Upgrade the dependency to
`@ketvietlab/ketjs@^0.1.2` and replace `node_modules/ketjs/dist/cli.js` with
`node_modules/@ketvietlab/ketjs/dist/cli.js`, or scaffold the project again with the current release.
:::

## The module

`modules/notes.ts` declares its data and callable surface together:

```ts
import { defineModule, from } from '@ketvietlab/ketjs'

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
import { defineApp, defineWorkspace, json } from '@ketvietlab/ketjs'
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
