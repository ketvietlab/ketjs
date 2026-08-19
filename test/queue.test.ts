import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  bootWorker,
  callFn,
  compose,
  composeWorkspace,
  createQueue,
  defineApp,
  defineModule,
  registerFunctions,
  sqliteAdapter,
} from 'ketjs'
import type { Ctx, JobContext } from 'ketjs'
import type { WorkerLog } from 'ketjs'

const tasks = defineModule({
  name: 'tasks',
  app: true,
  functions: {
    schedule: {
      input: { id: 'id' },
      effects: ['enqueue:tasks.deliver'],
      handler: (ctx: Ctx, args) =>
        ctx.tx((tx) =>
          tx.jobs.enqueue('tasks.deliver', { id: args.id as string }, { uniqueKey: String(args.id) }),
        ),
    },
    scheduleThenFail: {
      input: { id: 'id' },
      effects: ['enqueue:tasks.deliver'],
      handler: (ctx: Ctx, args) =>
        ctx.tx(async (tx) => {
          await tx.jobs.enqueue('tasks.deliver', { id: args.id as string })
          throw new Error('business transaction failed')
        }),
    },
  },
  jobs: {
    deliver: {
      queue: 'default',
      input: { id: 'id' },
      idempotent: true,
      handler: async () => {},
    },
  },
})

test('queue contracts are namespaced and carry operational defaults', () => {
  const manifest = compose([tasks], { headless: true })
  assert.deepEqual(manifest.jobs['tasks.deliver'], {
    by: 'tasks',
    queue: 'default',
    input: { id: 'id' },
    effects: [],
    crossCompany: false,
    idempotent: true,
    maxAttempts: 20,
    timeoutMs: 300_000,
  })

  assert.throws(
    () =>
      compose(
        [
          defineModule({
            name: 'broken_job',
            jobs: {
              bad: {
                queue: 'UPPER',
                idempotent: true,
                handler: async () => {},
              },
            },
          }),
        ],
        { headless: true },
      ),
    /invalid queue/,
  )
  assert.throws(
    () => composeWorkspace([defineApp({ name: 'missing_worker', modules: [tasks], headless: true })]),
    /does not configure that worker queue/,
  )

  const consumer = defineModule({
    name: 'effect_consumer',
    jobs: { run: { idempotent: true, handler: async () => {} } },
  })
  const producer = defineModule({
    name: 'effect_producer',
    functions: {
      schedule: {
        effects: ['enqueue:effect_consumer.run'],
        handler: () => null,
      },
    },
  })
  assert.throws(
    () => compose([consumer, producer], { headless: true }),
    /does not depend on "effect_consumer"/,
  )
  assert.throws(
    () =>
      compose(
        [
          defineModule({
            name: 'unknown_job_effect',
            functions: {
              schedule: { effects: ['enqueue:no_such.job'], handler: () => null },
            },
          }),
        ],
        { headless: true },
      ),
    /unknown effect "enqueue:no_such.job"/,
  )
})

test('enqueue is refused unless the producer declares the exact job effect', async () => {
  const module = defineModule({
    name: 'guarded_enqueue',
    functions: {
      schedule: {
        effects: [],
        handler: (ctx: Ctx) => ctx.jobs.enqueue('guarded_enqueue.run', {}),
      },
    },
    jobs: { run: { idempotent: true, handler: async () => {} } },
  })
  const adapter = sqliteAdapter()
  await adapter.open()
  registerFunctions([module])
  await assert.rejects(
    () =>
      callFn('guarded_enqueue.schedule', {}, { adapter, manifest: compose([module], { headless: true }) }),
    (error: unknown) =>
      (error as { code?: string }).code === 'E_EFFECT_NOT_DECLARED' &&
      /enqueue on guarded_enqueue\.run/.test(String(error)),
  )
  assert.equal((await (await createQueue(adapter)).list()).length, 0)
  await adapter.close()
})

test('queue schema migrates v1 rows instead of abandoning pending work', async () => {
  const adapter = sqliteAdapter()
  await adapter.open()
  await adapter.exec(`CREATE TABLE ket_job (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    queue TEXT NOT NULL,
    payload TEXT,
    state TEXT NOT NULL DEFAULT 'ready',
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`)
  await adapter.run(
    `INSERT INTO ket_job (queue, payload, state, attempts, created_at) VALUES (?, ?, ?, ?, ?)`,
    ['tasks.deliver', JSON.stringify({ id: 'legacy' }), 'ready', 1, '2026-01-01T00:00:00.000Z'],
  )
  const queue = await createQueue(adapter)
  const migrated = await queue.list()
  assert.equal(migrated.length, 1)
  assert.equal(migrated[0]?.id, 'legacy-1')
  assert.equal(migrated[0]?.state, 'available')
  assert.deepEqual(migrated[0]?.args, { id: 'legacy' })
  await adapter.close()
})

