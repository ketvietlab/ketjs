import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import {
  callFn,
  compose,
  defineFormAction,
  defineFormContract,
  defineModule,
  formConflict,
  notificationHub,
  planMigration,
  registerFunctions,
  renderSql,
  schemaFromManifest,
  sqliteAdapter,
  validationIssue,
} from '@ketvietlab/ketjs'
import type { Adapter, FormOutcome } from '@ketvietlab/ketjs'
import { postgresAdapter } from '@ketvietlab/ketjs-postgres'
import { adminUrl, live } from './postgres-live.ts'
import {
  bootDeployment,
  defineDeployment,
  formActionTransport,
  httpRoutes,
  diffManifests,
} from '@ketvietlab/ketjs'

type Values = { variants: Array<{ rowKey: string; id: string | null; weight: string }> }
const contract = defineFormContract<Values>('example.variants.v1', {
  fields: {
    variants: {
      type: 'array',
      required: true,
      key: 'rowKey',
      maxItems: 20,
      items: {
        type: 'object',
        fields: {
          rowKey: { required: true },
          id: { type: 'id', required: true, nullable: true },
          weight: { type: 'decimal', required: true },
        },
      },
    },
  },
})
const initial = (): Values => ({ variants: [{ rowKey: 'new-1', id: null, weight: '2' }] })

function fixture(afterNotify?: () => void) {
  let refuse = false
  let malformedReceipt = false
  let executions = 0
  const module = defineModule({
    name: 'example',
    models: {
      Setup: { scope: 'company', fields: { id: 'id', revision: 'text' } },
      Variant: { scope: 'company', fields: { id: 'id', weight: 'decimal' } },
    },
    functions: {
      save: defineFormAction(contract, {
        effects: ['read:example.Setup', 'write:example.Setup', 'write:example.Variant'],
        handler: async (ctx, { recordId, expectedRevision, values }) => {
          executions++
          const revision = randomUUID()
          const cas = await ctx.db.compareAndSet(
            'example.Setup',
            { id: recordId },
            { revision: expectedRevision },
            { revision },
          )
          if (!('matched' in cas) || !cas.matched)
            return { ...formConflict(), internal: { privateCost: 'hidden' } }
          const variants = []
          for (const row of values.variants) {
            const id = row.id ?? randomUUID()
            if (row.id) await ctx.db.update('example.Variant', { id }, { weight: row.weight })
            else await ctx.db.insert('example.Variant', { id, weight: row.weight })
            variants.push({ ...row, id })
          }
          await ctx.notify('form_saved', recordId)
          afterNotify?.()
          if (refuse)
            return {
              status: 'invalid',
              issues: [validationIssue('variants.0.weight', 'refused')],
              internal: { privateCost: 'hidden' },
            }
          return {
            status: 'committed',
            accepted: malformedReceipt ? ({ variants: null } as unknown as Values) : { variants },
            revision,
            value: { count: variants.length },
          }
        },
      }),
    },
  })
  return {
    module,
    setRefuse: (value: boolean) => {
      refuse = value
    },
    badReceipt: () => {
      malformedReceipt = true
    },
    executions: () => executions,
  }
}

async function boot(adapter: Adapter = sqliteAdapter(), afterNotify?: () => void) {
  const state = fixture(afterNotify)
  const manifest = compose([state.module], { headless: true })
  await adapter.open()
  for (const sql of renderSql(planMigration(null, schemaFromManifest(manifest)), adapter))
    await adapter.exec(sql)
  await adapter.run("INSERT INTO example_setup (id, revision, \"companyId\") VALUES ('p1', 'r0', 'a')")
  registerFunctions([state.module])
  const input = (values: unknown = initial(), expectedRevision = 'r0') => ({
    contractId: contract.id,
    recordId: 'p1',
    expectedRevision,
    values,
  })
  const options = {
    adapter,
    manifest,
    allow: ['example.save'],
    actor: 'editor',
    scope: { company: 'a' },
    idempotencyKey: 'intent-1',
  }
  const call = (values: unknown = initial(), overrides = {}, expectedRevision = 'r0') =>
    callFn('example.save', input(values, expectedRevision), { ...options, ...overrides })
  return { ...state, adapter, manifest, input, options, call }
}

