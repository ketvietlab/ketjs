import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  bootWorker,
  compose,
  createQueue,
  defineApp,
  defineModule,
  effectTransport,
  memoryTransport,
  sqliteAdapter,
  validateOutboundMessage,
} from 'ketjs'
import type { JobContext, OutboundMessage, WorkerLog } from 'ketjs'

const message = (idempotencyKey = 'delivery-1'): OutboundMessage => ({
  idempotencyKey,
  from: { address: 'robot@example.test', name: 'KetSuite' },
  to: [{ address: 'customer@example.test' }],
  subject: 'Transfer ready',
  text: 'Your transfer is ready.',
  headers: { 'X-Ket-Delivery': idempotencyKey },
})

test('outbound transport: envelope safety, exact effect and provider-side idempotency are enforced', async () => {
  const raw = memoryTransport({ now: () => new Date('2026-08-20T00:00:00.000Z') })
  const blocked = effectTransport(raw, [], 'mail_transport.deliver')
  assert.throws(
    () => blocked.send(message()),
    (error: unknown) => (error as { code?: string }).code === 'E_EFFECT_NOT_DECLARED',
  )

  const allowed = effectTransport(raw, ['transport:send'], 'mail_transport.deliver')
  const first = await allowed.send(message())
  const replay = await allowed.send(message())
  assert.equal(first.deduplicated, false)
  assert.equal(replay.deduplicated, true)
  assert.equal(replay.providerMessageId, first.providerMessageId)
  assert.equal(raw.attempts('delivery-1'), 2)
  assert.equal(raw.deliveries().length, 1)

  assert.throws(
    () => validateOutboundMessage({ ...message('bad-header'), subject: 'hello\r\nBcc: victim@example.test' }),
    (error: unknown) => (error as { code?: string }).code === 'E_TRANSPORT_MESSAGE',
  )
})

test('outbound transport: worker retry reuses the stable key and undeclared sends are discarded', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ket-transport-'))
  const database = join(dir, 'worker.db')
  const provider = memoryTransport({
    now: () => new Date('2026-08-20T00:00:00.000Z'),
    fail: (_message, attempt) => (attempt === 1 ? new Error('provider temporarily unavailable') : null),
  })
  const jobs = defineModule({
    name: 'transport_jobs',
    app: true,
    jobs: {
      deliver: {
        queue: 'mail',
        input: { deliveryId: 'id' },
        effects: ['transport:send'],
        idempotent: true,
        maxAttempts: 2,
        handler: async (ctx: JobContext, args) => {
          await ctx.transport.send(message(String(args.deliveryId)), { signal: ctx.signal })
        },
      },
      undeclared: {
        queue: 'mail',
        input: { deliveryId: 'id' },
        idempotent: true,
        maxAttempts: 1,
        handler: async (ctx: JobContext, args) => {
          await ctx.transport.send(message(String(args.deliveryId)), { signal: ctx.signal })
        },
      },
    },
  })
  const app = defineApp({
    name: 'transport_worker',
    modules: [jobs],
    headless: true,
    worker: { queues: { mail: 1 } },
    serve: {
      bootstrap: ['transport_jobs'],
      openTransport: () => provider,
    },
  })
  assert.ok(compose([jobs], { headless: true }).jobs['transport_jobs.deliver'])

  const producer = sqliteAdapter(database)
  await producer.open()
  const queue = await createQueue(producer)
  const delivery = await queue.enqueue(
    'transport_jobs.deliver',
    { deliveryId: 'delivery-retry' },
    { queue: 'mail', maxAttempts: 2 },
  )
  const undeclared = await queue.enqueue(
    'transport_jobs.undeclared',
    { deliveryId: 'delivery-forbidden' },
    { queue: 'mail', maxAttempts: 1 },
  )
  await producer.close()

  const logs: WorkerLog[] = []
  const worker = await bootWorker(app, {
    env: {
      KET_SQLITE: database,
      KET_STORAGE_DIR: join(dir, 'storage'),
      KET_QUEUE_NOTIFY: '0',
    },
    now: () => new Date('2026-08-20T00:00:00.000Z'),
    random: () => 0,
    log: (entry) => logs.push(entry),
  })
  try {
    assert.equal(await worker.drain(), 3, 'one retry plus one discarded undeclared send')
  } finally {
    await worker.close()
  }

  assert.equal(provider.attempts('delivery-retry'), 2)
  assert.equal(provider.deliveries().length, 1)
  assert.equal(provider.deliveries()[0]!.message.idempotencyKey, 'delivery-retry')
  assert.equal(provider.attempts('delivery-forbidden'), 0, 'effect guard fails before provider I/O')
  assert.ok(logs.some((entry) => entry.event === 'retrying' && entry.jobId === delivery.id))
  assert.ok(logs.some((entry) => entry.event === 'discarded' && entry.jobId === undeclared.id))

  const inspector = sqliteAdapter(database)
  await inspector.open()
  const after = await createQueue(inspector)
  assert.equal((await after.get(delivery.id))?.state, 'completed')
  assert.equal((await after.get(undeclared.id))?.state, 'discarded')
  await inspector.close()
  await rm(dir, { recursive: true, force: true })
})
