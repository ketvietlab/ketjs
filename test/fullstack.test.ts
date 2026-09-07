import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  type DestructiveMigrationError,
  callFn,
  compose,
  createQueue,
  createStreams,
  dbStreamStore,
  memoryStreamStore,
  defineModule,
  planMigration,
  registerFunctions,
  renderSql,
  schemaFromManifest,
  sqliteAdapter,
} from '@ketvietlab/ketjs'
import type { Adapter, Manifest } from '@ketvietlab/ketjs'
import { catalog, checkout, defaultTheme as theme, inventory } from '@ketvietlab/ketsuite'

/** Every request acts as some company; these tests act as one. */
const SCOPE = { company: 'c1', branch: 'main', branches: null }

const mods = [catalog, inventory, checkout, theme]

async function boot(): Promise<{ adapter: Adapter; manifest: Manifest }> {
  const manifest = compose(mods)
  const adapter = sqliteAdapter()
  await adapter.open()
  for (const sql of renderSql(planMigration(null, schemaFromManifest(manifest)), adapter))
    await adapter.exec(sql)
  registerFunctions(mods)
  return { adapter, manifest }
}

test('fullstack: schema is derived from the composed manifest, extensions included', async () => {
  const { adapter } = await boot()
  const cols = (await adapter.introspect())['catalog_product']!
  assert.ok('title' in cols)
  assert.ok('leadTimeDays' in cols, 'the column inventory added to catalog.Product must exist')
  await adapter.close()
})

test('fullstack: destructive migrations are generated but refused by default', () => {
  const before = schemaFromManifest(compose(mods))
  const shrunk = defineModule({
    name: 'catalog',
    models: { Product: { scope: 'shared', fields: { id: 'id', title: 'text' } } },
  })
  const after = schemaFromManifest(compose([shrunk]))
  assert.throws(
    () => planMigration(before, after),
    (e: unknown) => {
      const err = e as DestructiveMigrationError
      assert.equal(err.code, 'E_DESTRUCTIVE_MIGRATION')
      assert.match(err.message, /DROP_COLUMN catalog_product\.leadTimeDays \(contributed by inventory\)/)
      return true
    },
  )
  const ops = planMigration(before, after, { allowDestructive: true })
  assert.ok(ops.some((o) => o.op === 'DROP_COLUMN'))
})

test('fullstack: a server function cannot touch a model it did not declare', async () => {
  const { adapter } = await boot()
  const rogue = defineModule({
    name: 'rogue',
    depends: ['catalog'],
    functions: { peek: { effects: [], handler: (ctx) => ctx.db.select('catalog.Product') } },
  })
  const m2 = compose([...mods, rogue])
  registerFunctions([...mods, rogue])
  await assert.rejects(
    () => callFn('rogue.peek', {}, { adapter, manifest: m2 }),
    (e: unknown) => {
      assert.equal((e as { code: string }).code, 'E_EFFECT_NOT_DECLARED')
      assert.match((e as Error).message, /declares effects \[none\]/)
      return true
    },
  )
  await adapter.close()
})

test('fullstack: input is validated against the declared signature', async () => {
  const { adapter, manifest } = await boot()
  await assert.rejects(
    () =>
      callFn(
        'catalog.createProduct',
        { id: 'p1', title: 'X', priceCents: 'nhieu', slug: 's' },
        { adapter, manifest },
      ),
    (e: unknown) => {
      assert.match((e as Error).message, /expects int \(number\), got string/)
      return true
    },
  )
  await assert.rejects(
    () => callFn('catalog.getProduct', { id: 'p1', surprise: 1 }, { adapter, manifest }),
    (e: unknown) => {
      assert.match((e as Error).message, /unknown input "surprise"/)
      return true
    },
  )
  await adapter.close()
})

