import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { BrowserScreenPlan, Row } from '@ketvietlab/ketjs'
import {
  BrowserListLoader,
  type BrowserFetch,
  type BrowserListBootstrap,
} from '../packages/ketsuite/src/ui/client/browser-list-loader.ts'

const plan = (resources: number, sharedEndpoint = false): BrowserScreenPlan => {
  const optional = Object.fromEntries(
    Array.from({ length: resources }, (_, at) => {
      const id = `extension_${at}.values`
      return [
        id,
        {
          id,
          by: `extension_${at}`,
          source: `extension_${at}.values`,
          needs: `extension_${at}.values`,
          phase: 'deferred' as const,
          key: 'id',
          fields: { id: 'id', value: 'text' },
          batch: { input: 'ids', max: 10 },
          endpoint: sharedEndpoint ? '/_ket/fn/shared.values' : `/_ket/fn/${id}`,
        },
      ]
    }),
  )
  return {
    version: 1,
    revision: 'test-revision',
    screen: {
      id: 'directory.partners',
      kind: 'list',
      contract: '1.0.0',
      primary: 'directory.rows',
      rowKey: 'id',
      title: 'Partners',
      columns: [],
    },
    resources: {
      'directory.rows': {
        id: 'directory.rows',
        by: 'directory',
        source: 'directory.rows',
        needs: 'directory.rows',
        phase: 'primary',
        key: 'id',
        fields: { id: 'id', name: 'text' },
        endpoint: '/_ket/fn/directory.rows',
      },
      ...optional,
    },
    widgets: {},
  }
}

const bootstrap = (
  screenPlan: BrowserScreenPlan,
  contextKey: string,
  rows: Row[] = Array.from({ length: 25 }, (_, at) => ({ id: `p${at}`, name: `Partner ${at}` })),
): BrowserListBootstrap => ({
  mode: 'csr-planned',
  plan: screenPlan,
  baseEndpoint: '/base',
  contextKey,
  concurrency: 2,
  initial: { rows, total: rows.length },
})

const ok = (value: unknown) => ({
  ok: true,
  status: 200,
  json: async () => ({ ok: true, value }),
})

test('browser list loader: provider requests are batched and globally bounded', async () => {
  let active = 0
  let peak = 0
  let calls = 0
  const fetcher: BrowserFetch = async (_url, init) => {
    calls++
    active++
    peak = Math.max(peak, active)
    await new Promise((resolve) => setTimeout(resolve, 2))
    active--
    const ids = (JSON.parse(init?.body ?? '{}').ids ?? []) as string[]
    return ok(ids.map((id) => ({ id, value: id })))
  }
  const loader = new BrowserListLoader(bootstrap(plan(5), 'bounded'), () => {}, fetcher)
  await loader.start()
  assert.equal(calls, 15)
  assert.ok(peak <= 2, `expected at most two concurrent requests, saw ${peak}`)
  assert.equal(loader.state.phase, 'complete')
  assert.equal(loader.state.resources['extension_4.values']?.size, 25)
})

test('browser list loader: identical provider batches are deduplicated', async () => {
  let calls = 0
  const fetcher: BrowserFetch = async (_url, init) => {
    calls++
    const ids = (JSON.parse(init?.body ?? '{}').ids ?? []) as string[]
    return ok(ids.map((id) => ({ id, value: id })))
  }
  const loader = new BrowserListLoader(bootstrap(plan(2, true), 'dedupe'), () => {}, fetcher)
  await loader.start()
  assert.equal(calls, 3)
  assert.equal(loader.state.resources['extension_0.values']?.size, 25)
  assert.equal(loader.state.resources['extension_1.values']?.size, 25)
})

test('browser list loader: batches with different input contracts are not deduplicated', async () => {
  let calls = 0
  const fetcher: BrowserFetch = async (_url, init) => {
    calls++
    const input = JSON.parse(init?.body ?? '{}') as { ids?: string[]; partnerIds?: string[] }
    const ids = input.ids ?? input.partnerIds ?? []
    return ok(ids.map((id) => ({ id, value: id })))
  }
  const screenPlan = plan(2, true)
  screenPlan.resources['extension_1.values']!.batch = { input: 'partnerIds', max: 10 }
  const loader = new BrowserListLoader(bootstrap(screenPlan, 'distinct-inputs'), () => {}, fetcher)
  await loader.start()
  assert.equal(calls, 6)
})

