---
title: Benchmarks
description: Compare KetJS database execution, HTTP server and SSR performance with reproducible workloads, exact versions, HTML charts and raw measurement results.
group: Testing
order: 2
benchmarkSources:
  - database-comparison.json
  - server-comparison.json
  - ssr-comparison.json
---

## How to read the comparisons

The HTML charts above are generated from fresh measurements, with **database execution first**. Every bar is a median across four independent Node processes, with balanced framework order. Bigger bars mean more completed operations per second. These measurements are workload-specific: they do not rank entire frameworks or prove production capacity.

### Database workloads

`bench/ssr-comparison/database.mjs` creates **50,000 products**, a primary key and a composite `(tenant, value, id)` index. It measures an actual primary-key lookup, a tenant-filtered 20-row indexed read, an individually committed insert, a transaction containing 25 inserts and a two-update balance transfer. The unit for transactions is **transactions/s**, not individual statements/s. Seed data and migrations are outside timing; output rows, insert counts, total balances and rollback correctness are checked.

SQLite uses a temporary **on-disk file**, WAL and `synchronous=FULL` (2). Both its KetJS adapter and raw `node:sqlite` baseline prepare each statement, so neither gets an artificial prepared-statement-cache advantage. PostgreSQL uses an owned, disposable **PostgreSQL 17.10** Docker container with `synchronous_commit=on` and a **one-connection** pool for both the KetJS adapter and raw `postgres.js` baseline. Exact engine and driver versions are in [DB results](/measurements/database-comparison.json).

The raw driver is a lower-level baseline, not another business framework. These adapter operations do not include model validation, authorization, tenant resolution or a domain-function call. SQLite runs natively on macOS; PostgreSQL includes the Docker VM and local TCP path. Compare the two bars **within one engine and workload**, not SQLite versus PostgreSQL as a universal database ranking. Concurrent writes, lock contention, tenant fleets and production-sized datasets need separate fixtures.

### HTTP server workloads

`bench/ssr-comparison/server.mjs` compares **KetJS**, **Express 5.2.1**, **Fastify 5.12.5** and a native **Node HTTP** baseline. All four use the same KetJS adapter, schema, SQL and JSON payload; this isolates routing/response overhead from ORM differences. The native KetJS server is created through its public `createKetServer()` API. Routes return a small JSON response, one product, or 20 indexed products.

Each run uses **16 keep-alive HTTP/1.1 clients**, 160 warm-up requests and 1,600 timed requests per route, on loopback. Every response status and result is checked. Timing includes the local load generator, JSON parsing and assertions. [Server results](/measurements/server-comparison.json) include throughput, the median of each run's median/p95 latency, and observed throughput ranges. The PostgreSQL pool of one connection intentionally bounds concurrency; this is not a saturated production load test. Authentication, permissions, domain functions, TLS, proxies, compression, network distance and startup time are outside this fixture.

### SSR renderer workloads

`bench/ssr-comparison/run.mjs` compares **ketjs-view 0.1.41**, **React 19.3.0**, **Preact 11.0.0** with renderer **6.8.0**, and **Vue 3.5.43**. Each renders the same 50-row or 1,000-row product list with text escaping. Element creation and the awaited public static render API are included; imports are warm. Output equivalence ignores hydration comments and the equivalent `>`/`&gt;` text encoding. There is no HTTP, hydration or browser work in this comparison.

[SSR results](/measurements/ssr-comparison.json) include versions, sample counts, medians, ranges, output bytes and environment. **ketjs-view is slower in this SSR workload** than the three compared renderers; the charts preserve that result. Its independent dependency surface and island model are separate properties, not a speed claim inferred from this benchmark.

Raw runs: [DB 1](/measurements/database-comparison-1.txt), [2](/measurements/database-comparison-2.txt), [3](/measurements/database-comparison-3.txt), [4](/measurements/database-comparison-4.txt); [server 1](/measurements/server-comparison-1.txt), [2](/measurements/server-comparison-2.txt), [3](/measurements/server-comparison-3.txt), [4](/measurements/server-comparison-4.txt); [SSR 1](/measurements/ssr-comparison-1.txt), [2](/measurements/ssr-comparison-2.txt), [3](/measurements/ssr-comparison-3.txt), [4](/measurements/ssr-comparison-4.txt).

