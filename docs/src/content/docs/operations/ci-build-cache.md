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
prefix restore keys, node_modules, database contents, credentials or test-result
caches. Fork pull requests can restore visible caches but do not save them.

The existing builder always runs after restore. It regenerates browser assets and
checks its source fingerprint before skipping TypeScript emission and workspace
copying. This preserves the existing build contract; a cache hit does not skip
quality checks or SQLite/PostgreSQL tests. Release verification and publication
checks remain mandatory. Job summaries show the exact cache key and hit/miss.

Quality builds populate the cache before dependent PostgreSQL matrix jobs run.
Permission and release workflows use the same action. Cache eviction is harmless:
a miss builds normally. GitHub isolates PR caches from parent branches, so a new
master/tag run may build once even after a successful release PR.

This initial contract caches the complete framework build as one task. It does not
claim per-package incremental compilation or remote test caching. Browser bundle
generation still runs on a hit; measure that cost before introducing finer task
boundaries. GitHub-hosted remains the default runner; self-hosted is opt-in backup.

Run the focused cache-key tests without compiling the framework:

```sh
# Run from: ketjs
node --test tools/ci-build-cache-key.test.mjs
```

See [GitHub cache restrictions](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching#restrictions-for-accessing-a-cache)
for branch visibility and eviction behavior.