test('browser list loader: batches with different projections are not deduplicated', async () => {
  let calls = 0
  const fetcher: BrowserFetch = async (_url, init) => {
    calls++
    const ids = (JSON.parse(init?.body ?? '{}').ids ?? []) as string[]
    return ok(ids.map((id) => ({ id, value: id, alternate: id })))
  }
  const screenPlan = plan(2, true)
  screenPlan.resources['extension_1.values']!.fields = { id: 'id', alternate: 'text' }
  const loader = new BrowserListLoader(bootstrap(screenPlan, 'distinct-projections'), () => {}, fetcher)
  await loader.start()
  assert.equal(calls, 6)
  assert.deepEqual(loader.state.resources['extension_1.values']?.get('p0'), {
    id: 'p0',
    alternate: 'p0',
  })
})

test('browser list loader: one optional provider failure stays scoped', async () => {
  const fetcher: BrowserFetch = async (url, init) => {
    if (url.endsWith('extension_0.values')) throw new Error('provider unavailable')
    const ids = (JSON.parse(init?.body ?? '{}').ids ?? []) as string[]
    return ok(ids.map((id) => ({ id, value: 'ready' })))
  }
  const loader = new BrowserListLoader(bootstrap(plan(2), 'failure'), () => {}, fetcher)
  await loader.start()
  assert.equal(loader.state.phase, 'complete')
  assert.equal(loader.state.errors['extension_0.values'], 'provider unavailable')
  assert.equal(loader.state.resources['extension_1.values']?.size, 25)
})

test('browser list loader: a failed essential provider never marks required data complete', async () => {
  const screenPlan = plan(1)
  screenPlan.resources['extension_0.values']!.phase = 'essential'
  const fetcher: BrowserFetch = async (url) => {
    if (url === '/base')
      return { ok: true, status: 200, json: async () => ({ rows: [{ id: 'p1' }], total: 1 }) }
    throw new Error('required provider unavailable')
  }
  const loader = new BrowserListLoader(
    { ...bootstrap(screenPlan, 'required-failure', []), mode: 'csr-two-stage' },
    () => {},
    fetcher,
  )
  await assert.rejects(() => loader.start(), /required browser resources failed/)
  assert.equal(loader.state.requiredReady, false)
  assert.equal(loader.state.phase, 'primary')
  assert.equal(loader.state.errors['extension_0.values'], 'required provider unavailable')
})

test('browser list loader: an incomplete essential provider cannot mark required data complete', async () => {
  const screenPlan = plan(1)
  screenPlan.resources['extension_0.values']!.phase = 'essential'
  const fetcher: BrowserFetch = async (url, init) => {
    if (url === '/base')
      return { ok: true, status: 200, json: async () => ({ rows: [{ id: 'p1' }, { id: 'p2' }], total: 2 }) }
    const ids = (JSON.parse(init?.body ?? '{}').ids ?? []) as string[]
    return ok(ids.slice(0, 1).map((id) => ({ id, value: id })))
  }
  const loader = new BrowserListLoader(
    { ...bootstrap(screenPlan, 'incomplete-required', []), mode: 'csr-two-stage' },
    () => {},
    fetcher,
  )
  await assert.rejects(() => loader.start(), /required browser resources failed/)
  assert.equal(loader.state.requiredReady, false)
  assert.match(loader.state.errors['extension_0.values'] ?? '', /omitted 1 requested row/)
})

test('browser list loader: provider rows are projected again before entering client state', async () => {
  const fetcher: BrowserFetch = async (_url, init) => {
    const ids = (JSON.parse(init?.body ?? '{}').ids ?? []) as string[]
    return ok(ids.map((id) => ({ id, value: 'visible', secret: 'hidden' })))
  }
  const loader = new BrowserListLoader(bootstrap(plan(1), 'client-projection'), () => {}, fetcher)
  await loader.start()
  assert.deepEqual(loader.state.resources['extension_0.values']?.get('p0'), {
    id: 'p0',
    value: 'visible',
  })
})

test('browser list loader: planned mode requires every embedded essential resource', async () => {
  const screenPlan = plan(1)
  screenPlan.resources['extension_0.values']!.phase = 'essential'
  const loader = new BrowserListLoader(
    bootstrap(screenPlan, 'missing-essential'),
    () => {},
    async () => {
      throw new Error('planned mode must reject before fetching deferred resources')
    },
  )
  await assert.rejects(() => loader.start(), /required browser resources failed/)
  assert.equal(loader.state.requiredReady, false)
  assert.equal(loader.state.phase, 'primary')
})

test('browser list loader: an embedded empty primary page hydrates as data, not a shell', async () => {
  const phases: string[] = []
  const loader = new BrowserListLoader(
    bootstrap(plan(0), 'empty-primary', []),
    (state) => phases.push(state.phase),
    async () => {
      throw new Error('an embedded empty page needs no fetch')
    },
  )
  assert.equal(loader.state.phase, 'primary')
  await loader.start()
  assert.deepEqual(phases, ['primary', 'complete'])
})