## Measurement environment

Measured **2026-10-07**, using the local **KetJS 0.1.41** source checkout: Node.js **24.14.1**, macOS Darwin **25.2.0**, Apple **M1 Pro**, arm64, **10 logical CPUs** and **32 GiB RAM**. See the [environment and source digest](/measurements/environment.json).

Node workloads ran **three independent processes, sequentially**. Tables report the median of those runs. Every workload validates its result before reporting it. The source revision and digest identify the code measured; View Tools content-collection changes in this checkout are not part of the published 0.1.41 release.

These are local microbenchmarks and regression baselines. The new comparisons below cover specific local workloads; they do not establish production HTTP capacity or universal framework speed ratios. Earlier competitor and KetSuite-domain tables have been removed because their old harnesses are no longer in this framework repository and were not rerun.

## Published npm footprint

Fresh isolated consumers installed the exact published `0.1.41` versions, with installation scripts disabled. Package counts include the selected platform's installed optional packages; sizes are logical file bytes under `node_modules`, excluding the consumer's lockfile and npm cache. Installation latency is omitted because network and cache conditions are not controlled.

| Package installed | Installed packages | Logical size |
| --- | ---: | ---: |
| `@ketvietlab/ketjs-view` | 1 | 0.202 MB |
| `@ketvietlab/ketjs-view-tools` | 4 | 11.001 MB |
| `@ketvietlab/ketjs` | 2 | 3.375 MB |

[Raw footprint](/measurements/footprint.json). Standalone View installs one package. Static tooling adds esbuild and its platform binary; the core framework is a separate two-package dependency chain. PostgreSQL is not included in any of these three consumers.

## KTL rendering and query compilation

KTL renders fifty products with the same pre-created currency formatter on every render. Templates are compiled before timing, and output is checked byte-for-byte against a known result. Query timing includes construction of two predicates, ordering and a limit, then generation of SQLite SQL and parameters. It does not execute the query.

| Operation | Iterations per run | Median throughput |
| --- | ---: | ---: |
| KTL: 50 products with cached money filter | 20,000 | 33,040/s |
| Query: two predicates, order, limit and SQLite SQL | 200,000 | 506,370/s |

[Run 1](/measurements/framework-1.txt), [run 2](/measurements/framework-2.txt), [run 3](/measurements/framework-3.txt). This fixture makes no EJS, Liquid, Knex or Drizzle comparison; earlier speed ratios are not carried forward.

## Localization hot paths

Each process warms every path before timing. Inputs and iteration counts are fixed in `bench/i18n.bench.ts`; the date bucket uses `Asia/Ho_Chi_Minh`.

| Operation | Median throughput |
| --- | ---: |
| plain translation | 19,448,600 ops/s |
| placeholder translation | 4,056,011 ops/s |
| plural translation | 1,744,804 ops/s |
| cached date/time format | 676,641 ops/s |
| timezone date bucket | 502,159 ops/s |

[Run 1](/measurements/i18n-1.txt), [run 2](/measurements/i18n-2.txt), [run 3](/measurements/i18n-3.txt). No uncached baseline was measured during this run, so the table claims no cache improvement ratio.

## Module discovery startup

A catalogue contains **250 candidate modules**; the selected dependency closure contains **40**. Unselected modules throw if executed, and every measured resolution asserts the selected module count. The fixture now exports public `defineModule()` declarations instead of manually copying an old internal object shape.

Cold means the first catalogue resolution in an already running process whose framework imports are loaded. Each process then performs **25 warm resolutions**. The warm p95 below is the median of the three processes' internal p95 values, not a pooled percentile.

| Measure | Median across three processes |
| --- | ---: |
| First resolution | 34.95 ms |
| Warm median | 12.95 ms |
| Warm p95 | 15.91 ms |

