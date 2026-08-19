# Ket

A monorepo: **KetJS** the framework, **KetSuite** the application built on it.

A zero-dependency fullstack framework for Node, built on five pillars:

1. **Lego** — modules compose through extension points the base module *publishes*, not through arbitrary patching
2. **Zero dependencies** — 0 *required* runtime deps; `node` and nothing else. One fenced exception: the Postgres driver is an optional dependency (see [D4a](docs/00-decisions.md)). SQLite, the default adapter, needs nothing.
3. **Agent-driven** — the manifest is the agent's map; mutations are dry-runnable and idempotent
4. **Theming-driven** — third-party themes in a restricted language that cannot run code
5. **Fullstack** — the framework owns models, migrations, functions, streams and jobs

Plus an **umbrella layout**: one codebase, many deployable apps, shared modules.

```bash
npm start                                   # KetSuite on SQLite, at :3000
DATABASE_URL=postgres://… npm start         # …or on Postgres
npm run design                              # the backend UI catalogue, for designers
npm run verify                              # audit + typecheck + tests + type proof
```

A first run migrates, installs a starter set of apps, and serves. Configuration is
in `apps/ketsuite/config.ts` — every knob has a default that works.

**No authentication yet.** The company a request acts as comes from the
`X-Ket-Company` header. Fine for development, not for production; the resolver is
deliberately one function so replacing it with a session is a single change.

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
line between this and Odoo/WordPress, where anything can be patched and therefore
nothing can be safely changed.

## Measured against the competition

Full methodology in [docs/03-benchmarks.md](docs/03-benchmarks.md). Three of these
found bugs in Ket, which is the point of running them.

| | KetJS | best competitor |
|---|---|---|
| `npm i` footprint | **1 package, 0.4 MB** | SvelteKit — 53 packages, 28 MB |
| template renders/s | **10 652** | EJS 10 311 · LiquidJS 824 |
| DOM: update 1 row of 1 000 | **0.070 ms** | lit-html 0.100 ms |
| DOM: create 1 000 rows | **1.80 ms** | lit-html 2.60 ms |
| DOM: reorder rows | 0.100 ms | lit-html 0.092 ms |
| hydrate a 495-node page | **0.025 ms** (islands, 9 nodes) | 0.660 ms (whole tree) |

## What is actually proven

| Claim | Evidence |
|---|---|
| Cross-module field extension is *typed* | `node tools/type-proof.ts` — 7/7 assertions checked by tsc |
| Updating 1 row of 1000 is surgical | `node bench/view.bench.ts` — **1** host operation |
| Re-render with no change | **0** operations |
| Swap 2 rows of 1000 | **2** moves (LIS reconciliation, no cascade) |
| A theme cannot run code | no `eval`/`new Function` anywhere; prototype access rejected at parse time |
| A stream survives a reload | resumes from cursor, no gap and no duplicate |
| An agent cannot double-apply | idempotency key replays the first result, and survives a restart |
| A transaction is really one transaction | BEGIN and body share a reserved connection |
| Uninstalling an app loses no data | table list is identical before and after; rows are where they were on re-install |
| A theme cannot write behaviour | `defineTheme` refuses `islands`; placing one nobody provides is a build error |
| Only islands hydrate | the rest of the page stays inert markup |
| Hydration adopts server DOM | 20 rows hydrated in a real browser: **0** nodes created, same node objects |
| A tenant cannot see another tenant | resolution happens once, in ctx; unresolvable requests get `E_UNKNOWN_TENANT` |
| A query is checked before it runs | `q.touches` vs declared effects — a query reading an undeclared model is blocked |
| Mass assignment is not possible | `cast()` is an allow-list; uncast fields are dropped |
| A function cannot touch undeclared data | `E_EFFECT_NOT_DECLARED` |
| Zero required dependencies | `node tools/zero-dep-audit.ts` — enforces that only `src/data/postgres.ts` may import the one allowlisted driver |

## Layout

```
packages/
  ketjs-view/      signals, surgical DOM, SSR, hydration, islands — browser-safe, 0 deps
  ketjs/           kernel, data, server, theme, agent, codegen — depends only on ketjs-view
  ketjs-postgres/  the one package permitted a driver, and the reason it is a package
  ketsuite/        KetSuite — business modules, using only the public entry
examples/          umbrella apps composed from the packages
tools/  test/  bench/  docs/
```

The split is not decoration. `ketjs` cannot import a database driver because no such
dependency exists in its package; `ketsuite` cannot reach past the public entry
because the audit rejects it. What used to be rules about which file may import what
are now facts about which package declares what.

## Static typing

Node **runs** TypeScript but does **not** check it — it is a type stripper.
Ket therefore keeps `typescript` and `@types/node` as the only devDependencies,
used by `tsc --noEmit` and never loaded at runtime. `erasableSyntaxOnly` is on so
every source file stays runnable by Node with no build step.

See [docs/00-decisions.md](docs/00-decisions.md) for the reasoning behind each choice.
