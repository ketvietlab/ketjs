import { test } from 'node:test'
import assert from 'node:assert/strict'
import { effect, signal } from '@ketvietlab/ketjs-view'
import { createMirror } from '@ketvietlab/ketjs-view/mirror'
import type { Mirror } from '@ketvietlab/ketjs-view/mirror'
import { defineStore } from '@ketvietlab/ketjs-view/store'
import type { StoreScope } from '@ketvietlab/ketjs-view/store'

type Row = { id: number; name: string }

const tick = () => new Promise<void>((resolve) => setImmediate(resolve))

/** An async call the test settles explicitly. */
function deferred<T = unknown>() {
  const calls: Array<{
    input: unknown
    signal: AbortSignal
    resolve(value: T): void
    reject(error: unknown): void
  }> = []
  const run = (input: unknown, signal: AbortSignal) =>
    new Promise<T>((resolve, reject) => calls.push({ input, signal, resolve, reject }))
  return { calls, run }
}

const createCounter = defineStore('test.counter', (input: { start: number }, _deps, use) => {
  const count = use.state(input.start)
  const label = use.state('')
  const doubled = use.derived(() => count() * 2)
  const bump = use.action((by: number) => {
    count.set((value) => value + by)
    label.set(`+${by}`)
    return count.peek()
  })
  return { count, label, doubled, bump }
})

// Compile-time contract: state is read-only outside the store, and deps may be omitted.
function typeChecks(store: ReturnType<typeof createCounter>): void {
  // @ts-expect-error state is read-only outside the store
  store.count.set(1)
  // @ts-expect-error a derived value is not writable either
  store.doubled.set(1)
  const total: number = store.count() + store.doubled()
  void total
}
void typeChecks

test('a store is created per instance and instances share nothing', () => {
  let setups = 0
  const create = defineStore('test.instances', (_input: Record<string, never>, _deps, use) => {
    setups++
    const items = use.state<string[]>([])
    return { items, add: use.action((item: string) => items.set((list) => [...list, item])) }
  })
  const first = create({})
  const second = create({})
  first.add('a')
  assert.equal(setups, 2)
  assert.deepEqual(first.items(), ['a'])
  assert.deepEqual(second.items(), [])
  assert.equal(first.id, 'test.instances')
})

test('state is read-only outside the store and tracked by effects', () => {
  const store = createCounter({ start: 1 })
  assert.equal('set' in store.count, false)
  assert.equal('dispose' in store.doubled, false)
  assert.throws(() => {
    ;(store as unknown as Record<string, unknown>).count = signal(5)
  }, TypeError)
  const seen: number[] = []
  const stop = effect(() => {
    seen.push(store.doubled())
  })
  assert.equal(store.bump(2), 3)
  assert.deepEqual(seen, [2, 6])
  assert.equal(store.count.peek(), 3)
  stop()
})

test('a raw signal returned by setup is exposed read-only too', () => {
  const create = defineStore('test.raw', (_input: object, _deps, _use) => ({ flag: signal(true) }))
  const store = create({})
  assert.equal(store.flag(), true)
  assert.equal('set' in store.flag, false)
})

test('an action writes in one batch and does not subscribe the effect that calls it', () => {
  const create = defineStore('test.batch', (_input: object, _deps, use) => {
    const a = use.state(0)
    const b = use.state(0)
    const both = use.action(() => {
      a.set(1)
      b.set(1)
    })
    const nested = use.action(() => {
      both()
      a.set(2)
    })
    const read = use.action(() => a() + b())
    return { a, b, both, nested, read }
  })
  const store = create({})
  let runs = 0
  const stop = effect(() => {
    store.a()
    store.b()
    runs++
  })
  store.both()
  assert.equal(runs, 2, 'two writes, one run')
  store.nested()
  assert.equal(runs, 3, 'a nested action stays one batch')
  stop()

  const outer = signal(0)
  let callerRuns = 0
  const caller = effect(() => {
    outer()
    store.read()
    callerRuns++
  })
  store.both()
  store.nested()
  assert.equal(callerRuns, 1, 'state read inside an action is not tracked by the caller')
  caller()
})

test('plain objects and arrays are frozen in place, and frozen rows keep their identity', () => {
  class Point {
    x: number
    constructor(x: number) {
      this.x = x
    }
  }
  const create = defineStore('test.freeze', (_input: object, _deps, use) => {
    const rows = use.state<Row[]>([{ id: 1, name: 'a' }])
    const extra = use.state<{ map: Map<string, number>; point: Point } | null>(null)
    return {
      rows,
      extra,
      add: use.action((row: Row) => rows.set((list) => [...list, row])),
      setExtra: use.action((value: { map: Map<string, number>; point: Point }) => extra.set(value)),
    }
  })
  const store = create({})
  const first = store.rows()[0]
  assert.ok(Object.isFrozen(store.rows()))
  assert.ok(first && Object.isFrozen(first))
  assert.throws(() => {
    ;(first as Row).name = 'changed'
  }, TypeError)
  const added = { id: 2, name: 'b' }
  store.add(added)
  assert.equal(store.rows()[0], first, 'an unchanged row keeps its identity')
  assert.equal(store.rows()[1], added, 'a written value is frozen in place, not copied')
  assert.ok(Object.isFrozen(added))

  const map = new Map([['a', 1]])
  const point = new Point(1)
  store.setExtra({ map, point })
  assert.ok(Object.isFrozen(store.extra()))
  assert.equal(Object.isFrozen(point), false, 'a class instance is held as it is')
  map.set('b', 2)
  assert.equal(store.extra()?.map.get('b'), 2)
})