test('agent safety: dry-run reports intended writes and commits nothing', async () => {
  const { adapter, manifest } = await boot()
  const res = await callFn(
    'catalog.createProduct',
    { id: 'p9', title: 'Thu', priceCents: 1000, slug: 'thu' },
    { adapter, manifest, dryRun: true },
  )
  assert.equal(res.dryRun, true)
  assert.equal(res.writes.length, 1)
  assert.equal(res.writes[0]!.model, 'catalog.Product')
  const rows = await adapter.all('SELECT * FROM catalog_product WHERE id = ?', ['p9'])
  assert.equal(rows.length, 0, 'dry-run must not commit')
  await adapter.close()
})

test('agent safety: a dry-run cannot consume the idempotency key of the real command', async () => {
  const { adapter, manifest } = await boot()
  const args = { id: 'previewed', title: 'Previewed', priceCents: 1000, slug: 'previewed' }
  const preview = await callFn('catalog.createProduct', args, {
    adapter,
    manifest,
    dryRun: true,
    idempotencyKey: 'preview-then-commit',
  })
  assert.equal(preview.dryRun, true)
  assert.equal((await adapter.all('SELECT * FROM catalog_product WHERE id = ?', [args.id])).length, 0)

  const committed = await callFn('catalog.createProduct', args, {
    adapter,
    manifest,
    idempotencyKey: 'preview-then-commit',
  })
  assert.equal(committed.replayed, undefined)
  assert.equal(committed.dryRun, false)
  assert.equal((await adapter.all('SELECT * FROM catalog_product WHERE id = ?', [args.id])).length, 1)

  const retried = await callFn('catalog.createProduct', args, {
    adapter,
    manifest,
    idempotencyKey: 'preview-then-commit',
  })
  assert.equal(retried.replayed, true, 'the first real command, not its preview, owns the durable key')
  await adapter.close()
})

test('agent safety: an idempotency key makes a retry replay instead of double-apply', async () => {
  const { adapter, manifest } = await boot()
  const args = { id: 'o1', productId: 'p1', qty: 2 }
  await callFn(
    'catalog.createProduct',
    { id: 'p1', title: 'Ao', priceCents: 5000, slug: 'ao' },
    { adapter, manifest },
  )
  const a = await callFn('checkout.placeOrder', args, {
    adapter,
    manifest,
    scope: SCOPE,
    idempotencyKey: 'k1',
  })
  const b = await callFn('checkout.placeOrder', args, {
    adapter,
    manifest,
    scope: SCOPE,
    idempotencyKey: 'k1',
  })
  assert.equal(b.replayed, true)
  assert.deepEqual(a.value, b.value)
  assert.equal(
    (await adapter.all('SELECT * FROM checkout_order', [])).length,
    1,
    'retry must not create a second order',
  )
  await adapter.close()
})

test('agent safety: an idempotency key on a non-idempotent function is refused', async () => {
  const { adapter, manifest } = await boot()
  await assert.rejects(
    () => callFn('catalog.listProducts', {}, { adapter, manifest, idempotencyKey: 'k' }),
    (e: unknown) => {
      assert.equal((e as { code: string }).code, 'E_NOT_IDEMPOTENT')
      return true
    },
  )
  await adapter.close()
})

test('streams: a client that reloads mid-generation resumes exactly where it stopped', async () => {
  const adapter = sqliteAdapter()
  await adapter.open()
  const s = await createStreams(dbStreamStore(adapter))
  const w = await s.open('gen')
  w.write('Xin')
  w.write(' chao')
  await w.flush()
  const first = await s.since('gen', 0)
  assert.equal(first.chunks.map((c) => c.data).join(''), 'Xin chao')
  assert.equal(first.done, false)

  // ... the browser reloads here; generation keeps running on the server
  w.write(' ban')
  await w.end({ tokens: 3 })

  const resumed = await s.since('gen', first.nextSeq)
  assert.equal(resumed.chunks.map((c) => c.data).join(''), ' ban', 'only what was missed, no duplicates')
  assert.equal(resumed.done, true)
  assert.deepEqual(resumed.summary, { tokens: 3 })
  await adapter.close()
})

