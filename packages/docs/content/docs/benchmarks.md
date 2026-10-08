---
title: Benchmarks
description: Compare KetJS database execution, HTTP server and SSR performance with repeatable workloads, exact versions and HTML charts.
group: Verify and deploy
order: 2
# Maintained chart summaries; generated raw runs live outside the website.
benchmarkReports:
  - kind: database
    date: "2026-10-07T04:08:14.899Z"
    processes: 4
    measurements:
      - {"framework": "KetJS adapter", "version": "0.2.0", "medianPerSecond": 169577.36721044034, "engine": "SQLite", "databaseVersion": "3.51.2", "operation": "point", "title": "Primary-key lookup", "minPerSecond": 164903.57263590128, "maxPerSecond": 176349.48178470388}
      - {"framework": "KetJS adapter", "version": "0.2.0", "medianPerSecond": 56770.960366397834, "engine": "SQLite", "databaseVersion": "3.51.2", "operation": "range", "title": "Indexed tenant read: 20 rows", "minPerSecond": 53386.28493527304, "maxPerSecond": 59478.32512684445}
      - {"framework": "KetJS adapter", "version": "0.2.0", "medianPerSecond": 16239.764840819584, "engine": "SQLite", "databaseVersion": "3.51.2", "operation": "insert", "title": "Single committed insert", "minPerSecond": 15022.778362806483, "maxPerSecond": 16674.876820183697}
      - {"framework": "KetJS adapter", "version": "0.2.0", "medianPerSecond": 5637.3923167880885, "engine": "SQLite", "databaseVersion": "3.51.2", "operation": "batch", "title": "Transaction: 25 inserts", "minPerSecond": 5322.687957418506, "maxPerSecond": 6276.839766843003}
      - {"framework": "KetJS adapter", "version": "0.2.0", "medianPerSecond": 21061.489245486613, "engine": "SQLite", "databaseVersion": "3.51.2", "operation": "transfer", "title": "Transaction: two balance updates", "minPerSecond": 4593.97932915112, "maxPerSecond": 21972.870667881027}
      - {"framework": "Raw driver baseline", "version": "v24.14.1", "medianPerSecond": 174264.48927780823, "engine": "SQLite", "databaseVersion": "3.51.2", "operation": "point", "title": "Primary-key lookup", "minPerSecond": 145193.72472721722, "maxPerSecond": 190668.67504337712}
      - {"framework": "Raw driver baseline", "version": "v24.14.1", "medianPerSecond": 57155.948614646586, "engine": "SQLite", "databaseVersion": "3.51.2", "operation": "range", "title": "Indexed tenant read: 20 rows", "minPerSecond": 52810.35496990593, "maxPerSecond": 58640.42182010091}
      - {"framework": "Raw driver baseline", "version": "v24.14.1", "medianPerSecond": 16956.33611973333, "engine": "SQLite", "databaseVersion": "3.51.2", "operation": "insert", "title": "Single committed insert", "minPerSecond": 16371.557875863708, "maxPerSecond": 17134.31436535605}
      - {"framework": "Raw driver baseline", "version": "v24.14.1", "medianPerSecond": 5889.975721789828, "engine": "SQLite", "databaseVersion": "3.51.2", "operation": "batch", "title": "Transaction: 25 inserts", "minPerSecond": 4253.011663884481, "maxPerSecond": 6906.633980791127}
      - {"framework": "Raw driver baseline", "version": "v24.14.1", "medianPerSecond": 22713.143443360215, "engine": "SQLite", "databaseVersion": "3.51.2", "operation": "transfer", "title": "Transaction: two balance updates", "minPerSecond": 21431.61379923317, "maxPerSecond": 23909.81237898495}
      - {"framework": "KetJS adapter", "version": "0.2.0", "medianPerSecond": 948.9643097110734, "engine": "PostgreSQL", "databaseVersion": "17.10", "operation": "point", "title": "Primary-key lookup", "minPerSecond": 821.3405857172634, "maxPerSecond": 953.6069427065095}
      - {"framework": "KetJS adapter", "version": "0.2.0", "medianPerSecond": 927.5312984560967, "engine": "PostgreSQL", "databaseVersion": "17.10", "operation": "range", "title": "Indexed tenant read: 20 rows", "minPerSecond": 883.8020300032916, "maxPerSecond": 1082.8959886123985}
      - {"framework": "KetJS adapter", "version": "0.2.0", "medianPerSecond": 309.9748237374366, "engine": "PostgreSQL", "databaseVersion": "17.10", "operation": "insert", "title": "Single committed insert", "minPerSecond": 228.15939658622332, "maxPerSecond": 427.3059466274766}
      - {"framework": "KetJS adapter", "version": "0.2.0", "medianPerSecond": 34.13669594562573, "engine": "PostgreSQL", "databaseVersion": "17.10", "operation": "batch", "title": "Transaction: 25 inserts", "minPerSecond": 28.74241514610309, "maxPerSecond": 37.6297001737777}
      - {"framework": "KetJS adapter", "version": "0.2.0", "medianPerSecond": 278.2401747023888, "engine": "PostgreSQL", "databaseVersion": "17.10", "operation": "transfer", "title": "Transaction: two balance updates", "minPerSecond": 214.75328586201786, "maxPerSecond": 286.14895955548707}
      - {"framework": "Raw driver baseline", "version": "3.4.9", "medianPerSecond": 999.0729997127307, "engine": "PostgreSQL", "databaseVersion": "17.10", "operation": "point", "title": "Primary-key lookup", "minPerSecond": 897.3776560383524, "maxPerSecond": 1096.436356239477}
      - {"framework": "Raw driver baseline", "version": "3.4.9", "medianPerSecond": 962.8526762568525, "engine": "PostgreSQL", "databaseVersion": "17.10", "operation": "range", "title": "Indexed tenant read: 20 rows", "minPerSecond": 922.9342823056834, "maxPerSecond": 1123.6192476505971}
      - {"framework": "Raw driver baseline", "version": "3.4.9", "medianPerSecond": 317.8161261204675, "engine": "PostgreSQL", "databaseVersion": "17.10", "operation": "insert", "title": "Single committed insert", "minPerSecond": 214.76978042682063, "maxPerSecond": 418.7726276225254}
      - {"framework": "Raw driver baseline", "version": "3.4.9", "medianPerSecond": 33.13078836899098, "engine": "PostgreSQL", "databaseVersion": "17.10", "operation": "batch", "title": "Transaction: 25 inserts", "minPerSecond": 29.467638737707457, "maxPerSecond": 35.92587790832893}
      - {"framework": "Raw driver baseline", "version": "3.4.9", "medianPerSecond": 182.0875312251267, "engine": "PostgreSQL", "databaseVersion": "17.10", "operation": "transfer", "title": "Transaction: two balance updates", "minPerSecond": 89.16150911917168, "maxPerSecond": 265.4299312924668}
  - kind: server
    date: "2026-10-07T04:09:34.024Z"
    processes: 4
    measurements:
      - {"framework": "KetJS", "version": "0.2.0", "medianPerSecond": 20758.83104526715, "engine": "SQLite", "databaseVersion": "3.51.2", "path": "/json", "minPerSecond": 16631.534110065477, "maxPerSecond": 21542.861502209053}
      - {"framework": "KetJS", "version": "0.2.0", "medianPerSecond": 17125.05143689714, "engine": "SQLite", "databaseVersion": "3.51.2", "path": "/db/point", "minPerSecond": 15882.410602501723, "maxPerSecond": 18503.981970182558}
      - {"framework": "KetJS", "version": "0.2.0", "medianPerSecond": 12298.83041937429, "engine": "SQLite", "databaseVersion": "3.51.2", "path": "/db/range", "minPerSecond": 11879.567234196413, "maxPerSecond": 12421.43606660073}
      - {"framework": "Node HTTP baseline", "version": "v24.14.1", "medianPerSecond": 23814.927801223588, "engine": "SQLite", "databaseVersion": "3.51.2", "path": "/json", "minPerSecond": 12564.437799008592, "maxPerSecond": 25955.74950268374}
      - {"framework": "Node HTTP baseline", "version": "v24.14.1", "medianPerSecond": 18822.656827664257, "engine": "SQLite", "databaseVersion": "3.51.2", "path": "/db/point", "minPerSecond": 14166.223706559143, "maxPerSecond": 21194.883549812326}
      - {"framework": "Node HTTP baseline", "version": "v24.14.1", "medianPerSecond": 14101.349833690558, "engine": "SQLite", "databaseVersion": "3.51.2", "path": "/db/range", "minPerSecond": 11971.492822858103, "maxPerSecond": 15186.791508294144}
      - {"framework": "Express", "version": "5.2.1", "medianPerSecond": 17533.877783722302, "engine": "SQLite", "databaseVersion": "3.51.2", "path": "/json", "minPerSecond": 13941.153085841554, "maxPerSecond": 19290.278580919832}
      - {"framework": "Express", "version": "5.2.1", "medianPerSecond": 15697.872340302525, "engine": "SQLite", "databaseVersion": "3.51.2", "path": "/db/point", "minPerSecond": 15370.35347009745, "maxPerSecond": 16464.86487877099}
      - {"framework": "Express", "version": "5.2.1", "medianPerSecond": 12442.79353556966, "engine": "SQLite", "databaseVersion": "3.51.2", "path": "/db/range", "minPerSecond": 11235.442202427572, "maxPerSecond": 12489.409176165636}
      - {"framework": "Fastify", "version": "5.12.5", "medianPerSecond": 19270.140422649485, "engine": "SQLite", "databaseVersion": "3.51.2", "path": "/json", "minPerSecond": 17918.9642838644, "maxPerSecond": 22962.359669485526}
      - {"framework": "Fastify", "version": "5.12.5", "medianPerSecond": 17497.158223892686, "engine": "SQLite", "databaseVersion": "3.51.2", "path": "/db/point", "minPerSecond": 15728.828392406971, "maxPerSecond": 18031.352081048473}
      - {"framework": "Fastify", "version": "5.12.5", "medianPerSecond": 13579.371125982052, "engine": "SQLite", "databaseVersion": "3.51.2", "path": "/db/range", "minPerSecond": 11859.835278006572, "maxPerSecond": 14155.403558567588}
      - {"framework": "KetJS", "version": "0.2.0", "medianPerSecond": 20159.3333652484, "engine": "PostgreSQL", "databaseVersion": "17.10", "path": "/json", "minPerSecond": 15917.784642322376, "maxPerSecond": 22100.274137325574}
      - {"framework": "KetJS", "version": "0.2.0", "medianPerSecond": 950.0791505791065, "engine": "PostgreSQL", "databaseVersion": "17.10", "path": "/db/point", "minPerSecond": 823.2902818962287, "maxPerSecond": 1187.9024751401028}
      - {"framework": "KetJS", "version": "0.2.0", "medianPerSecond": 918.0157579137319, "engine": "PostgreSQL", "databaseVersion": "17.10", "path": "/db/range", "minPerSecond": 842.506155966058, "maxPerSecond": 1187.6051135832695}
      - {"framework": "Node HTTP baseline", "version": "v24.14.1", "medianPerSecond": 23474.837378597455, "engine": "PostgreSQL", "databaseVersion": "17.10", "path": "/json", "minPerSecond": 18760.93784661934, "maxPerSecond": 27878.0453301539}
      - {"framework": "Node HTTP baseline", "version": "v24.14.1", "medianPerSecond": 1110.5284810044932, "engine": "PostgreSQL", "databaseVersion": "17.10", "path": "/db/point", "minPerSecond": 904.3656197950877, "maxPerSecond": 1170.1300176146913}
      - {"framework": "Node HTTP baseline", "version": "v24.14.1", "medianPerSecond": 931.013526954483, "engine": "PostgreSQL", "databaseVersion": "17.10", "path": "/db/range", "minPerSecond": 789.1764450560561, "maxPerSecond": 1010.5671373830496}
      - {"framework": "Express", "version": "5.2.1", "medianPerSecond": 17206.89809845932, "engine": "PostgreSQL", "databaseVersion": "17.10", "path": "/json", "minPerSecond": 14703.703150612857, "maxPerSecond": 17777.152417060537}
      - {"framework": "Express", "version": "5.2.1", "medianPerSecond": 1110.679590946083, "engine": "PostgreSQL", "databaseVersion": "17.10", "path": "/db/point", "minPerSecond": 838.5871693018397, "maxPerSecond": 1121.917061755312}
      - {"framework": "Express", "version": "5.2.1", "medianPerSecond": 1004.9405827151329, "engine": "PostgreSQL", "databaseVersion": "17.10", "path": "/db/range", "minPerSecond": 832.9329546089928, "maxPerSecond": 1189.9039254837537}
      - {"framework": "Fastify", "version": "5.12.5", "medianPerSecond": 19813.980431726908, "engine": "PostgreSQL", "databaseVersion": "17.10", "path": "/json", "minPerSecond": 15829.620413419378, "maxPerSecond": 20772.038240024525}
      - {"framework": "Fastify", "version": "5.12.5", "medianPerSecond": 1189.0510966511463, "engine": "PostgreSQL", "databaseVersion": "17.10", "path": "/db/point", "minPerSecond": 957.5131470459933, "maxPerSecond": 1234.3628093774446}
      - {"framework": "Fastify", "version": "5.12.5", "medianPerSecond": 952.6672705809858, "engine": "PostgreSQL", "databaseVersion": "17.10", "path": "/db/range", "minPerSecond": 812.5648771794663, "maxPerSecond": 1006.775283037568}
  - kind: ssr
    date: "2026-10-07T04:48:23.041Z"
    processes: 4
    measurements:
      - {"framework": "ketjs-view", "version": "0.2.0", "medianPerSecond": 27643.7666172053, "rows": 50}
      - {"framework": "React", "version": "19.3.0", "medianPerSecond": 27086.61720309974, "rows": 50}
      - {"framework": "Preact", "version": "11.0.0 / renderer 6.8.0", "medianPerSecond": 35569.16509836515, "rows": 50}
      - {"framework": "Vue", "version": "3.5.43", "medianPerSecond": 21294.122312380325, "rows": 50}
      - {"framework": "ketjs-view", "version": "0.2.0", "medianPerSecond": 1341.046823337843, "rows": 1000}
      - {"framework": "React", "version": "19.3.0", "medianPerSecond": 1314.0577128105037, "rows": 1000}
      - {"framework": "Preact", "version": "11.0.0 / renderer 6.8.0", "medianPerSecond": 1685.468854171546, "rows": 1000}
      - {"framework": "Vue", "version": "3.5.43", "medianPerSecond": 1195.8892641510906, "rows": 1000}
