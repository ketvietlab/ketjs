---
title: Lego CSR prototype evidence
description: Measured SSR and CSR partner-list variants built from a release-time KetJS browser plan.
---

# Lego CSR prototype evidence

This experiment does **not** support a production-wide CSR migration. The matched
SSR path is the fastest complete path in the tested first-page workload. Of the two
CSR variants, the planned variant is the better direction: at 120 ms RTT it makes
the 100,000-partner core usable in 790.8 ms rather than 927.6 ms and completes in
1,258.2 ms rather than 1,398.7 ms. It still completes 515.3 ms after matched SSR.

The recommended next step is therefore narrow and reversible: retain SSR as the
default, keep `csr-planned` behind the explicit prototype query, and optimize the
remaining query, transfer, and client-navigation costs before another decision.

## What was built

The partner host publishes one typed `partners:columns` joint with stable screen,
column, widget, and row-resource IDs. It does not import accounting. The separately
selected `account_partner_backend` bridge contributes a permission-gated balance
resource, money widget, and balance column. The benchmark can then select zero, one,
five, or ten extensions at release composition time. Counts above one add real
indexed metric-provider functions rather than timers or per-cell fake work.

Composition validates dependency ownership, joint compatibility, duplicate IDs,
resource and widget references, field bindings, and declared operations. It hashes
the result into one deterministic browser-plan revision. The request path projects
that plan through both the resource permission and source-function permission;
denied optional contributions, widget assets, and fetch endpoints are omitted
together. Each data response is projected to declared fields and must contain
exactly one row for every requested visible key. The browser repeats that
allowlist projection before a provider response can enter client state.

The generic client path reuses KetJS View and the canonical KetSuite `ListPage` and
`DataTable`. Its loader:

- batches resource calls over the 30 visible partner IDs rather than fetching per
  cell;
- deduplicates equal batches and bounds provider concurrency at four;
- cancels on disposal and rejects stale generations;
- distinguishes primary, essential, and deferred completion;
- scopes optional failures to their extension; and
- keys a 15-second context cache by an opaque viewer-session digest, projection,
  scope, query, resource, and IDs.

Adding or removing a contribution still means changing `DeploymentSpec.modules`
and releasing. There is no runtime marketplace, tenant-local installation state,
arbitrary template JavaScript, or client-side authorization filter.

## Compared execution modes

| Mode | Execution | Comparable feature set |
| --- | --- | --- |
| A — `ssr-current` | Existing SSR/island partner route | Historical only: five columns and no extension columns |
| B — `ssr-matched` | Optimized page query plus all visible extension values rendered on the server | Yes |
| C — `csr-two-stage` | HTML shell, browser primary-data request, then essential and deferred provider batches | Yes |
| D — `csr-planned` | Primary rows and essential values in the HTML bootstrap; deferred providers load in the browser | Yes |

B, C, and D share providers, authorization, projected fields, 30 row IDs, 16
desktop columns at ten extensions, translated labels, counts, tabs, selection,
search, pager, and host chrome. A deliberately records the current route but must
not be used to claim a rendering win: it has less functionality and uses the old
list/count query shape.

The default route remains A. B, C, and D are available only through
`prototype=ssr-matched`, `prototype=csr-two-stage`, or
`prototype=csr-planned`, so removing the experiment does not require changing the
host module contract or stored data.

## Fixture and method

The accepted run started at `2026-09-07T15:18:47Z` and completed at
`2026-09-07T15:46:16Z`. The working tree was based on
`657699eff2a151f9a3c59fd7b98ed7ccf44be307` on
`feat/lego-csr-bench-20260907`. It was intentionally dirty with the prototype
under measurement.

| Item | Measured value |
| --- | --- |
| Host | Linux `6.8.0-136-generic` |
| CPU / logical CPUs | Intel Xeon E5-2680 v4 at 2.40 GHz / 28 |
| Memory | 33.5 GB |
| Runtime / browser | Node `v24.20.0` / Google Chrome `152.0.7977.82` |
| Database | Isolated SQLite files, one connection/pool slot |
| Browser network | 100 Mbps down, 50 Mbps up; controlled 50/120/250 ms CDP latency |
| Browser provider concurrency | 4 |
| Main viewport | 1,440×1,000 desktop and 390×844 emulated mobile |
| Main sample size | 30 serial warm navigations per principal group |

