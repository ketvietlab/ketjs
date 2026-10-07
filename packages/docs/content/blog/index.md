---
title: Engineering with KetJS
description: Eight in-depth articles on application contracts, database correctness, tenant isolation, rendering, effects, durable jobs, benchmarks and evaluating the KetJS preview.
---
Building an application means deciding where its rules live, how its data stays correct, and what happens when a request, browser or worker fails. This series explains how KetJS approaches those decisions, where the boundaries are, and what to verify in your own project.

## A reading path through the framework

Start with the application contract, then follow one operation from storage to the browser and background work:

1. [Why KetJS starts with an application contract](/blog/introducing-ketjs/) — modules, ownership and deployment composition.
2. [Database correctness before convenience](/blog/database-correctness/) — scopes, changesets, transactions and migration planning.
3. [Tenant isolation is more than a query filter](/blog/tenant-isolation/) — identity, company boundaries and authorization.
4. [HTML first, islands where interaction belongs](/blog/html-first-islands/) — static sites, SSR, hydration and persistent identity.
5. [Fetching data without losing control of effects](/blog/effects-and-data-loading/) — reactive dependencies, cancellation and stale responses.
6. [Durable jobs without a second source of truth](/blog/durable-jobs/) — atomic enqueueing, leases, retries and external side effects.
7. [What a framework benchmark actually tells you](/blog/reading-benchmarks/) — database, HTTP and rendering measurements with honest boundaries.
8. [How to evaluate a preview framework](/blog/evaluating-preview/) — a practical evaluation project, tests, upgrades and feedback.

These articles describe the current **KetJS 0.2.0 Preview**. The project is in active review, and APIs may change before 1.0. Use the [Docs](/docs/) for exact contracts and [Learn](/learn/) for step-by-step exercises; the blog explains the engineering choices behind them.
