# Benchmarks

Numbers measured on 2026-08-19, Node 26.7.0, Apple Silicon. Every one of these was
run against the real competitor, not against a description of it. Three of them
found bugs in Ket, which is the main reason to run them at all.

## Install footprint

`npm i <framework>` into an empty project, counting what actually lands on disk.

| | packages | disk | install |
|---|---|---|---|
| **ketjs** | **1** | **0.4 MB** | <1s |
| @sveltejs/kit + svelte + vite | 53 | 28 MB | 2s |
| astro | 209 | 141 MB | 6s |
| nuxt | 528 | 211 MB | 12s |
| next + react + react-dom | 26 | 318 MB | 4s |

**This benchmark found a bug.** The first attempt measured 2 packages for ketjs:
npm installs `optionalDependencies` by default and only skips them when
installation *fails*. The Postgres driver was being shipped to everyone. Fixed by
moving it to an optional **peer** dependency, which npm does not auto-install.

## Template rendering — the theming pillar

50 products, 20 000 renders, templates pre-compiled, **the same money-filter
implementation registered in all three engines**, and output verified byte-identical
before timing.

| | renders/s | |
|---|---|---|
| **KetJS (KTL)** | **10 652** | sandboxed, no `eval` |
| EJS | 10 311 | compiles via `new Function` |
| LiquidJS (Shopify) | 824 | 12.9× slower |

Matching EJS matters more than beating Liquid: EJS compiles templates to native
JavaScript, which Ket deliberately cannot do, and the closure-tree interpreter
still keeps up.

**This benchmark found a bug.** The first run had Ket at 1 489 renders/s, *slower
than Liquid*. Isolating each construct showed the loop and the interpreter were
fine (13–38 ms) while a template using `| money` cost 4 521 ms: the filter
constructed a new `Intl.NumberFormat` on every interpolation. Cached, it dropped to
137 ms. The first comparison was also unfair — the Liquid template had no filter at
all — which is why the table above pins the filter implementation for everyone.

## Query building

Same query (two conditions, order, limit), SQL text and parameters generated
200 000 times.

| | queries/s |
|---|---|
| **KetJS** | **598 582** |
| Knex | 411 966 |
| Drizzle | 21 586 |

**Read this one narrowly.** It measures string generation only. All three are far
faster than any database round trip, so the honest conclusion is "the builder is
not a bottleneck", not "Ket is 27× faster at queries".

## DOM updates — real browser, real DOM

1 000 rows, median of 15 runs, 50 operations per timed sample to clear the clock's
resolution. Both libraries' rendered HTML compared and confirmed identical.
lit-html is the fair comparison: same architecture, same no-build-step constraint.

| | KetJS | lit-html 3.3.3 | |
|---|---|---|---|
| create 1 000 rows | **1.80 ms** | 2.60 ms | Ket 1.45× |
| update 1 row of 1 000 | **0.070 ms** | 0.100 ms | Ket 1.43× |
| re-render, nothing changed | **0.060 ms** | 0.090 ms | Ket 1.50× |
| swap 2 rows | 0.100 ms | **0.092 ms** | lit 1.09× |
| remove + re-add a row | 0.122 ms | **0.096 ms** | lit 1.27× |

Reordering used to cost 0.220 ms — 2.3× lit — because the path rebuilt a Map of
previous positions and a Set of wanted keys on every reorder of every list, to
answer questions the pass already had the answers to. Position now rides on the
instance, the removal scan runs only when the reused count says something actually
disappeared, and the LIS returns a typed array instead of a hash. 0.220 → 0.100 ms.
The remaining gap is small enough that closing it further would be chasing.

**This benchmark found two bugs**, neither visible from the op-counting harness:

1. There was **no real-DOM host at all** — the renderer had only ever run against
   the counting mock. Writing one also exposed `nextSibling()` walking a mock-only
   children array.
2. Keyed reconciliation was **O(n²)**: an `indexOf` inside a `map` over the same
   array, a million comparisons per render of a thousand rows. The op counter could
   never have seen it, because it counts DOM operations and this cost none.
   An unchanged re-render was costing 0.55 ms; it now costs 0.060 ms.

## Islands — what they actually buy

A realistic product page: 120 spec rows, 40 related items, and three small
interactive widgets. 495 elements, of which 9 are interactive. Median of 15 runs,
20 hydrations per timed sample. Both variants render the same content; only the
hydration strategy differs.

| | hydration | nodes walked |
|---|---|---|
| **islands** | **0.025 ms** | **9 of 495 — 1.8%** |
| whole tree | 0.660 ms | 493 of 493 — 100% |

26× faster, for a payload cost of **208 bytes** — the serialised props the client
needs to revive each island with exactly the input the server used.

**Read the ratio honestly.** It is the static-to-interactive ratio of the page and
nothing else. This page is 98% inert, so islands win by roughly that much; a page
that is mostly interactive gains nothing at all, and would be simpler hydrated
whole. The measurement says islands are worth having for content-shaped pages, not
that they are always right.

**This benchmark found a bug too**, and a classic one: an HTML parser does not hand
back the markup it was given. `<table><tr>` comes back as `<table><tbody><tr>`, so a
template that omitted the tbody walked into a node it never wrote. The fix is to
write the element — but the error now says so, naming the tag the parser inserted,
instead of leaving the author to work it out from "expected <tr>, found <tbody>".

## What the op counter is still good for

`bench/view.bench.ts` counts host operations rather than time, and those numbers
are unchanged: 1 operation to update one row of a thousand, 0 for an unchanged
re-render, 2 moves for a swap. It proves the algorithm touches the right nodes.
It cannot prove the work *around* those touches is cheap — which is exactly the
gap the browser benchmark closed.

## Not measured

- SSR throughput against Next/Nuxt/Astro end-to-end. Ket has no client bundler, so
  a whole-framework comparison would not be like-for-like yet.
- Cold start and build time, for the same reason.
- Postgres throughput under load. The adapter is correct against a live server
  (`test/pg-live.test.ts`) but has never been put under concurrency.
