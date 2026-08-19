# Headless end-to-end testing

Ket's end-to-end boundary is HTTP, not a browser. A test that calls `callFn()`
directly is useful, but it does not exercise request parsing, sessions, permissions,
tenant resolution, response projection or error serialization. `ketjs/testing`
boots the real `AppSpec` on an ephemeral port and gives the test an HTTP client.
No UI or browser is involved.

## First test

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestApp } from 'ketjs/testing'
import { ketsuite } from '../apps/ketsuite/app.ts'

test('a product can be listed', async () => {
  const e2e = await createTestApp(ketsuite, {
    worker: false,
    client: { company: 'acme' },
  })
  try {
    await e2e.fixture.call('product.saveTemplate', {
      id: 'p1',
      name: 'Áo thun',
      type: 'goods',
    })

    // This crosses the real POST /_ket/fn/product.listTemplates endpoint.
    const result = await e2e.client.call<Array<{ id: string; name: string }>>(
      'product.listTemplates',
      {},
    )
    assert.deepEqual(result.value.map((row) => row.id), ['p1'])
  } finally {
    await e2e.close()
  }
})
```

Always register `close()` with `t.after()` or use `try/finally`. Cleanup is
idempotent, so doing both is harmless:

```ts
test('flow', async (t) => {
  const e2e = await createTestApp(app)
  t.after(() => e2e.close())
  // ...
})
```

## Isolation

By default every `createTestApp()` call creates one private directory containing:

- a file-backed SQLite database;
- local blob storage;
- any cookie files or test artifacts the test writes there.

A file-backed database, rather than `:memory:`, is deliberate: the HTTP process
and worker open separate adapters and must observe the same committed rows. The
directory is recursively removed by `close()`.

The host process environment is **not inherited**. This prevents a developer with
`DATABASE_URL` set in their terminal from accidentally running a test against that
database. Opt in only when the test really needs it:

```ts
await createTestApp(app, {
  inheritEnv: true,
  env: { KET_QUEUE_NOTIFY: '0' },
})
```

Other isolation controls:

```ts
await createTestApp(app, {
  env: { KET_SQLITE: ':memory:' }, // only when no second adapter/worker needs it
  artifactsDir: './tmp/e2e',       // caller-owned; close() never removes it
  keepArtifacts: true,             // retain an automatically-created directory
  worker: false,                   // do not open a worker handle
  log: console.log,                // boot progress; silent by default
  workerLog: console.log,          // worker events; silent by default
})
```

`KET_SECRET` and `KET_STORAGE_DIR` receive isolated defaults. Migrations and the
app's bootstrap set run exactly as they do at normal boot.

## TestClient

`e2e.client` wraps standard `fetch`. `get()`, `post()` and `request()` return the
real `Response`, while `json()`, `form()` and `call()` parse successful responses
and throw `TestHttpError` for non-2xx status codes.

```ts
const page = await e2e.client.get('/health')
assert.equal(page.status, 200)

const body = await e2e.client.json<{ ok: boolean }>('/custom', { input: 1 })

await assert.rejects(
  () => e2e.client.call('unknown.function'),
  (error) => error instanceof TestHttpError && error.status === 400,
)
```

Function calls retain the complete Ket response, including `writes`, `dryRun` and
`replayed`:

```ts
const preview = await e2e.client.call(
  'product.saveTemplate',
  { id: 'p1', name: 'Demo', type: 'goods' },
  { dryRun: true },
)
assert.equal(preview.writes.length, 1)

await e2e.client.call('checkout.placeOrder', order, {
  idempotencyKey: 'order-001',
})
```

### Identity and tenants

Create clients for distinct request identities without sharing mutable headers:

```ts
const acme = e2e.client.as({
  company: 'acme',
  companies: ['acme', 'subsidiary'],
  branches: ['hcm', 'hn'],
  locale: 'vi',
})

