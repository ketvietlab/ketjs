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

## Odoo 19 product, pricing and stock domain

Measured on 2026-08-20 with Node 24.19.0 on Apple Silicon, after the complete
Product/Media/Pricelist/Stock/Inventory admin flows passed the repository verify
suite. The benchmark uses the public server-function boundary and a migrated
SQLite datastore; it does not bypass validation or effect checks.

| operation | sample | elapsed | throughput |
|---|---:|---:|---:|
| generate attribute combinations | 125 variants | 9.37 ms | 13,346 variants/s |
| resolve deterministic pricelist rules | 1,000 prices | 83.01 ms | 12,047 prices/s |
| reserve stock through move lines + quant CAS | 100 moves | 27.64 ms | 3,618 moves/s |

The same revision also passed all 13 live PostgreSQL integration cases, including
two real connections competing for one quant without over-reserving it. Reproduce
the timings with `npm run bench` and the database checks with
`node --test .build/test/pg-live.test.js` while the development PostgreSQL service
is available.

These are regression baselines, not capacity claims. Price resolution deliberately
includes precedence/date/quantity checks; reservation deliberately includes the
transaction and compare-and-set work that makes the result safe.

## Module discovery startup

Measured on 2026-08-20 with Node 26.7.0 on Apple Silicon. One module root contains
250 valid descriptors; the app selects the end of a 40-module dependency chain.
The other 210 executable entries throw immediately if imported, proving that a
catalogue scan does not execute modules outside the selected closure.

| catalogue | selected closure | cold resolve | warm median | warm p95 |
|---:|---:|---:|---:|---:|
| 250 modules | 40 modules | 33.38 ms | 14.89 ms | 20.84 ms |

The first implementation probed each directory sequentially and measured a 62.42
ms warm median on the same machine. The benchmark led to bounded concurrent probes
(64 directories at a time), reducing that median by 4.2× without unbounded file
descriptor pressure. Settled results are still consumed in sorted order, so faster
I/O cannot change which invalid module is reported first.

Read this as startup/catalogue cost, not request throughput. Warm resolution still
reads and validates every descriptor while Node reuses executable modules it has
already imported. Reproduce it with `npm run bench:modules`.

## Queue across tenant databases

The queue benchmark uses the public worker and tenant-pool APIs, warms migrations
and app registries, then enqueues equal work into separate physical databases. It
asserts every database completes and reports the spread between the first job seen
from the first and last tenant. Notifications are disabled, so the result measures
the polling and round-robin correctness path rather than a local wake-up shortcut.

| driver | databases | jobs | concurrency | enqueue/s | execute/s | first-job spread |
|---|---:|---:|---:|---:|---:|---:|
| SQLite | 32 | 3,200 | 8 | 2,636 | 1,115 | 294.1 ms |
| PostgreSQL 17 | 8 | 800 | 8 | 250 | 284 | 365.6 ms |

These are development-machine numbers, not capacity promises. The PostgreSQL run
uses eight real databases on the local cluster, `FOR UPDATE SKIP LOCKED`, a bounded
tenant pool and no Redis. Reproduce with `npm run bench:queue`; select PostgreSQL
with `KET_BENCH_DRIVER=postgres` and tune database/job counts through the benchmark
environment variables.

With 100,000 runnable PostgreSQL rows, `EXPLAIN (ANALYZE, BUFFERS)` selected
`ket_job_fetch_active` directly with no Sort node: 0.893 ms total execution and 23
shared-buffer hits to lock the first 10 rows on the development cluster. This is
why the fetch index is partial across runnable states and ordered `(queue,
priority, scheduled_at, id)` rather than putting the multi-valued `state` column
before the requested order.

## S3 storage across tenant databases

The storage benchmark starts the full HTTP app, streams multipart uploads into a
real MinIO server, writes Attachment metadata into separate physical databases,
then downloads every object through the module route. It verifies the exact object
count under each tenant namespace before cleanup.

