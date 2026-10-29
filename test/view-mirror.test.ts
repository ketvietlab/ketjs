import { test } from 'node:test'
import assert from 'node:assert/strict'
import { countingHost, each, html, mount, signal } from '@ketvietlab/ketjs-view'
import { createMirror } from '@ketvietlab/ketjs-view/mirror'
import type { Mirror, MirrorKey, MirrorOptions } from '@ketvietlab/ketjs-view/mirror'

type Row = { id: number; name: string }

const tick = () => new Promise<void>((resolve) => setImmediate(resolve))
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

const parseRows = (raw: unknown): Row[] => {
  if (!Array.isArray(raw)) throw new TypeError('rows: expected an array')
  for (const row of raw)
    if (typeof row?.id !== 'number' || typeof row.name !== 'string') throw new TypeError('rows: bad row')
  return raw as Row[]
}

/** A server whose answers the test releases explicitly, in any order. */
function server() {
  const calls: Array<{
    key: unknown
    cursor?: unknown
    signal: AbortSignal
    resolve(v: unknown): void
    reject(e: unknown): void
  }> = []
  const load = (key: unknown, context: { signal: AbortSignal }) =>
    new Promise<unknown>((resolve, reject) => calls.push({ key, signal: context.signal, resolve, reject }))
  return { calls, load }
}

function attached(options: MirrorOptions = {}): { mirror: Mirror; lifetime: AbortController } {
  const mirror = createMirror(options)
  const lifetime = new AbortController()
  mirror.attach(lifetime.signal)
  return { mirror, lifetime }
}

const rows = (...names: string[]): Row[] => names.map((name, id) => ({ id, name }))

test('a read starts no load before attach, then loads once and reports each state', async () => {
  const api = server()
  const mirror = createMirror()
  const reading = mirror.read({ key: () => ['rows'] as const, load: api.load, parse: parseRows })
  await tick()
  assert.equal(api.calls.length, 0, 'a server render must stay pure')
  assert.equal(reading.status(), 'idle')
  const lifetime = new AbortController()
  mirror.attach(lifetime.signal)
  assert.equal(reading.status(), 'loading')
  assert.equal(reading.fetching(), true)
  await tick()
  assert.equal(api.calls.length, 1)
  api.calls[0]?.resolve(JSON.parse(JSON.stringify(rows('a'))))
  await reading.settled()
  assert.deepEqual(reading.data(), rows('a'))
  assert.equal(reading.status(), 'ready')
  assert.equal(reading.fetching(), false)
  assert.equal(typeof reading.updatedAt(), 'number')
  reading.dispose()
  mirror.dispose()
})

test('readers of one key share one request', async () => {
  const api = server()
  const { mirror } = attached()
  const first = mirror.read({
    key: () => ['rows', { page: 1, size: 20 }] as const,
    load: api.load,
    parse: parseRows,
  })
  const second = mirror.read({
    key: () => ['rows', { size: 20, page: 1 }] as const,
    load: api.load,
    parse: parseRows,
  })
  await tick()
  assert.equal(api.calls.length, 1, 'object keys are compared after sorting their properties')
  api.calls[0]?.resolve(rows('a'))
  await first.settled()
  assert.equal(first.data(), second.data())
  first.dispose()
  second.dispose()
  mirror.dispose()
})

test('the latest load wins and an older answer never lands', async () => {
  const api = server()
  const { mirror } = attached()
  const reading = mirror.read({ key: () => ['rows'] as const, load: api.load, parse: parseRows })
  await tick()
  const refetched = reading.refetch()
  await tick()
  assert.equal(api.calls.length, 2)
  assert.equal(api.calls[0]?.signal.aborted, true, 'refetch supersedes the load in flight')
  api.calls[1]?.resolve(rows('new'))
  api.calls[0]?.resolve(rows('old'))
  await refetched
  await tick()
  assert.deepEqual(reading.data(), rows('new'))
  reading.dispose()
  mirror.dispose()
})

test('keepPrevious shows the previous key until the new key answers', async () => {
  const api = server()
  const { mirror } = attached()
  const filter = signal('all')
  const reading = mirror.read({
    key: () => ['rows', { filter: filter() }] as const,
    load: api.load,
    parse: parseRows,
    keepPrevious: true,
  })
  const plain = mirror.read({
    key: () => ['rows', { filter: filter() }] as const,
    load: api.load,
    parse: parseRows,
  })
  await tick()
  api.calls[0]?.resolve(rows('all'))
  await reading.settled()
  filter.set('even')
  assert.deepEqual(reading.data(), rows('all'))
  assert.equal(reading.previous(), true)
  assert.equal(reading.status(), 'loading')
  assert.equal(plain.data(), undefined, 'without keepPrevious the new key starts empty')
  await tick()
  api.calls[1]?.resolve(rows('even'))
  await reading.settled()
  assert.deepEqual(reading.data(), rows('even'))
  assert.equal(reading.previous(), false)
  reading.dispose()
  plain.dispose()
  mirror.dispose()
})