test('nothing connects before attach, and connect gets a lifetime that ends with it', () => {
  const log: string[] = []
  const lifetimes: AbortSignal[] = []
  const create = defineStore('test.connect', (_input: object, _deps, use) => {
    use.connect((lifetime) => {
      lifetimes.push(lifetime)
      log.push('first')
      return () => log.push('first cleanup')
    })
    use.connect(() => {
      log.push('second')
      return () => log.push('second cleanup')
    })
    return {}
  })
  const store = create({})
  assert.deepEqual(log, [], 'a server render never connects')

  const lifetime = new AbortController()
  store.attach(lifetime.signal)
  assert.deepEqual(log, ['first', 'second'])
  assert.throws(() => store.attach(new AbortController().signal), /already attached/)
  lifetime.abort()
  assert.deepEqual(log, ['first', 'second', 'second cleanup', 'first cleanup'])
  assert.equal(lifetimes[0]?.aborted, true)

  const aborted = new AbortController()
  aborted.abort()
  store.attach(aborted.signal)
  assert.equal(log.length, 4, 'an aborted lifetime connects nothing')

  store.attach(new AbortController().signal)
  assert.equal(log.length, 6, 'attaching again connects again')
  store.dispose()
  assert.deepEqual(log.slice(6), ['second cleanup', 'first cleanup'])
  assert.equal(lifetimes[1]?.aborted, true)
  assert.throws(() => store.attach(new AbortController().signal), /disposed/)
})

test('an exclusive task rejects a second run, and a failure sets error', async () => {
  const api = deferred<string>()
  const create = defineStore('test.exclusive', (_input: object, _deps, use) => ({
    save: use.task((name: string, signal) => api.run(name, signal)),
  }))
  const store = create({})
  const first = store.save.run('a')
  assert.equal(store.save.pending(), true)
  assert.deepEqual(await store.save.run('b'), { status: 'rejected' })
  api.calls[0]?.resolve('saved a')
  assert.deepEqual(await first, { status: 'done', value: 'saved a' })
  assert.equal(store.save.pending(), false)

  const failing = store.save.run('c')
  const cause = new Error('HTTP 500')
  api.calls[1]?.reject(cause)
  assert.deepEqual(await failing, { status: 'failed', error: cause })
  assert.equal(store.save.error(), cause)
  const retry = store.save.run('d')
  assert.equal(store.save.error(), undefined, 'a new run clears the last failure')
  api.calls[2]?.resolve('saved d')
  await retry

  const throwing = defineStore('test.throwing', (_input: object, _deps, use) => ({
    fail: use.task((): Promise<void> => {
      throw new Error('sync')
    }),
  }))({})
  const outcome = await throwing.fail.run()
  assert.equal(outcome.status, 'failed')
})

test('a latest task supersedes the pending run and aborts its signal', async () => {
  const api = deferred<string>()
  const create = defineStore('test.latest', (_input: object, _deps, use) => ({
    search: use.task((query: string, signal) => api.run(query, signal), { concurrency: 'latest' }),
  }))
  const store = create({})
  const older = store.search.run('a')
  const newer = store.search.run('ab')
  assert.equal(api.calls[0]?.signal.aborted, true)
  api.calls[0]?.resolve('late answer')
  assert.deepEqual(await older, { status: 'superseded' })
  assert.equal(store.search.pending(), true, 'the newer run is still pending')
  api.calls[1]?.resolve('ab results')
  assert.deepEqual(await newer, { status: 'done', value: 'ab results' })
  assert.equal(store.search.pending(), false)
})

test('ending the lifetime or disposing aborts tasks in flight', async () => {
  const api = deferred()
  const create = defineStore('test.abort', (_input: object, _deps, use) => ({
    work: use.task((input: number, signal) => api.run(input, signal), { concurrency: 'latest' }),
  }))
  const store = create({})
  const lifetime = new AbortController()
  store.attach(lifetime.signal)
  const during = store.work.run(1)
  lifetime.abort()
  assert.equal(api.calls[0]?.signal.aborted, true)
  api.calls[0]?.resolve('ignored')
  assert.deepEqual(await during, { status: 'aborted' })

  const before = store.work.run(2)
  store.dispose()
  assert.equal(api.calls[1]?.signal.aborted, true)
  api.calls[1]?.resolve('ignored')
  assert.deepEqual(await before, { status: 'aborted' })
  assert.deepEqual(await store.work.run(3), { status: 'aborted' })
  assert.equal(api.calls.length, 2, 'a disposed store runs nothing')
})