`bench:lego-csr` creates fresh 10,000- and 100,000-partner databases, records
physical indexes and `EXPLAIN QUERY PLAN` output, measures server paths, drives
Chrome, runs bounded request bursts, and writes summaries and raw samples.

```sh
# Run from: /home/ubuntu/repos/ketjs-worktrees/lego-csr-bench-20260907
LEGO_RUN_ID=final-20260907T151828Z npm run bench:lego-csr
```

The 10,000-row database is 9,756,672 bytes and took 798.6 ms to seed. The
100,000-row database is 47,656,960 bytes and took 2,123.4 ms. The large fixture has
80,001 companies, 19,999 people, 50,000 customers, 33,333 suppliers, 100,000
metric rows, one posted move, and 31 move lines covering the 30 visible balances.
The metric data module is present in every release variant, keeping the physical
schema constant as screen providers are added or removed.

SQLite selected the declared indexes for all four recorded probes:
`partner_partner__active_name`, covering
`partner_role__role_partner`,
`account_move_line__company_partner_open`, and
`lego_metric_data_metric__partner`.

The harness produced 1,984 warm/route-first server samples, 840 browser attempt
records, and 120 load samples. There are 836 successful browser navigations. Four
transient attempts failed and succeeded on the next retry: three cold navigations
timed out while the screen phase had already rendered and stylesheet requests were
pending, and one warm D navigation saw Chromium `ERR_NETWORK_CHANGED`. Every
principal group still contains 30 successful samples. All server and load responses
returned HTTP 200.

“Warm browser” means the HTTP asset cache is warm. Every timed sample is a full
document navigation, so it creates a new JavaScript realm and does not preserve the
in-memory data cache. A separate probe confirms that the current tab links also
reload the document. Same-realm cache hits are covered by loader tests, not claimed
as a measured navigation improvement.

### Post-projection validation

A final review after the full-matrix run found that the primary data endpoint still
carried the partner model's undeclared `contactConsent` field even though no visible
column used it. The final implementation now projects primary rows through the same
declared field allowlist as joined resources and no longer publishes a generic
function endpoint for the query-aware primary resource. Generic joined endpoints
also fail composition if their function output contains an undeclared field.

The full tables below retain the accepted 30-sample figures rather than silently
mixing sample sizes. A separate post-projection validation run measured the
heaviest cell (100,000 partners and ten extensions) from
`2026-09-07T16:43:54Z` to `2026-09-07T16:50:55Z`. Its five principal desktop samples
per mode at 120 ms RTT produced complete medians of 1,072.8 ms (A), 743.6 ms (B),
1,411.3 ms (C), and 1,273.4 ms (D). Those values differ from the accepted medians by
at most 1.3%; the mode ordering, core/required ordering, 13-versus-11 data requests,
and six-versus-four data waves are unchanged. Its ten-sample sensitivity groups
again show C ahead of D at 50 ms (786.6 versus 861.3 ms) and D ahead at 250 ms
(2,328.0 versus 2,593.8 ms).

That run contains 48 server samples, 201 browser attempt records with 200 successful
navigations, 120 load samples, and a fresh 32-file desktop/mobile evidence set. One
cold-cache D navigation timed out after rendering primary rows while stylesheets
were pending and succeeded on its immediate retry. All server and load responses
were HTTP 200. A post-run payload and interaction probe confirmed the exact seven
primary fields, no `contactConsent`, all eight mode/viewport navigations, and the
Vietnamese mobile keyboard path.

The later cache-isolation and provider-coverage hardening does not change the query
or request topology behind those comparisons. A final PR-update smoke ran the built
tree from `2026-09-07T17:21:47Z` to `2026-09-07T17:22:20Z` with 100,000 partners and
ten extensions. Its 12 server samples were HTTP 200, all eight measured browser
navigations completed without a recorded error, and eight fresh desktop/mobile
captures produced 32 evidence files. Every DOM record had 30 rows, the expected
five or 16 columns, one shell and `ListPage`, zero document overflow, and no fatal
plan or widget error. This one-sample-per-temperature run is a correctness smoke,
not a replacement performance sample.

## Browser result at 120 ms RTT

The milestones are measured from navigation start. Core means usable primary rows,
required means essential values are ready, and complete includes optional visible
providers. A skeleton is not core data. SSR has no progressive browser marker, so
its three milestones collapse to the completed page load.

### Default directory

