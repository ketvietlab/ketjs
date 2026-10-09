---
title: Benchmarks
description: Compare KetJS database, HTTP, SSR and browser form performance with repeatable workloads and exact versions.
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

## Browser form sessions

Measured **2026-10-09**, at KetJS source revision **`d7af51c5`** (ketjs-view 0.2.0), against
**React 19.3.0**, **React Hook Form 7.89.0** and **Formik 2.4.9**. The private
`bench/form-comparison/` deployment bundles minified production React with esbuild 0.28.2,
without StrictMode. Environment: Apple M1 Pro, 32 GiB RAM, arm64 macOS Darwin 25.2.0,
Node.js 24.14.1, Chromium 154.0.8037.95, **1440 × 900**, device scale 1, light theme,
no CPU throttling. This synthetic deployment is separate from KetSuite.

Two fresh browser sessions each run two mounts per case and five warmup edits per mount.
Library order rotates by case and mount. The figures below pool **80 valid edits** and
**20 invalid edits, recoveries and API submits** per library/workload. Both runs have identical
runtime/harness digests and diagnostic counters; **10,272 correctness assertions** passed.
The raw reports contain the source revision, package versions, environment, digests and individual
samples and remain local under `.artifacts/benchmarks/`.

Each library uses the same full-schema validator on change, a value mirror and error text per
field, and dirty/error/pending status. RHF uses uncontrolled `register` with exact field
subscriptions and memoized components; Formik uses `FastField` for independent fields. Nested
fixtures initialize `useFieldArray`/`FieldArray` and contain stable row keys, nullable IDs,
decimal weights, boolean flags and attribute-value records. Three controls per variant plus
one title produce 31, 301 or 751 controls. KetJS flat forms use the default native adapter;
its nested forms use a custom structured reader, equality-guarded writer and indexed issue
lookup. KetJS mounts native controls once and updates field mirrors through effects with primitive
`computed` selectors; the timer does not include a KetJS TSX component-tree render on each edit.

### Valid input changes

Elapsed time starts at synthetic `input` event dispatch and ends when raw state, dirty state,
error text and the changed field's value-mirror DOM settle, including asynchronous React commits.
The driver value assignment, preceding animation frame and correctness assertions are excluded.
This does **not** measure layout, paint or INP. Each cell is **median / p95, in milliseconds**.

| Workload | KetJS | RHF | Formik FastField |
| --- | ---: | ---: | ---: |
| 10 flat fields | 0.20 / 0.50 | 0.30 / 0.40 | 0.90 / 1.70 |
| 100 flat fields | 0.60 / 0.70 | 0.40 / 0.60 | 1.80 / 2.10 |
| 500 flat fields | 2.30 / 2.60 | 1.30 / 1.50 | 5.30 / 5.90 |
| 10 variants, 31 controls | 0.35 / 0.50 | 0.40 / 0.90 | 1.30 / 4.10 |
| 100 variants, 301 controls | 1.30 / 1.60 | 0.90 / 1.20 | 3.00 / 3.60 |
| 250 variants, 751 controls | 3.30 / 3.70 | 1.80 / 2.20 | 6.10 / 6.50 |

### One invalid field

The middle field becomes empty (flat) or a malformed decimal (nested). The same settlement
boundary includes displaying its error. Each cell is **median / p95, in milliseconds**.

| Workload | KetJS | RHF | Formik FastField |
| --- | ---: | ---: | ---: |
| 10 flat fields | 0.25 / 0.40 | 0.80 / 2.10 | 0.80 / 1.10 |
| 100 flat fields | 0.60 / 0.70 | 1.35 / 1.70 | 1.70 / 2.00 |
| 500 flat fields | 2.35 / 3.00 | 3.00 / 4.30 | 5.20 / 5.70 |
| 10 variants, 31 controls | 0.40 / 1.30 | 1.30 / 2.10 | 1.35 / 3.70 |
| 100 variants, 301 controls | 1.30 / 1.50 | 2.50 / 3.00 | 3.05 / 3.40 |
| 250 variants, 751 controls | 3.15 / 3.50 | 4.55 / 5.00 | 6.10 / 6.80 |

### Before and after the adapter fix

The earlier revision `756efdf9` rebuilt and searched the controls list for every issue/control
pair, introducing quadratic work even for one issue. Revision `d7af51c5` snapshots current
controls once per pass, indexes their names, resolves each issue once, groups errors by field,
guards DOM writes and caches baseline validation. The before/after runs have identical harness
digests, package versions, viewport and workloads; each revision has two browser runs. Each cell
is **median / p95, in milliseconds**.

| KetJS operation | Before `756efdf9` | After `d7af51c5` |
| --- | ---: | ---: |
| Valid edit, 500 flat fields | 2.70 / 3.00 | 2.30 / 2.60 |
| One invalid field, 500 flat fields | **64.05 / 65.80** | **2.35 / 3.00** |
| Valid edit, 250 variants | 3.70 / 4.20 | 3.30 / 3.70 |

The invalid-edit median is about **27× lower** in this workload. This measures the combined
adapter/cache fix, not an isolated contribution from each optimization. Full draft validation,
copying, comparisons and control traversal still scale with draft/control size in this fixture.
The nested fixture still uses its
explicit structured reader/writer, so it does not establish default nested-path support.

### API submit and accepted baseline

These timers include client validation, a mock accepted receipt and baseline reset, with no HTTP
or database. KetJS additionally snapshots mutation identity, checks receipts and locks native
controls; RHF uses `handleSubmit`/`reset`, while Formik uses `submitForm`, projects accepted values
through the shared schema and calls `resetForm`. These application flows have different library
semantics, so the figures do not rank equivalent server transactions. Each cell is
**median / p95, in milliseconds**.