test('a payload that fails parse is a failed load, not cached data or an unhandled rejection', async () => {
  const api = server()
  const { mirror } = attached()
  const reading = mirror.read({ key: () => ['rows'] as const, load: api.load, parse: parseRows })
  await tick()
  api.calls[0]?.resolve({ not: 'rows' })
  await reading.settled()
  assert.equal(reading.status(), 'failed')
  assert.ok(reading.error() instanceof TypeError)
  assert.equal(reading.data(), undefined)
  reading.dispose()
  mirror.dispose()
})

test('an unchanged answer keeps its reference, so a mounted list does not run again', async () => {
  for (const structuralSharing of [true, false]) {
    const api = server()
    const { mirror } = attached({ structuralSharing })
    const reading = mirror.read({ key: () => ['rows'] as const, load: api.load, parse: parseRows })
    await tick()
    api.calls[0]?.resolve(JSON.parse(JSON.stringify(rows('a', 'b'))))
    await reading.settled()
    const host = countingHost()
    let runs = 0
    const mounted = mount(host, host.root(), () => {
      runs++
      return html`<ul>${each(
        reading.data() ?? [],
        (row) => row.id,
        (row) => html`<li>${row.name}</li>`,
      )}</ul>`
    })
    const before = reading.data()
    const refetched = reading.refetch()
    await tick()
    api.calls[1]?.resolve(JSON.parse(JSON.stringify(rows('a', 'b'))))
    await refetched
    assert.equal(reading.data() === before, structuralSharing)
    assert.equal(runs, structuralSharing ? 1 : 2)
    mounted.dispose()
    reading.dispose()
    mirror.dispose()
  }
})

test('sharing keeps unchanged rows and replaces the changed one', async () => {
  const api = server()
  const { mirror } = attached()
  const reading = mirror.read({ key: () => ['rows'] as const, load: api.load, parse: parseRows })
  await tick()
  api.calls[0]?.resolve(rows('a', 'b'))
  await reading.settled()
  const [a, b] = reading.data() as Row[]
  const refetched = reading.refetch()
  await tick()
  api.calls[1]?.resolve([
    { id: 0, name: 'a' },
    { id: 1, name: 'B' },
  ])
  await refetched
  const [a2, b2] = reading.data() as Row[]
  assert.equal(a2, a)
  assert.notEqual(b2, b)
  assert.equal(b2?.name, 'B')
  reading.dispose()
  mirror.dispose()
})

test('invalidate reloads observed entries and marks the rest stale', async () => {
  const api = server()
  const { mirror } = attached({ staleMs: 60_000 })
  const reading = mirror.read({
    key: () => ['rows'] as const,
    load: api.load,
    parse: parseRows,
    tags: () => ['rows'],
  })
  await tick()
  api.calls[0]?.resolve(rows('a'))
  await reading.settled()
  await mirror.prefetch({
    key: ['other'],
    load: async () => rows('x'),
    parse: parseRows,
    tags: () => ['rows'],
  })
  const done = mirror.invalidate('rows')
  await tick()
  assert.equal(api.calls.length, 2, 'only the observed entry reloads now')
  api.calls[1]?.resolve(rows('b'))
  await done
  assert.deepEqual(reading.data(), rows('b'))
  const other = mirror.read({ key: () => ['other'] as const, load: api.load, parse: parseRows })
  assert.equal(other.stale(), true)
  await tick()
  assert.equal(api.calls.length, 3, 'the stale entry reloads when it is read again')
  other.dispose()
  reading.dispose()
  mirror.dispose()
})

test('staleMs keeps a fresh answer from reloading for a new reader', async () => {
  const api = server()
  const { mirror } = attached({ staleMs: 60_000 })
  const first = mirror.read({ key: () => ['rows'] as const, load: api.load, parse: parseRows })
  await tick()
  api.calls[0]?.resolve(rows('a'))
  await first.settled()
  const second = mirror.read({ key: () => ['rows'] as const, load: api.load, parse: parseRows })
  await tick()
  assert.equal(api.calls.length, 1)
  assert.equal(second.stale(), false)
  first.dispose()
  second.dispose()
  mirror.dispose()
})