test('streams: writes are batched, so a token is not a transaction', async () => {
  const adapter = sqliteAdapter()
  await adapter.open()
  let inserts = 0
  const counting = {
    ...adapter,
    run: (s: string, p?: unknown[]) => {
      if (s.startsWith('INSERT INTO ket_stream')) inserts++
      return adapter.run(s, p)
    },
  }
  const s = await createStreams(dbStreamStore(counting))
  const w = await s.open('g')
  for (let i = 0; i < 100; i++) w.write(`tok${i}`)
  await w.end()
  assert.ok(inserts <= 6, `100 chunks must not cost 100 inserts, got ${inserts}`)
  assert.equal((await s.since('g', 0)).chunks.length, 100, 'every chunk still arrives')
  await adapter.close()
})

test('streams: a finished stream is swept after its grace period', async () => {
  const adapter = sqliteAdapter()
  await adapter.open()
  const s = await createStreams(dbStreamStore(adapter))
  const w = await s.open('old')
  w.write('x')
  await w.end()
  assert.equal(await s.sweep(10 * 60_000), 0, 'still inside the grace period')
  assert.equal((await s.sweep(0)) > 0, true, 'past it, the rows go')
  assert.equal((await s.since('old', 0)).chunks.length, 0)
  await adapter.close()
})

test('streams: a reader on the same instance is woken, not polled', async () => {
  const s = await createStreams()
  const w = await s.open('live')
  const seen: unknown[] = []
  const reader = (async () => {
    for await (const c of s.tail('live', 0, { pollMs: 60_000 })) seen.push(c.data)
  })()
  w.write('a')
  await w.flush()
  await new Promise((r) => setTimeout(r, 20))
  await w.end()
  await reader
  assert.deepEqual(seen, ['a'], 'with a 60s poll interval this only works if the writer woke the reader')
})

test('streams: a tail reads only what the reader has not seen', async () => {
  const adapter = sqliteAdapter()
  await adapter.open()
  const queries: string[] = []
  const watched = {
    ...adapter,
    all: (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM ket_stream')) queries.push(sql)
      return adapter.all(sql, params)
    },
  }
  const s = await createStreams(dbStreamStore(watched))
  const w = await s.open('long')
  for (let index = 0; index < 50; index++) w.write(`chunk${index}`)
  await w.flush()

  // A tail that has caught up used to re-read and re-parse the whole topic on
  // every pass, so a stream that had written a thousand chunks paid for a
  // thousand rows to learn there was nothing new.
  queries.length = 0
  const caughtUp = await s.since('long', 50)
  assert.equal(caughtUp.chunks.length, 0)
  assert.ok(
    queries.some((sql) => /seq >= /u.test(sql)),
    'the cursor is in the query, not applied to the rows afterwards',
  )

  // And resuming still means resuming. The cursor counts batches, not chunks —
  // a flush is one row — so the second batch comes back whole and the first does
  // not come back at all.
  const resumed = await s.since('long', 1)
  assert.equal(resumed.chunks.length, 18, 'the second flush, and only it')
  assert.equal(resumed.chunks[0]?.data, 'chunk32')
  assert.deepEqual(
    (await s.since('long', 0)).chunks.map((c) => c.data),
    Array.from({ length: 50 }, (_, index) => `chunk${index}`),
    'from the start, everything, in order',
  )
  await adapter.close()
})

test('streams: a reader past the end is still told the stream is over', async () => {
  // `done` and the summary live on the end marker, and its sequence is behind a
  // reader who has read everything. Excluding it by cursor would leave that
  // reader waiting for a stream that finished.
  const adapter = sqliteAdapter()
  await adapter.open()
  const s = await createStreams(dbStreamStore(adapter))
  const w = await s.open('short')
  w.write('only')
  await w.end({ tokens: 1 })
  const after = await s.since('short', 999)
  assert.equal(after.chunks.length, 0)
  assert.equal(after.done, true)
  assert.deepEqual(after.summary, { tokens: 1 })
  assert.equal(after.nextSeq, 999, 'a cursor beyond the end resumes where the reader is')
  await adapter.close()
})

test('streams: a store that cannot reach another process keeps its tight poll', async () => {
  // SQLite has no way to tell a second process anything, so there the read is
  // how news arrives and the interval has to stay short.
  const adapter = sqliteAdapter()
  await adapter.open()
  const sqlite = dbStreamStore(adapter)
  assert.ok(!sqlite.notifies, 'sqlite cannot notify across processes')
  // A single-process store is its own authority, so it may wait.
  assert.equal(memoryStreamStore().notifies, true)
  await adapter.close()
})