test('transactional enqueue rolls back with business data and captures actor/scope on commit', async () => {
  const adapter = sqliteAdapter()
  await adapter.open()
  const manifest = compose([tasks], { headless: true })
  registerFunctions([tasks])

  await assert.rejects(
    () =>
      callFn(
        'tasks.scheduleThenFail',
        { id: 'rolled-back' },
        {
          adapter,
          manifest,
          actor: 'user-7',
          scope: { company: 'acme', companies: ['acme', 'other'], branches: ['north'] },
        },
      ),
    /business transaction failed/,
  )
  const queue = await createQueue(adapter)
  assert.equal((await queue.list()).length, 0, 'the job belongs to the rolled-back transaction')

  const result = await callFn(
    'tasks.schedule',
    { id: 'kept' },
    {
      adapter,
      manifest,
      actor: 'user-7',
      scope: { company: 'acme', companies: ['acme', 'other'], branches: ['north'] },
    },
  )
  const row = await queue.get((result.value as { id: string }).id)
  assert.equal(row?.actor, 'user-7')
  assert.deepEqual(row?.scope, {
    company: 'acme',
    companies: ['acme', 'other'],
    branches: ['north'],
  })
  await adapter.close()
})

test('unique enqueue, priority ordering and due time are enforced by the durable table', async () => {
  const adapter = sqliteAdapter()
  await adapter.open()
  const at = new Date('2026-01-01T00:00:00.000Z')
  const queue = await createQueue(adapter, { now: () => at })
  const concurrent = await Promise.all(
    Array.from({ length: 10 }, () =>
      queue.enqueue('tasks.deliver', { id: 'same' }, { queue: 'default', uniqueKey: 'same' }),
    ),
  )
  assert.equal(new Set(concurrent.map((entry) => entry.id)).size, 1)
  assert.equal(concurrent.filter((entry) => !entry.existing).length, 1)

  await queue.enqueue(
    'tasks.deliver',
    { id: 'later' },
    {
      queue: 'default',
      priority: 0,
      runAt: new Date(at.getTime() + 60_000),
    },
  )
  await queue.enqueue('tasks.deliver', { id: 'low' }, { queue: 'default', priority: 9 })
  const first = await queue.claimBatch('default', { workerId: 'w1', limit: 10 })
  assert.deepEqual(
    first.map((job) => job.args.id),
    ['same', 'low'],
    'a future high-priority job is still not due',
  )
  const completed = first.find((job) => job.args.id === 'same')!
  assert.equal(await queue.complete(completed.id, 'w1'), true)
  const again = await queue.enqueue(
    'tasks.deliver',
    { id: 'same-again' },
    { queue: 'default', uniqueKey: 'same' },
  )
  assert.equal(again.existing, false, 'a terminal job releases its queue uniqueness key')
  assert.notEqual(again.id, completed.id)
  await adapter.close()
})

test('terminal jobs cannot be overwritten by discard and rescue is bounded', async () => {
  const adapter = sqliteAdapter()
  await adapter.open()
  let time = Date.parse('2026-01-01T00:00:00.000Z')
  const queue = await createQueue(adapter, { now: () => new Date(time) })
  for (let n = 0; n < 5; n++)
    await queue.enqueue('tasks.deliver', { id: String(n) }, { queue: 'default', maxAttempts: 2 })
  const claimed = await queue.claimBatch('default', { workerId: 'bounded', leaseMs: 1_000, limit: 5 })
  assert.equal(await queue.complete(claimed[0]!.id, 'bounded'), true)
  assert.equal(await queue.discard(claimed[0]!.id, new Error('late discard')), false)
  assert.equal((await queue.get(claimed[0]!.id))?.state, 'completed')
  assert.equal(await queue.cancel(claimed[1]!.id), true)
  assert.equal(await queue.discard(claimed[1]!.id, new Error('late discard'), 'bounded'), false)
  assert.equal((await queue.get(claimed[1]!.id))?.state, 'cancelled')

  time += 1_001
  assert.deepEqual(await queue.rescue({ limit: 2 }), { retried: 2, discarded: 0 })
  assert.equal((await queue.list({ state: 'executing' })).length, 1)
  assert.deepEqual(await queue.rescue({ limit: 2 }), { retried: 1, discarded: 0 })
  assert.equal((await queue.list({ state: 'executing' })).length, 0)
  await adapter.close()
})