test('browser list loader: an older primary response cannot overwrite a newer load', async () => {
  type Resolve = (value: { ok: boolean; status: number; json(): Promise<unknown> }) => void
  const pending: Resolve[] = []
  const fetcher: BrowserFetch = () => new Promise((resolve) => pending.push(resolve))
  const baseResponse = (rows: Row[]) => ({
    ok: true,
    status: 200,
    json: async () => ({ rows, total: rows.length }),
  })
  const screenPlan = plan(0)
  const spec: BrowserListBootstrap = {
    ...bootstrap(screenPlan, 'stale', []),
    mode: 'csr-two-stage',
  }
  const loader = new BrowserListLoader(spec, () => {}, fetcher)
  const older = loader.start()
  const newer = loader.start()
  pending[1]!(baseResponse([{ id: 'new', name: 'New' }]))
  await newer
  pending[0]!(baseResponse([{ id: 'old', name: 'Old' }]))
  await older
  assert.deepEqual(
    loader.state.rows.map(({ id }) => id),
    ['new'],
  )
})

test('browser list loader: context cache serves a warm reopen without another fetch', async () => {
  let calls = 0
  const fetcher: BrowserFetch = async (_url, init) => {
    calls++
    const ids = (JSON.parse(init?.body ?? '{}').ids ?? []) as string[]
    return ok(ids.map((id) => ({ id, value: 'cached' })))
  }
  const screenPlan = plan(1)
  screenPlan.resources['extension_0.values']!.cache = { scope: 'context', ttlMs: 10_000 }
  const spec = bootstrap(screenPlan, 'warm-cache')
  await new BrowserListLoader(
    spec,
    () => {},
    fetcher,
    () => 100,
  ).start()
  await new BrowserListLoader(
    spec,
    () => {},
    fetcher,
    () => 101,
  ).start()
  assert.equal(calls, 3, 'the first three batches are reused by the warm loader')
})

test('browser list loader: context changes do not reuse another projection cache', async () => {
  let calls = 0
  const fetcher: BrowserFetch = async (_url, init) => {
    calls++
    const ids = (JSON.parse(init?.body ?? '{}').ids ?? []) as string[]
    return ok(ids.map((id) => ({ id, value: 'scoped' })))
  }
  const screenPlan = plan(1)
  screenPlan.resources['extension_0.values']!.cache = { scope: 'context', ttlMs: 10_000 }
  await new BrowserListLoader(bootstrap(screenPlan, 'company-a'), () => {}, fetcher).start()
  await new BrowserListLoader(bootstrap(screenPlan, 'company-b'), () => {}, fetcher).start()
  assert.equal(calls, 6)
})

test('browser list loader: expired context entries are removed and fetched again', async () => {
  let calls = 0
  let now = 100
  const fetcher: BrowserFetch = async (_url, init) => {
    calls++
    const ids = (JSON.parse(init?.body ?? '{}').ids ?? []) as string[]
    return ok(ids.map((id) => ({ id, value: 'fresh' })))
  }
  const screenPlan = plan(1)
  screenPlan.resources['extension_0.values']!.cache = { scope: 'context', ttlMs: 10 }
  const spec = bootstrap(screenPlan, 'expiring-cache')
  await new BrowserListLoader(
    spec,
    () => {},
    fetcher,
    () => now,
  ).start()
  now = 110
  await new BrowserListLoader(
    spec,
    () => {},
    fetcher,
    () => now,
  ).start()
  assert.equal(calls, 6)
})

test('browser list loader: disposal aborts work and suppresses its late primary result', async () => {
  let resolveResponse!: (response: { ok: boolean; status: number; json(): Promise<unknown> }) => void
  let signal: AbortSignal | undefined
  const fetcher: BrowserFetch = (_url, init) => {
    signal = init?.signal
    return new Promise((resolve) => {
      resolveResponse = resolve
    })
  }
  const spec: BrowserListBootstrap = {
    ...bootstrap(plan(0), 'dispose', []),
    mode: 'csr-two-stage',
  }
  const loader = new BrowserListLoader(spec, () => {}, fetcher)
  const loading = loader.start()
  loader.dispose()
  assert.equal(signal?.aborted, true)
  resolveResponse({ ok: true, status: 200, json: async () => ({ rows: [{ id: 'late' }], total: 1 }) })
  await loading
  assert.deepEqual(loader.state.rows, [])
})