test('a new scope drops every entry and never shows the previous scope', async () => {
  const api = server()
  const tenant = signal('a')
  const { mirror } = attached({ scope: () => tenant() })
  const reading = mirror.read({
    key: () => ['rows'] as const,
    load: api.load,
    parse: parseRows,
    keepPrevious: true,
  })
  await tick()
  api.calls[0]?.resolve(rows('tenant a'))
  await reading.settled()
  const snapshot = mirror.snapshot()
  tenant.set('b')
  assert.equal(reading.data(), undefined, 'keepPrevious never crosses a scope')
  assert.equal(reading.previous(), false)
  await tick()
  assert.equal(api.calls.length, 2)
  assert.equal(mirror.restore(snapshot), 0, 'a snapshot from another scope is refused')
  api.calls[1]?.resolve(rows('tenant b'))
  await reading.settled()
  assert.deepEqual(reading.data(), rows('tenant b'))
  reading.dispose()
  mirror.dispose()
})

test('an optimistic write shows at once, then the invalidated entry reloads', async () => {
  const api = server()
  const { mirror } = attached()
  const reading = mirror.read({
    key: () => ['rows'] as const,
    load: api.load,
    parse: parseRows,
    tags: () => ['rows'],
  })
  await tick()
  api.calls[0]?.resolve(rows('a', 'b'))
  await reading.settled()
  const keys: string[] = []
  const rename = mirror.write({
    run: async (input: { id: number; name: string }, { idempotencyKey }) => {
      keys.push(idempotencyKey)
      return input
    },
    invalidates: () => ['rows'],
    optimistic: (cache, input) =>
      cache.update<Row[]>(['rows'], (current) =>
        (current ?? []).map((row) => (row.id === input.id ? { ...row, name: input.name } : row)),
      ),
  })
  const outcome = rename.run({ id: 1, name: 'B' })
  assert.equal(reading.data()?.[1]?.name, 'B', 'the patch lands before the request')
  assert.equal(rename.pending(), true)
  assert.deepEqual(await outcome, { status: 'done', value: { id: 1, name: 'B' } })
  assert.equal(rename.pending(), false)
  await tick()
  assert.equal(api.calls.length, 2, 'invalidates() reloads the observed entry')
  assert.match(keys[0] as string, /^[0-9a-f-]{36}$/)
  api.calls[1]?.resolve(rows('a', 'B'))
  await reading.settled()
  reading.dispose()
  mirror.dispose()
})

test('a failed write rolls its patch back unless newer data replaced it', async () => {
  const api = server()
  const { mirror } = attached()
  const reading = mirror.read({ key: () => ['rows'] as const, load: api.load, parse: parseRows })
  await tick()
  api.calls[0]?.resolve(rows('a'))
  await reading.settled()
  const original = reading.data()
  let fail: (e: unknown) => void = () => {}
  const write = mirror.write({
    run: () => new Promise((_resolve, reject) => (fail = reject)),
    optimistic: (cache) => cache.update<Row[]>(['rows'], () => rows('patched')),
  })
  const first = write.run(undefined)
  assert.deepEqual(reading.data(), rows('patched'))
  assert.deepEqual(await write.run(undefined), { status: 'rejected' }, 'exclusive rejects a second run')
  fail(new Error('refused'))
  const outcome = await first
  assert.equal(outcome.status, 'failed')
  assert.equal(outcome.status === 'failed' && outcome.rolledBack, true)
  assert.equal(reading.data(), original)
  assert.equal((write.error() as Error).message, 'refused')

  const second = write.run(undefined)
  const refetched = reading.refetch()
  await tick()
  api.calls[1]?.resolve(rows('newer'))
  await refetched
  fail(new Error('refused again'))
  const late = await second
  assert.equal(late.status === 'failed' && late.rolledBack, false)
  assert.deepEqual(reading.data(), rows('newer'), 'a newer answer is not rolled back')
  reading.dispose()
  mirror.dispose()
})

test('queued writes run in order and a retried write keeps its idempotency key', async () => {
  const { mirror } = attached()
  const order: string[] = []
  const keys: string[] = []
  let failures = 1
  const write = mirror.write({
    concurrency: 'queue',
    retry: { attempts: 2, delayMs: () => 1 },
    run: async (input: string, { idempotencyKey }) => {
      keys.push(idempotencyKey)
      if (input === 'first' && failures-- > 0) throw new Error('transient')
      order.push(input)
      return input
    },
  })
  const results = await Promise.all([write.run('first'), write.run('second')])
  assert.deepEqual(order, ['first', 'second'])
  assert.deepEqual(
    results.map((r) => r.status),
    ['done', 'done'],
  )
  assert.equal(keys[0], keys[1], 'the retry reuses the key of its run')
  assert.notEqual(keys[1], keys[2], 'a new run gets a new key')
  mirror.dispose()
})

