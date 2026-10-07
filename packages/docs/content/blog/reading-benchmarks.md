---
title: What a framework benchmark actually tells you
description: Read KetJS database, HTTP and SSR comparisons by workload, durability settings and measured boundary instead of treating a chart as a universal ranking.
date: "2026-10-02"
order: 7
---
A bar chart can make a framework comparison look definitive. One bar is longer, so the decision seems obvious. But a point lookup, an HTTP JSON response and a transaction that validates business state are different operations, even when all three are reported as “performance.”

The KetJS [benchmark page](/docs/benchmarks/) separates database, server and rendering measurements. Its charts are useful evidence when read with their fixtures and limitations. They are not a claim that KetJS wins every workload or that a Preview release has proven production capacity.

This article explains how to interpret those measurements and how to design a follow-up benchmark for an actual application.

## Name the measured boundary first

A raw database driver baseline measures a lower-level path. A KetJS adapter adds its adapter behavior. An HTTP endpoint adds request handling and serialization. A domain operation may further include validation, scope, permissions and several statements.

Before comparing numbers, ask which of those layers is inside timing. A fast raw lookup cannot establish the throughput of a full payment approval, and a slow HTTP result cannot automatically identify the database as the bottleneck.

A helpful report names the engine, driver, framework version, workload and unit. “Requests per second” describes completed HTTP requests. “Transactions per second” describes completed transactions. Counting a transaction containing 25 inserts as 25 transactions would inflate the result without improving the system.

## Database work deserves its own measurements

The current database fixtures use 50,000 products and relevant indexes. Workloads include primary-key reads, tenant-filtered indexed ranges, individually committed inserts, transactions containing multiple inserts and balance transfers.

Each workload answers a different question. Point lookups expose a short access path. Range reads include filtering and materializing several results. Committed inserts include durability overhead. A balance transfer tests related writes inside a transaction.

The benchmark also checks results: expected rows, insert counts, total balances and rollback correctness. Throughput without correctness checks can reward a path that does less work than intended. An implementation that omits a commit or returns an empty result is not a meaningful optimization.

These are adapter measurements. They do not include a full domain-function call with all business validation and authorization. Keep that exclusion visible when discussing the charts.

## Durability settings can dominate write results

SQLite measurements use an on-disk database, WAL and `synchronous=FULL`. That is meaningfully different from an in-memory database or a relaxed durability setting.

PostgreSQL measurements use a disposable local container, `synchronous_commit=on` and a one-connection pool for both compared paths. They include the local TCP and container environment. That fixture does not model every production connection pool or network.

Compare bars inside the same engine and workload. A SQLite bar and a PostgreSQL bar differ in engine, access path and environment; their ratio is not a universal database ranking. If your application needs many concurrent writers, run a contention fixture that represents them.

Changing settings is legitimate when it represents the desired deployment, but disclose it. A higher throughput number bought by accepting different failure behavior is a tradeoff, not a free speedup.

## HTTP JSON and database endpoints isolate different costs

A small JSON response is useful for observing routing and serialization overhead. A database-backed endpoint includes additional work, and may shift the dominant cost away from the HTTP framework.

For server comparisons, examine concurrency, response payload, query shape and connection limits. Two endpoints called “database read” are not comparable if one performs an indexed lookup and the other scans a table. A pool change can alter throughput without any routing change at all.

The current charts include other HTTP frameworks and a Node HTTP baseline. Read those as implementations of the fixture, not complete substitutes for a business application's modules, permission contracts and workers. Similar fixture performance does not imply identical functionality.

## SSR throughput is not browser responsiveness

Server rendering fixtures compare equivalent output shapes at specified row counts. A larger list exercises more template work than a tiny page, and its result may change the relative costs.

Those measurements exclude browser hydration, event handling, bundle download and network latency. An SSR throughput advantage cannot prove a smoother task editor on a phone. Browser performance needs its own interaction and loading fixtures.

Also check whether server work is pure rendering or includes application data loading. Comparing a renderer with an endpoint that queries a database answers no clear renderer question. Isolate the layers first, then measure the end-to-end path separately.

## Repeated runs show uncertainty

The published summaries use medians across independent Node processes and balance framework order. This reduces the influence of one unusually fast run and some order effects, but does not remove all environmental variation.

Read the spread where reported. Close medians with overlapping ranges should not be presented as a decisive victory. Background load, warm-up and machine configuration can influence short local runs.

When the code changes, rerun the applicable fixture and record the version and environment. Do not carry an old release's result into new documentation just because the label still says “KetJS.” The maintained [benchmark reference](/docs/benchmarks/) is the place for current values; this article deliberately explains interpretation rather than duplicating numbers that will age.

## Benchmark the decision you are about to make

If a product relies on a company-filtered list, test representative row counts and indexes. If it relies on frequent writes, measure commit latency, concurrent writers and failure recovery. If users complain about navigation, measure the browser experience rather than quoting SSR throughput.

Preserve a correctness assertion in each fixture and identify which settings must remain equivalent. Report the result as evidence for that workload, with its limitations beside it.

The next article, [evaluating a preview framework](/blog/evaluating-preview/), turns those measurements into one part of a broader evaluation: can your team understand, test and upgrade the application it builds?
