import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import {
  bootDeployment,
  callFn,
  compose,
  composeWorkspace,
  defineDeployment,
  defineJob,
  defineModule,
  migrateOne,
  sqliteAdapter,
  type Adapter,
} from '@ketvietlab/ketjs'

/**
 * Company scoping is opt-in per deployment. Without `companies: true` there is one
 * global scope: models need no scope, and no request, session, development header
 * or caller-supplied scope carries a company into a handler, a sequence or a
 * replay key.
 */

const codes = (run: () => unknown): string[] => {
  try {
    run()
    return []
  } catch (error) {
    return ((error as { items?: Array<{ code: string }> }).items ?? []).map((item) => item.code)
  }
}

const open = async (t: TestContext): Promise<Adapter> => {
  const adapter = sqliteAdapter(':memory:')
  await adapter.open()
  t.after(() => adapter.close())
  return adapter
}

const acme = { company: 'acme', companies: ['acme'], branch: null, branches: null }
const globex = { company: 'globex', companies: ['globex'], branch: null, branches: null }

const notes = defineModule({
  name: 'notes',
  models: { Note: { fields: { id: 'id', title: 'text' } } },
  functions: {
    add: {
      anonymous: true,
      idempotent: true,
      input: { title: 'text' },
      output: { id: 'id', number: 'int', company: 'id?' },
      effects: ['write:notes.Note'],
      handler: async (ctx, input) => {
        const number = await ctx.sequence('notes.note')
        const id = `n${number}`
        await ctx.db.insert('notes.Note', { id, title: input.title })
        return { id, number, company: ctx.scope.company }
      },
    },
    who: {
      input: {},
      output: { actor: 'id?', company: 'id?' },
      effects: [],
      handler: (ctx) => ({ actor: ctx.actor, company: ctx.scope.company }),
    },
  },
})

const ledger = defineModule({
  name: 'ledger',
  models: { Entry: { scope: 'company', fields: { id: 'id' } } },
  functions: {
    who: {
      input: {},
      output: { company: 'id?' },
      effects: [],
      handler: (ctx) => ({ company: ctx.scope.company }),
    },
  },
})

const unscoped = defineModule({ name: 'unscoped', models: { Item: { fields: { id: 'id' } } } })

test('companies: off by default, so a model without a scope is one global table', () => {
  const manifest = compose([notes], { headless: true })
  assert.equal(manifest.companies, false)
  assert.equal(manifest.models['notes.Note']!.scope, 'shared')
  assert.deepEqual(Object.keys(manifest.models['notes.Note']!.fields), ['id', 'title'])
})

test('companies: a company scope needs them, and with them every model states its scope', () => {
  assert.deepEqual(
    codes(() => compose([ledger], { headless: true })),
    ['E_COMPANIES_DISABLED'],
  )
  assert.deepEqual(
    codes(() => compose([unscoped], { headless: true, companies: true })),
    ['E_MODEL_NO_SCOPE'],
  )

  const manifest = compose([ledger], { headless: true, companies: true })
  assert.equal(manifest.companies, true)
  assert.ok(manifest.models['ledger.Entry']!.fields['companyId'])

  const workspace = composeWorkspace([
    defineDeployment({ name: 'books', modules: [ledger], headless: true, companies: true }),
    defineDeployment({ name: 'notebook', modules: [notes], headless: true }),
  ])
  assert.equal(workspace.deployments['books']!.companies, true)
  assert.equal(workspace.deployments['notebook']!.companies, false)
})

test('companies: without them a request has no company, whatever the environment or headers say', async () => {
  const deployment = defineDeployment({ name: 'global_notes', modules: [notes], headless: true })
  const development = await bootDeployment(deployment, {
    port: 0,
    env: { KET_SQLITE: ':memory:', KET_LOG: 'null', KET_COMPANY: 'acme', KET_DEV: '1' },
  })
  try {
    const add = async (company: string, key?: string) => {
      const response = await fetch(`http://127.0.0.1:${development.port}/_ket/fn/notes.add`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-ket-company': company,
          ...(key ? { 'idempotency-key': key } : {}),
        },
        body: JSON.stringify({ title: 'note' }),
      })
      assert.equal(response.status, 200)
      return ((await response.json()) as { value: unknown }).value
    }
    assert.deepEqual(await add('acme'), { id: 'n1', number: 1, company: null })
    assert.deepEqual(await add('globex'), { id: 'n2', number: 2, company: null }, 'one counter for everyone')
    assert.deepEqual(await add('acme', 'k1'), { id: 'n3', number: 3, company: null })
    assert.deepEqual(
      await add('globex', 'k1'),
      { id: 'n3', number: 3, company: null },
      'one replay key space',
    )
    const banner = await development.banner()
    assert.match(banner, /identity\s+development identity/)
    assert.match(banner, /Development identity: every function may be called without signing in/)
    assert.doesNotMatch(banner, /X-Ket-Company|in company/)
  } finally {
    await development.close()
  }

  const production = await bootDeployment(deployment, {
    port: 0,
    env: { KET_SQLITE: ':memory:', KET_LOG: 'null', KET_COMPANY: 'acme' },
  })
  try {
    assert.match(await production.banner(), /No authentication: every caller is anonymous\n/)
  } finally {
    await production.close()
  }
})

