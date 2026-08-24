---
title: Testing
description: Exercise KetJS applications through real HTTP, isolated datastores, sessions, tenants, and durable workers.
---

`@ketvietlab/ketjs/testing` boots a real `DeploymentSpec` on an ephemeral port and provides a cookie-aware HTTP client.
This boundary covers request parsing, tenant resolution, sessions, permissions, output projection, and
error serialization. Direct `callFn()` tests remain useful integration tests, but they do not cover those
HTTP seams.

## First end-to-end test

```ts
// File: test/order.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ordersApp } from '../deployment.ts'

test('an order can be listed', async (t) => {
  const e2e = await createTestDeployment(ordersApp, {
    worker: false,
    client: { company: 'acme' },
  })
  t.after(() => e2e.close())

  await e2e.fixture.call('order.create', {
    id: 'order-1',
    customer: 'customer-1',
  })

  const result = await e2e.client.call<Array<{ id: string }>>('order.list', {})
  assert.deepEqual(result.value.map((row) => row.id), ['order-1'])
})
```

Always register `close()` with the test lifecycle or use `try/finally`. Cleanup is idempotent.

## Isolation model

Each `createTestDeployment()` call creates a private temporary directory containing:

- a file-backed SQLite database;
- local object storage;
- artifacts written by the test harness.

A file-backed database is intentional: the HTTP runtime and worker may open different adapters and must
observe the same committed state. `close()` shuts down the server and worker, closes adapters, and removes
the directory.

The harness does not inherit the host process environment by default. A developer's `DATABASE_URL` cannot
silently redirect an isolated test to a real database.

```ts
// File: test/order.test.ts
const e2e = await createTestDeployment(app, {
  env: { KET_QUEUE_NOTIFY: '0' },
  worker: false,
  keepArtifacts: true,
  log: console.log,
  workerLog: console.log,
})
```

Use `inheritEnv: true` only for an intentional integration test. Set `artifactsDir` when the caller should
own the directory; `close()` does not remove caller-owned artifacts.

## The test client

`e2e.client` wraps standard `fetch`:

- `get()`, `post()`, and `request()` return the real `Response`;
- `json()`, `form()`, and `call()` parse successful responses;
- non-2xx parsed calls throw `TestHttpError` with `status`, `response`, and `body`.

```ts
// File: test/order.test.ts
import { TestHttpError } from '@ketvietlab/ketjs/testing'

const response = await e2e.client.get('/health')
assert.equal(response.status, 200)

await assert.rejects(
  () => e2e.client.call('unknown.function'),
  (error) => error instanceof TestHttpError && error.status === 400,
)
```

A function call returns the complete Ket result, including `value`, `writes`, `dryRun`, and `replayed`:

```ts
// File: test/order.test.ts
const preview = await e2e.client.call(
  'order.create',
  { id: 'order-1', customer: 'customer-1' },
  { dryRun: true },
)

assert.equal(preview.dryRun, true)
assert.equal(preview.writes.length, 1)

await e2e.client.call('order.create', input, {
  idempotencyKey: 'order-import-0001',
})
```

## Identities, sessions, and cookies

Create immutable client variants for separate request identities:

```ts
// File: test/order.test.ts
const acme = e2e.client.as({
  company: 'acme',
  companies: ['acme', 'subsidiary'],
  branch: 'hcm',
  branches: ['hcm', 'hn'],
  locale: 'en',
})

const tenant = e2e.client.as({ tenant: 'acme' })
const customTenant = e2e.client.as({ tenant: 'acme', tenantHeader: 'x-database' })
```

Apps with sessions ignore development company headers. Authenticate through the real route:

```ts
// File: test/order.test.ts
await e2e.client.login({ login: 'admin', password: 'secret' })
await e2e.client.call('order.privateList')
await e2e.client.logout()
```

The cookie jar captures cookies across same-origin redirects and applies deletion attributes. Clone it for
another client or save it with file mode `0600`:

```ts
// File: test/order.test.ts
import { CookieJar } from '@ketvietlab/ketjs/testing'

await e2e.client.jar.save('.ket/admin.cookies.json')
const jar = await CookieJar.load('.ket/admin.cookies.json')
const restored = e2e.client.with({ jar })
const anonymous = restored.anonymous()
```

The client refuses direct cross-origin requests and does not follow cross-origin redirects. This prevents
cookies and identity headers from leaking to an external OAuth or payment host.

## Fixtures

Fixtures are an explicit setup bypass. They call declared Ket functions and retain input, effect, and output
validation, but they do not apply HTTP identity permissions.

```ts
// File: test/order.test.ts
await e2e.fixture.call(
  'user.create',
  { id: 'admin', login: 'admin' },
  { scope: { company: 'acme', branches: null } },
)
```

Keep the behavior under test on `e2e.client`. If setup and action both use fixtures, the scenario is an
integration test rather than an end-to-end test.

For an invariant with no public read function, inspect the selected tenant adapter:

```ts
// File: test/order.test.ts
await e2e.fixture.withTenant('', async ({ adapter }) => {
  const rows = await adapter.all('SELECT id FROM sales_order')
  assert.equal(rows.length, 1)
})
```

A multi-tenant fixture requires an explicit tenant key.

## Durable jobs

When the deployment declares worker queues, the harness opens a worker handle against the same isolated database.
It does not leave a polling loop running. Drain at the point where asynchronous work must settle:

```ts
// File: test/order.test.ts
await e2e.client.call('order.requestExport', {})
const completed = await e2e.drainJobs()
assert.equal(completed, 1)
```

Set `worker: false` for scenarios that cannot enqueue jobs. Calling `drainJobs()` without a worker fails.

## Run emitted tests

`ket test` delegates to Node's test runner and requires emitted JavaScript artifacts:

```bash
# Run from: /path/to/example-app
ket test dist/test
ket test test/order.test.ts --out-dir dist
ket test dist/test --test-name-pattern checkout
ket test dist/test --coverage
ket test dist/test --watch
```

Authored `.ts` and `.tsx` paths are mapped to `--out-dir`, `.build`, and then `dist`. KetJS reports a
build-first error when an artifact is absent; production-style tests never execute TypeScript implicitly.
Pass additional Node test arguments after `--`.

## Smoke-test a function

`ket call` uses the same HTTP and cookie behavior:

```bash
# Run from: /path/to/example-app
ket call order.list \
  --against http://127.0.0.1:3000 \
  --company acme \
  --input '{"limit":10}'

ket call order.create \
  --against http://127.0.0.1:3000 \
  --input @fixtures/order.json \
  --idempotency-key order-import-0001
```

Without `--against`, the CLI loads the workspace app on an ephemeral port and closes it after the request.
That uses the deployment's configured datastore. Add `--isolated` for a temporary database and storage directory.

## Test boundary checklist

- Use direct `callFn()` tests for operation logic and real HTTP for request behavior.
- Use one isolated app per test or suite ownership boundary.
- Exercise permission denial as well as success.
- Test at least two companies or tenants when the deployment supports them.
- Drain jobs explicitly; do not wait with arbitrary sleeps.
- Assert durable state or public output, not internal process timing.
- Close every harness even when an assertion fails.
