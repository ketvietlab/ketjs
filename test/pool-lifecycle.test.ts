import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createAdapterPool } from '../packages/ketjs/src/data/pool.ts'
import { sqliteAdapter } from '../packages/ketjs/src/data/sqlite.ts'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve))

test('pool lifecycle: concurrent same-key admission shares one opening adapter', async () => {
  const openingStarted = deferred()
  const finishOpening = deferred()
  let creates = 0
  let closes = 0
  const pool = createAdapterPool({
    create: () => {
      creates++
      const adapter = sqliteAdapter()
      return {
        ...adapter,
        async open() {
          openingStarted.resolve()
          await finishOpening.promise
          await adapter.open()
        },
        async close() {
          closes++
          await adapter.close()
        },
      }
    },
  })

  const first = pool.acquire('same')
  const second = pool.acquire('same')
  await openingStarted.promise
  assert.equal(creates, 1)

  finishOpening.resolve()
  const [a, b] = await Promise.all([first, second])
  assert.equal(a, b)
  pool.release('same')
  pool.release('same')

  await pool.close()
  assert.equal(closes, 1)
})

test('pool lifecycle: reacquiring an entry waits for slow idle eviction', async () => {
  const closeStarted = deferred()
  const finishClose = deferred()
  let clock = 0
  let generation = 0
  const pool = createAdapterPool({
    idleMs: 50,
    now: () => clock,
    create: () => {
      const id = ++generation
      const adapter = sqliteAdapter()
      return {
        ...adapter,
        async open() {
          await adapter.open()
        },
        async close() {
          if (id === 1) {
            closeStarted.resolve()
            await finishClose.promise
          }
          await adapter.close()
        },
      }
    },
  })

  const first = await pool.acquire('tenant')
  pool.release('tenant')
  clock = 100
  const eviction = pool.evictIdle()
  await closeStarted.promise

  let settled = false
  const reacquired = pool.acquire('tenant')
  void reacquired.then(
    () => {
      settled = true
    },
    () => {
      settled = true
    },
  )
  await nextTurn()

  assert.equal(settled, false, 'the closing entry must not be returned')
  assert.equal(generation, 1, 'replacement admission waits until physical close settles')
  assert.deepEqual(pool.open, ['tenant'])

  finishClose.resolve()
  assert.equal(await eviction, 1)
  const replacement = await reacquired
  assert.notEqual(replacement, first)
  assert.equal(generation, 2)
  pool.release('tenant')
  await pool.close()
})

test('pool lifecycle: close rejects a queued admission and all future acquisitions', async () => {
  const closeStarted = deferred()
  const finishClose = deferred()
  let clock = 0
  let creates = 0
  let closes = 0
  const pool = createAdapterPool({
    idleMs: 50,
    now: () => clock,
    create: () => {
      creates++
      const adapter = sqliteAdapter()
      return {
        ...adapter,
        async close() {
          closes++
          closeStarted.resolve()
          await finishClose.promise
          await adapter.close()
        },
      }
    },
  })

  await pool.with('old', async () => {})
  clock = 100
  const eviction = pool.evictIdle()
  await closeStarted.promise
  const queued = pool.acquire('replacement')
  const shutdown = pool.close()

  await assert.rejects(() => pool.acquire('after-close'), /adapter pool is closed/)
  finishClose.resolve()
  assert.equal(await eviction, 1)
  await assert.rejects(() => queued, /adapter pool is closed/)
  await shutdown

  assert.equal(creates, 1, 'shutdown must not admit a replacement adapter')
  assert.equal(closes, 1)
  assert.equal(pool.size, 0)
  await assert.rejects(() => pool.acquire('after-closed'), /adapter pool is closed/)
  await pool.close()
  assert.equal(closes, 1, 'close is idempotent')
})

test('pool lifecycle: close drains an adapter whose acquire is still opening', async () => {
  const openingStarted = deferred()
  const finishOpening = deferred()
  let closes = 0
  const pool = createAdapterPool({
    create: () => {
      const adapter = sqliteAdapter()
      return {
        ...adapter,
        async open() {
          openingStarted.resolve()
          await finishOpening.promise
          await adapter.open()
        },
        async close() {
          closes++
          await adapter.close()
        },
      }
    },
  })

  const acquiring = pool.acquire('opening')
  await openingStarted.promise
  const shutdown = pool.close()
  finishOpening.resolve()

  await assert.rejects(() => acquiring, /adapter pool is closed/)
  await shutdown
  assert.equal(closes, 1)
  assert.equal(pool.size, 0)
})