test('disposing a writer aborts its run and reloads what it patched', async () => {
  const api = server()
  const { mirror } = attached()
  const reading = mirror.read({ key: () => ['rows'] as const, load: api.load, parse: parseRows })
  await tick()
  api.calls[0]?.resolve(rows('a'))
  await reading.settled()
  const write = mirror.write({
    run: (_input: undefined, { signal }) =>
      new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason))),
    optimistic: (cache) => cache.update<Row[]>(['rows'], () => rows('patched')),
  })
  const outcome = write.run(undefined)
  write.dispose()
  assert.deepEqual(await outcome, { status: 'aborted' })
  await tick()
  assert.equal(api.calls.length, 2, 'an unknown outcome asks the server again')
  reading.dispose()
  mirror.dispose()
})

test('pages load one cursor at a time and a refetch reloads the loaded pages', async () => {
  type Page = { items: string[]; next: number | null }
  const calls: Array<number | null> = []
  const { mirror } = attached()
  const paging = mirror.pages({
    key: () => ['feed'] as const,
    load: async (_key, cursor: number | null) => {
      calls.push(cursor)
      const at = cursor ?? 0
      return { items: [`item ${at}`], next: at < 2 ? at + 1 : null }
    },
    parse: (raw) => raw as Page,
    next: (last) => last.next,
  })
  await paging.settled()
  assert.equal(paging.data()?.length, 1)
  assert.equal(paging.more(), true)
  await paging.loadMore()
  await paging.loadMore()
  assert.deepEqual(
    paging.data()?.map((page) => page.items[0]),
    ['item 0', 'item 1', 'item 2'],
  )
  assert.equal(paging.more(), false)
  await paging.loadMore()
  assert.deepEqual(calls, [null, 1, 2])
  await paging.refetch()
  assert.deepEqual(calls.slice(3), [null, 1, 2], 'refetch follows next() through every loaded page')
  assert.throws(
    () => mirror.read({ key: () => ['feed'] as const, load: async () => [], parse: parseRows }),
    /used by both read\(\) and pages\(\)/,
  )
  paging.dispose()
  mirror.dispose()
})

test('a server snapshot is restored, parsed by the reader and not reloaded while fresh', async () => {
  const ssr = createMirror({ scope: () => 'tenant', staleMs: 60_000 })
  await ssr.prefetch({ key: ['rows'], load: async () => rows('ssr'), parse: parseRows, tags: () => ['rows'] })
  const snapshot = JSON.parse(JSON.stringify(ssr.snapshot()))
  ssr.dispose()

  const api = server()
  const browser = createMirror({ scope: () => 'tenant', staleMs: 60_000 })
  assert.equal(browser.restore(snapshot), 1)
  let parsed = 0
  const reading = browser.read({
    key: () => ['rows'] as const,
    load: api.load,
    parse: (raw) => {
      parsed++
      return parseRows(raw)
    },
  })
  assert.deepEqual(reading.data(), rows('ssr'))
  assert.equal(parsed, 1, 'restored data passes the same parse as a response')
  const lifetime = new AbortController()
  browser.attach(lifetime.signal)
  await tick()
  assert.equal(api.calls.length, 0, 'fresh restored data is not loaded again')
  reading.dispose()
  browser.dispose()
})

test('restored data that fails parse is loaded instead', async () => {
  const api = server()
  const mirror = createMirror()
  mirror.restore({
    version: 1,
    scope: '',
    entries: [{ key: ['rows'], data: 'broken', updatedAt: Date.now(), tags: [] }],
  })
  const reading = mirror.read({ key: () => ['rows'] as const, load: api.load, parse: parseRows })
  assert.equal(reading.data(), undefined)
  const lifetime = new AbortController()
  mirror.attach(lifetime.signal)
  await tick()
  assert.equal(api.calls.length, 1)
  reading.dispose()
  mirror.dispose()
})

test('reads retry when the policy says the error is transient', async () => {
  let attempts = 0
  const { mirror } = attached({
    retry: { attempts: 2, delayMs: () => 1, when: (e) => (e as Error).message === 'busy' },
  })
  const reading = mirror.read({
    key: () => ['rows'] as const,
    load: async () => {
      attempts++
      if (attempts < 3) throw new Error('busy')
      return rows('a')
    },
    parse: parseRows,
  })
  await wait(20)
  await reading.settled()
  assert.equal(attempts, 3)
  assert.equal(reading.status(), 'ready')
  const denied = mirror.read({
    key: () => ['denied'] as const,
    load: async () => {
      throw new Error('forbidden')
    },
    parse: parseRows,
  })
  await wait(5)
  await denied.settled()
  assert.equal(denied.status(), 'failed', 'an error the policy rejects is not retried')
  reading.dispose()
  denied.dispose()
  mirror.dispose()
})