test('form action rejects malformed replacement before writes and preserves tenant/permission checks', async () => {
  const app = await boot()
  try {
    const result = await app.call({ variants: {} })
    assert.equal((result.value as FormOutcome).status, 'invalid')
    assert.equal(app.executions(), 0)
    assert.deepEqual(result.writes, [])
    await assert.rejects(app.call({}, { allow: [] }), { code: 'E_FN_NOT_PERMITTED' })
    assert.equal(app.executions(), 0)
    const other = await app.call(initial(), { scope: { company: 'b' } })
    assert.equal((other.value as FormOutcome).status, 'conflict')
    assert.deepEqual(Object.keys(other.value as object).sort(), ['issues', 'status'])
    assert.equal((await app.adapter.all('SELECT * FROM example_variant')).length, 0)
    await assert.rejects(app.call(initial(), { idempotencyKey: undefined }), {
      code: 'E_ATOMIC_KEY_REQUIRED',
    })
  } finally {
    await app.adapter.close()
  }
})

test('a normal domain refusal rolls back the revision, child writes and receipt', async () => {
  const app = await boot()
  try {
    app.setRefuse(true)
    const result = await app.call()
    const outcome = result.value as FormOutcome
    assert.equal(outcome.status, 'invalid')
    assert.deepEqual(Object.keys(outcome).sort(), ['issues', 'status'])
    if (outcome.status === 'invalid')
      assert.deepEqual(outcome.issues[0].path, ['variants', { key: 'new-1' }, 'weight'])
    assert.equal((await app.adapter.all('SELECT revision FROM example_setup'))[0].revision, 'r0')
    assert.equal((await app.adapter.all('SELECT * FROM example_variant')).length, 0)
    assert.equal((await app.adapter.all('SELECT * FROM ket_idem')).length, 0)
    app.setRefuse(false)
    assert.equal((await app.call()).ok, true)
  } finally {
    await app.adapter.close()
  }
})

test('a lost response replays the exact IDs and revision; a stale second editor cannot overwrite', async () => {
  const app = await boot()
  try {
    const first = await app.call()
    const retry = await app.call()
    assert.equal(retry.replayed, true)
    assert.deepEqual(retry.value, first.value)
    assert.equal(app.executions(), 1)
    assert.equal((await app.adapter.all('SELECT * FROM example_variant')).length, 1)
    const stale = await app.call({ variants: [] }, { idempotencyKey: 'intent-2' })
    assert.equal((stale.value as FormOutcome).status, 'conflict')
    await assert.rejects(app.call({ variants: [] }), { code: 'E_IDEMPOTENCY_CONFLICT' })
  } finally {
    await app.adapter.close()
  }
})

test('an invalid accepted projection cannot commit writes', async () => {
  const app = await boot()
  try {
    app.badReceipt()
    await assert.rejects(app.call(), /accepted values/)
    assert.equal((await app.adapter.all('SELECT revision FROM example_setup'))[0].revision, 'r0')
    assert.equal((await app.adapter.all('SELECT * FROM example_variant')).length, 0)
  } finally {
    await app.adapter.close()
  }
})

test('failure while recording the receipt rolls back the business transaction', async () => {
  const app = await boot()
  try {
    const faulty: Adapter = {
      ...app.adapter,
      tx: (body) =>
        app.adapter.tx((tx) =>
          body({
            ...tx,
            run: async (sql, params) => {
              if (sql.startsWith('UPDATE ket_idem')) throw new Error('receipt unavailable')
              return tx.run(sql, params)
            },
          }),
        ),
    }
    await assert.rejects(app.call(initial(), { adapter: faulty }), /receipt unavailable/)
    assert.equal((await app.adapter.all('SELECT revision FROM example_setup'))[0].revision, 'r0')
    assert.equal((await app.adapter.all('SELECT * FROM example_variant')).length, 0)
    assert.equal((await app.call()).ok, true)
    assert.equal((await app.adapter.all('SELECT * FROM example_variant')).length, 1)
  } finally {
    await app.adapter.close()
  }
})

async function assertFormNotifications(adapter: Adapter) {
  const delivered: string[] = []
  const app = await boot(adapter, () => assert.deepEqual(delivered, [], 'no notice before commit'))
  let unsubscribe: (() => Promise<void>) | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    let received!: () => void
    const notice = new Promise<void>((resolve) => {
      received = resolve
    })
    unsubscribe = await notificationHub(adapter).subscribe('form_saved', (payload) => {
      delivered.push(payload)
      received()
    })
    app.setRefuse(true)
    assert.equal(((await app.call()).value as FormOutcome).status, 'invalid')
    assert.deepEqual(delivered, [], 'a rolled-back action does not publish')
    app.setRefuse(false)
    const first = await app.call()
    await Promise.race([
      notice,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('committed notification was not delivered')), 2000)
      }),
    ])
    assert.deepEqual(delivered, ['p1'])
    const replay = await app.call()
    assert.equal(replay.replayed, true)
    assert.deepEqual(replay.value, first.value)
    assert.equal(app.executions(), 2, 'the refusal and commit execute; the replay does not')
    assert.deepEqual(delivered, ['p1'], 'receipt replay does not publish again')
  } finally {
    if (timer) clearTimeout(timer)
    await unsubscribe?.()
    await adapter.close()
  }
}

