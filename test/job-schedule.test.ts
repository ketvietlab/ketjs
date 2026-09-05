import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import {
  claimDue,
  compose,
  defineDeployment,
  defineJob,
  defineModule,
  migrateOne,
  parseEvery,
  sqliteAdapter,
  tickAt,
  ticksBetween,
  validateSchedule,
  type Adapter,
  type Manifest,
} from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'

const ran: string[] = []

const nightly = defineModule({
  name: 'nightly',
  models: { Mark: { scope: 'shared', fields: { id: 'id', at: 'text' } } },
  jobs: {
    close: defineJob({
      input: {},
      idempotent: true,
      schedule: { every: '10s' },
      effects: ['write:nightly.Mark'],
      handler: async (ctx) => {
        ran.push(ctx.job.id)
        await ctx.db.insert('nightly.Mark', { id: ctx.job.id, at: new Date().toISOString() })
      },
    }),
  },
})

const app = defineDeployment({
  name: 'nightly_app',
  headless: true,
  modules: [nightly],
  serve: {},
  worker: { queues: { default: 1 }, scheduleSweepMs: 1_000 },
})

const manifestOf = (): Manifest => compose([nightly], { headless: true })

const openDatabase = async (t: TestContext): Promise<{ adapter: Adapter; manifest: Manifest }> => {
  const adapter = sqliteAdapter(':memory:')
  await adapter.open()
  t.after(() => adapter.close())
  const manifest = manifestOf()
  await migrateOne(adapter, manifest)
  return { adapter, manifest }
}

test('an interval is a count and a unit, and a schedule that is not one is a build error', () => {
  assert.equal(parseEvery('30s'), 30_000)
  assert.equal(parseEvery('15m'), 900_000)
  assert.equal(parseEvery('1d'), 86_400_000)

  for (const bad of ['', '15', 'm', '15 m', '15minutes', '-5m']) {
    assert.throws(() => parseEvery(bad), /is not an interval/, bad)
  }
  // Below the floor a sweep costs more than the work it schedules.
  assert.throws(() => parseEvery('5s'), /shorter than the 10s minimum/)
  assert.throws(() => validateSchedule({ dailyAt: '25:00' }), /is not a time of day/)
  assert.throws(() => validateSchedule({ dailyAt: '3:00' }), /is not a time of day/)
  validateSchedule({ dailyAt: '03:00' })
})

test('a tick is the occurrence that has passed, in the timezone that was named', () => {
  const at = (iso: string) => new Date(iso)

  // Interval ticks are floors, so every replica computes the same one.
  assert.equal(tickAt({ every: '15m' }, at('2026-09-05T10:07:31Z'), 'UTC'), '2026-09-05T10:00:00.000Z')
  assert.equal(tickAt({ every: '15m' }, at('2026-09-05T10:14:59Z'), 'UTC'), '2026-09-05T10:00:00.000Z')
  assert.equal(tickAt({ every: '15m' }, at('2026-09-05T10:15:00Z'), 'UTC'), '2026-09-05T10:15:00.000Z')

  // 03:00 in Ho Chi Minh is 20:00 UTC the day before, which is exactly the kind of
  // thing that makes "nightly" wrong when it is computed in the server's timezone.
  const tz = 'Asia/Ho_Chi_Minh'
  assert.equal(tickAt({ dailyAt: '03:00' }, at('2026-09-05T04:00:00Z'), tz), '2026-09-04T20:00:00.000Z')
  // Just before the occurrence, the one that has actually passed is yesterday's.
  assert.equal(tickAt({ dailyAt: '03:00' }, at('2026-09-04T19:59:00Z'), tz), '2026-09-03T20:00:00.000Z')

  assert.equal(ticksBetween({ every: '1d' }, '2026-09-01T00:00:00.000Z', '2026-09-04T00:00:00.000Z'), 2)
  assert.equal(ticksBetween({ every: '1d' }, '2026-09-03T00:00:00.000Z', '2026-09-04T00:00:00.000Z'), 0)
})

test('a schedule does not fire for the tick it was installed inside', async (t) => {
  const { adapter, manifest } = await openDatabase(t)
  const now = new Date('2026-09-05T10:00:05Z')

  // Nobody asked for a run at deploy time, and a nightly job firing the moment it
  // is installed is a surprise at the worst possible moment.
  assert.deepEqual(await claimDue(adapter, manifest, { now, timezone: 'UTC' }), [])
  assert.deepEqual(await claimDue(adapter, manifest, { now, timezone: 'UTC' }), [])
})

test('two workers looking at one tick produce exactly one run', async (t) => {
  const { adapter, manifest } = await openDatabase(t)
  const start = new Date('2026-09-05T10:00:05Z')
  await claimDue(adapter, manifest, { now: start, timezone: 'UTC' })

  const due = new Date('2026-09-05T10:00:15Z')
  // Sequential rather than concurrent on purpose: the second call is the replica
  // that lost the compare-and-set, and losing it must be silent and empty rather
  // than an error or a second run.
  const first = await claimDue(adapter, manifest, { now: due, timezone: 'UTC' })
  const second = await claimDue(adapter, manifest, { now: due, timezone: 'UTC' })

  assert.equal(first.length, 1)
  assert.equal(first[0]!.job, 'nightly.close')
  assert.equal(first[0]!.tick, '2026-09-05T10:00:10.000Z')
  assert.deepEqual(second, [])
})

