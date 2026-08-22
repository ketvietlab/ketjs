---
title: Testing KetSuite
description: Run focused domain, HTTP, UI contract, dialect, and benchmark checks for KetSuite changes.
---

KetSuite tests execute emitted JavaScript. Build is the boundary from authored TypeScript and TSX to
the `.build/` test tree and package `dist/` directories; production-style tests do not depend on an
implicit TypeScript loader.

## Fast contributor loop

From the repository root:

```bash
npm ci
npm run build
npm run test:one -- test/partner-e2e.test.ts
```

`test:one` maps one or more authored paths under `test/` to their emitted `.build/test/*.js` files.
After source changes, run `npm run build` again before invoking `node --test` directly.

For a KetSuite change, select the smallest relevant set first:

```bash
node --test .build/test/partner-e2e.test.js
node --test .build/test/channel-api.test.js
node --test .build/test/backend-ui.test.js
```

Run repository-wide `npm run verify` only after focused tests pass or when preparing the final handoff.
It formats, lints, builds, checks types, audits public and UI boundaries, and runs the complete emitted
test suite.

## Test layers

| Layer | Use it for | Typical boundary |
| --- | --- | --- |
| Pure helper | Parsing, rounding, state transitions, deterministic calculations | Direct function call with no datastore |
| Domain integration | Models, functions, transactions, idempotency, and scope | `compose()`, `migrateOne()`, `callFn()`, SQLite adapter |
| HTTP end-to-end | Sessions, permissions, cookies, routes, forms, locale, redirects | `createTestApp(ketsuite)` and its client |
| UI contract | Shared component markup, hooks, exports, CSS ownership | Server-rendered component and audit tests |
| Dialect integration | Locks, constraints, concurrency, and SQL behavior | Isolated PostgreSQL database when configured |
| Benchmark | Regression signals on representative data volume | Named scripts under `bench/` |

Most features need domain integration plus one HTTP end-to-end path. A route-only test cannot prove a
transactional invariant, and a direct `callFn()` test cannot prove staff authentication or form behavior.

## End-to-end setup

Use framework fixtures only for setup; exercise the behavior under test through the real client:

```ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createTestApp } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '@ketvietlab/ketsuite/app'

test('partner command crosses the staff HTTP boundary', async (t) => {
  const e2e = await createTestApp(ketsuite, { worker: false })
  t.after(() => e2e.close())

  const scope = { company: 'acme', branches: null }
  const fixture = (name: string, input: Record<string, unknown>) =>
    e2e.fixture.call(name, input, { scope })
  await fixture('partner.savePartner', {
    id: 'acme-party',
    kind: 'company',
    name: 'ACME',
  })
  await fixture('company.saveCompany', {
    id: 'acme',
    partnerId: 'acme-party',
    currency: 'VND',
  })
  await fixture('user.createUser', {
    id: 'admin',
    login: 'admin',
    password: 'test-only-password',
    name: 'Administrator',
    defaultCompanyId: 'acme',
    superuser: true,
  })
  await fixture('user.grantCompany', {
    id: 'admin:acme',
    userId: 'admin',
    companyId: 'acme',
  })

  await e2e.client.login({ login: 'admin', password: 'test-only-password' })
  const result = await e2e.client.call('partner.savePartner', {
    id: 'customer',
    kind: 'company',
    name: 'Example customer',
  })
  assert.equal((result.value as { ok: boolean }).ok, true)
})
```

Create staff, company grants, and branch grants explicitly when the scenario depends on them. Keep
fixture calls out of the action being asserted; otherwise the test skips the HTTP authorization boundary.
Always close the harness through the test lifecycle.

## What to assert

A focused suite should cover:

- successful command and stable output;
- field-level validation failure without a partial write;
- permission denial for a user missing the function grant;
- company or branch isolation where scoped models are involved;
- idempotent replay or conflict for externally retryable commands;
- English and Vietnamese rendering for new visible messages;
- redirect and form-value preservation for backend mutations;
- worker drain and durable state for queued behavior.

Use SQLite for the normal isolated loop. Add a PostgreSQL case when correctness depends on dialect
behavior, concurrent writers, indexes, or locks. PostgreSQL tests should create and remove their own
database and use the repository's configured test URL rather than a developer's production connection.

## UI and generated artifacts

`test/backend-ui.test.ts` and `tools/ui-audit.ts` enforce the shared markup and CSS-hook contract. Add
or update a representative contract case when changing a shared component. A vertical screen still
needs an HTTP test to prove real data assembly and translations.

Screenshots and generated browser evidence are disposable test output. Inspect them locally when visual
behavior matters, keep reusable fixtures intentionally small, and do not commit PR evidence images into
the documentation tree or Git history.

For harness details, cookies, tenant clients, and workers, continue with KetJS
[Testing](/ketjs/testing/).
