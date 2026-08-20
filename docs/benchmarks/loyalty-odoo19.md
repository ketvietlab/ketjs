# Loyalty Odoo 19 benchmark evidence

Generated on 2026-08-20 immediately before the implementation commit.

## Environment

| Item | Value |
| --- | --- |
| Base | `966c144ebffbb663edd8cc4a9ee352d4c90d4b50` (`origin/develop`) |
| Head under test | `feat/loyalty-odoo19` working tree based on `966c144` |
| Node / npm | Node `v26.7.0`, npm `11.19.0` |
| OS | macOS `26.2` (`darwin 25.2.0`) |
| CPU | Apple M1 Pro (`MacBookPro18,1`) |
| PostgreSQL client/server target | PostgreSQL `17.2`, `127.0.0.1:5435` |
| SQLite | isolated temporary file per benchmark process |
| PostgreSQL | generated `ket_loyalty_bench_<pid>` database, dropped on completion |

The host was under substantial unrelated interactive load. At the final evidence check, load averages were
`73.16 / 52.35 / 54.30`. No unrelated user process was stopped. Median and p95 are therefore reported without
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
KET_BENCH_DRIVER=sqlite KET_BENCH_COMMIT=feat/loyalty-odoo19@966c144 \
  npm run bench:loyalty
KET_BENCH_DRIVER=postgres \
  KET_BENCH_PG=postgres://dev:devpassword@127.0.0.1:5435/postgres \
  KET_BENCH_COMMIT=feat/loyalty-odoo19@966c144 npm run bench:loyalty
