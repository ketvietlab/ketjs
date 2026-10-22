import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  bootDeployment,
  bytes,
  defineDeployment,
  defineJob,
  defineModule,
  httpRoutes,
  json,
  memoryLog,
  text,
  withHeaders,
} from '@ketvietlab/ketjs'
import type { Ctx } from '@ketvietlab/ketjs'

/**
 * The generic transport `/_ket/fn` calls the same functions an HTTP binding
 * publishes. These tests hold it to the boundaries a binding already had: no
 * cross-site call on a session, no input the binding takes from identity, no
 * write log outside a dry run, and the same log records as any other call.
 */
let mailed = 0
const notes = defineModule({
  name: 'notes',
  models: {
    Note: { scope: 'company', fields: { id: 'id', title: 'text', cost: 'decimal?' } },
  },
  jobs: {
    send: defineJob({ idempotent: true, input: { id: 'text' }, effects: [], handler: async () => {} }),
  },
  functions: {
    create: {
      input: { id: 'id', title: 'text' },
      output: { id: 'id' },
      idempotent: true,
      effects: ['write:notes.Note'],
      handler: async (ctx: Ctx, input) => {
        await ctx.db.insert('notes.Note', { id: input['id'], title: input['title'], cost: '7.25' })
        return { id: input['id'] }
      },
    },
    publish: {
      input: { id: 'text' },
      dryRun: true,
      effects: ['enqueue:notes.send'],
      handler: async (ctx: Ctx, input) => ctx.jobs.enqueue('notes.send', { id: input['id'] }),
    },
    charge: {
      input: {},
      effects: [],
      handler: () => {
        mailed += 1
        return { charged: true }
      },
    },
    mine: {
      input: { userId: 'text' },
      output: { userId: 'text' },
      returns: 'one',
      effects: [],
      handler: (_ctx: Ctx, input) => ({ userId: input['userId'] }),
    },
    hidden: { input: {}, effects: [], handler: () => ({ ok: true }) },
  },
  routes: {
    '/login': {
      anonymous: true,
      handler: (ctx) => async (url, req) => {
        const sessions = await ctx.sessionsOf(url, req)
        const started = await sessions!.start({ userId: 'u1', companies: ['acme'], company: 'acme' })
        return withHeaders(json({ ok: true }), { 'set-cookie': started.cookie })
      },
    },
  },
})
const api = defineModule({
  name: 'notes_api',
  depends: ['notes'],
  routes: httpRoutes(
    { profile: 'notes', prefix: '/api' },
    { 'GET /mine': { call: 'notes.mine', bind: { userId: 'actor' } } },
  ),
})