---

## How to read the comparisons

The HTML charts above use maintained summaries of the measured runs, with **database execution first**. Every bar is a median across independent Node processes with balanced framework order; each chart states how many. Bigger bars mean more completed operations per second. These measurements are workload-specific: they do not rank entire frameworks or prove production capacity.

### Database workloads

`bench/ssr-comparison/database.mjs` creates **50,000 products**, a primary key and a composite `(tenant, value, id)` index. It measures an actual primary-key lookup, a tenant-filtered 20-row indexed read, an individually committed insert, a transaction containing 25 inserts and a two-update balance transfer. The unit for transactions is **transactions/s**, not individual statements/s. Seed data and migrations are outside timing; output rows, insert counts, total balances and rollback correctness are checked.

SQLite uses a temporary **on-disk file**, WAL and `synchronous=FULL` (2). Both its KetJS adapter and raw `node:sqlite` baseline prepare each statement, so neither gets an artificial prepared-statement-cache advantage. PostgreSQL uses an owned, disposable **PostgreSQL 17.10** Docker container with `synchronous_commit=on` and a **one-connection** pool for both the KetJS adapter and raw `postgres.js` baseline. Engine and driver versions appear beside the chart values.

The raw driver is a lower-level baseline, not another business framework. These adapter operations do not include model validation, authorization, tenant resolution or a domain-function call. SQLite runs natively on macOS; PostgreSQL includes the Docker VM and local TCP path. Compare the two bars **within one engine and workload**, not SQLite versus PostgreSQL as a universal database ranking. Concurrent writes, lock contention, tenant fleets and production-sized datasets need separate fixtures.

