---
title: CI build cache
---

KetJS CI shares compiled build artifacts through GitHub Actions cache. This is a
content-addressed build cache, separate from setup-node's npm download cache.

The key hashes every tracked file in packages, apps, examples, tests, tools and
benchmarks, root package/lock/TypeScript/workspace configuration, and the build
action. Node's exact version, operating system and CPU architecture also enter the
key. A source, asset, compiler dependency or configuration change causes a miss.
No commit SHA enters the key; identical input trees can reuse artifacts across
commits within GitHub's cache visibility rules.

Only `.build`, `.types` and package `dist` directories are cached. There are no
prefix restore keys, node_modules, database contents or credentials in the build cache. Fork pull requests can restore visible caches but do not save them.

The existing builder always runs after restore. It regenerates browser assets and
checks its source fingerprint before skipping TypeScript emission and workspace
copying. This preserves the existing build contract; a cache hit does not skip
SQLite/PostgreSQL tests. Deterministic quality tasks use the separate result cache described below. Release verification and publication
checks remain mandatory. Job summaries show the exact cache key and hit/miss.

Quality builds populate the cache before dependent PostgreSQL matrix jobs run.
Permission and release workflows use the same action. Cache eviction is harmless:
a miss builds normally. GitHub isolates PR caches from parent branches, so a new
master/tag run may build once even after a successful release PR.

This initial contract caches the complete framework build as one task. It does not
claim per-package incremental compilation. Browser bundle
generation still runs on a hit; measure that cost before introducing finer task
boundaries. GitHub-hosted remains the default runner; self-hosted is opt-in backup.

Run the focused cache-key tests without compiling the framework:

```sh
# Run from: ketjs
node --test tools/ci-build-cache-key.test.mjs
```

See [GitHub cache restrictions](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching#restrictions-for-accessing-a-cache)
for branch visibility and eviction behavior.


## Deterministic task cache (local and CI)

`npm run ci:task -- <task>` uses the same runner locally and on GitHub-hosted
or backup self-hosted runners. Supported tasks are `format`, `lint`, `types`,
and `unit-cache` (only the build/task-cache contract tests). It records successful,
output-free checks in ignored `.task-cache/<task>/` directories. It does not cache
the general unit suite, database tests, browser tests, permission evidence,
diff-dependent governance checks, tarball smoke checks or publication.

```sh
# Run from: ketjs
npm run ci:task -- lint
npm run ci:task -- lint --force
```

Use an installed lockfile dependency tree (`npm ci`) and build before `types`,
as in the existing CI pipeline. Each task key hashes its command, all tracked and
non-ignored untracked file contents (including uncommitted edits and deletions),
lockfiles/configuration, installed tool manifests and npm install lock, exact Node
version, OS and CPU architecture. Type checking additionally hashes ignored
outputs under source roots and `.types`, excluding node_modules. Different tasks
and Mac/Linux installations cannot share results. No timestamp or commit SHA is
used. This deliberately conservative repository-wide input closure invalidates
all affected checks on any authored change; it is not yet per-package dependency
graph scheduling like Turbo.

Tasks run with a controlled environment: `CI=true`, `TZ=UTC`, `LANG=C.UTF-8`,
`NO_COLOR=1`, plus system path/home/temp variables. Other caller variables,
including `NODE_OPTIONS`, credentials and database URLs, are not forwarded.
New environment-dependent tasks require an explicit reviewed input contract.
Hand-patching node_modules is not supported; reinstall from the lockfile.

The runner prints HIT/MISS/FORCE and the hash. Only exit code zero produces an
atomic receipt, and it rechecks inputs after execution: editing during a check
fails without saving success. Corrupt receipts rerun normally. `--force` removes
that key's previous success first, so a failed rerun cannot leave a stale pass.
Deleting `.task-cache` is safe and causes fresh checks. Old local receipts can be
removed this way to reclaim disk space.

The task-cache composite restores/saves exact keys only; a restored entry is
validated by the runner. Fork PRs cannot save. Local results remain local by
default; no GitHub credentials or network are required by the runner. Actions
Cache transports CI receipts, subject to GitHub branch visibility restrictions.
PR-created cache entries are not accessible to a subsequent tag run. There is no
cross-branch remote cache service or automatic local-to-CI upload.

Verify quality and release workflows use the same action. The `verify` script
also invokes cached format/lint/types, allowing release checks to reuse receipts
from the preceding action steps. Other release gates always execute.

Focused verification:

```sh
# Run from: ketjs
node --test tools/ci-build-cache-key.test.mjs tools/ci-task-cache.test.mjs
```
