import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test, type TestContext } from 'node:test'
import {
  bufferedLog,
  CORE_EVENTS,
  createLogger,
  defineDeployment,
  defineJob,
  defineModule,
  enforcePolicy,
  KetError,
  leveledLog,
  memoryLog,
  MODULE_EVENT,
  multiLog,
  readConfig,
  redactLog,
  text,
  traceOf,
  type LogDriver,
  type LogRecord,
} from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'

const record = (over: Partial<LogRecord> = {}): LogRecord => ({
  at: '2026-09-04T00:00:00.000Z',
  level: 'info',
  event: 'fn_call',
  deployment: 'app',
  process: 'http',
  tenant: null,
  trace: null,
  ...over,
})

const observed = defineModule({
  name: 'observed',
  models: { Note: { scope: 'shared', fields: { id: 'id', body: 'text' } } },
  functions: {
    ok: { input: {}, output: { done: 'bool' }, handler: () => ({ done: true }) },
    speak: {
      input: {},
      output: { done: 'bool' },
      handler: (ctx) => {
        ctx.log.info('observed.spoke', { where: 'handler' })
        return { done: true }
      },
    },
    leak: {
      input: {},
      output: { done: 'bool' },
      handler: (ctx) => {
        // A JavaScript caller can hand over what the type forbids.
        ctx.log.info('observed.leaked', {
          password: 'hunter2',
          note: { secret: 'nested' },
        } as never)
        return { done: true }
      },
    },
    named: {
      input: {},
      output: { done: 'bool' },
      handler: () => {
        throw new KetError({ code: 'E_EXPECTED', message: 'a contract this system named' })
      },
    },
    burst: {
      input: {},
      output: { done: 'bool' },
      handler: () => {
        throw new TypeError('nobody wrote a try for this')
      },
    },
    schedule: {
      input: {},
      effects: ['enqueue:observed.remind'],
      handler: (ctx) => ctx.jobs.enqueue('observed.remind', {}),
    },
  },
  jobs: {
    remind: defineJob({ input: {}, idempotent: true, handler: async () => {} }),
  },
})

const app = defineDeployment({
  name: 'logging_e2e',
  headless: true,
  modules: [observed],
  serve: {
    routes: () => ({
      '/boom/{id}': async () => {
        throw new TypeError('route exploded')
      },
      '/fine/{id}': async (_url, _req, params) => text(params.id ?? ''),
    }),
  },
})

const worked = defineDeployment({
  name: 'logging_worker_e2e',
  headless: true,
  modules: [observed],
  serve: {},
  worker: { queues: { default: 1 } },
})

const boot = async (t: TestContext) => {
  const deployment = await createTestDeployment(app, { worker: false })
  t.after(() => deployment.close())
  return deployment
}

test('log configuration is checked at boot, not at the first record', () => {
  const base = readConfig({})
  assert.equal(base.logDriver, 'auto')
  assert.equal(base.logLevel, 'info')
  // stdout carries the answer a command was run for; a log line in it breaks the pipe.
  assert.equal(base.logStream, 'stderr')

  assert.throws(
    () => readConfig({ KET_LOG: 'syslog' }),
    (error: unknown) => (error as KetError).code === 'E_LOG_CONFIG',
  )
  assert.throws(
    () => readConfig({ KET_LOG_LEVEL: 'verbose' }),
    (error: unknown) => (error as KetError).code === 'E_LOG_CONFIG',
  )
  assert.throws(
    () => readConfig({ KET_LOG_BUFFER: '0' }),
    (error: unknown) => (error as KetError).code === 'E_LOG_CONFIG',
  )
})

test('a trace is keyed by the deployment secret, so pods agree and guessing does not', () => {
  // Every pod holds the same secret, which is the only reason a web record and a
  // worker record can be recognised as the same request.
  assert.equal(traceOf('order-42', 'shared-secret'), traceOf('order-42', 'shared-secret'))
  assert.notEqual(traceOf('order-42', 'shared-secret'), traceOf('order-42', 'other-secret'))
  // A low-entropy command key must not be recoverable from an aggregator.
  assert.notEqual(traceOf('order-42', 'shared-secret'), traceOf('order-42', null))
  assert.equal(traceOf('order-42', 'shared-secret')?.length, 16)
  assert.equal(traceOf('  ', 'shared-secret'), null)
  assert.equal(traceOf(null, 'shared-secret'), null)
})

