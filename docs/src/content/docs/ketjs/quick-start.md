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
# Run from: /path/to/projects
npx -y @ketvietlab/ketjs@latest new notes
cd notes
npm install
npm run dev
```

Use an exact version such as `@ketvietlab/ketjs@0.1.3` when the scaffold must be reproducible. App
names accept lowercase letters, digits, and underscores and must start with a letter. To separate
the app identifier from its directory name:

```bash
# Run from: /path/to/projects
npx -y @ketvietlab/ketjs@latest new my_app --dir ./my-app
```

Keep `@latest` even though npm normally defaults to the latest tag. When invoked inside an existing
KetJS project, `npx` can reuse that project's locally installed older CLI when no tag is present.

The generated deployment listens on `http://127.0.0.1:3000`. Its first boot creates
`.ket/deployment.db`, applies the composed schema, and serves the workspace's first deployment.

The scaffold contains:

```text
# File: docs/src/content/docs/ketjs/quick-start.md
notes/
├── ket.workspace.ts
├── modules/
│   └── notes.ts
├── test/
│   └── deployment.test.ts
├── tools/
│   └── dev.mjs
├── package.json
├── tsconfig.json
├── biome.json
└── .gitignore
```

:::note[Projects generated with 0.1.1]
The `0.1.1` scaffold wrote the old unscoped CLI path into `tools/dev.mjs`. Upgrade the dependency to
`@ketvietlab/ketjs@^0.1.3` and replace `node_modules/ketjs/dist/cli.js` with
`node_modules/@ketvietlab/ketjs/dist/cli.js`, or scaffold the project again with the current release.
:::

## The module

`modules/notes.ts` declares its data and callable surface together:

```ts
// File: src/modules/notes/index.ts
import { defineModule, from } from '@ketvietlab/ketjs'

export default defineModule({
  name: 'notes',
  title: 'Notes',
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
// File: ket.workspace.ts
import { defineDeployment, defineWorkspace, json } from '@ketvietlab/ketjs'
import notes from './modules/notes.ts'

export const deployment = defineDeployment({
  name: 'notes',
  modules: [notes],
  headless: true,
  serve: {
    routes: (ctx) => ({
      '/': async (url, request) => json(await ctx.call('notes.list', {}, url, request)),
    }),
  },
})

export default defineWorkspace({ deployments: [deployment] })
```

The module appears once, in `modules`. KetJS composes it, migrates its schema, and runs its behavior.

## Call the application

Open the route:

```bash
# Run from: /path/to/ketjs
curl -H 'X-Ket-Company: demo' http://127.0.0.1:3000/
```

Or call the function transport directly:

```bash
# Run from: /path/to/example-app
npx ket call notes.list \
  --against http://127.0.0.1:3000 \
  --company demo
```

Until an application enables sessions, the development identity shim reads company context from
request headers. It is a development convenience, not production authentication.

## Inspect the composed application

Build before using production-style CLI commands:

```bash
# Run from: /path/to/example-app
npm run build
npx ket check --workspace dist/ket.workspace.js
npx ket manifest --workspace dist/ket.workspace.js
npx ket permissions --workspace dist/ket.workspace.js
```

- `check` composes every deployment and reports contract violations.
- `manifest` prints the single derived artifact.
- `permissions` inventories callable functions and their data reach.

## Run the test

```bash
# Run from: /path/to/ketjs
npm test
```

The generated test boots the real deployment on an ephemeral port with an isolated SQLite database. See
[Testing](/ketjs/testing/) for fixtures, sessions, tenants, cookie jars, and worker draining.

## Next steps

1. Model the deployment with [Workspaces and deployments](/ketjs/workspaces/).
2. Learn the extension rules in [Modules and manifest](/ketjs/modules/).
3. Add validated writes with [Queries and changesets](/ketjs/data/).
4. Replace the header identity shim using [Sessions and tenants](/ketjs/sessions-tenants/).