| Partners | Mode | Core p50 (ms) | Required p50 (ms) | Complete p50 (ms) | Complete p95 (ms) |
| ---: | --- | ---: | ---: | ---: | ---: |
| 10,000 | A — current SSR | 723.0 | 723.0 | 723.0 | 729.1 |
| 10,000 | B — matched SSR | 745.3 | 745.3 | 745.3 | 756.8 |
| 10,000 | C — two-stage CSR | 919.3 | 1,062.4 | 1,389.8 | 1,472.0 |
| 10,000 | D — planned CSR | 791.8 | 792.0 | 1,261.9 | 1,319.8 |
| 100,000 | A — current SSR | 1,085.1 | 1,085.1 | 1,085.1 | 1,153.5 |
| 100,000 | B — matched SSR | 742.9 | 742.9 | 742.9 | 755.3 |
| 100,000 | C — two-stage CSR | 927.6 | 1,072.2 | 1,398.7 | 1,497.0 |
| 100,000 | D — planned CSR | 790.8 | 790.8 | 1,258.2 | 1,320.2 |

At 100,000 rows, B's complete latency has a 0.9% coefficient of variation; C is
3.0%, D is 2.3%, and A is 6.2%. The optimized query makes B faster at 100,000 than
10,000 in this particular browser run; that small cross-size inversion is host
variation, not an algorithmic scaling claim.

### Role filter and mobile

| 100,000 partners / 10 extensions | A complete p50 | B complete p50 | C core / complete p50 | D core / complete p50 |
| --- | ---: | ---: | ---: | ---: |
| Default, desktop | 1,085.1 | **742.9** | 927.6 / 1,398.7 | 790.8 / 1,258.2 |
| Default, mobile | 1,080.2 | **745.9** | 918.3 / 1,374.1 | 796.0 / 1,284.0 |
| Customer, desktop | 1,659.6 | **1,157.1** | 1,305.5 / 1,747.7 | 1,197.1 / 1,666.2 |
| Customer, mobile | 1,647.9 | **1,174.3** | 1,306.1 / 1,768.4 | 1,198.0 / 1,687.2 |

The customer slowdown is primarily the existing role-filter query shape, not CSR
rendering. The path still materializes a large matching-partner and role-holder set
before slicing the page. D moves some work into the initial plan response; C's
small HTML-shell server time merely defers this cost to its browser data request.

## Requests, transfer, and client work

These are medians for the 100,000-row default desktop case at 120 ms RTT with ten
extensions and a warm asset cache.

| Mode | Transfer bytes | Requests | Data requests | Data waves | Long-task time (ms) | Hydrate / render (ms) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| A — current SSR | 158,954 | 38 | 0 | 0 | 0 | — |
| B — matched SSR | 210,835 | 38 | 0 | 0 | 0 | — |
| C — two-stage CSR | 201,803 | 55 | 13 | 6 | 263 | 1.6 / 125.0 |
| D — planned CSR | 317,471 | 53 | 11 | 4 | 165 | 23.0 / 99.0 |

D removes a primary/essential round trip and two observed waves compared with C.
Its current bootstrap, however, serializes rows and essential values alongside the
SSR table used for first display. That duplication makes D 106,636 bytes larger
than B and explains why a faster core does not become the fastest complete path.
C transfers fewer bytes than D but spends more time across sequential provider
waves and targeted DOM updates.

Largest Contentful Paint is not used as the CSR core metric because C's skeleton
can become the largest painted element before usable row data exists.

## RTT sensitivity

The following groups use 100,000 partners, ten extensions, the default desktop
directory, a warm asset cache, and ten samples per mode.

| RTT | Mode | Core p50 (ms) | Required p50 (ms) | Complete p50 / p95 (ms) | Data waves |
| ---: | --- | ---: | ---: | ---: | ---: |
| 50 ms | A — current SSR | 820.6 | 820.6 | 820.6 / 848.4 | — |
| 50 ms | B — matched SSR | 460.6 | 460.6 | **460.6 / 479.1** | — |
| 50 ms | C — two-stage CSR | 490.4 | 586.7 | 788.5 / 843.4 | 5 |
| 50 ms | D — planned CSR | 497.7 | 497.7 | 857.8 / 879.7 | 4 |
| 250 ms | A — current SSR | 1,603.1 | 1,603.1 | 1,603.1 / 1,623.1 | — |
| 250 ms | B — matched SSR | 1,396.5 | 1,396.5 | **1,396.5 / 1,402.1** | — |
| 250 ms | C — two-stage CSR | 1,700.6 | 1,985.1 | 2,588.7 / 2,611.0 | 6 |
| 250 ms | D — planned CSR | 1,452.3 | 1,452.4 | 2,330.6 / 2,341.7 | 4 |