test('redaction removes what the type system cannot see', () => {
  const sink = memoryLog()
  redactLog(sink).write([
    record({
      fields: {
        password: 'hunter2',
        apiKey: 'k',
        keep: 'yes',
        long: 'x'.repeat(600),
        nested: { deep: true } as never,
      },
    }),
  ])
  const fields = sink.records[0]?.fields as Record<string, unknown>
  assert.equal(fields.password, '[redacted]')
  assert.equal(fields.apiKey, '[redacted]')
  assert.equal(fields.keep, 'yes')
  assert.equal(String(fields.long).length, 513)
  assert.equal(fields.nested, '[dropped: non-scalar]')
})

test('a level filter drops before anything else does work', () => {
  const sink = memoryLog()
  const driver = leveledLog(sink, 'warn')
  driver.write([record({ level: 'debug' }), record({ level: 'warn' }), record({ level: 'error' })])
  assert.deepEqual(
    sink.records.map((r) => r.level),
    ['warn', 'error'],
  )
})

test('one failing sink never stops the others', () => {
  const sink = memoryLog()
  const broken: LogDriver = {
    name: 'broken',
    write() {
      throw new Error('the collector is down')
    },
  }
  multiLog([broken, sink]).write([record()])
  assert.equal(sink.records.length, 1)
})

test('a full buffer drops the newest, keeps room for errors, and says what it lost', async () => {
  const sink = memoryLog()
  const driver = bufferedLog(sink, { max: 4, everyMs: 60_000, errorReserve: 0.5, batch: 64 })

  // Two slots for anything; all four for an error.
  driver.write([record({ event: 'a' }), record({ event: 'b' }), record({ event: 'c' })])
  driver.write([record({ level: 'error', event: 'boom' })])
  await driver.flush?.()

  const events = sink.records.map((r) => r.event)
  assert.deepEqual(events, ['log_dropped', 'a', 'b', 'boom'])
  // The gap is announced rather than left to be mistaken for quiet.
  assert.equal(sink.records[0]?.fields?.count, 1)
  assert.equal(sink.records[0]?.fields?.reason, 'buffer_full')
  await driver.close?.()
})

test('a served request leaves one record naming its route pattern, never its path', async (t) => {
  const deployment = await boot(t)
  deployment.records.clear()

  const response = await deployment.client.request('/fine/secret-customer-id?token=abc')
  assert.equal(response.status, 200)

  const request = deployment.records.first('http_request')
  assert.ok(request, 'a served request must leave a record')
  assert.equal(request.fields?.route, '/fine/{id}')
  assert.equal(request.fields?.status, 200)
  assert.equal(typeof request.durationMs, 'number')
  // The identifier and the query string are exactly what must not be kept.
  const serialized = JSON.stringify(deployment.records.records)
  assert.doesNotMatch(serialized, /secret-customer-id/)
  assert.doesNotMatch(serialized, /token=abc/)
})

test('a 500 is no longer discarded: the stack stays on the server', async (t) => {
  const deployment = await boot(t)
  deployment.records.clear()

  const response = await deployment.client.request('/boom/1')
  assert.equal(response.status, 500)

  const unhandled = deployment.records.first('unhandled')
  assert.ok(unhandled, 'an unexpected failure must be recorded')
  assert.equal(unhandled.level, 'error')
  assert.equal(unhandled.error?.code, 'E_UNEXPECTED')
  assert.match(unhandled.error?.message ?? '', /route exploded/)
  assert.match(unhandled.error?.stack ?? '', /route exploded/)
  assert.equal(unhandled.fields?.route, '/boom/{id}')
})

test('a call records its duration, and a denial is counted as a denial', async (t) => {
  const deployment = await boot(t)
  deployment.records.clear()

  await deployment.fixture.call('observed.ok')
  const call = deployment.records.first('fn_call')
  assert.ok(call)
  assert.equal(call.fn, 'observed.ok')
  assert.equal(typeof call.durationMs, 'number')

  deployment.records.clear()
  await assert.rejects(() => deployment.fixture.call('observed.ok', {}, { allow: ['observed.speak'] }))
  const denied = deployment.records.first('fn_denied')
  assert.ok(denied, 'a caller reaching for what it may not have must be observable')
  assert.equal(denied.level, 'warn')
  assert.equal(denied.fn, 'observed.ok')
  assert.equal(deployment.records.of('fn_error').length, 0)
})