### HTTP server workloads

`bench/ssr-comparison/server.mjs` compares **KetJS**, **Express 5.2.1**, **Fastify 5.12.5** and a native **Node HTTP** baseline. All four use the same KetJS adapter, schema, SQL and JSON payload; this isolates routing/response overhead from ORM differences. The native KetJS server is created through its public `createKetServer()` API. Routes return a small JSON response, one product, or 20 indexed products.

Each run uses **16 keep-alive HTTP/1.1 clients**, 160 warm-up requests and 1,600 timed requests per route, on loopback. Every response status and result is checked. Timing includes the local load generator, JSON parsing and assertions. The charts report median throughput and observed throughput ranges. The PostgreSQL pool of one connection intentionally bounds concurrency; this is not a saturated production load test. Authentication, permissions, domain functions, TLS, proxies, compression, network distance and startup time are outside this fixture.

### SSR renderer workloads

`bench/ssr-comparison/run.mjs` compares **ketjs-view** **0.2.0**, **React 19.3.0**, **Svelte 5.57.1**, **Vue 3.5.43** and **Astro 7.3.5**. Each renders the same 50-row or 1,000-row product list with text escaping. ketjs-view, React and Vue create elements through their runtime element functions inside the timer. Svelte and Astro compile `components/ProductList.svelte` and `components/ProductList.astro` once before timing, as their builds would, so their template work is partly done ahead of time. The timed loop calls Svelte's `render()` from `svelte/server` and Astro's public Container API, `renderToString()`, which also runs Astro's component-rendering pipeline. The awaited public render API and encoding every result to bytes are included; imports are warm. Encoding keeps a renderer from returning an unflattened string whose cost would land after the timer. Output equivalence ignores hydration comments and the equivalent `>`/`&gt;` text encoding. There is no HTTP, hydration or browser work in this comparison. Five processes each start the sequence at a different framework, on the same machine with Node.js **26.7.0**.

