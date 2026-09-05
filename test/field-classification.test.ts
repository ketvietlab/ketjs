import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  agentDescriptor,
  callFn,
  classificationInventory,
  compose,
  defineModule,
  diffManifests,
  formatClassification,
  migrateOne,
  registerFunctions,
  schemaFromManifest,
  sqliteAdapter,
  type Manifest,
} from '@ketvietlab/ketjs'

const plain = defineModule({
  name: 'plain',
  models: {
    Person: {
      scope: 'shared',
      fields: { id: 'id', email: 'text', secret: 'text?', note: 'text?' },
    },
  },
})

const classified = defineModule({
  name: 'plain',
  models: {
    Person: {
      scope: 'shared',
      fields: {
        id: 'id',
        email: { type: 'text', personal: true },
        secret: { type: 'text?', sensitive: true },
        note: 'text?',
      },
    },
  },
  functions: {
    save: {
      input: { id: 'id', email: 'text', secret: 'text?' },
      output: { id: 'id' },
      effects: ['write:plain.Person'],
      handler: async (ctx, args) => {
        await ctx.db.insert('plain.Person', {
          id: args.id,
          email: args.email,
          secret: args.secret ?? null,
        })
        await ctx.db.update('plain.Person', { id: args.id }, { secret: 'rotated' })
        return { id: args.id }
      },
    },
  },
})

const manifestOf = (module: Parameters<typeof compose>[0][number]): Manifest =>
  compose([module], { headless: true })

test('a field is a type string or an object, and both compose to the same field', () => {
  const bare = manifestOf(plain).models['plain.Person']!.fields
  const rich = manifestOf(classified).models['plain.Person']!.fields

  for (const name of ['id', 'email', 'secret', 'note']) {
    assert.equal(rich[name]!.base, bare[name]!.base, name)
    assert.equal(rich[name]!.optional, bare[name]!.optional, name)
    assert.equal(rich[name]!.by, bare[name]!.by, name)
  }
  assert.equal(rich.email!.personal, true)
  assert.equal(rich.secret!.sensitive, true)
  // Absent rather than false, so a record carries only what was declared.
  assert.equal(rich.note!.personal, undefined)
  assert.equal(rich.note!.sensitive, undefined)
})

test('classifying a field is never a migration', () => {
  // The whole design rests on this: classification describes the data, not its
  // storage. If it reached the snapshot, tagging a column would plan an ALTER and
  // nobody would tag anything.
  assert.deepEqual(schemaFromManifest(manifestOf(classified)), schemaFromManifest(manifestOf(plain)))
})

test('the field vocabulary is closed, so a typo cannot silently protect nothing', () => {
  const typo = defineModule({
    name: 'typo',
    models: {
      Thing: { scope: 'shared', fields: { id: 'id', card: { type: 'text', sensitiv: true } as never } },
    },
  })
  assert.throws(
    () => compose([typo], { headless: true }),
    (error: unknown) => /unknown field key\(s\) sensitiv/.test(String((error as Error).message)),
  )

  const untyped = defineModule({
    name: 'untyped',
    models: { Thing: { scope: 'shared', fields: { id: 'id', card: { personal: true } as never } } },
  })
  assert.throws(
    () => compose([untyped], { headless: true }),
    (error: unknown) => /needs a type string/.test(String((error as Error).message)),
  )

  const wrongType = defineModule({
    name: 'wrong',
    models: {
      Thing: { scope: 'shared', fields: { id: 'id', card: { type: 'text', personal: 'yes' } as never } },
    },
  })
  assert.throws(
    () => compose([wrongType], { headless: true }),
    (error: unknown) => /"personal" must be a boolean/.test(String((error as Error).message)),
  )
})

test('a sensitive value never reaches a write record', async () => {
  const manifest = manifestOf(classified)
  registerFunctions([classified])
  const adapter = sqliteAdapter(':memory:')
  await adapter.open()
  try {
    await migrateOne(adapter, manifest)
    const result = await callFn(
      'plain.save',
      { id: 'p1', email: 'someone@example.com', secret: 'hunter2' },
      { adapter, manifest },
    )

    const serialized = JSON.stringify(result.writes)
    // A write record is returned to the caller, shown by a dry-run, and stored
    // verbatim in the durable idempotency row that answers a retry.
    assert.doesNotMatch(serialized, /hunter2/)
    assert.doesNotMatch(serialized, /rotated/)
    assert.match(serialized, /\[sensitive\]/)
    // A personal field is recorded normally; the obligation there is to know where
    // it is, not to hide it from the application that has to serve the person.
    assert.match(serialized, /someone@example\.com/)
  } finally {
    await adapter.close()
  }
})

test('the agent is not shown a field it must never write', () => {
  const descriptor = agentDescriptor(manifestOf(classified)) as {
    models: Record<string, Record<string, string>>
  }
  const person = descriptor.models['plain.Person']!
  assert.equal(person.secret, undefined, 'a sensitive field is withheld from the map')
  assert.match(person.email!, /\[personal\]/)
  assert.ok(person.note)
})

test('the inventory names what is classified and what has never been looked at', () => {
  const other = defineModule({
    name: 'other',
    models: { Untouched: { scope: 'shared', fields: { id: 'id', label: 'text' } } },
  })
  const inventory = classificationInventory(compose([classified, other], { headless: true }))

  assert.deepEqual(
    inventory.personal.map((entry) => `${entry.model}.${entry.field}`),
    ['plain.Person.email'],
  )
  assert.deepEqual(
    inventory.sensitive.map((entry) => `${entry.model}.${entry.field}`),
    ['plain.Person.secret'],
  )
  // An inventory of only what somebody remembered to tag is the one thing worse
  // than no inventory, because it looks complete.
  assert.deepEqual(inventory.unclassified, ['other.Untouched'])
  assert.equal(inventory.counts.models, 2)

  const printed = formatClassification(inventory)
  assert.match(printed, /plain\.Person\.email/)
  assert.match(printed, /1 of 2 model\(s\) classify no field at all/)
})

test('an upgrade shows a field losing or gaining its classification', () => {
  const items = diffManifests(manifestOf(classified), manifestOf(plain))
  const dropped = items.find((item) => item.code === 'FIELD_SENSITIVITY_CHANGED')
  assert.ok(dropped, 'dropping sensitive must be visible')
  assert.equal(dropped.severity, 'risky')
  assert.match(dropped.message, /no longer sensitive/)

  const gained = diffManifests(manifestOf(plain), manifestOf(classified)).find(
    (item) => item.code === 'FIELD_CLASSIFICATION_CHANGED',
  )
  assert.ok(gained)
  assert.match(gained.message, /now personal data/)
})