test('a named failure warns and an unexpected one errors', async (t) => {
  const deployment = await boot(t)

  deployment.records.clear()
  await assert.rejects(() => deployment.fixture.call('observed.named'))
  const named = deployment.records.first('fn_error')
  assert.equal(named?.level, 'warn')
  assert.equal(named?.error?.code, 'E_EXPECTED')
  // A contract this system named does not need a stack to be understood.
  assert.equal(named?.error?.stack, undefined)

  deployment.records.clear()
  await assert.rejects(() => deployment.fixture.call('observed.burst'))
  const burst = deployment.records.first('fn_error')
  assert.equal(burst?.level, 'error')
  assert.match(burst?.error?.stack ?? '', /nobody wrote a try for this/)
})

test('ctx.log carries the call it belongs to, and is redacted like everything else', async (t) => {
  const deployment = await boot(t)

  deployment.records.clear()
  await deployment.fixture.call('observed.speak', {}, { correlationId: 'cmd-1' })
  const spoken = deployment.records.first('observed.spoke')
  assert.ok(spoken, 'a handler must be able to say something')
  // A module's events are namespaced, so one module can never claim another's name
  // or collide with the framework's own catalogue.
  assert.match(spoken.event, MODULE_EVENT)
  assert.equal(spoken.fn, 'observed.speak')
  assert.equal(spoken.fields?.where, 'handler')

  deployment.records.clear()
  await deployment.fixture.call('observed.leak')
  const leaked = deployment.records.first('observed.leaked')
  assert.equal(leaked?.fields?.password, '[redacted]')
  assert.equal(leaked?.fields?.note, '[dropped: non-scalar]')
})

test('the documented event catalogue is the one the framework actually emits', async () => {
  const page = await readFile('docs/src/content/docs/ketjs/logging.md', 'utf8')
  const documented = new Set([...page.matchAll(/^\| `([a-z_]+)` \|/gm)].map((match) => match[1]))
  for (const event of CORE_EVENTS) {
    assert.ok(documented.has(event), `event "${event}" is emitted but not documented`)
  }
  for (const event of documented) {
    assert.ok(
      (CORE_EVENTS as readonly string[]).includes(event as string),
      `event "${event}" is documented but no longer emitted`,
    )
  }
})

test('a policy denial is recorded as well as audited', async () => {
  const sink = memoryLog()
  const log = createLogger(sink, { deployment: 'app', process: 'http', fn: 'sale.confirm' })

  await assert.rejects(() =>
    enforcePolicy({
      policy: 'sale.order-approval',
      allowed: false,
      actor: 'approver',
      denialCode: 'E_SALE_SELF_APPROVAL',
      targetDigest: 'sha256:opaque',
      log,
    }),
  )

  const denied = sink.first('policy_denied')
  assert.ok(denied, 'a record-level refusal must be observable, not only auditable')
  assert.equal(denied.level, 'warn')
  assert.equal(denied.fn, 'sale.confirm')
  assert.equal(denied.fields?.code, 'E_SALE_SELF_APPROVAL')
  assert.equal(denied.fields?.target, 'sha256:opaque')
  // The raw actor on the decision is not repeated into a record; the logger's own
  // context already carries a hashed one.
  assert.doesNotMatch(JSON.stringify(sink.records), /approver/)
})

test('a worker reports its jobs on the deployment sink, not on stdout', async (t) => {
  const deployment = await createTestDeployment(worked)
  t.after(() => deployment.close())

  await deployment.fixture.call('observed.schedule')
  assert.equal(await deployment.drainJobs(), 1)

  const started = deployment.records.first('job_started')
  const completed = deployment.records.first('job_completed')
  assert.ok(started, 'a claimed job must be visible')
  assert.ok(completed, 'a finished job must be visible')
  assert.equal(completed.fn, 'observed.remind')
  assert.equal(completed.process, 'worker')
  assert.equal(typeof completed.durationMs, 'number')
  assert.equal(completed.fields?.queue, 'default')
  assert.equal(completed.fields?.attempt, 1)
})