| metadata driver | databases | files | uploads/s | downloads/s | tenant namespaces |
|---|---:|---:|---:|---:|---|
| SQLite | 8 | 200 | 24 | 810 | complete |
| PostgreSQL 17 | 4 | 100 | 21 | 61 | complete |

These numbers include multipart parsing, SHA-256 content addressing, Attachment
writes, tenant-pool leasing, SigV4 and actual S3 HTTP. They are development-machine
figures, not object-store capacity claims. Reproduce with `npm run bench:storage`;
select PostgreSQL with `KET_BENCH_DRIVER=postgres`.

## Hospitality operations across databases

The hospitality benchmark migrates separate physical databases and loads each one
through the public `hospitality_core` functions: one property, one building, ten
floors, twelve room types, 250 rooms and 100 reservations. It then creates and
idempotently posts 50 service intentions per database, runs check-in/charge/
checkout cycles and alternates room-board and reservation queries. Two PostgreSQL
connections race for the same physical room and the same service occurrence. A
third race checks that cancel and check-in cannot both win or leave reservation,
stay, room and assignment states out of sync. The run also checks company isolation,
content-change durability and PostgreSQL `numeric`/`date` column types.

| driver | databases | rooms | reservations | migrate | room writes/s | bookings/s | service posts/s | operation cycles/s | list pairs/s | room/service races | isolated counts |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| SQLite | 8 | 2,000 | 800 | 178.1 ms | 3,135 | 908 | 1,060 | 1,391 | 529 | one row (sequential) | complete |
| PostgreSQL 17 | 4 | 1,000 | 400 | 906.1 ms | 729 | 227 | 195 | 237 | 261 | one row (concurrent) | complete |

The reservation-intake run on 2026-08-21 adds a read-only quote before every
booking and verifies that the quote phase does not create or update an
`AvailabilityLedger` row.

| driver | physical databases | quotes | elapsed | quotes/s | inventory unchanged |
|---|---:|---:|---:|---:|---|
| SQLite | 8 | 800 | 334.1 ms | 2,394 | yes |
| PostgreSQL 17 | 4 | 400 | 600.6 ms | 666 | yes |

Each quote resolves the default rate, validates the property calendar and sales
restrictions, and reads the minimum room-night availability. Confirmation still
performs the compare-and-set inventory claim; the quote is never treated as a
hold.

An operation cycle contains check-in, an idempotent folio charge and checkout for
every second stay. A list pair contains the room board plus the reservation list;
the table keeps the benchmark field name `readsPerSecond` for compatibility. These
are local development figures and the rates include application-level reference,
uniqueness, scope and transition validation. Reproduce with
`npm run bench:hospitality`; select PostgreSQL with
`KET_BENCH_DRIVER=postgres`. Both drivers remain part of the acceptance path;
SQLite covers the local single-writer shape while PostgreSQL exercises real
multi-connection compare-and-set.

Hospitality figures were rerun on 2026-08-20 after rebasing onto the full current
KetSuite deployment. PostgreSQL migration and master-data figures therefore
include the much larger dependency manifest now pulled in by the backend module;
the operation rates remain the hospitality-only paths. The rerun also includes
the property-timezone, primary-guest, room-claim and cancel/check-in concurrency
guards, and verifies that every checkout creates exactly one durable housekeeping
task in every physical tenant database. The 2026-08-21 rerun adds provider-visible
property fees, product-backed service intentions and immutable operational charges;
retrying all 600 service-post attempts produced exactly 400 SQLite and 200
PostgreSQL charge rows, while the two-connection PostgreSQL race produced one row.

The 2026-08-21 stay-notice extension prepares one masked notice for every checked-in
guest, builds and hashes the live submission package, records operator evidence and
confirms half the rows. It asserts that every physical database contains only its
own company rows, every notice has only the final four document digits, and every
submitted package has a SHA-256 hash. PostgreSQL additionally checks `dueAt` is
`TIMESTAMPTZ` and runs two real connections against the same notice without creating
a duplicate.

