---
title: Loyalty benchmark evidence
description: Reproducible benchmark notes for KetSuite Loyalty workloads.
---

# Loyalty benchmark evidence

Generated on 2026-08-20 immediately before the implementation commit.

## Environment

| Item | Value |
| --- | --- |
| Base | `884d9a1806a8b8f7c9ccacca481f04798dd5aa80` (`origin/develop`) |
| Head under test | `feat/loyalty-domain` working tree based on `884d9a1` |
| Node / npm | Node `v26.7.0`, npm `11.19.0` |
| OS | macOS `26.2` (`darwin 25.2.0`) |
| CPU | Apple M1 Pro (`MacBookPro18,1`) |
| PostgreSQL client/server target | PostgreSQL `17.2`, `127.0.0.1:5435` |
| SQLite | isolated temporary file per benchmark process |
| PostgreSQL | generated `ket_loyalty_bench_<pid>` database, dropped on completion |

The host was under substantial unrelated interactive load. At the final evidence check, load averages were
`41.83 / 45.94 / 66.91`. No unrelated user process was stopped. Median and p95 are therefore reported without
a hard pass/fail threshold, and surprising cross-cutting results were repeated and investigated below.

## Commands and fixture

```sh
export PATH=/Users/kieuduy/.nvm/versions/node/v26.7.0/bin:$PATH

# Existing framework/domain/collaboration regression suite, in base then head worktrees.
npm run bench

# Existing Partner/identity PostgreSQL suite, in base then head worktrees.
KET_BENCH_PG=postgres://dev:devpassword@127.0.0.1:5435/ket_loyalty_identity_bench_20260820 \
  npm run bench:identity

# Loyalty, first SQLite and then PostgreSQL.
KET_BENCH_DRIVER=sqlite KET_BENCH_COMMIT=feat/loyalty-domain@884d9a1 \
  npm run bench:loyalty
KET_BENCH_DRIVER=postgres \
  KET_BENCH_PG=postgres://dev:devpassword@127.0.0.1:5435/postgres \
  KET_BENCH_COMMIT=feat/loyalty-domain@884d9a1 npm run bench:loyalty
```

`bench:loyalty` calls the public function boundary. Each driver receives one warm-up plus seven measured
runs over 50 programs, 250 rules, 1,000 carts with 10 lines, 1,000 apply/remove mutations, 1,000 Sale/POS
finalizations, 1,000 reversals, 100 two-request wallet races, and 1,000 membership refreshes per run.

## Final Loyalty result

### SQLite

Generated at `2026-08-20T07:06:57.830Z`.

| Workload | Median (ms) | p95 (ms) | Throughput (ops/s) |
| --- | ---: | ---: | ---: |
| Evaluate 1,000 carts × 10 lines / 50 programs / 250 rules | 2.776 | 8.484 | 271 |
| Apply and remove reward | 0.864 | 2.146 | 851 |
| Finalize Sale/POS orders with earn and redeem ledger | 1.659 | 5.296 | 279 |
| Ledger reversal | 6.485 | 18.009 | 117 |
| Concurrent wallet redemption | 1.188 | 4.258 | 384 |
| Membership refresh | 0.284 | 1.128 | 1,951 |

### PostgreSQL

Generated at `2026-08-20T07:25:05.775Z`. The generated database was
`127.0.0.1:5435/ket_loyalty_bench_36178` and was removed by the harness after a successful run.

| Workload | Median (ms) | p95 (ms) | Throughput (ops/s) |
| --- | ---: | ---: | ---: |
| Evaluate 1,000 carts × 10 lines / 50 programs / 250 rules | 5.375 | 14.875 | 139 |
| Apply and remove reward | 23.305 | 85.216 | 27 |
| Finalize Sale/POS orders with earn and redeem ledger | 25.494 | 56.137 | 20 |
| Ledger reversal | 20.993 | 50.297 | 38 |
| Concurrent wallet redemption | 16.136 | 35.928 | 27 |
| Membership refresh | 7.793 | 22.554 | 79 |

PostgreSQL is slower where real transactions, unique source keys, reservations, and row locking are part of
the operation. Row counts progressed linearly through 16,000 applications/reservations, immutable reversal
entries, and 800 race wallets including warm-up. Every race produced exactly one winner.

## Optimization performed before the final run

An initial exact PostgreSQL attempt showed non-linear time in cart evaluation and apply/remove. Inspection
found that product template and tag rows were loaded even after a direct product mismatch made a rule or
reward impossible. The engine now exits that match early when no category/tag fallback exists, and an
`onlyProgramId` evaluation scopes program-pricelist, rule, reward, membership-config, and earn-group reads.