```

`bench:loyalty` calls the public function boundary. Each driver receives one warm-up plus seven measured
runs over 50 programs, 250 rules, 1,000 carts with 10 lines, 1,000 apply/remove mutations, 1,000 Sale/POS
finalizations, 1,000 reversals, 100 two-request wallet races, and 1,000 membership refreshes per run.

## Final Loyalty result

### SQLite

Generated at `2026-08-20T07:38:15.930Z`.

| Workload | Median (ms) | p95 (ms) | Throughput (ops/s) |
| --- | ---: | ---: | ---: |
| Evaluate 1,000 carts × 10 lines / 50 programs / 250 rules | 1.432 | 3.355 | 573 |
| Apply and remove reward | 0.909 | 2.870 | 769 |
| Finalize Sale/POS orders with earn and redeem ledger | 1.401 | 4.629 | 332 |
| Ledger reversal | 5.399 | 12.496 | 154 |
| Concurrent wallet redemption | 1.055 | 2.216 | 521 |
| Membership refresh | 0.240 | 0.571 | 3,161 |

### PostgreSQL

Generated at `2026-08-20T08:00:13.955Z`. The generated database was
`127.0.0.1:5435/ket_loyalty_bench_82127` and was removed by the harness after a successful run.

| Workload | Median (ms) | p95 (ms) | Throughput (ops/s) |
| --- | ---: | ---: | ---: |
| Evaluate 1,000 carts × 10 lines / 50 programs / 250 rules | 4.774 | 7.666 | 192 |
| Apply and remove reward | 20.951 | 62.752 | 34 |
| Finalize Sale/POS orders with earn and redeem ledger | 28.560 | 84.949 | 15 |
| Ledger reversal | 24.356 | 76.558 | 25 |
| Concurrent wallet redemption | 18.664 | 41.510 | 24 |
| Membership refresh | 8.659 | 32.375 | 57 |

PostgreSQL is slower where real transactions, unique source keys, reservations, and row locking are part of
the operation. Row counts progressed linearly through 16,000 applications/reservations, immutable reversal
entries, and 800 race wallets including warm-up. Every race produced exactly one winner.

## Optimization performed before the final run

An initial exact PostgreSQL attempt showed non-linear time in cart evaluation and apply/remove. Inspection
found that product template and tag rows were loaded even after a direct product mismatch made a rule or
reward impossible. The engine now exits that match early when no category/tag fallback exists, and an
`onlyProgramId` evaluation scopes program-pricelist, rule, reward, membership-config, and earn-group reads.

The following diagnostic SQLite runs were made on the same former base (`a024c76`) before and after that
change. They are optimization evidence, not the final score after rebasing to `966c144`.

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

### Framework and domain repeated runs

| Existing workload | Base | Head | Observation |
| --- | ---: | ---: | --- |
| Mount 1,000 view rows | 6.05 ms | 7.82 ms | Head was slower in both rounds; compiled benchmark/runtime files are byte-identical |
| Update one of 1,000 rows | 0.842 ms | 1.551 ms | Still exactly one host operation; byte-identical code path |
| Generate 125 variants | 12.27 ms | 11.25 ms | Stable after reversing run order |
| Resolve 1,000 prices | 92.72 ms | 90.85 ms | Stable after reversing run order |
| Reserve 100 stock moves | 23.41 ms | 24.55 ms | Stable after reversing run order |

The first base/head round measured domain at `10.88/101.21/29.02 ms` and
`22.63/133.73/32.71 ms`; every head workload and every collaboration screen slowed together. Running head
again before base produced the representative values above and removed that domain-wide slowdown. The view
benchmark still measured slower from the head worktree, but both `view.bench.js` and the compiled
`ketjs-view` entry have identical SHA-1 hashes across worktrees. Loyalty does not modify those files, so the
timing difference cannot be attributed to a changed view code path. It is disclosed as worktree/host
variance rather than converted into a threshold exception.

### Collaboration HTTP p50

| Existing screen | Base p50 (ms) | Head p50 (ms) |
| --- | ---: | ---: |
| Product collaboration | 6.55 | 5.77 |
| Transfer collaboration | 5.36 | 7.08 |
| My activities | 4.62 | 3.84 |
| Calendar agenda | 3.58 | 2.83 |
| Calendar week | 2.96 | 2.95 |
| Calendar month | 4.08 | 3.64 |
| Notification inbox | 4.24 | 3.25 |
| Transactional outbox | 5.06 | 3.15 |
| Inbound email log | 3.21 | 2.94 |

Only Transfer was slower in the reversed-order representative round; the other eight screens were stable or
faster. No N+1 growth was observed; every screen received the same fixed 639-byte navigation addition.

### Partner/identity PostgreSQL converged pair

The final adjacent base/head pair was run against the same dedicated database and fixture.

| Existing workload | Base p50 / p95 (ms) | Head p50 / p95 (ms) | p50 change |
| --- | --- | --- | ---: |
| List first page / 500 seeded | 1.020 / 2.108 | 1.158 / 2.856 | +13.5% |
| Read partner detail | 2.169 / 5.752 | 1.866 / 4.125 | -14.0% |
| Idempotent role grant | 1.887 / 4.138 | 1.851 / 8.550 | -1.9% |
| Switch default address | 3.252 / 16.662 | 2.446 / 9.987 | -24.8% |

This benchmark imports and executes Partner/identity only; Loyalty is not composed into its manifest. The
p50 values converged within the observed host variance and three of four improved. The isolated role-grant
p95 spread is disclosed rather than hidden behind a regression threshold.

## Validation paired with this evidence

- Targeted Loyalty HTTP E2E and PostgreSQL concurrency: 8 passed, 0 failed.
- Full verification: 696 tests, 695 passed, one MinIO live test skipped, 0 failed.
- The rebased `origin/develop` carried Biome failures in OIDC/user return-path checks. The head preserves the
  exact control-character rejection with documented lint suppressions and applies the suggested optional
  chaining; targeted OAuth/user tests passed 29/29.
- Type proofs: 11/11; format, lint, build, type check, zero-dependency audit, and UI audit passed.
- Visual evidence: 28 fresh PNGs from the final base, with Vietnamese `1440×900` and English `390×844` for
  every affected screen. DOM scans found no `undefined` value or leaked Loyalty translation key.