| driver | physical databases | notices | elapsed | notices/s | masked evidence and isolation |
|---|---:|---:|---:|---:|---|
| SQLite | 2 | 24 | 22.1 ms | 1,085 | complete |
| PostgreSQL 17 | 2 | 24 | 172.3 ms | 139 | complete |

This targeted run used 48 rooms, 12 reservations and 12 operational transitions in
each database so both engines exercised the same workflow. It is a regression baseline,
not a capacity estimate; the PostgreSQL figure includes real transactions and
cross-connection contention on the local development cluster.

The 2026-08-21 housekeeping-workspace extension then claimed and completed every
checkout cleaning task through the public functions. It verifies the durable task
state, assignee, timestamps and restored room state on every physical database; room
moves and their pending cleaning tasks remain separately asserted.

| driver | physical databases | tasks completed | elapsed | tasks/s | task and room lifecycle |
|---|---:|---:|---:|---:|---|
| SQLite | 8 | 48 | 14.9 ms | 3,226 | complete |
| PostgreSQL 17 | 4 | 24 | 53.5 ms | 448 | complete |

The same run retained the existing room, inventory, folio-correction, stay-notice,
night-audit and cross-database isolation assertions. These figures measure the task
lifecycle only; browser rendering and operator think time are intentionally excluded.

The room-status workspace extension then released one maintenance room to housekeeping
and returned it to service hold in every physical database through guarded public
transitions. Each run verifies the final note, exact property summary and physical
database isolation; occupied/cleaning/open-task rejection remains covered by the
engine tests.

| driver | physical databases | status transitions | elapsed | transitions/s | status, note and summary |
|---|---:|---:|---:|---:|---|
| SQLite | 8 | 16 | 3.4 ms | 4,713 | complete |
| PostgreSQL 17 | 4 | 8 | 9.5 ms | 839 | complete |

These are transition-engine timings, not operator or browser latency. The same run
continued to pass the booking, folio, housekeeping-task, night-audit, concurrency and
cross-database assertions listed above. PostgreSQL also races task creation against an
out-of-service transition on two real connections and proves that exactly one wins.

The property-workspace extension then creates a company-scoped cancellation policy,
updates the operating profile through `saveProperty`, and reads the complete detail
back in every physical database. The assertion covers the display name, local clocks,
long-stay policy, preserved address, preloaded default policy, durable content feed and
cross-database isolation.

| driver | physical databases | profile updates | elapsed | updates/s | settings, address and policy |
|---|---:|---:|---:|---:|---|
| SQLite | 8 | 8 | 13.5 ms | 594 | complete |
| PostgreSQL 17 | 4 | 4 | 21.1 ms | 190 | complete |

These figures measure the guarded domain update plus detail read, not form rendering or
operator input. The same runs kept every prior booking, inventory, folio, housekeeping,
night-audit, stay-notice and PostgreSQL contention assertion green.

The room-type workspace extension then updates a populated sellable product and reads
its complete detail through every physical database. It verifies capacity, view, colour,
property and cancellation-policy preloads, the exact physical-room count, one additional
durable content signal and isolation between tenant databases.

| driver | physical databases | room-type updates | elapsed | updates/s | settings, relations and room count |
|---|---:|---:|---:|---:|---|
| SQLite | 8 | 8 | 5.1 ms | 1,576 | complete |
| PostgreSQL 17 | 4 | 4 | 19.5 ms | 205 | complete |

The full runs used 2,000 rooms on SQLite and 1,000 rooms on PostgreSQL. These timings
cover the guarded update and relation-rich detail read; form rendering and operator
input are intentionally excluded. All earlier booking, inventory, folio, housekeeping,
night-audit, contention, durable-feed and cross-database assertions remained green.

## Not measured

- SSR throughput against Next/Nuxt/Astro end-to-end. Ket has no client bundler, so
  a whole-framework comparison would not be like-for-like yet.
- Cold start and build time, for the same reason.
- Cross-host throughput and latency under network or replication delay; the queue
  measurement above uses a local PostgreSQL cluster.