**The SSR chart and the figures in this paragraph predate the Svelte and Astro harness.** They were measured with its previous revision, which compared **Preact 11.0.0** (renderer 6.8.0) instead, across four processes on a development machine; a measurement of the current harness on an isolated server will replace them. The charts report versions and medians. ketjs-view 0.2.0 is level with React and behind Preact in that measurement. Its JSX runtime caches each element shape, its server writer compiles each template once into static markup between holes, and escaping copies clean runs in one pass. The harness calls the runtime `jsx()` for every element, so it measures neither `html` templates nor the opt-in [JSX compiler](/ketjs/view-static-sites/#compile-jsx). Its independent dependency surface and island model are separate properties, not a speed claim inferred from this benchmark.

## Measurement environment

Raw run files and generated reports are not checked into the repository or served by this site. Chart summaries remain in this page's Markdown frontmatter. Re-run the harnesses below to inspect current raw results locally under `.artifacts/benchmarks/`.

Measured **2026-10-07**, using the **KetJS 0.2.0** source: Node.js **24.14.1**, macOS Darwin **25.2.0**, Apple **M1 Pro**, arm64, **10 logical CPUs** and **32 GiB RAM**. Generated environment/digest records are local artifacts rather than published downloads.

Node workloads ran **three independent processes, sequentially**. Tables report the median of those runs. Every workload validates its result before reporting it. The generated local reports record the source revision and digest. The database and HTTP code paths measured here are the same in 0.2.0.

These are local microbenchmarks and regression baselines. The new comparisons below cover specific local workloads; they do not establish production HTTP capacity or universal framework speed ratios. Earlier competitor and KetSuite-domain tables have been removed because their old harnesses are no longer in this framework repository and were not rerun.

## Published npm footprint

Fresh isolated consumers install the exact published versions with installation scripts disabled, using `node tools/benchmark-footprint.mjs`. The 0.2.0 footprint is measured after that version is published; View Tools 0.2.0 adds `acorn` and `acorn-jsx` to its dependencies, and standalone View still has none.

## KTL rendering and query compilation

KTL renders fifty products with the same pre-created currency formatter on every render. Templates are compiled before timing, and output is checked byte-for-byte against a known result. Query timing includes construction of two predicates, ordering and a limit, then generation of SQLite SQL and parameters. It does not execute the query.

| Operation | Iterations per run | Median throughput |
| --- | ---: | ---: |
| KTL: 50 products with cached money filter | 20,000 | 33,040/s |
| Query: two predicates, order, limit and SQLite SQL | 200,000 | 506,370/s |

This fixture makes no EJS, Liquid, Knex or Drizzle comparison; earlier speed ratios are not carried forward.

## Localization hot paths

Each process warms every path before timing. Inputs and iteration counts are fixed in `bench/i18n.bench.ts`; the date bucket uses `Asia/Ho_Chi_Minh`.

| Operation | Median throughput |
| --- | ---: |
| plain translation | 19,448,600 ops/s |
| placeholder translation | 4,056,011 ops/s |
| plural translation | 1,744,804 ops/s |
| cached date/time format | 676,641 ops/s |
| timezone date bucket | 502,159 ops/s |

No uncached baseline was measured during this run, so the table claims no cache improvement ratio.

## Module discovery startup

A catalogue contains **250 candidate modules**; the selected dependency closure contains **40**. Unselected modules throw if executed, and every measured resolution asserts the selected module count. The fixture now exports public `defineModule()` declarations instead of manually copying an old internal object shape.

Cold means the first catalogue resolution in an already running process whose framework imports are loaded. Each process then performs **25 warm resolutions**. The warm p95 below is the median of the three processes' internal p95 values, not a pooled percentile.

| Measure | Median across three processes |
| --- | ---: |
| First resolution | 34.95 ms |
| Warm median | 12.95 ms |
| Warm p95 | 15.91 ms |

This is catalogue startup cost, not request throughput.

## SQLite queue across tenant databases

The public worker and tenant APIs handle **32 physical databases**, **100 jobs per database** and **8 concurrent workers**. Notification shortcuts are disabled. Every run asserts all 3,200 jobs complete in the expected tenant, with migrations and runtime preparation outside the measured queue regions.

| Measure | Median across three processes |
| --- | ---: |
| Enqueue time | 473.4 ms |
| Enqueue throughput | 6,760.0 jobs/s |
| Execution time | 1,545.5 ms |
| Execution throughput | 2,071.0 jobs/s |
| First-job spread across tenants | 130.0 ms |

PostgreSQL was not measured in this run; its historical throughput is not presented as current. The fixture's jobs have minimal handlers, so these numbers do not represent a real domain workload.

## Real browser DOM updates

Chromium **154.0.8037.95**, **1440 × 1000**, light theme. The native TSX fixture mounts 1,000 keyed rows in a real DOM, performs five warmup rounds and thirty measured rounds, and checks the final row count and changed text. Timings include rendering and DOM API calls, excluding layout and paint. Browser timer resolution and background activity affect very short samples.

| Operation | Median | p95 |
| --- | ---: | ---: |
| Mount 1,000 rows | 4.70 ms | 5.90 ms |
| Update one row | 1.10 ms | 1.80 ms |
| Unchanged render | 1.00 ms | 2.00 ms |
| Swap two rows | 1.00 ms | 2.40 ms |
| Remove and re-add one row (two renders) | 2.30 ms | 3.60 ms |

The old lit comparison used a different fixture and environment; no current cross-framework ratio is claimed.

## Renderer host operations

A separate counting-host fixture verifies the mutation cost independent of browser time. This fixture is not a DOM performance measurement.

| Change to 1,000 keyed rows | Host operations |
| --- | ---: |
| Update one text field | 1 `setText` |
| Unchanged render | 0 |
| Prepend one row | 15 |
| Remove one row | 3 removals |
| Swap two rows | 2 moves |

The former island-vs-whole-tree timings are not included: that fixture is absent, and counting operations does not recreate its timing claim.

## Reproduce

The Node harnesses write generated reports and raw runs to the ignored `.artifacts/benchmarks/` directory. They do not update or publish the maintained Markdown summaries automatically.

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

Open `http://127.0.0.1:3701/` and press **Run benchmark** for the real browser fixture. Save its JSON results and browser environment locally under `.artifacts/benchmarks/` before closing the benchmark page. The footprint command installs only the three named npm consumers into disposable directories.

## Not measured here

- Current EJS, Liquid, Knex, Drizzle and lit comparisons need pinned competitor versions and equivalent maintained fixtures.
- PostgreSQL queue throughput needs an isolated database service and a separately recorded run.
- Product, pricing, stock, hospitality and storage workloads belong to KetSuite or its deployment repositories. Their old numbers no longer appear as KetJS-framework benchmarks.
- Production HTTP capacity, concurrency/lock contention, layout/paint and full-page versus island timings need dedicated workloads beyond these local fixtures.

Those gaps are explicit; there are no reused historical numbers standing in for fresh measurements.