test('expired leases are rescued once and max attempts become discarded', async () => {
  const adapter = sqliteAdapter()
  await adapter.open()
  let time = Date.parse('2026-01-01T00:00:00.000Z')
  const queue = await createQueue(adapter, { now: () => new Date(time) })
  const inserted = await queue.enqueue(
    'tasks.deliver',
    { id: 'lease' },
    {
      queue: 'default',
      maxAttempts: 2,
    },
  )
  assert.equal((await queue.claimBatch('default', { workerId: 'dead-1', leaseMs: 1_000 }))[0]?.attempt, 1)
  time += 1_001
  assert.deepEqual(await queue.rescue(), { retried: 1, discarded: 0 })
  assert.deepEqual(await queue.rescue(), { retried: 0, discarded: 0 }, 'the same lease is not rescued twice')

  assert.equal((await queue.claimBatch('default', { workerId: 'dead-2', leaseMs: 1_000 }))[0]?.attempt, 2)
  time += 1_001
  assert.deepEqual(await queue.rescue(), { retried: 0, discarded: 1 })
  const row = await queue.get(inserted.id)
  assert.equal(row?.state, 'discarded')
  assert.equal(row?.errors.length, 2)
  await adapter.close()
})

test('worker executes with captured context and discards an exhausted handler', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ket-queue-'))
  const file = join(dir, 'jobs.db')
  const seen: Array<{ actor: string | null; company: string | null; id: unknown }> = []
  let timedOut = false
  const module = defineModule({
    name: 'worker_tasks',
    app: true,
    jobs: {
      deliver: {
        input: { id: 'id' },
        idempotent: true,
        handler: async (ctx: JobContext, args) => {
          seen.push({ actor: ctx.actor, company: ctx.scope.company, id: args.id })
        },
      },
      alwaysFails: {
        idempotent: true,
        maxAttempts: 2,
        handler: async () => {
          throw new Error('still broken')
        },
      },
      timesOut: {
        idempotent: true,
        maxAttempts: 1,
        timeoutMs: 20,
        handler: async (ctx: JobContext) => {
          await new Promise<void>((_resolve, reject) => {
            ctx.signal.addEventListener('abort', () => {
              timedOut = true
              reject(ctx.signal.reason)
            })
          })
        },
      },
      ignoresAbort: {
        idempotent: true,
        maxAttempts: 1,
        timeoutMs: 5,
        handler: async () => {
          await new Promise((resolve) => setTimeout(resolve, 20))
        },
      },
    },
  })
  const app = defineApp({
    name: 'worker_test',
    modules: [module],
    headless: true,
    serve: { bootstrap: ['worker_tasks'] },
    worker: { queues: { default: 2 }, leaseMs: 3_000 },
  })

  const producer = sqliteAdapter(file)
  await producer.open()
  const queue = await createQueue(producer)
  const delivered = await queue.enqueue(
    'worker_tasks.deliver',
    { id: 'j1' },
    {
      queue: 'default',
      actor: 'u1',
      scope: { company: 'acme', companies: ['acme'], branches: ['b1'] },
    },
  )
  const failed = await queue.enqueue('worker_tasks.alwaysFails', {}, { queue: 'default', maxAttempts: 2 })
  const removed = await queue.enqueue('removed.oldHandler', {}, { queue: 'default' })
  const timeout = await queue.enqueue('worker_tasks.timesOut', {}, { queue: 'default', maxAttempts: 1 })
  const ignored = await queue.enqueue('worker_tasks.ignoresAbort', {}, { queue: 'default', maxAttempts: 1 })
  await producer.close()

  const fixed = new Date('2026-01-01T00:00:00.000Z')
  const logs: WorkerLog[] = []
  const worker = await bootWorker(app, {
    env: { KET_SQLITE: file, KET_QUEUE_NOTIFY: '0' },
    now: () => fixed,
    random: () => 0,
    log: (entry) => logs.push(entry),
  })
  assert.equal(await worker.drain(), 6, 'success, unknown, two timeout cases, and two failed attempts')
  await worker.close()

  assert.deepEqual(seen, [{ actor: 'u1', company: 'acme', id: 'j1' }])
  const inspector = sqliteAdapter(file)
  await inspector.open()
  const after = await createQueue(inspector)
  assert.equal((await after.get(delivered.id))?.state, 'completed')
  assert.equal((await after.get(failed.id))?.state, 'discarded')
  assert.equal((await after.get(failed.id))?.errors.length, 2)
  assert.equal((await after.get(removed.id))?.state, 'discarded', 'removed code is never executed')
  assert.equal((await after.get(timeout.id))?.state, 'discarded')
  assert.equal((await after.get(ignored.id))?.state, 'discarded')
  assert.equal(timedOut, true)
  assert.ok(logs.some((entry) => entry.event === 'handler_ignored_abort' && entry.jobId === ignored.id))
  await inspector.close()
  rmSync(dir, { recursive: true, force: true })
})