test('an unobserved entry is collected after gcMs', async () => {
  const { mirror } = attached({ gcMs: 5 })
  const reading = mirror.read({ key: () => ['rows'] as const, load: async () => rows('a'), parse: parseRows })
  await reading.settled()
  assert.deepEqual(mirror.peek(['rows']), rows('a'))
  reading.dispose()
  await wait(20)
  assert.equal(mirror.peek(['rows']), undefined)
  mirror.dispose()
})

test('pollMs reloads while attached and stops when the lifetime ends', async () => {
  let loads = 0
  const { mirror, lifetime } = attached({ staleMs: 60_000 })
  const reading = mirror.read({
    key: () => ['rows'] as const,
    load: async () => {
      loads++
      return rows(`v${loads}`)
    },
    parse: parseRows,
    pollMs: 5,
  })
  await wait(40)
  assert.ok(loads >= 3, `expected several polls, saw ${loads}`)
  lifetime.abort()
  assert.equal(mirror.attached(), false)
  const stopped = loads
  await wait(30)
  assert.equal(loads, stopped)
  reading.dispose()
  mirror.dispose()
})

test('reconnect refetches observed stale entries', async () => {
  const target = new EventTarget()
  const scope = globalThis as { addEventListener?: unknown }
  const original = scope.addEventListener
  scope.addEventListener = target.addEventListener.bind(target)
  try {
    let loads = 0
    const { mirror } = attached({ refetchOn: { reconnect: true } })
    const reading = mirror.read({
      key: () => ['rows'] as const,
      load: async () => {
        loads++
        return rows('a')
      },
      parse: parseRows,
    })
    await reading.settled()
    target.dispatchEvent(new Event('online'))
    await reading.settled()
    assert.equal(loads, 2)
    reading.dispose()
    mirror.dispose()
  } finally {
    if (original === undefined) delete scope.addEventListener
    else scope.addEventListener = original
  }
})

test('keys and reads are validated where they are written', () => {
  const mirror = createMirror()
  assert.throws(
    () =>
      mirror.read({
        key: () => ['rows', { at: new Date() }] as const,
        load: async () => [],
        parse: parseRows,
      }),
    /JSON values only/,
  )
  assert.throws(() => mirror.peek([1] as unknown as MirrorKey), /first element names the resource/)
  assert.throws(
    () => mirror.read({ key: () => ['rows'] as const, load: async () => [] } as never),
    /needs parse/,
  )
  assert.throws(() => mirror.restore({ version: 2 } as never), /Not a Mirror snapshot/)
  const lifetime = new AbortController()
  mirror.attach(lifetime.signal)
  assert.throws(() => mirror.attach(new AbortController().signal), /already attached/)
  mirror.dispose()
  assert.throws(
    () => mirror.read({ key: () => ['rows'] as const, load: async () => [], parse: parseRows }),
    /disposed/,
  )
})

test('dispose stops readers and writers', async () => {
  const api = server()
  const { mirror } = attached()
  const reading = mirror.read({ key: () => ['rows'] as const, load: api.load, parse: parseRows })
  await tick()
  const write = mirror.write({ run: async () => 'never' })
  mirror.dispose()
  assert.equal(api.calls[0]?.signal.aborted, true)
  assert.equal(reading.data(), undefined)
  assert.equal(reading.status(), 'idle')
  assert.deepEqual(await write.run(undefined), { status: 'aborted' })
  reading.dispose()
})

test('seed stores a trusted value that a reader shows without loading while fresh', async () => {
  const api = server()
  const { mirror } = attached({ staleMs: 60_000 })
  mirror.seed(['rows'], rows('seeded'), { tags: ['rows'] })
  const reading = mirror.read({ key: () => ['rows'] as const, load: api.load, parse: parseRows })
  assert.deepEqual(reading.data(), rows('seeded'))
  await tick()
  assert.equal(api.calls.length, 0)
  void mirror.invalidate('rows')
  await tick()
  assert.equal(api.calls.length, 1, 'seeded entries keep their tags')
  api.calls[0]?.resolve(rows('loaded'))
  await reading.settled()
  reading.dispose()
  mirror.dispose()
})