const boot = async (env: Record<string, string> = {}) => {
  const sink = memoryLog()
  const booted = await bootDeployment(
    defineDeployment({
      name: 'transport',
      modules: [notes, api],
      headless: true,
      companies: true,
      worker: { queues: { default: 1 } },
      serve: {
        sessions: { secret: 'transport-secret-0123456789abcdef', secure: false },
        permissions: async () => ['notes.create', 'notes.publish', 'notes.charge', 'notes.mine'],
      },
    }),
    { env: { KET_SQLITE: ':memory:', ...env }, port: 0, log: () => {}, openLog: () => sink },
  )
  const base = `http://127.0.0.1:${booted.port}`
  const login = await fetch(`${base}/login`)
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]!
  const call = (name: string, body: unknown, headers: Record<string, string> = {}, query = '') =>
    fetch(`${base}/_ket/fn/${name}${query}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: base, cookie, ...headers },
      body: JSON.stringify(body),
    })
  return { booted, base, cookie, call, sink }
}

test('function transport: a session call must be same-origin JSON', async (t) => {
  const { booted, call } = await boot()
  t.after(() => booted.close())

  const crossSite = await call('notes.create', { id: 'n1', title: 'x' }, { origin: 'https://evil.example' })
  assert.equal(crossSite.status, 403)
  assert.equal(((await crossSite.json()) as { code: string }).code, 'E_HTTP_CSRF')

  const sibling = await call('notes.create', { id: 'n1', title: 'x' }, { origin: 'https://app.example.test' })
  assert.equal(sibling.status, 403, 'a sibling subdomain is not the same origin')

  const simple = await call('notes.create', { id: 'n1', title: 'x' }, { 'content-type': 'text/plain' })
  assert.equal(simple.status, 415)
  assert.equal(((await simple.json()) as { code: string }).code, 'E_HTTP_CONTENT_TYPE')

  const fetchMetadata = await call(
    'notes.create',
    { id: 'n1', title: 'x' },
    { origin: '', 'sec-fetch-site': 'cross-site' },
  )
  assert.equal(fetchMetadata.status, 403)

  const ok = await call('notes.create', { id: 'n1', title: 'x' })
  assert.equal(ok.status, 200)
})

test('function transport: a real call returns its value, never the write log', async (t) => {
  const { booted, call } = await boot()
  t.after(() => booted.close())

  const response = await call('notes.create', { id: 'n2', title: 'x' }, { 'idempotency-key': 'k-1' })
  const body = (await response.json()) as Record<string, unknown>
  assert.deepEqual(body, { ok: true, value: { id: 'n2' }, dryRun: false })
  assert.doesNotMatch(JSON.stringify(body), /7\.25/)

  const replay = (await (
    await call('notes.create', { id: 'n2', title: 'x' }, { 'idempotency-key': 'k-1' })
  ).json()) as Record<string, unknown>
  assert.equal(replay.replayed, true)
  assert.equal('writes' in replay, false)

  assert.match(response.headers.get('x-request-id') ?? '', /^[0-9a-f-]{36}$/)
  assert.ok(response.headers.get('x-ket-build'))
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
})

test('function transport: a dry run enqueues nothing and needs the function to opt in', async (t) => {
  const { booted, call } = await boot()
  t.after(() => booted.close())

  const preview = await call('notes.publish', { id: 'n3' }, {}, '?dryRun=1')
  assert.equal(preview.status, 200)
  const body = (await preview.json()) as { dryRun: boolean; value: { dryRun?: boolean }; writes: unknown[] }
  assert.equal(body.dryRun, true)
  assert.equal(body.value.dryRun, true)
  assert.deepEqual(body.writes, [{ op: 'enqueue', job: 'notes.send' }])
  const jobs = await booted.tenants.with('', (tenant) => tenant.adapter.all('SELECT id FROM ket_job'))
  assert.equal(jobs.length, 0, 'a preview must not store the job it shows')

  const before = mailed
  const refused = await call('notes.charge', {}, {}, '?dryRun=1')
  assert.equal(refused.status, 400)
  assert.equal(((await refused.json()) as { code: string }).code, 'E_NO_DRY_RUN')
  assert.equal(mailed, before, 'a function that did not opt in never runs for a preview')
})

test('function transport: input a binding takes from identity cannot be chosen here', async (t) => {
  const { booted, base, cookie, call } = await boot()
  t.after(() => booted.close())

  const forged = await call('notes.mine', { userId: 'someone-else' })
  assert.equal(forged.status, 403)
  assert.equal(((await forged.json()) as { code: string }).code, 'E_FUNCTION_BOUND')

  const bound = await fetch(`${base}/api/mine`, { headers: { cookie } })
  assert.equal(bound.status, 200)
  assert.deepEqual(await bound.json(), { data: { userId: 'u1' } })
})

test('function transport: an unknown or forbidden name reveals no other function', async (t) => {
  const { booted, base, call } = await boot()
  t.after(() => booted.close())

  const unknownSignedIn = await call('notes.nope', {})
  assert.equal(unknownSignedIn.status, 403, 'outside the allow-list, existence is not disclosed')
  const forbidden = await call('notes.hidden', {})
  assert.equal(forbidden.status, 403)

  const anonymous = await fetch(`${base}/_ket/fn/notes.nope`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  })
  const text = await anonymous.text()
  assert.doesNotMatch(text, /notes\.(create|publish|charge|mine|hidden)/)
  assert.doesNotMatch(text, /"hint": "[^n]/, 'outside development an error carries no hint')
})

test('function transport: calls and refusals are logged like any other call', async (t) => {
  const { booted, call, sink } = await boot()
  t.after(() => booted.close())

  assert.equal((await call('notes.create', { id: 'n4', title: 'x' })).status, 200)
  assert.equal((await call('notes.hidden', {})).status, 403)

  const find = async (event: string, fn: string) => {
    // A batching driver writes after the response; give it a few turns.
    for (let turn = 0; turn < 50; turn++) {
      const found = sink.records.find((record) => record.event === event && record.fn === fn)
      if (found) return found
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    return undefined
  }
  const called = await find('fn_call', 'notes.create')
  assert.ok(called, 'a successful call over /_ket/fn records fn_call')
  assert.ok(called.trace, 'the record carries the request correlation')
  assert.ok(await find('fn_denied', 'notes.hidden'), 'a refused call over /_ket/fn records fn_denied')
})

test('responses: a non-markup helper or header cannot produce markup', () => {
  const body = new TextEncoder().encode('<svg onload=alert(1)>')
  assert.throws(() => text('<b>x</b>', { type: 'text/html' }), /raw\(\)/)
  assert.throws(() => text('<x/>', { type: 'application/xhtml+xml' }), /raw\(\)/)
  for (const type of [
    'application/xml',
    'text/xml',
    'image/svg+xml',
    'application/rss+xml',
    'text/html; charset=utf-8',
  ])
    assert.throws(() => bytes(body, { type }), /raw\(\)/, type)
  assert.throws(
    () => withHeaders(bytes(body, { type: 'text/plain' }), { 'Content-Type': 'text/html' }),
    /raw\(\)/,
  )
  assert.doesNotThrow(() => withHeaders(text('a > b {}'), { 'content-type': 'text/css; charset=utf-8' }))
  assert.doesNotThrow(() => bytes(body, { type: 'application/json' }))
})