D is better than C at 120 and 250 ms RTT, where eliminating a stage matters. At
50 ms, C happens to complete 69.3 ms earlier because D's duplicated bootstrap
transfer and hydration cost outweigh the saved latency. B remains the fastest
complete feature-equivalent path at every tested RTT.

## Extension scaling on natural localhost

This secondary coverage sweep has only three warm samples per cell and no injected
RTT. It is descriptive coverage, not a stable p95 claim.

| Extensions / 100,000 partners | A p50 (ms) | B p50 (ms) | C p50 (ms) | D p50 (ms) |
| ---: | ---: | ---: | ---: | ---: |
| 0 | 701.6 | **241.5** | 284.7 | 270.1 |
| 1 | 688.1 | **264.6** | 378.3 | 306.5 |
| 5 | 681.1 | **280.4** | 511.2 | 467.0 |
| 10 | 681.0 | **309.3** | 660.0 | 535.2 |

A is flat because it does not render the extensions. B's extra providers add
67.8 ms from zero to ten. C adds 375.3 ms and D adds 265.1 ms, making provider
transport/orchestration the next CSR bottleneck.

## Server query attribution

The following are 30 warm HTML request samples against 100,000 rows. Query and row
counts are medians. Database time is available in the raw summary but is not shown:
the instrumented calls can overlap under `Promise.all`, so summed adapter time can
exceed wall time and must not be treated as an exclusive breakdown.

| Role / extensions | Mode | Server p50 / p95 (ms) | DB queries | Rows returned to callers |
| --- | --- | ---: | ---: | ---: |
| Default / 0 | A — current SSR | 383.2 / 407.3 | 41 | 283,395 |
| Default / 0 | B — matched SSR | 33.3 / 43.2 | 33 | 57 |
| Default / 0 | C — CSR shell | 34.1 / 44.9 | 30 | 25 |
| Default / 0 | D — planned CSR | 36.7 / 43.4 | 33 | 57 |
| Default / 10 | A — current SSR | 390.5 / 427.9 | 41 | 283,395 |
| Default / 10 | B — matched SSR | 44.8 / 52.2 | 86 | 402 |
| Default / 10 | C — CSR shell | 33.2 / 40.1 | 50 | 45 |
| Default / 10 | D — planned CSR | 40.8 / 45.7 | 59 | 114 |
| Customer / 10 | A — current SSR | 958.7 / 980.9 | 43 | 583,364 |
| Customer / 10 | B — matched SSR | 445.1 / 469.9 | 88 | 150,358 |
| Customer / 10 | C — CSR shell | 35.0 / 47.5 | 51 | 46 |
| Customer / 10 | D — planned CSR | 450.8 / 462.1 | 61 | 150,070 |

The large A-to-B improvement is a query/projection improvement. It cannot be
credited to SSR or CSR rendering. C's server row count excludes its later browser
primary and provider calls, while B and D include all data embedded in their HTML
response. End-to-end browser milestones are the comparable result.

## Bounded HTML load probe

Each cell schedules ten requests against the 100,000-row, ten-extension, default
directory in one process with a one-slot SQLite pool. It is a short burst, not a
production capacity test.

| Mode | Offered requests/s | Response p50 / p95 (ms) | Achieved requests/s | Errors |
| --- | ---: | ---: | ---: | ---: |
| A — current SSR | 1 | 480.7 / 527.3 | 1.05 | 0 |
| A — current SSR | 10 | 1,545.3 / 3,091.8 | 2.56 | 0 |
| A — current SSR | 20 | 2,664.3 / 2,665.9 | 2.62 | 0 |
| B — matched SSR | 1 | 94.1 / 108.5 | 1.10 | 0 |
| B — matched SSR | 10 | 71.0 / 83.2 | 10.29 | 0 |
| B — matched SSR | 20 | 51.4 / 60.3 | 20.20 | 0 |
| C — CSR shell | 1 | 61.2 / 80.9 | 1.10 | 0 |
| C — CSR shell | 10 | 57.0 / 58.3 | 10.44 | 0 |
| C — CSR shell | 20 | 43.3 / 52.8 | 20.63 | 0 |
| D — planned CSR | 1 | 87.6 / 99.1 | 1.10 | 0 |
| D — planned CSR | 10 | 70.3 / 81.3 | 10.19 | 0 |
| D — planned CSR | 20 | 47.0 / 62.0 | 20.15 | 0 |