test('ticks missed while nothing was running are skipped, and counted', async (t) => {
  const { adapter, manifest } = await openDatabase(t)
  await claimDue(adapter, manifest, { now: new Date('2026-09-05T10:00:05Z'), timezone: 'UTC' })

  // Two hours of downtime is 719 missed ten-second ticks. One run, not 720.
  const back = new Date('2026-09-05T12:00:05Z')
  const claims = await claimDue(adapter, manifest, { now: back, timezone: 'UTC' })
  assert.equal(claims.length, 1)
  assert.equal(claims[0]!.tick, '2026-09-05T12:00:00.000Z')
  assert.equal(claims[0]!.skipped, 719)
})

test('a due schedule enqueues its job, and the worker runs it once', async (t) => {
  ran.length = 0
  // A schedule is the one thing a drain cannot hurry along, so the clock moves
  // instead of the test waiting: deterministic, and ten seconds cheaper.
  let clock = new Date('2026-09-05T10:00:05Z')
  const deployment = await createTestDeployment(app, { workerNow: () => clock })
  t.after(() => deployment.close())
  const worker = deployment.worker
  assert.ok(worker, 'the deployment declares a queue, so a worker was booted')

  // The first sweep only records where the schedule starts.
  assert.equal(await worker.sweepSchedules(), 0)
  clock = new Date('2026-09-05T10:00:15Z')
  assert.equal(await worker.sweepSchedules(), 1)
  // A second sweep in the same tick adds nothing, exactly as a second replica would.
  assert.equal(await worker.sweepSchedules(), 0)

  assert.equal(await deployment.drainJobs(), 1)
  assert.equal(ran.length, 1)

  const fired = deployment.records.first('schedule_fired')
  assert.ok(fired, 'a schedule that fires must be visible')
  assert.equal(fired.fn, 'nightly.close')
  assert.equal(fired.process, 'worker')
  assert.equal(fired.fields?.skipped, 0)
  assert.equal(deployment.records.first('job_completed')?.fn, 'nightly.close')
})

test('a scheduled job that needs arguments is refused at composition', () => {
  const needy = defineModule({
    name: 'needy',
    jobs: {
      report: defineJob({
        input: { since: 'date' },
        idempotent: true,
        schedule: { every: '1h' },
        handler: async () => {},
      }),
    },
  })
  // Nobody is there at three in the morning to supply an argument.
  assert.throws(
    () => compose([needy], { headless: true }),
    (error: unknown) => /requires input since/.test(String((error as Error).message)),
  )

  const wrong = defineModule({
    name: 'wrong',
    jobs: {
      report: defineJob({ input: {}, idempotent: true, schedule: { every: '2x' }, handler: async () => {} }),
    },
  })
  assert.throws(
    () => compose([wrong], { headless: true }),
    (error: unknown) => /is not an interval/.test(String((error as Error).message)),
  )
})

test('only a cross-company operation may enqueue into another company', async (t) => {
  const fanout = defineModule({
    name: 'fanout',
    models: { Row: { scope: 'company', fields: { id: 'id', label: 'text' } } },
    jobs: {
      perCompany: defineJob({
        input: { company: 'text?' },
        idempotent: true,
        effects: ['write:fanout.Row'],
        handler: async (ctx) => {
          await ctx.db.insert('fanout.Row', { id: `row-${ctx.job.id}`, label: 'done' })
        },
      }),
      // The shape a schedule takes: no company of its own, reads across them, and
      // hands each legal entity its own job.
      sweep: defineJob({
        input: {},
        idempotent: true,
        crossCompany: true,
        schedule: { every: '1h' },
        effects: ['enqueue:fanout.perCompany'],
        handler: async (ctx) => {
          await ctx.jobs.enqueue('fanout.perCompany', {}, { company: 'acme' })
        },
      }),
      // The same call without the declaration.
      sneak: defineJob({
        input: {},
        idempotent: true,
        effects: ['enqueue:fanout.perCompany'],
        handler: async (ctx) => {
          await ctx.jobs.enqueue('fanout.perCompany', {}, { company: 'acme' })
        },
      }),
    },
  })
  const spec = defineDeployment({
    name: 'fanout_app',
    headless: true,
    modules: [fanout],
    serve: {},
    worker: { queues: { default: 1 } },
  })
  const deployment = await createTestDeployment(spec)
  t.after(() => deployment.close())

  await deployment.fixture.call('fanout.sweep' as string, {}).catch(() => {})
  await deployment.deployment.tenants.with('', async (tenant) => {
    const { createQueue } = await import('@ketvietlab/ketjs')
    const queue = await createQueue(tenant.adapter)
    await queue.enqueue('fanout.sweep', {}, { queue: 'default', maxAttempts: 1 })
    await queue.enqueue('fanout.sneak', {}, { queue: 'default', maxAttempts: 1 })
  })
  await deployment.drainJobs()

  // The declared one fanned out and its child wrote into the company it was given.
  const completed = deployment.records.of('job_completed').map((record) => record.fn)
  assert.ok(completed.includes('fanout.sweep'))
  assert.ok(completed.includes('fanout.perCompany'), 'the per-company child ran')

  // The undeclared one was refused, and the refusal names the declaration to add.
  const discarded = deployment.records.of('job_discarded').find((record) => record.fn === 'fanout.sneak')
  assert.ok(discarded, 'enqueueing into another company without the declaration must fail')
  assert.match(String(discarded.error?.code), /E_ENQUEUE_COMPANY_NOT_ALLOWED/)
})