test('streams: how often a tail reads follows whether it can be told', async () => {
  // The interval is the difference between a poll that *is* the mechanism and
  // one that is only there for the notification that never came.
  const readsIn = async (notifies: boolean, ms: number): Promise<number> => {
    const inner = memoryStreamStore()
    let reads = 0
    const counted = {
      ...inner,
      notifies,
      since: (topic: string, fromSeq: number) => {
        reads++
        return inner.since(topic, fromSeq)
      },
    }
    const s = await createStreams(counted)
    const w = await s.open('quiet')
    const reader = (async () => {
      for await (const _ of s.tail('quiet', 0)) {
        // nothing is written until the end, so this body never runs
      }
    })()
    await new Promise((r) => setTimeout(r, ms))
    await w.end()
    await reader
    return reads
  }
  // 700ms at the tight interval is at least two reads after the first; at the
  // slow one the first read is still the only one.
  assert.ok((await readsIn(false, 700)) >= 3, 'a store that cannot notify keeps reading')
  assert.ok((await readsIn(true, 700)) <= 2, 'a store that can notify waits to be told')
})

test('streams: a database that can carry a notification is used to carry one', async () => {
  // The local bus stops at the process boundary, and a job runs in a worker. A
  // driver with notifications closes that gap; the poll stays underneath for the
  // notification that never arrives.
  const adapter = sqliteAdapter()
  await adapter.open()
  const published: Array<[string, string]> = []
  let deliver: ((payload: string) => void) | null = null
  const announcing = {
    ...adapter,
    notifications: {
      async publish(channel: string, payload: string) {
        published.push([channel, payload])
        // A different process would receive it; here the same store does, which
        // is what lets the test observe the path rather than the plumbing.
        deliver?.(payload)
      },
      async subscribe(_channel: string, onMessage: (payload: string) => void, onReady: () => void) {
        deliver = onMessage
        onReady()
        return async () => {
          deliver = null
        }
      },
    },
  }
  const store = dbStreamStore(announcing)
  assert.equal(store.notifies, true, 'a driver with notifications can reach another process')
  const s = await createStreams(store)
  const w = await s.open('across')
  const seen: unknown[] = []
  const reader = (async () => {
    for await (const c of s.tail('across', 0, { pollMs: 60_000 })) seen.push(c.data)
  })()
  await new Promise((r) => setTimeout(r, 10))
  w.write('from a worker')
  await w.flush()
  await new Promise((r) => setTimeout(r, 20))
  await w.end()
  await reader
  assert.deepEqual(seen, ['from a worker'], 'with a 60s poll this only works if the notification woke it')
  assert.deepEqual(published[0]?.[0], 'ket_stream', 'one channel, the topic in the payload')
  assert.equal(published[0]?.[1], 'across')
  await adapter.close()
})

test('streams: a dry run says what would happen, and tells nobody it happened', async () => {
  // Announcing is doing. A preview that woke every screen watching the record
  // would be a command pretending to be a question.
  const adapter = sqliteAdapter()
  await adapter.open()
  const announcing = defineModule({
    name: 'announcing',
    functions: {
      touch: {
        input: {},
        output: { ok: 'bool' },
        dryRun: true,
        handler: async (ctx) => {
          const writer = await ctx.streams.open('preview')
          writer.write('x')
          await writer.end()
          return { ok: true }
        },
      },
    },
  })
  const manifest = compose([announcing])
  registerFunctions([announcing])
  const preview = await callFn('announcing.touch', {}, { adapter, manifest, dryRun: true })
  assert.deepEqual(preview.value, { ok: true }, 'the rehearsal still answers')
  assert.equal('ket_stream' in (await adapter.introspect()), false, 'and left no trace for anyone to hear')

  await callFn('announcing.touch', {}, { adapter, manifest })
  assert.equal('ket_stream' in (await adapter.introspect()), true, 'the real call does announce')
  await adapter.close()
})

