import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import {
  auditHash,
  auditId,
  callFn,
  compose,
  defineModule,
  deleteFrom,
  diffManifests,
  eq,
  migrateOne,
  registerFunctions,
  schemaFromManifest,
  sqliteAdapter,
  type Adapter,
  type Manifest,
} from '@ketvietlab/ketjs'

const scope = { company: 'acme', companies: ['acme'], branch: null, branches: null }

const timeline = defineModule({
  name: 'timeline',
  models: {
    Event: {
      scope: 'company',
      append: true,
      fields: { id: 'id', action: 'text', note: 'text?' },
    },
    Draft: { scope: 'company', fields: { id: 'id', note: 'text?' } },
  },
  functions: {
    record: {
      input: { id: 'id', action: 'text' },
      output: { written: 'bool' },
      effects: ['write:timeline.Event'],
      handler: async (ctx, args) => {
        const result = await ctx.db.insertIfAbsent('timeline.Event', { id: args.id, action: args.action })
        return { written: 'dryRun' in result ? false : result.inserted }
      },
    },
    amend: {
      input: { id: 'id' },
      output: { done: 'bool' },
      effects: ['write:timeline.Event'],
      handler: async (ctx, args) => {
        await ctx.db.update('timeline.Event', { id: args.id }, { note: 'edited' })
        return { done: true }
      },
    },
    erase: {
      input: { id: 'id' },
      output: { done: 'bool' },
      effects: ['write:timeline.Event'],
      handler: async (ctx, args) => {
        const Event = ctx.table('timeline.Event')
        await ctx.db.del(deleteFrom(Event).where(eq(Event.id, args.id)))
        return { done: true }
      },
    },
    cas: {
      input: { id: 'id' },
      output: { done: 'bool' },
      effects: ['write:timeline.Event'],
      handler: async (ctx, args) => {
        await ctx.db.compareAndSet('timeline.Event', { id: args.id }, { action: 'opened' }, { note: 'x' })
        return { done: true }
      },
    },
    amendDraft: {
      input: { id: 'id' },
      output: { done: 'bool' },
      effects: ['write:timeline.Draft'],
      handler: async (ctx, args) => {
        await ctx.db.insertIfAbsent('timeline.Draft', { id: args.id })
        await ctx.db.update('timeline.Draft', { id: args.id }, { note: 'edited' })
        return { done: true }
      },
    },
  },
})

const manifestOf = (): Manifest => compose([timeline], { headless: true })

const boot = async (t: TestContext): Promise<{ adapter: Adapter; manifest: Manifest }> => {
  const adapter = sqliteAdapter(':memory:')
  await adapter.open()
  t.after(() => adapter.close())
  const manifest = manifestOf()
  registerFunctions([timeline])
  await migrateOne(adapter, manifest)
  return { adapter, manifest }
}

const refused = (error: unknown) => (error as { code?: string }).code === 'E_APPEND_ONLY'

test('an append-only model takes an insert, and a replay of it', async (t) => {
  const { adapter, manifest } = await boot(t)
  const call = (fn: string, input: Record<string, unknown>) => callFn(fn, input, { adapter, manifest, scope })

  assert.deepEqual((await call('timeline.record', { id: 'e1', action: 'opened' })).value, {
    written: true,
  })
  // A retried command lands on the row it already wrote rather than a second one.
  assert.deepEqual((await call('timeline.record', { id: 'e1', action: 'opened' })).value, {
    written: false,
  })
})

test('every way of changing a written row is refused, not just the obvious one', async (t) => {
  const { adapter, manifest } = await boot(t)
  const call = (fn: string, input: Record<string, unknown>) => callFn(fn, input, { adapter, manifest, scope })
  await call('timeline.record', { id: 'e1', action: 'opened' })

  // update, delete and compare-and-set are three doors into the same room.
  await assert.rejects(() => call('timeline.amend', { id: 'e1' }), refused)
  await assert.rejects(() => call('timeline.erase', { id: 'e1' }), refused)
  await assert.rejects(() => call('timeline.cas', { id: 'e1' }), refused)

  // The row is still exactly what was written.
  const rows = await adapter.all('SELECT id, action, note FROM timeline_event', [])
  assert.equal(rows.length, 1)
  assert.equal(rows[0]!.note, null)
})

test('a model that did not ask for this is unaffected', async (t) => {
  const { adapter, manifest } = await boot(t)
  const result = await callFn('timeline.amendDraft', { id: 'd1' }, { adapter, manifest, scope })
  assert.deepEqual(result.value, { done: true })
})

test('append-only is not storage, so declaring it plans no migration', async (t) => {
  const plain = defineModule({
    name: 'timeline',
    models: {
      Event: { scope: 'company', fields: { id: 'id', action: 'text', note: 'text?' } },
      Draft: { scope: 'company', fields: { id: 'id', note: 'text?' } },
    },
  })
  void t
  assert.deepEqual(schemaFromManifest(compose([plain], { headless: true })), schemaFromManifest(manifestOf()))
})

test('an upgrade shows a timeline that stopped being one', () => {
  const plain = defineModule({
    name: 'timeline',
    models: {
      Event: { scope: 'company', fields: { id: 'id', action: 'text', note: 'text?' } },
      Draft: { scope: 'company', fields: { id: 'id', note: 'text?' } },
    },
  })
  const dropped = diffManifests(manifestOf(), compose([plain], { headless: true })).find(
    (item) => item.code === 'MODEL_APPEND_CHANGED',
  )
  assert.ok(dropped, 'a record that can suddenly be edited must be visible')
  assert.equal(dropped.severity, 'risky')
  assert.match(dropped.message, /no longer append-only/)
})

test('a digest stands for an identity without carrying it, and cannot cross modules', () => {
  const one = auditHash('pos', 'actor', 'someone@example.com')
  assert.ok(one)
  assert.doesNotMatch(one, /example/)
  // The same person, hashed by two modules, is two different digests: one timeline
  // cannot be joined to another by accident.
  assert.notEqual(one, auditHash('account', 'actor', 'someone@example.com'))
  assert.notEqual(one, auditHash('pos', 'subject', 'someone@example.com'))
  assert.equal(auditHash('pos', 'actor', '  '), null)
  assert.equal(auditHash('pos', 'actor', null), null)
  assert.throws(() => auditHash('POS', 'actor', 'x'), /not an audit namespace/)
})

test('an event id is derived from the command, so a retry is the same command', () => {
  const first = auditId('pos', ['shift.close', 'shift-7', 'cmd-42'])
  assert.equal(first, auditId('pos', ['shift.close', 'shift-7', 'cmd-42']))
  assert.notEqual(first, auditId('pos', ['shift.close', 'shift-7', 'cmd-43']))
  // Parts are joined with a separator they cannot contain, so a colon in one part
  // cannot make two different commands look like one.
  assert.notEqual(auditId('pos', ['a', 'b:c']), auditId('pos', ['a:b', 'c']))
  assert.throws(() => auditId('pos', []), /at least one part/)
})