test('companies: without them a session needs no company, and a gateway identity none either', async () => {
  const deployment = defineDeployment({
    name: 'global_sessions',
    modules: [notes],
    headless: true,
    serve: { sessions: { secret: 'local-test-only' }, permissions: async () => null },
  })
  const app = await bootDeployment(deployment, { port: 0, env: { KET_SQLITE: ':memory:', KET_LOG: 'null' } })
  try {
    const sessions = await app.tenants.with('', async (tenant) => tenant.sessions!)
    const { cookie } = await sessions.start({ userId: 'u1', companies: [] })
    const response = await fetch(`http://127.0.0.1:${app.port}/_ket/fn/notes.who`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cookie.split(';')[0]! },
      body: '{}',
    })
    assert.equal(response.status, 200)
    assert.deepEqual(((await response.json()) as { value: unknown }).value, { actor: 'u1', company: null })
  } finally {
    await app.close()
  }

  const gateway = await bootDeployment(
    defineDeployment({
      name: 'global_gateway',
      modules: [notes],
      headless: true,
      serve: {
        resolveIdentity: async () => ({ userId: 'u2', company: null, companies: [] }),
        permissions: async () => ['notes.who'],
      },
    }),
    { port: 0, env: { KET_SQLITE: ':memory:', KET_LOG: 'null' } },
  )
  try {
    const response = await fetch(`http://127.0.0.1:${gateway.port}/_ket/fn/notes.who`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    assert.equal(response.status, 200)
    assert.deepEqual(((await response.json()) as { value: unknown }).value, { actor: 'u2', company: null })
  } finally {
    await gateway.close()
  }

  // The company-required default is unchanged where companies are on.
  const scoped = await bootDeployment(
    defineDeployment({
      name: 'scoped_sessions',
      modules: [ledger],
      headless: true,
      companies: true,
      serve: { sessions: { secret: 'local-test-only' }, permissions: async () => null },
    }),
    { port: 0, env: { KET_SQLITE: ':memory:', KET_LOG: 'null' } },
  )
  try {
    const sessions = await scoped.tenants.with('', async (tenant) => tenant.sessions!)
    await assert.rejects(sessions.start({ userId: 'u1', companies: [] }), { code: 'E_SESSION_NO_COMPANY' })
  } finally {
    await scoped.close()
  }
})

test('companies: a scope handed to callFn is made global, so replays and counters do not split', async (t) => {
  const adapter = await open(t)
  const manifest = compose([notes], { headless: true })
  await migrateOne(adapter, manifest)
  const first = await callFn(
    'notes.add',
    { title: 'a' },
    { adapter, manifest, scope: acme, idempotencyKey: 'k1' },
  )
  const replay = await callFn(
    'notes.add',
    { title: 'a' },
    { adapter, manifest, scope: globex, idempotencyKey: 'k1' },
  )
  assert.deepEqual(first.value, { id: 'n1', number: 1, company: null })
  assert.deepEqual(replay.value, first.value)
  assert.equal(replay.replayed, true)
  const next = await callFn('notes.add', { title: 'b' }, { adapter, manifest, scope: globex })
  assert.deepEqual(next.value, { id: 'n2', number: 2, company: null })
})

test('companies: a manifest built without the flag reads it from its models', async (t) => {
  const adapter = await open(t)
  const manifest = compose([ledger], { headless: true, companies: true })
  delete manifest.companies
  await migrateOne(adapter, manifest)
  const result = await callFn('ledger.who', {}, { adapter, manifest, scope: acme })
  assert.deepEqual(result.value, { company: 'acme' })
})

test('companies: without them a job cannot be enqueued into a company', async (t) => {
  const adapter = await open(t)
  const fanout = defineModule({
    name: 'fanout',
    functions: {
      send: {
        input: {},
        crossCompany: true,
        effects: ['enqueue:fanout.deliver'],
        handler: async (ctx) => {
          await ctx.jobs.enqueue('fanout.deliver', {}, { company: 'acme' })
        },
      },
    },
    jobs: { deliver: defineJob({ input: {}, idempotent: true, effects: [], handler: async () => {} }) },
  })
  const manifest = compose([fanout], { headless: true })
  await migrateOne(adapter, manifest)
  await assert.rejects(callFn('fanout.send', {}, { adapter, manifest }), { code: 'E_COMPANIES_DISABLED' })
})