const tenant = e2e.client.as({ tenant: 'acme' }) // sends x-tenant by default
const custom = e2e.client.as({ tenant: 'acme', tenantHeader: 'x-database' })
```

Tenant resolution belongs to the app. If it reads a query parameter, subdomain or
another header, set that through the URL or `headers` option instead.

Apps using sessions ignore the development company headers, just as they do in
production. Log in through HTTP:

```ts
await e2e.client.login({ login: 'admin', password: 'secret' })
await e2e.client.call('private.function')
await e2e.client.logout()
```

The cookie jar captures cookies on intermediate redirects, applies deletion via
`Max-Age=0`/`Expires`, and can be cloned or persisted:

```ts
await e2e.client.jar.save('.ket/e2e-admin.cookies.json')
const jar = await CookieJar.load('.ket/e2e-admin.cookies.json')
const restored = e2e.client.with({ jar })
const anonymous = e2e.client.anonymous()
```

Cookie files are written with mode `0600`.
Cross-origin redirects are returned to the test without being followed, so an app
session or identity header is never forwarded to an external OAuth/payment host.
Direct cross-origin requests are refused for the same reason.

## Fixtures and database assertions

Setup often needs to create a user before an authenticated public request can
exist. `e2e.fixture` is the explicitly named bypass for that setup. It still calls
a declared Ket function and retains input/effect/output checks, but does not apply
HTTP identity permissions.

```ts
await e2e.fixture.call('user.create', user, {
  scope: { company: 'acme', branches: null },
})
```

Keep the action under test on `e2e.client`. If both setup and action use fixtures,
the test is an integration test rather than an end-to-end test.

For invariants with no public read function:

```ts
await e2e.fixture.withTenant('', async ({ adapter }) => {
  const rows = await adapter.all('SELECT id FROM product_template')
  assert.equal(rows.length, 1)
})
```

A multi-tenant fixture call requires `options.tenant`; this prevents a setup step
from silently using a default customer database that does not exist.

## Durable jobs

When an app declares worker queues, the test harness opens a worker handle against
the same isolated datastore. It does not start a permanent polling loop. Drain it
at the point the scenario expects asynchronous work to settle:

```ts
await e2e.client.call('storage.requestSweep', {})
const completed = await e2e.drainJobs()
assert.equal(completed, 1)
```

Set `worker: false` for scenarios that do not enqueue jobs. Calling `drainJobs()`
without a worker fails loudly.

## Command line

### Run tests

`ket test` delegates to Node's test runner and runs emitted JavaScript artifacts:

```bash
ket test dist/test
ket test test/order.test.ts --out-dir dist
ket test dist/test --test-name-pattern checkout
ket test dist/test --coverage
ket test dist/test --watch
```

Authored `.ts`/`.tsx` paths are mapped to `--out-dir`, `.build`, then `dist`. A
missing artifact is refused with a build-first message; production-style tests do
not silently execute uncompiled TypeScript. In watch mode, keep the project's
compiler watcher running in another terminal so emitted JavaScript changes:

```bash
npm run build -- --watch
ket test dist/test --watch
```

Arguments after `--` are passed to Node's test runner.

### Smoke-call a development server

`ket call` uses the same cookie-aware HTTP client:

```bash
ket call product.listTemplates \
  --against http://127.0.0.1:3000 \
  --company acme \
  --input '{"limit":10}'

ket call checkout.placeOrder \
  --against http://127.0.0.1:3000 \
  --input @fixtures/order.json \
  --idempotency-key order-001
```

Input may be inline JSON, `@file`, or `-` for stdin. Use repeated `--header` flags
for app-specific tenant/auth headers. `--compact` emits one-line JSON and `--value`
prints only the function value.

Session workflow:

```bash
ket call product.listTemplates \
  --against http://127.0.0.1:3000 \
  --login @fixtures/admin-login.json \
  --cookie-file .ket/admin.cookies.json

# Later calls reuse and update the same session.
ket call product.listTemplates \
  --against http://127.0.0.1:3000 \
  --cookie-file .ket/admin.cookies.json
```

Without `--against`, the CLI loads the selected workspace app on port `0`, makes
the real HTTP request, then closes it. This uses the app's configured database.
Add `--isolated` to use a temporary test database and storage instead:

```bash
ket call public.health --workspace dist/ket.workspace.js --isolated
```

An app with sessions or restrictive permissions may correctly reject an isolated
anonymous call. Seed and authenticate in a test file when the flow needs protected
state; the CLI never adds an unchecked production bypass.

## Why not one rollback around a suite?

An end-to-end flow can cross several HTTP requests, pooled database connections,
worker adapters and storage writes. One outer transaction cannot contain all of
those without ceasing to represent production. Per-suite ephemeral resources give
real commit/visibility behaviour and deterministic cleanup instead.