test('multi-database worker refreshes tenants and round-robin prevents a hot tenant starving another', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ket-queue-tenants-'))
  const tenantKeys = ['t1']
  const order: string[] = []
  const module = defineModule({
    name: 'tenant_jobs',
    app: true,
    jobs: {
      record: {
        input: { n: 'int' },
        idempotent: true,
        handler: async (ctx: JobContext) => {
          order.push(ctx.scope.company as string)
        },
      },
    },
  })
  const app = defineApp({
    name: 'tenant_worker_test',
    modules: [module],
    headless: true,
    serve: {
      bootstrap: ['tenant_jobs'],
      tenants: {
        resolve: () => null,
        open: (key) => sqliteAdapter(join(dir, `${key}.db`)),
        list: async () => [...tenantKeys],
        max: 1,
      },
    },
    worker: {
      queues: { default: 10 },
      tenantRefreshMs: 60_000,
    },
  })
  let time = Date.parse('2026-01-01T00:00:00.000Z')
  const worker = await bootWorker(app, {
    env: { KET_QUEUE_NOTIFY: '0' },
    now: () => new Date(time),
    log: () => {},
  })
  await worker.runOnce()

  tenantKeys.push('t2')
  time += 60_001
  for (const [key, count] of [
    ['t1', 20],
    ['t2', 1],
  ] as const) {
    const adapter = sqliteAdapter(join(dir, `${key}.db`))
    await adapter.open()
    const queue = await createQueue(adapter)
    for (let n = 0; n < count; n++)
      await queue.enqueue('tenant_jobs.record', { n }, { queue: 'default', scope: { company: key } })
    await adapter.close()
  }

  assert.equal(await worker.drain(), 21)
  assert.ok(order.indexOf('t2') <= 1, `cold tenant ran at position ${order.indexOf('t2')}`)
  assert.equal(order.filter((key) => key === 't1').length, 20)
  await worker.close()
  rmSync(dir, { recursive: true, force: true })
})

test('cancelling an executing job aborts its handler and cannot be overwritten by complete/retry', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ket-queue-cancel-'))
  const file = join(dir, 'jobs.db')
  let started!: () => void
  const didStart = new Promise<void>((resolve) => {
    started = resolve
  })
  let aborted = false
  const module = defineModule({
    name: 'cancel_jobs',
    app: true,
    jobs: {
      wait: {
        idempotent: true,
        handler: async (ctx: JobContext) => {
          started()
          await new Promise<void>((_resolve, reject) => {
            ctx.signal.addEventListener('abort', () => {
              aborted = true
              reject(ctx.signal.reason)
            })
          })
        },
      },
    },
  })
  const app = defineApp({
    name: 'cancel_worker_test',
    modules: [module],
    headless: true,
    serve: { bootstrap: ['cancel_jobs'] },
    worker: { queues: { default: 1 }, leaseMs: 3_000, shutdownGraceMs: 100 },
  })
  const producer = sqliteAdapter(file)
  await producer.open()
  const queue = await createQueue(producer)
  const row = await queue.enqueue('cancel_jobs.wait', {}, { queue: 'default' })
  await producer.close()

  const logs: WorkerLog[] = []
  const worker = await bootWorker(app, {
    env: { KET_SQLITE: file, KET_QUEUE_NOTIFY: '0' },
    log: (entry) => logs.push(entry),
  })
  assert.equal(await worker.runOnce(), 1)
  await didStart
  const operator = sqliteAdapter(file)
  await operator.open()
  const operatorQueue = await createQueue(operator)
  assert.equal((await operatorQueue.get(row.id))?.state, 'executing')
  assert.equal(await operatorQueue.cancel(row.id), true)
  const deadline = Date.now() + 2_000
  while (!aborted && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(aborted, true)
  while (!logs.some((entry) => entry.event === 'cancelled') && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal((await operatorQueue.get(row.id))?.state, 'cancelled')
  assert.ok(logs.some((entry) => entry.event === 'cancelled'))
  await operator.close()
  await worker.close()
  rmSync(dir, { recursive: true, force: true })
})