test('streams: a reader that goes away stops the tail where it is sleeping', async () => {
  // The wait between reads is seconds long once a notification is what usually
  // ends it. A tail that only noticed at its next read would keep a database
  // open after the caller had finished with it, and then take a read against one
  // that is closing — which is exactly how this surfaced.
  const inner = memoryStreamStore()
  let reads = 0
  const counted = {
    ...inner,
    notifies: true,
    since: (topic: string, fromSeq: number) => {
      reads++
      return inner.since(topic, fromSeq)
    },
  }
  const s = await createStreams(counted)
  const w = await s.open('leaving')
  w.write('a')
  await w.flush()

  const gone = new AbortController()
  const seen: unknown[] = []
  const reader = (async () => {
    for await (const c of s.tail('leaving', 0, { pollMs: 60_000, signal: gone.signal })) seen.push(c.data)
  })()
  await new Promise((r) => setTimeout(r, 20))
  assert.deepEqual(seen, ['a'], 'it read what was there and then went to sleep')
  const readsWhileWatching = reads

  gone.abort()
  // It returns now rather than in a minute, which is the whole point, and this
  // await is what would hang if it did not.
  await reader
  assert.equal(reads, readsWhileWatching, 'and took no read on its way out')
  await w.end()
})

test('streams: a notification arriving during a read is not lost before sleep', async () => {
  let notify = () => {}
  let release!: () => void
  let entered!: () => void
  const reading = new Promise<void>((resolve) => {
    entered = resolve
  })
  const blocked = new Promise<void>((resolve) => {
    release = resolve
  })
  let reads = 0
  const inner = memoryStreamStore()
  const store = {
    ...inner,
    notifies: true,
    subscribe: (_topic: string, cb: () => void) => {
      notify = cb
      return () => {
        notify = () => {}
      }
    },
    async since() {
      reads++
      if (reads === 1) {
        entered()
        await blocked
        return { batches: [], done: false, summary: null, nextSeq: 0 }
      }
      return { batches: [], done: true, summary: null, nextSeq: 0 }
    },
  }
  const streams = await createStreams(store)
  const reader = (async () => {
    for await (const _ of streams.tail('between', 0, { pollMs: 60_000 })) {
      // no chunks; the second read only observes the end marker
    }
  })()
  await reading
  notify()
  release()
  await reader
  assert.equal(reads, 2, 'the notification forces a second read without waiting for the fallback poll')
})

test('streams: aborting while a read is in flight never enters the fallback sleep', async () => {
  let release!: () => void
  let entered!: () => void
  const reading = new Promise<void>((resolve) => {
    entered = resolve
  })
  const blocked = new Promise<void>((resolve) => {
    release = resolve
  })
  const inner = memoryStreamStore()
  const store = {
    ...inner,
    notifies: true,
    async since() {
      entered()
      await blocked
      return { batches: [], done: false, summary: null, nextSeq: 0 }
    },
  }
  const gone = new AbortController()
  const streams = await createStreams(store)
  const reader = (async () => {
    for await (const _ of streams.tail('leaving-mid-read', 0, { pollMs: 60_000, signal: gone.signal })) {
      // no chunks
    }
  })()
  await reading
  gone.abort()
  release()
  await reader
})

test('queue: jobs live in their own table, claimed one at a time', async () => {
  const adapter = sqliteAdapter()
  await adapter.open()
  const q = await createQueue(adapter)
  await q.enqueue('mail', { to: 'a@b.c' })
  await q.enqueue('mail', { to: 'd@e.f' })
  assert.equal(await q.pending('mail'), 2)
  const job = (await q.claim('mail'))!
  assert.deepEqual(job.payload, { to: 'a@b.c' })
  assert.equal(job.attempts, 1)
  await q.complete(job.id)
  assert.equal(await q.pending('mail'), 1)
  const second = (await q.claim('mail'))!
  assert.deepEqual(second.payload, { to: 'd@e.f' })
  assert.equal(await q.claim('mail'), null, 'nothing left to claim')
  await adapter.close()
})