test('dispose stops actions and derived values and disposes owned children in reverse order', () => {
  const disposed: string[] = []
  let derivedRuns = 0
  const outside = signal(1)
  const held: { scope?: StoreScope } = {}
  const create = defineStore('test.dispose', (_input: object, _deps, use) => {
    held.scope = use
    const value = use.state(0)
    use.own({ dispose: () => disposed.push('first') })
    use.own({ dispose: () => disposed.push('second') })
    const sum = use.derived(() => {
      derivedRuns++
      return outside() + value()
    })
    return { value, sum, set: use.action((next: number) => value.set(next)) }
  })
  const store = create({})
  assert.equal(store.sum(), 1)
  store.dispose()
  store.dispose()
  assert.deepEqual(disposed, ['second', 'first'])
  assert.equal(store.set(5), undefined)
  assert.equal(store.value(), 0, 'a write after dispose is ignored')
  const runs = derivedRuns
  outside.set(2)
  assert.equal(derivedRuns, runs, 'a disposed derived value no longer recomputes')
  const late = { dispose: () => disposed.push('late') }
  assert.equal(held.scope?.own(late), late)
  assert.deepEqual(disposed, ['second', 'first', 'late'], 'own() after dispose disposes at once')
})

test('snapshot is a JSON copy of the top-level state', () => {
  const create = defineStore('test.snapshot', (_input: object, _deps, use) => {
    const query = use.state('an')
    const selected = use.state<readonly number[]>([1, 2])
    const hidden = use.state('private')
    return { query, selected, length: use.derived(() => hidden().length) }
  })
  const store = create({})
  const snapshot = store.snapshot()
  assert.deepEqual(snapshot, { query: 'an', selected: [1, 2] })
  assert.notEqual(snapshot.selected, store.selected(), 'a copy, not the held value')
})

test('a failing setup disposes what it created', () => {
  const disposed: string[] = []
  const create = defineStore('test.failing', (_input: object, _deps, use) => {
    use.own({ dispose: () => disposed.push('child') })
    throw new Error('setup failed')
  })
  assert.throws(() => create({}), /setup failed/)
  assert.deepEqual(disposed, ['child'])
})

test('misuse is reported', () => {
  assert.throws(() => defineStore('', () => ({})), TypeError)
  assert.throws(() => defineStore('test.reserved', () => ({ dispose: () => {} }))({}), /reserved/)
  assert.throws(
    () => defineStore('test.array', () => [] as unknown as Record<string, unknown>)({}),
    TypeError,
  )
  assert.throws(
    () =>
      defineStore('test.concurrency', (_input: object, _deps, use) => ({
        task: use.task(async () => {}, { concurrency: 'queue' as 'latest' }),
      }))({}),
    TypeError,
  )
  const held: { scope?: StoreScope } = {}
  defineStore('test.late', (_input: object, _deps, use) => {
    held.scope = use
    return {}
  })({})
  assert.throws(() => held.scope?.state(1), /only while the store is set up/)
  assert.throws(() => held.scope?.connect(() => {}), /only while the store is set up/)
  assert.throws(() => held.scope?.own({} as { dispose(): void }), TypeError)
})

test('a store owns Mirror readings that follow its state', async () => {
  const loads: unknown[] = []
  const parseRows = (raw: unknown): Row[] => raw as Row[]
  const createOrders = defineStore(
    'test.orders',
    (input: { status: string }, deps: { mirror: Mirror }, use) => {
      const status = use.state(input.status)
      const orders = use.own(
        deps.mirror.read({
          key: () => ['orders', { status: status() }] as const,
          load: async ([, filter]) => {
            loads.push(filter.status)
            return [{ id: loads.length, name: filter.status }]
          },
          parse: parseRows,
          tags: () => ['orders'],
        }),
      )
      return { status, orders, filter: use.action((next: string) => status.set(next)) }
    },
  )
  const mirror = createMirror()
  const lifetime = new AbortController()
  mirror.attach(lifetime.signal)
  const store = createOrders({ status: 'open' }, { mirror })
  await store.orders.settled()
  assert.deepEqual(store.orders.data(), [{ id: 1, name: 'open' }])
  store.filter('closed')
  await tick()
  await store.orders.settled()
  assert.deepEqual(store.orders.data(), [{ id: 2, name: 'closed' }])

  store.dispose()
  mirror.invalidate('orders')
  await tick()
  assert.deepEqual(loads, ['open', 'closed'], 'a disposed store no longer observes its readings')
  lifetime.abort()
  mirror.dispose()
})
