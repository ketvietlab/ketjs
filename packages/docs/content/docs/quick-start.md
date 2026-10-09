---
title: Quick start
description: Scaffold, inspect, and run a minimal KetJS application.
group: Set up KetJS
order: 1
---

This guide creates a headless notes application backed by SQLite. It exercises a real module, model,
function, route, migration, and HTTP call without adding a database server.

:::caution[Preview release]
This guide targets KetJS `0.4.0`, which is preview software. The package workflow below is verified before each release, but APIs and
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

Use an exact version such as `@ketvietlab/ketjs@0.4.0` when the scaffold must be reproducible. App
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
# File: packages/docs/content/docs/quick-start.md
notes/
├── ket.workspace.ts
├── modules/
│   └── notes.ts
├── test/
│   └── deployment.test.ts
├── tools/
│   ├── dev.mjs
│   └── openapi.ts
├── package.json
├── tsconfig.json
├── biome.json
└── .gitignore
```



Generate the OpenAPI contract with `npm run openapi`, or build its reference UI with `npm run api:docs`.
See [Spec](/spec/) for the output directory, hosting and request console.

## The module

`modules/notes.ts` declares its data and callable surface together:

```ts
// File: modules/notes.ts
import { defineModule, from, httpRoutes } from '@ketvietlab/ketjs'

export default defineModule({
  name: 'notes',
  title: 'notes',
  models: {
    Note: {
      scope: 'company',
      fields: { id: 'id', title: 'text', body: 'text?' },
    },
  },
  functions: {
    list: {
      agent: true,
      anonymous: true,
      output: { id: 'id', title: 'text', body: 'text?' },
      returns: 'many',
      effects: ['read:notes.Note'],
      handler: (ctx) => ctx.db.all(from(ctx.table('notes.Note'))),
    },
  },
  routes: httpRoutes(
    { profile: 'notes', prefix: '/api/v1', auth: 'public' },
    { 'GET /notes': { call: 'notes.list', summary: 'List notes.' } },
  ),
})
```

Model and function keys become qualified in the manifest: `notes.Note` and `notes.list`. The
function cannot read another model unless its effects declare that model.

`httpRoutes` publishes the function as `GET /api/v1/notes`, an ordinary HTTP operation whose request and
response are checked against a contract derived from the function. The operation is `public`, and the function
`anonymous`, only because the scaffold has no sign-in yet; once the deployment configures sessions or
`resolveIdentity`, remove both so the operation requires authentication. See
[Function bindings](/ketjs/openapi/#function-bindings).

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

Or the published operation, which answers `{ "data": [...] }`:

```bash
# Run from: /path/to/example-app
curl -H 'X-Ket-Company: demo' http://127.0.0.1:3000/api/v1/notes
```

## Write the OpenAPI document

```bash
# Run from: /path/to/example-app
npm run openapi
```

`tools/openapi.ts` composes the deployment and writes `openapi/notes.json` with
`httpOpenApiDocument()`. The document lists only the operations that actually compose, and the same manifest
always yields the same bytes, so commit it and review its diff. Biome skips the `openapi/` directory for that
reason. Add `servers`, and `securitySchemes` with `security`, in `tools/openapi.ts` once an operation requires
sign-in; the generator refuses a non-public operation without them. See
[Generating OpenAPI](/ketjs/openapi/#generating-openapi).

## Build the API reference

```sh
# Run from: notes/
npm run api:docs
```

The scaffold includes a pinned Spec development tool. This command writes the OpenAPI document, then builds
a static API reference and try-it console in `.ket/api-docs`. Serve that directory with your static host;
the output is ignored by Git. See [Reading the document](/ketjs/openapi/#reading-the-document) for server
addresses and alternative renderers.

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