C measures only its HTML shell here, not the browser's complete journey. The
probe establishes bounded local behavior and A's saturation in this fixture; it
does not establish internet throughput, multi-process scaling, or PostgreSQL
capacity.

## Correctness and browser evidence

The accepted run contains eight screenshots, eight sanitized HAR files, eight
Chrome traces, and eight DOM metric records: four modes at desktop and mobile.
Inspection found:

- exactly one application shell, one canonical `ListPage`, one tabs region, one
  bulk form, and one select-all control in every mode;
- 30 rows in all modes; 16 columns for B/C/D at ten extensions and five historical
  columns for A;
- stable CSR row identities while resources complete;
- zero document-level horizontal overflow at 1,440 px and 390 px;
- the same 16-column DOM in matched mobile modes, with six core/essential cells
  visible under the existing responsive policy and optional metric cells hidden;
- no fatal plan/widget errors; and
- no cookie, `Set-Cookie`, or `Authorization` headers in the sanitized HAR files.

A separate Vietnamese 390×844 acceptance probe focused a row checkbox, toggled it
with Space, observed the select-all indeterminate state, and navigated the focused
first row with Enter. The target was
`/admin/partner/partners/bench-company-party?lang=vi`; the page title remained
“Đối tác,” the first balance was “1.000 ₫,” and no page or console error was
recorded. After the final UI-helper refactor, another eight-navigation smoke repeated
all four modes at both viewports: every response was 200, row/column counts matched,
each page had one shell and one `ListPage`, overflow stayed zero, and no browser,
plan, or widget error appeared.

Raw evidence is intentionally ignored by Git. From the repository root, the
accepted artifact locations are:

| Artifact | Local path |
| --- | --- |
| Concise verdict | `.artifacts/lego-csr/run-final-20260907T151828Z/result-summary.json` |
| Raw samples and database profiles | `.artifacts/lego-csr/run-final-20260907T151828Z/raw/` |
| Screenshots, HAR, traces, DOM metrics | `.artifacts/lego-csr/run-final-20260907T151828Z/browser-evidence/` |
| Mobile/keyboard/cache probe | `.artifacts/lego-csr/run-final-20260907T151828Z/browser-acceptance.json` |
| Post-projection validation summary | `.artifacts/lego-csr/run-post-projection-final-20260907T164352Z/validation-summary.json` |
| Post-projection raw samples and evidence | `.artifacts/lego-csr/run-post-projection-final-20260907T164352Z/` |
| Final PR-update smoke and evidence | `.artifacts/lego-csr/run-pr-update-final-20260907T1700Z/` |
| Current task status | `.artifacts/lego-csr/status.json` |

An earlier interrupted run is marked with `invalid.json` and is not used anywhere
in this report.

## Remaining gaps and decision

Proceed only with the experimental D path, not a general migration. Before another
decision:

1. Replace the role-filter materialization with an indexed SQL join/subquery that
   orders and paginates before returning rows, and make count semantics match.
2. Adopt or reuse the server-rendered table instead of serializing duplicate
   rows/essential values, then remeasure D's 317 KB transfer and hydration cost.
3. Bundle or orchestrate deferred providers into fewer HTTP waves while preserving
   server authorization and extension-scoped errors.
4. Add real client-side navigation if the product intends to benefit from the
   context cache; the current full-document tabs cannot.
5. Build the omitted `RecordPage` extension proof, including dirty-draft isolation,
   stale-refetch rejection, validation, and one server-owned save transaction.
6. Repeat against isolated PostgreSQL and a physical mobile device under controlled
   load.

The list loader unit tests cover batching, deduplication, bounded concurrency,
context-cache hits in one JavaScript realm, optional failure, abort/disposal, and
stale-response suppression. They do not substitute for the missing RecordPage
draft/transaction proof. Balance and metric columns are explicitly display-only;
global sort/filter by an enriched value was not implemented or claimed.

The evidence supports the release-time lego contracts and the generic renderer as
a viable experiment. It does not show a first-page latency reason to replace
matched SSR today.
