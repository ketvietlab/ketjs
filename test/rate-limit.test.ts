import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import {
  claimRateSlot,
  defineDeployment,
  defineModule,
  pruneRateSlots,
  sqliteAdapter,
  text,
  type Adapter,
} from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'

const openDatabase = async (t: TestContext): Promise<Adapter> => {
  const adapter = sqliteAdapter(':memory:')
  await adapter.open()
  t.after(() => adapter.close())
  return adapter
}

const policy = { action: 'auth.signIn', key: 'someone', limit: 3, windowMs: 60_000 }

test('an allowance is spent, refused, and released when the window turns over', async (t) => {
  const adapter = await openDatabase(t)
  const at = (iso: string) => ({ now: new Date(iso) })

  const first = await claimRateSlot(adapter, policy, at('2026-09-05T10:00:00Z'))
  assert.deepEqual(first, { ok: true, remaining: 2, retryAfterMs: 0 })
  assert.equal((await claimRateSlot(adapter, policy, at('2026-09-05T10:00:10Z'))).remaining, 1)
  assert.equal((await claimRateSlot(adapter, policy, at('2026-09-05T10:00:20Z'))).remaining, 0)

  const refused = await claimRateSlot(adapter, policy, at('2026-09-05T10:00:30Z'))
  assert.equal(refused.ok, false)
  assert.equal(refused.remaining, 0)
  // Enough to answer with a retry-after the caller can act on.
  assert.equal(refused.retryAfterMs, 30_000)

  // The window is fixed, so it turns over a minute after it opened.
  const after = await claimRateSlot(adapter, policy, at('2026-09-05T10:01:00Z'))
  assert.equal(after.ok, true)
  assert.equal(after.remaining, 2)
})

test('a limit is per action and per key, not one counter for everyone', async (t) => {
  const adapter = await openDatabase(t)
  const now = { now: new Date('2026-09-05T10:00:00Z') }
  for (let i = 0; i < 3; i += 1) await claimRateSlot(adapter, policy, now)
  assert.equal((await claimRateSlot(adapter, policy, now)).ok, false)

  // Somebody else, same action.
  assert.equal((await claimRateSlot(adapter, { ...policy, key: 'other' }, now)).ok, true)
  // Same person, a different action.
  assert.equal((await claimRateSlot(adapter, { ...policy, action: 'auth.refresh' }, now)).ok, true)
})

test('the table holds a counter, not a record of who was where', async (t) => {
  const adapter = await openDatabase(t)
  await claimRateSlot(
    adapter,
    { ...policy, key: 'someone@example.com' },
    {
      now: new Date('2026-09-05T10:00:00Z'),
    },
  )

  const rows = await adapter.all('SELECT * FROM ket_rate', [])
  assert.equal(rows.length, 1)
  // The action is kept because it is low-cardinality and useful; the key is not,
  // because a rate-limit row has no reason to also be a location record.
  assert.equal(rows[0]!.action, 'auth.signIn')
  assert.doesNotMatch(JSON.stringify(rows[0]), /someone@example\.com/)
})

test('counters nobody will use again are pruned, and live ones are not', async (t) => {
  const adapter = await openDatabase(t)
  await claimRateSlot(adapter, { ...policy, key: 'stale' }, { now: new Date('2026-09-01T10:00:00Z') })
  await claimRateSlot(adapter, { ...policy, key: 'fresh' }, { now: new Date('2026-09-05T09:59:00Z') })

  const { removed } = await pruneRateSlots(adapter, {
    now: new Date('2026-09-05T10:00:00Z'),
    olderThanMs: 24 * 3_600_000,
  })
  assert.equal(removed, 1)
  const rows = await adapter.all('SELECT id FROM ket_rate', [])
  assert.equal(rows.length, 1)
})

test('a refused request is answered 429 with retry-after, and never reaches the route', async (t) => {
  let reached = 0
  const module = defineModule({ name: 'guarded', models: {} })
  const spec = defineDeployment({
    name: 'guarded_app',
    headless: true,
    modules: [module],
    serve: {
      routes: () => ({
        '/expensive': async () => {
          reached += 1
          return text('done')
        },
      }),
      rateLimit: (_ctx, url) =>
        url.pathname === '/expensive'
          ? { action: 'report.run', key: 'anyone', limit: 2, windowMs: 60_000 }
          : null,
    },
  })
  const deployment = await createTestDeployment(spec, { worker: false })
  t.after(() => deployment.close())

  assert.equal((await deployment.client.request('/expensive')).status, 200)
  assert.equal((await deployment.client.request('/expensive')).status, 200)

  const refused = await deployment.client.request('/expensive')
  assert.equal(refused.status, 429)
  assert.ok(Number(refused.headers.get('retry-after')) >= 1)
  assert.match(await refused.text(), /E_RATE_LIMITED/)

  // Refusing after doing the work is a limit that costs what it was meant to save.
  assert.equal(reached, 2, 'the refused request must not have run the handler')

  const limited = deployment.records.first('rate_limited')
  assert.ok(limited, 'a refusal must be visible')
  assert.equal(limited.level, 'warn')
  assert.equal(limited.fields?.action, 'report.run')
  // The route is named by what was limited rather than by the path that was asked for.
  assert.equal(deployment.records.first('http_request')?.fields?.status, 200)
})

test('a route with no policy is not charged for the limiter', async (t) => {
  const module = defineModule({ name: 'open', models: {} })
  const spec = defineDeployment({
    name: 'open_app',
    headless: true,
    modules: [module],
    serve: {
      routes: () => ({ '/free': async () => text('ok') }),
      rateLimit: () => null,
    },
  })
  const deployment = await createTestDeployment(spec, { worker: false })
  t.after(() => deployment.close())

  for (let i = 0; i < 5; i += 1) {
    assert.equal((await deployment.client.request('/free')).status, 200)
  }
  assert.equal(deployment.records.of('rate_limited').length, 0)

  // Returning null must not have created the table either: a deployment that
  // limits nothing carries no limiter state.
  await deployment.deployment.tenants.with('', async (tenant) => {
    const tables = await tenant.adapter.introspect()
    assert.equal(tables.ket_rate, undefined)
  })
})
