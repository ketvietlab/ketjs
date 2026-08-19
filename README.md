# Ket

A zero-dependency fullstack framework for Node, built on five pillars:

1. **Lego** — modules compose through extension points the base module *publishes*, not through arbitrary patching
2. **Zero dependencies** — 0 *required* runtime deps; `node` and nothing else. One fenced exception: the Postgres driver is an optional dependency (see [D4a](docs/00-decisions.md)). SQLite, the default adapter, needs nothing.
3. **Agent-driven** — the manifest is the agent's map; mutations are dry-runnable and idempotent
4. **Theming-driven** — third-party themes in a restricted language that cannot run code
5. **Fullstack** — the framework owns models, migrations, functions, streams and jobs

Plus an **umbrella layout**: one codebase, many deployable apps, shared modules.

```bash
node --version   # >= 24, developed on 26.7.0
node src/cli.ts check
node --test test/
```

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
| A query is checked before it runs | `q.touches` vs declared effects — a query reading an undeclared model is blocked |
| Mass assignment is not possible | `cast()` is an allow-list; uncast fields are dropped |
| A function cannot touch undeclared data | `E_EFFECT_NOT_DECLARED` |
| Zero required dependencies | `node tools/zero-dep-audit.ts` — enforces that only `src/data/postgres.ts` may import the one allowlisted driver |

## Layout

```
src/kernel      define, compose, contracts, upgrade diff, umbrella workspace
src/data        model -> schema -> reviewable migrations; query values, changesets, sqlite + postgres adapters
src/server      server functions, effects, dry-run, resumable streams, jobs, http
src/view        signals + surgical DOM (app code)
src/theme       KTL restricted language, view-model drops, tokens (third-party themes)
src/agent       capability descriptors and the safe write surface
src/codegen     manifest -> .d.ts
```

## Static typing

Node **runs** TypeScript but does **not** check it — it is a type stripper.
Ket therefore keeps `typescript` and `@types/node` as the only devDependencies,
used by `tsc --noEmit` and never loaded at runtime. `erasableSyntaxOnly` is on so
every source file stays runnable by Node with no build step.

See [docs/00-decisions.md](docs/00-decisions.md) for the reasoning behind each choice.