The following diagnostic SQLite runs were made on the same former base (`a024c76`) before and after that
change. They are optimization evidence, not the final score after rebasing to `884d9a1`.

| Workload | Before median / p95 / ops/s | After median / p95 / ops/s | Median change |
| --- | --- | --- | ---: |
| Evaluate carts | 2.382 / 5.693 / 333 | 1.825 / 5.640 / 403 | -23.4% |
| Apply/remove reward | 1.740 / 4.529 / 425 | 1.003 / 3.833 / 664 | -42.4% |
| Concurrent redeem | 2.678 / 5.989 / 257 | 1.073 / 1.940 / 526 | -59.9% |

Reversal and membership paths do not use the eliminated product/tag lookups. Their variation was treated as
host noise, not attributed to this optimization.

## Base/head regression checks

The clean detached baseline worktree and the head worktree both used Node `v26.7.0`. Adding Loyalty changes
the composed sidebar HTML by exactly 639 bytes on the existing collaboration screens; this is expected app
navigation, not duplicated per-row markup.

### Framework and domain representative run

| Existing workload | Base | Head | Observation |
| --- | ---: | ---: | --- |
| Mount 1,000 view rows | 5.74 ms | 5.61 ms | Stable |
| Update one of 1,000 rows | 0.845 ms | 0.856 ms | Stable; still one host operation |
| Generate 125 variants | 10.56 ms | 9.56 ms | Stable |
| Resolve 1,000 prices | 86.26 ms | 103.52 ms | Repeated because the first head run was 20% slower |
| Reserve 100 stock moves | 25.20 ms | 23.91 ms | Stable |

Five additional process-level domain runs exposed broad host variance. Price resolution ranged from
`85.24–138.63 ms` on base and `81.77–371.04 ms` on head. The medians were `117.76 ms` and `126.28 ms`, but
two head samples were isolated `369–371 ms` spikes; without them the head median was `83.09 ms`. Variant and
stock workloads showed the same whole-process slow periods. Loyalty does not modify Product/Pricing/Stock
code on these paths, so there is no repeated path-specific regression to optimize from these samples.

### Collaboration HTTP p50

| Existing screen | Base p50 (ms) | Head p50 (ms) |
| --- | ---: | ---: |
| Product collaboration | 7.01 | 6.10 |
| Transfer collaboration | 5.33 | 4.93 |
| My activities | 3.79 | 3.86 |
| Calendar agenda | 4.26 | 2.95 |
| Calendar week | 5.07 | 3.81 |
| Calendar month | 3.32 | 4.46 |
| Notification inbox | 3.54 | 3.34 |
| Transactional outbox | 4.80 | 4.53 |
| Inbound email log | 3.01 | 3.36 |

The slower Calendar month and Inbound samples were not shared by adjacent screens and did not repeat as a
system-wide trend. No N+1 growth was observed; every screen received the same fixed 639-byte navigation
addition.

### Partner/identity PostgreSQL converged pair

Early alternating runs contained 2–3× p95 spikes on both base and head. The final adjacent pair converged as
follows and is used for the PR comparison.

| Existing workload | Base p50 / p95 (ms) | Head p50 / p95 (ms) | p50 change |
| --- | --- | --- | ---: |
| List first page / 500 seeded | 1.163 / 3.156 | 1.349 / 5.385 | +16.0% |
| Read partner detail | 1.980 / 3.779 | 2.039 / 4.552 | +3.0% |
| Idempotent role grant | 1.709 / 4.844 | 1.812 / 3.999 | +6.0% |
| Switch default address | 2.739 / 6.376 | 2.804 / 12.104 | +2.4% |

This benchmark imports and executes Partner/identity only; Loyalty is not composed into its manifest. The
p50 values converged within the observed host variance. The remaining p95 spread is disclosed rather than
hidden behind a regression threshold.

## Validation paired with this evidence

- Targeted Loyalty HTTP E2E and PostgreSQL concurrency: 8 passed, 0 failed.
- Full verification: 680 tests, 679 passed, one MinIO live test skipped, 0 failed.
- Type proofs: 11/11; format, lint, build, type check, zero-dependency audit, and UI audit passed.
- Visual evidence: 28 fresh PNGs from the final base, with Vietnamese `1440×900` and English `390×844` for
  every affected screen. DOM scans found no `undefined` value or leaked Loyalty translation key.
