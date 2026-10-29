# Mirror comparison: render counts and response cost

This benchmark measures `@ketvietlab/ketjs-view/mirror` against hand-written readers and TanStack
Query core, which is driven through a minimal signal adapter. It counts work in Node with `countingHost`.
It does not time a browser DOM.

```bash
# Run from: bench/mirror-comparison
npm install
node run.ts                        # render counts, 1000 rows, 7 runs per cell
ROWS=10000 REPEAT=5 node run.ts    # render counts, 10000 rows
node cost.ts                       # synchronous cost of applying one response
```

The scripts import `packages/ketjs-view/src` directly and rely on Node's TypeScript type stripping
(Node 24 or newer), so no workspace build is needed. The directory is excluded from the workspace type
check because TanStack Query is installed only here. Raw outputs are in `results/`; they were recorded on
an Apple M1 Pro with Node 26.7.0.

## What is measured

`run.ts` mounts a list view and runs seven scenarios against each variant. The view has a header with a
`Refreshing` flag, then one `<li>` per row. Every response is a fresh `JSON.parse`, as over HTTP.

| Column | Meaning |
| --- | --- |
| views | Runs of every mounted view effect |
| lists | Runs of the effect that renders the list |
| rows | Row templates built (memo hits are not counted) |
| dom ops | `countingHost` operations: create, insert, remove, setText, setAttribute, move |
| fetches | Requests the fake API received |
| correct | The rendered rows match the latest request |

The variants are:

- **naive:** separate signals, no batch, no abort.
- **careful:** the abort, guard and batch pattern from `view-effects-data.md`.
- **mirror:** the Mirror API; **mirror, no sharing** switches structural sharing off.
- **tanstack:** `QueryObserver` writing signals inside `batch`.
- **memo:** row templates cached by item identity.
- **split:** the header and the list are separate `mount()` effects.

Counts are deterministic across runs. The `cpu ms` column of `run.ts` includes timers and GC and is
noisy; use `cost.ts` for timing.

## Results (1000 rows unless stated)

| Scenario | naive | careful | mirror | tanstack | mirror + memo + split |
| --- | --- | --- | --- | --- | --- |
| Initial load: views / rows | 3 / 2000 | 2 / 1000 | 2 / 1000 | 2 / 1000 | 4 / 1000 (2 list runs) |
| 10 refetches, unchanged: list runs / rows | 30 / 30000 | 20 / 20000 | 20 / 20000 | 20 / 20000 | **0 / 0** |
| 1 row changed: rows | 3000 | 2000 | 2000 | 2000 | **1** |
| Optimistic rename 1 row: rows | 3000 | 3000 | 3000 | 3000 | **1** |
| Two views, same key: fetches | 2 | 2 | **1** | **1** | **1** |
| Race, older response last: correct | **no** | yes | yes | yes | yes |

In the race, Mirror runs the view three times rather than two. While the new key loads it shows the
cached answer of the key it returns to, and reports `loading` honestly instead of `ready`.

Within each scenario, every correct variant performs the same DOM operations, give or take a handful:

- split variants mount no `<section>` wrapper (4 fewer);
- the second TanStack observer starts with `isFetching` already true (1 fewer text write).

The keyed renderer already writes only what changed.

`cost.ts` times one response applied synchronously: `JSON.parse`, optional sharing, a signal write and
the render it triggers (median ms). `JSON.parse` alone takes 1.28 ms for 10000 rows.

| 10000 rows | replace, plain | mirror share, plain | mirror share, memo | TanStack `replaceEqualDeep`, memo |
| --- | --- | --- | --- | --- |
| Nothing changed | 2.91 | 2.32 | 2.33 | 3.21 |
| 1 row changed | 2.80 | 4.28 | 3.70 | 4.63 |
| Every row changed | 3.18 | 4.89 | 6.41 | 6.32 |

At 1000 rows every cell is between 0.18 and 0.48 ms.

## Findings

1. Correctness and request count are where a cache earns its place:
   - the naive pattern renders the older response in the race;
   - two views of one key fetch twice without a shared entry;
   - optimistic writes need a rollback path;
   - returning to a cached filter shows it at once and revalidates in the background.
2. ketjs-view re-renders cheaply. Re-running the unchanged 10000-row list costs about 1.6 ms on top of
   `JSON.parse`. `each()` calls the row renderer for every item on every run, but the per-value
   `Object.is` check makes that cheap.
3. Structural sharing removes renders but saves little CPU.
   - When nothing changed, comparing costs about 1 ms instead of the render it replaces, and the list
     effect does not run.
   - When rows do change, sharing adds about 1 to 1.7 ms per 10000-row response.
   - Its lasting value is stable identity. Mirror's sharing is faster than `replaceEqualDeep` in most
     cells.
4. Row memo by identity only pays off together with sharing. Without sharing it adds `WeakMap` churn
   and a worse p90.
5. Splitting a frequently toggled flag (`fetching`) into its own effect keeps the list effect from
   running at all.

## Not measured

- Browser DOM, layout and paint.
- Memory and GC over a long session.
- Bundle size.
- An official TanStack adapter.