| Workload | KetJS | RHF | Formik FastField |
| --- | ---: | ---: | ---: |
| 10 flat fields | 0.20 / 0.50 | 0.60 / 1.40 | 0.20 / 0.60 |
| 100 flat fields | 0.80 / 1.00 | 2.55 / 3.80 | 0.40 / 0.50 |
| 500 flat fields | 4.70 / 5.20 | 12.80 / 14.40 | 2.20 / 2.70 |
| 10 variants, 31 controls | 0.45 / 0.90 | 1.30 / 2.60 | 0.30 / 0.70 |
| 100 variants, 301 controls | 2.50 / 2.80 | 6.60 / 8.40 | 1.10 / 1.20 |
| 250 variants, 751 controls | 6.65 / 8.10 | 19.60 / 23.00 | 2.80 / 3.10 |

### Render isolation and work behind it

Counters come from separate fresh mounts, with prototype wrappers and MutationObserver;
timed mounts have neither. For **one valid edit in an already dirty 500-field form after warmup**:

| Counter | KetJS | RHF | Formik FastField |
| --- | ---: | ---: | ---: |
| Field-view executions | 1 | 1 | 1 |
| Unedited field-view executions | 0 | 0 | 0 |
| Form component renders | Not applicable | 0 | 2 |
| Status view executions | 1 | 0 | 2 |
| Completed root refinements | 1 | 1 | 1 |
| Successful custom field-rule calls | 500 | 500 | 500 |
| KetJS selector reads | 500 | Not applicable | Not applicable |
| Form `aria-busy` setter calls | 0 | 0 | 0 |
| Input `value` setter calls | 0 | 0 | 0 |
| Disabled-property writes | 0 | 0 | 0 |
| Attribute method calls | 0 | 0 | 0 |
| Text setter calls | 2 | 1 | 1 |
| MutationObserver records | 2 | 7 | 8 |

On the invalid/recovery transitions, KetJS executes one field view and RHF/Formik execute the
edited field twice; all three execute **zero unedited field views**. The extra React execution
reflects the separate value/error updates. Clean-to-dirty status changes are exercised during
warmup, not represented by the zero RHF status-render count in the valid-edit probe.

View effects and React renders are different operations. Setter calls can assign unchanged
values, and React can update `defaultValue` or attributes without assigning `input.value`.
Mutation records also differ by DOM implementation. A small record count does not mean a small
amount of adapter work. The legacy raw counter `adapterEffects` counts busy-attribute setters;
with guarded writes it does not count actual adapter executions. Built-in validation is not
represented by custom-rule counters, and a
malformed structured child can skip the root refinement.

KetJS validates the full draft on each edit and caches baseline validation until the baseline
or a tracked rule dependency changes. Compared with the earlier 500-field probe, this reduces
custom rule calls from 1,000 to 500 and removes 500 unchanged value/disabled assignments.
Primitive selectors prevent unchanged field-view effects but still read the whole draft signal.
At 250 variants, value/disabled/attribute writes are zero for a valid edit, while field and status
mirrors perform two text writes. In a separate
100-field probe, reading `session.values()` directly in every field effect executes **100 field
effects, including 99 unedited fields**, instead of one with primitive selectors. See
[form render subscriptions](/docs/form-validation/#render-subscriptions-and-cost).

The native regression fixture at `/regressions/` passes **4 cases and 46 assertions**, including
one control snapshot per update with 500 controls, one custom resolution per issue, dense error
visibility, dynamic controls, unchanged-write guards, multiple descriptions, native submitters,
disabled-fieldset preservation and unknown-outcome retry. Its reproduction steps are in
`bench/form-comparison/README.md`. These are deterministic operation/behavior checks, not dense-error
latency measurements.

This removes the measured default-lookup bottleneck. More selective draft/subscription work may
still help larger editors. The current validator is deliberately full-schema; incremental validation must preserve
cross-field and structured constraints. The timings do not establish a universal library ranking.
Array append/remove/reorder, comparative dense-error latency, async validation, memory/GC, mobile, Safari and actual
KetSuite editor performance remain unmeasured.

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
# Run from: ketjs/
npm run build
node tools/benchmark-report.mjs
node tools/benchmark-footprint.mjs
node tools/benchmark-browser.mjs
# Separate browser-form deployment; open its URL and click Run benchmark:
npm ci --prefix bench/form-comparison --ignore-scripts
npm start --prefix bench/form-comparison
# Separate terminal for the comparative fixtures:
npm ci --prefix bench/ssr-comparison --ignore-scripts
node tools/benchmark-ssr.mjs
# Docker must already have postgres:17.10-alpine; no shared service is modified.
node tools/benchmark-server-db.mjs
```

Open `http://127.0.0.1:3701/` and press **Run benchmark** for the real browser fixture. Save its JSON results and browser environment locally under `.artifacts/benchmarks/` before closing the benchmark page. The footprint command installs only the three named npm consumers into disposable directories.

The form comparison opens at `http://127.0.0.1:39751/` and saves completed runs automatically.
Its independent install and methodology are documented in `bench/form-comparison/README.md`.
Run `node --test bench/form-comparison/workload.test.mjs` for its focused harness checks.

## Not measured here

- Current EJS, Liquid, Knex, Drizzle and lit comparisons need pinned competitor versions and equivalent maintained fixtures.
- PostgreSQL queue throughput needs an isolated database service and a separately recorded run.
- Product, pricing, stock, hospitality and storage workloads belong to KetSuite or its deployment repositories. Their old numbers no longer appear as KetJS-framework benchmarks.
- Production HTTP capacity, concurrency/lock contention, layout/paint and full-page versus island timings need dedicated workloads beyond these local fixtures.

Those gaps are explicit; there are no reused historical numbers standing in for fresh measurements.