test('SQLite form notifications reach root listeners only after commit, never on refusal or replay', async () => {
  await assertFormNotifications(sqliteAdapter())
})

test('Postgres form actions serialize duplicate intents and roll back domain refusals', live, async () => {
  const name = `form_${randomUUID().replaceAll('-', '')}`
  const admin = postgresAdapter(adminUrl.toString())
  await admin.open()
  let app: Awaited<ReturnType<typeof boot>> | undefined
  try {
    await admin.exec(`CREATE DATABASE "${name}"`)
    const url = new URL(adminUrl)
    url.pathname = `/${name}`
    app = await boot(postgresAdapter(url.toString()))
    app.setRefuse(true)
    assert.equal(((await app.call()).value as FormOutcome).status, 'invalid')
    assert.equal((await app.adapter.all('SELECT * FROM example_variant')).length, 0)
    app.setRefuse(false)
    const [one, two] = await Promise.all([app.call(), app.call()])
    assert.deepEqual(one.value, two.value)
    assert.ok(one.replayed || two.replayed)
    assert.equal((await app.adapter.all('SELECT * FROM example_variant')).length, 1)
  } finally {
    await app?.adapter.close()
    await admin.exec(`DROP DATABASE IF EXISTS "${name}"`)
    await admin.close()
  }
})

test(
  'Postgres form notifications reach root listeners only after commit, never on refusal or replay',
  live,
  async () => {
    const name = `form_notify_${randomUUID().replaceAll('-', '')}`
    const admin = postgresAdapter(adminUrl.toString())
    await admin.open()
    try {
      await admin.exec(`CREATE DATABASE "${name}"`)
      const url = new URL(adminUrl)
      url.pathname = `/${name}`
      await assertFormNotifications(postgresAdapter(url.toString()))
    } finally {
      await admin.exec(`DROP DATABASE IF EXISTS "${name}"`)
      await admin.close()
    }
  },
)

test('form action HTTP uses existing authorization and bindings require an intent key', async (t) => {
  const state = fixture()
  const api = defineModule({
    name: 'example_api',
    depends: ['example'],
    routes: httpRoutes({ profile: 'forms', prefix: '/forms' }, { 'POST /save': 'example.save' }),
  })
  const app = await bootDeployment(
    defineDeployment({
      name: 'form_contract',
      headless: true,
      modules: [state.module, api],
      serve: {
        resolveIdentity: async ({ req }) =>
          req.headers.authorization === 'Bearer editor'
            ? { userId: 'editor', company: 'a', companies: ['a'] }
            : null,
        permissions: async () => ['example.save'],
      },
    }),
    {
      env: { KET_SQLITE: ':memory:' },
      port: 0,
      log: () => {},
      openLog: () => ({ name: 'quiet', write: () => {} }),
    },
  )
  t.after(() => app.close())
  await app.adapter!.run("INSERT INTO example_setup (id, revision, \"companyId\") VALUES ('p1', 'r0', 'a')")
  const base = `http://127.0.0.1:${app.port}`
  const input = { contractId: contract.id, recordId: 'p1', expectedRevision: 'r0', values: initial() }
  const body = JSON.stringify(input)
  const anonymous = await fetch(`${base}/_ket/fn/example.save`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': 'one' },
    body,
  })
  assert.ok([401, 403].includes(anonymous.status))
  assert.equal(state.executions(), 0)
  const missing = await fetch(`${base}/forms/save`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer editor' },
    body,
  })
  assert.equal(missing.status, 428)
  const transport = formActionTransport<Values>('example.save', {
    fetch: (url, init) =>
      fetch(`${base}${url}`, { ...init, headers: { ...init?.headers, authorization: 'Bearer editor' } }),
  })
  const request = { ...input, mutationId: 'one' }
  const first = await transport(request, new AbortController().signal)
  const replay = await transport(request, new AbortController().signal)
  assert.equal(first.status, 'committed')
  assert.deepEqual(first, replay)
  assert.equal(state.executions(), 1)
  const old = {
    ...app.manifest,
    functions: {
      ...app.manifest.functions,
      'example.save': { ...app.manifest.functions['example.save'], transactional: undefined },
    },
  }
  assert.match(JSON.stringify(diffManifests(old, app.manifest)), /FUNCTION_TRANSACTION_CHANGED/)
})