[Run 1](/measurements/module-path-1.txt), [run 2](/measurements/module-path-2.txt), [run 3](/measurements/module-path-3.txt). This is catalogue startup cost, not request throughput.

## SQLite queue across tenant databases

The public worker and tenant APIs handle **32 physical databases**, **100 jobs per database** and **8 concurrent workers**. Notification shortcuts are disabled. Every run asserts all 3,200 jobs complete in the expected tenant, with migrations and runtime preparation outside the measured queue regions.

| Measure | Median across three processes |
| --- | ---: |
| Enqueue time | 473.4 ms |
| Enqueue throughput | 6,760.0 jobs/s |
| Execution time | 1,545.5 ms |
| Execution throughput | 2,071.0 jobs/s |
| First-job spread across tenants | 130.0 ms |

[Run 1](/measurements/queue-1.txt), [run 2](/measurements/queue-2.txt), [run 3](/measurements/queue-3.txt). PostgreSQL was not measured in this run; its historical throughput is not presented as current. The fixture's jobs have minimal handlers, so these numbers do not represent a real domain workload.

## Real browser DOM updates

Chromium **154.0.8037.95**, **1440 × 1000**, light theme. The native TSX fixture mounts 1,000 keyed rows in a real DOM, performs five warmup rounds and thirty measured rounds, and checks the final row count and changed text. Timings include rendering and DOM API calls, excluding layout and paint. Browser timer resolution and background activity affect very short samples.

| Operation | Median | p95 |
| --- | ---: | ---: |
| Mount 1,000 rows | 4.70 ms | 5.90 ms |
| Update one row | 1.10 ms | 1.80 ms |
| Unchanged render | 1.00 ms | 2.00 ms |
| Swap two rows | 1.00 ms | 2.40 ms |
| Remove and re-add one row (two renders) | 2.30 ms | 3.60 ms |

[Raw browser samples and environment](/measurements/browser-view.json). The old lit comparison used a different fixture and environment; no current cross-framework ratio is claimed.

## Renderer host operations

A separate counting-host fixture verifies the mutation cost independent of browser time. This fixture is not a DOM performance measurement.

| Change to 1,000 keyed rows | Host operations |
| --- | ---: |
| Update one text field | 1 `setText` |
| Unchanged render | 0 |
| Prepend one row | 15 |
| Remove one row | 3 removals |
| Swap two rows | 2 moves |

[Raw counting-host results](/measurements/view-1.txt). The former island-vs-whole-tree timings are not included: that fixture is absent, and counting operations does not recreate its timing claim.

## Reproduce

The Node harness needs emitted framework artifacts. Its build compiles the five-package workspace; it does not run the repository's test suites. Benchmark deployments are the synthetic headless catalogue fixture and `queue_benchmark`, not a KetSuite product deployment.

```bash
# Run from: repository root
npm run build
node tools/benchmark-report.mjs
node tools/benchmark-footprint.mjs
node tools/benchmark-browser.mjs
# Separate terminal for the comparative fixtures:
npm ci --prefix bench/ssr-comparison --ignore-scripts
node tools/benchmark-ssr.mjs
# Docker must already have postgres:17.10-alpine; no shared service is modified.
node tools/benchmark-server-db.mjs
```

Open `http://127.0.0.1:3701/` and press **Run benchmark** for the real browser fixture. Preserve its JSON results and browser environment before closing the benchmark page. The footprint command installs only the three named npm consumers into disposable directories.

## Not measured here

- Current EJS, Liquid, Knex, Drizzle and lit comparisons need pinned competitor versions and equivalent maintained fixtures.
- PostgreSQL queue throughput needs an isolated database service and a separately recorded run.
- Product, pricing, stock, hospitality and storage workloads belong to KetSuite or its deployment repositories. Their old numbers no longer appear as KetJS-framework benchmarks.
- Production HTTP capacity, concurrency/lock contention, layout/paint and full-page versus island timings need dedicated workloads beyond these local fixtures.

Those gaps are explicit; there are no reused historical numbers standing in for fresh measurements.
