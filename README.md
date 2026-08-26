<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./docs/src/assets/ketsuite-logo-dark.png">
  <source media="(prefers-color-scheme: light)" srcset="./docs/src/assets/ketsuite-logo-light.png">
  <img alt="KetSuite — Extensible Open ERP" src="./docs/src/assets/ketsuite-logo-light.png" width="420">
</picture>

# Ket

A monorepo: **KetJS** the framework, **KetSuite** the application built on it.

Developer documentation: **[ketjs.ketviet.vn](https://ketjs.ketviet.vn/)**.

> [!WARNING]
> **Ket is under active development. The 0.x line is preview software and is not stable.**
> APIs, data formats, CLI behavior, and deployment assumptions may change without
> notice. Do not use Ket for production workloads yet.

## Install and create an application

KetJS requires Node.js 24 or newer. Scaffold a runnable application from the public package:

```bash
npx -y @ketvietlab/ketjs@latest new my_app --dir ./my-app
cd my-app
npm install
npm run dev
```

The application listens on `http://127.0.0.1:3000` and uses SQLite by default. The application
identifier must start with a lowercase letter and contain only lowercase letters, digits, and
underscores; the directory name may use hyphens.

Keep the explicit `@latest` tag: when this command runs inside an older KetJS project, npm may
otherwise reuse that project's locally installed CLI instead of downloading the current scaffold.

Install the framework into an existing project with `npm install @ketvietlab/ketjs`. Optional
packages are `@ketvietlab/ketjs-postgres` for PostgreSQL, `@ketvietlab/ketsuite` for business
modules, and `@ketvietlab/ketjs-view` when consuming the view layer directly. See the
[KetJS quick start](docs/src/content/docs/ketjs/quick-start.md) for the generated layout and next
commands.

To scaffold the complete KetSuite business application instead:

```bash
npx -y @ketvietlab/ketsuite@latest new my_suite
cd my_suite
npm install
npm run dev
```

The generated development server creates `admin` / `admin` only for a blank local database and
prints a security warning. `npm start` never creates this insecure account. See the
[KetSuite quick start](docs/src/content/docs/ketsuite/quick-start.md) for secure provisioning and
configuration.

A fullstack framework for Node with no required third-party runtime dependencies, built on five
pillars:

1. **Lego** — modules compose through extension points the base module *publishes*, not through arbitrary patching
2. **Minimal dependency surface** — the core uses Node built-ins plus the separately published
   `@ketvietlab/ketjs-view` package from this monorepo. PostgreSQL support and its driver live in the
   optional `@ketvietlab/ketjs-postgres` package; SQLite uses Node's built-in driver.
3. **Agent-driven** — the manifest is the agent's map; mutations are dry-runnable and idempotent
4. **Theming-driven** — third-party themes in a restricted language that cannot run code
5. **Fullstack** — the framework owns models, migrations, functions, streams and jobs

Plus an **umbrella layout**: one codebase, many immutable deployments, shared modules.

```bash
npm start                                   # KetSuite on SQLite, at :3000
DATABASE_URL=postgres://… npm start         # …or on Postgres
npm run dev                                 # …restarted on every change
npm run dev -- --all                       # HTTP + worker, still one tsx watcher
npm run build:watch                         # rebuild dist for a linked consumer
npm run design                              # the backend UI catalogue, for designers
npm run verify                              # audit + typecheck + full tests + type proof
npm run test:groups                         # list auto-discovered CI test groups
npm run test:group -- catalog               # build and run one domain group
npm run test:one -- test/e2e.test.ts        # one emitted test file
npm run bench:modules                       # custom module catalogue + selected closure
npm run bench:queue                         # queue across many physical databases
npm run bench:storage                       # S3 storage across tenant databases
```

Production, tests and release commands build first, then run emitted JavaScript.
`npm run dev` is deliberately diskless: `tsx` transforms TypeScript/TSX in memory
after a clean typecheck and watches the dependency graph. Node never receives
untransformed source. A first run composes the declared modules, migrates their
complete schema, and serves. The runtime never installs or removes modules.

`npm run build:watch` is the co-development path for another repository that links
this checkout and consumes package `dist` artifacts. It debounces changes, serializes
builds, and writes the gitignored `.ket-build-watch-ready` marker only after a
successful build so the consumer can safely rebuild against the new declarations.

The production worker is a separate process role of the same deployment artifact:
`ket worker --deployment ketsuite`. Jobs stay in PostgreSQL/SQLite and can be enqueued
through `tx.jobs.enqueue(...)` in the same transaction as business data. PostgreSQL
`LISTEN/NOTIFY` wakes a single-database worker quickly; polling and leases remain the
guarantee, so Redis is not required. Operators can inspect and control durable rows
with `ket jobs list|retry|cancel|prune`. Every producer must declare the exact
`enqueue:module.job` effect; moving a write into a worker does not widen what a
server function is allowed to cause.

Blob bytes use one tenant-namespaced `Storage` contract backed by local disk or an
S3-compatible service; attachment metadata remains in each tenant database. Set
`KET_STORAGE=s3`, `KET_S3_ENDPOINT`, `KET_S3_BUCKET`, `KET_S3_KEY` and
`KET_S3_SECRET` for S3/MinIO. Local storage defaults to `.ket/storage`. Uploads are
streamed through a bounded multipart parser, and cleanup runs on the existing
`maintenance` queue.

## Custom module paths

A workspace may select compiled modules from several filesystem roots without importing every
custom package by hand:

```ts
import { defineDeployment, defineWorkspace } from '@ketvietlab/ketjs'
import { product } from '@ketvietlab/ketsuite'

export default defineWorkspace({
  modulePaths: [new URL('./custom-addons/', import.meta.url), '/opt/vendor-addons'],
  deployments: [
    defineDeployment({
      name: 'shop',
      modules: [product, 'sale_discount'],
      headless: true,
    }),
  ],
})
```

Each direct child of a root is a module directory with a small discovery file:

```text
custom-addons/sale_discount/
├── ket.module.json       { "name": "sale_discount", "entry": "./dist/index.js" }
├── dist/index.js         default-exports defineModule(...)
└── assets/
```

Only selected names and their dependency closure are executed; merely dropping a
module into a root does not add it to the deployment. Roots never shadow one
another silently, descriptor identity must match the exported module, and an entry
may not escape its module directory. Production accepts JavaScript artifacts only;
the `tsx` development path additionally permits TypeScript source entries.

`--module-path DIR` supplements the workspace and is repeatable.
`KET_MODULE_PATH` uses the platform path separator. Run `ket modules` to see every
resolved module, the deployments that ship it and its concrete source path.

The full packaging, resolution, deployment and error contract is documented in
[Module discovery](docs/src/content/docs/ketjs/module-discovery.md).

## Headless end-to-end tests

`@ketvietlab/ketjs/testing` boots the real deployment on an ephemeral port with an isolated SQLite
database and storage directory. `TestClient` crosses HTTP, retains login cookies,
models company/tenant identity and can drain the app's durable worker without ever
opening a browser. Fixture calls are named separately so test setup cannot be
mistaken for the public action being exercised.

```ts
const e2e = await createTestDeployment(app)
try {
  await e2e.fixture.call('catalog.seed', fixture)
  const result = await e2e.client.call('catalog.list', {})
  assert.equal(result.value.length, 1)
} finally {
  await e2e.close()
}
```

Use `ket call FUNCTION --against http://localhost:3000` for a manual smoke call,
and `ket test dist/test --watch` to run emitted headless tests. Full API, isolation,
authentication, multi-tenant and worker examples are in
[the headless E2E guide](docs/src/content/docs/ketjs/testing.md).

Deployments may either configure session authentication with `resolveSession` or use the
development-only `X-Ket-Company` fallback. KetSuite configures cookie-backed user sessions and
permission resolution; the header fallback applies only to deployments that do not enable sessions.

## The one artifact

Everything reads from a single composed **manifest**: the module contract, the
database schema, the theme contract and the agent capability descriptor are the
same file. There is no second source of truth to drift.

```ts
defineModule({
  name: 'inventory',
  depends: ['catalog'],
  extend: { 'catalog.Product': { leadTimeDays: 'int?' } },      // typed, cross-module
  fills:  { 'catalog:product.detail.footer': '{{ product.leadTimeDays }}' },
})
```

`inventory` never imports anything from `catalog`. It adds a field to a model it
does not own, and fills an extension point `catalog` published on purpose. A fill
aimed at an unpublished joint is a **build error**, not a blank spot — that is the
line between declared composition and arbitrary patching, where upstream changes cannot be checked
safely.

## Reference benchmark snapshot

These are development-machine snapshots, not capacity claims or guarantees. Full dated methodology
and caveats are in [the benchmark guide](docs/src/content/docs/operations/benchmarks.md); rerun the benchmark commands on
the revision and hardware you care about.

| | KetJS | best competitor |
|---|---|---|
| template renders/s | **10 652** | EJS 10 311 · LiquidJS 824 |
| DOM: update 1 row of 1 000 | **0.070 ms** | lit-html 0.100 ms |
| DOM: create 1 000 rows | **1.80 ms** | lit-html 2.60 ms |
| DOM: reorder rows | 0.100 ms | lit-html 0.092 ms |
| hydrate a 495-node page | **0.025 ms** (islands, 9 nodes) | 0.660 ms (whole tree) |
| queue, 8 PostgreSQL databases | **377 jobs/s** (400 jobs, pool 8) | every tenant completed |

## What is actually proven

| Claim | Evidence |
|---|---|
| Cross-module field extension is *typed* | `npm run type-proof` — 7/7 assertions checked by tsc |
| Updating 1 row of 1000 is surgical | `npm run bench` — **1** host operation |
| Re-render with no change | **0** operations |
| Swap 2 rows of 1000 | **2** moves (LIS reconciliation, no cascade) |
| A theme cannot run code | no `eval`/`new Function` anywhere; prototype access rejected at parse time |
| A stream survives a reload | resumes from cursor, no gap and no duplicate |
| An agent cannot double-apply | idempotency key replays the first result, and survives a restart |
| A transaction is really one transaction | BEGIN and body share a reserved connection |
| Deployment composition is immutable at runtime | one declared module list drives schema, HTTP, workers, permissions, and rendering |
| A theme cannot write behaviour | `defineTheme` refuses `islands`; placing one nobody provides is a build error |
| Only islands hydrate | the rest of the page stays inert markup |
| Hydration adopts server DOM | 20 rows hydrated in a real browser: **0** nodes created, same node objects |
| A tenant cannot see another tenant | resolution happens once, in ctx; unresolvable requests get `E_UNKNOWN_TENANT` |
| A query is checked before it runs | `q.touches` vs declared effects — a query reading an undeclared model is blocked |
| Mass assignment is not possible | `cast()` is an allow-list; uncast fields are dropped |
| A function cannot touch undeclared data | `E_EFFECT_NOT_DECLARED` |
| No undeclared third-party runtime dependency | `npm run audit:zero-dep` audits imports and package boundaries; only `@ketvietlab/ketjs-postgres` may import the allowlisted database driver |
| A committed job is not lost | PostgreSQL transaction/notify, concurrent unique enqueue, lease rescue and multi-database fairness are exercised live |
| S3 compatibility is real | upload, HEAD, streamed GET, listing, presigned GET and delete run against MinIO in CI |

## Layout

```
packages/
  ketjs-view/      signals, surgical DOM, SSR, hydration, islands — browser-safe, 0 deps
  ketjs/           kernel, data, server, theme, agent, codegen — depends only on ketjs-view
  ketjs-postgres/  the one package permitted a driver, and the reason it is a package
  ketsuite/        KetSuite — business modules, using only the public entry
examples/          umbrella deployments composed from the packages
tools/  test/  bench/  docs/
```

The split is not decoration. `@ketvietlab/ketjs` cannot import a database driver because no such
dependency exists in its package; `@ketvietlab/ketsuite` cannot reach past the public entry
because the audit rejects it. What used to be rules about which file may import what
are now facts about which package declares what.

## Static typing

TypeScript and TSX are authored formats, never runtime inputs. `npm run build`
emits workspace JavaScript into `.build` and publishable package artifacts into
each package's `dist`; declarations are emitted separately. Production, tests and
publishing run only those artifacts. `npm run dev` instead uses `tsx watch` to
transform modules in memory and runs `tsc --noEmit --watch` beside it, so editing
never writes or deletes `.build`/`dist`. The custom JSX runtime still produces
Ket's existing hole-based templates, with no React, VDOM, or required runtime
dependency.

Biome is the repository-wide formatter and linter. `npm run format` normalises all
supported source/config files; `npm run verify` refuses unformatted or lint-invalid
changes before building and testing.

See [the architecture decisions](docs/src/content/docs/architecture/decisions.md) for the reasoning behind each choice.

## License

KetJS is released under the [MIT License](LICENSE).

Copyright © 2026 KETVIET JSC, Vietnam.
