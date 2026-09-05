import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import {
  callFn,
  compose,
  defineModule,
  migrateOne,
  nextSequenceNumber,
  peekSequenceNumber,
  registerFunctions,
  sqliteAdapter,
  type Adapter,
  type Manifest,
} from '@ketvietlab/ketjs'

const acme = { company: 'acme', companies: ['acme'], branch: null, branches: null }
const other = { company: 'other', companies: ['other'], branch: null, branches: null }

const open = async (t: TestContext): Promise<Adapter> => {
  const adapter = sqliteAdapter(':memory:')
  await adapter.open()
  t.after(() => adapter.close())
  return adapter
}

const numbered = defineModule({
  name: 'numbered',
  models: { Doc: { scope: 'company', fields: { id: 'id', ref: 'text' } } },
  functions: {
    issue: {
      input: {},
      output: { ref: 'text' },
      dryRun: true,
      effects: ['write:numbered.Doc'],
      handler: async (ctx) => {
        const number = await ctx.sequence('numbered.doc')
        const ref = `D${String(number).padStart(5, '0')}`
        await ctx.db.insert('numbered.Doc', { id: ref, ref })
        return { ref }
      },
    },
    issueThenFail: {
      input: {},
      output: { ref: 'text' },
      effects: ['write:numbered.Doc'],
      handler: async (ctx) => {
        await ctx.tx(async (tx) => {
          const number = await tx.sequence('numbered.doc')
          await tx.db.insert('numbered.Doc', { id: `x${number}`, ref: `x${number}` })
          throw new Error('the document could not be issued after all')
        })
        return { ref: 'unreachable' }
      },
    },
  },
})

const manifestOf = (): Manifest => compose([numbered], { headless: true })

test('numbers come out consecutively, from where the sequence was told to start', async (t) => {
  const adapter = await open(t)
  const take = (options = {}) => nextSequenceNumber(adapter, 'sale.order', { scope: acme, ...options })

  assert.equal(await take(), 1)
  assert.equal(await take(), 2)
  assert.equal(await take(), 3)
  // The start only decides where an unused sequence opens.
  assert.equal(await nextSequenceNumber(adapter, 'sale.invoice', { scope: acme, start: 1000 }), 1000)
  assert.equal(await nextSequenceNumber(adapter, 'sale.invoice', { scope: acme, start: 1000 }), 1001)
  assert.equal(await peekSequenceNumber(adapter, 'sale.order', { scope: acme }), 4)
})

test("one company cannot spend another company's numbers", async (t) => {
  const adapter = await open(t)
  assert.equal(await nextSequenceNumber(adapter, 'sale.order', { scope: acme }), 1)
  assert.equal(await nextSequenceNumber(adapter, 'sale.order', { scope: acme }), 2)
  // Per company is the default, because two legal entities issuing the same
  // invoice number is a bug nobody notices until an auditor does.
  assert.equal(await nextSequenceNumber(adapter, 'sale.order', { scope: other }), 1)

  // Sharing is available, and has to be asked for.
  assert.equal(await nextSequenceNumber(adapter, 'tenant.batch', { scope: acme, shared: true }), 1)
  assert.equal(await nextSequenceNumber(adapter, 'tenant.batch', { scope: other, shared: true }), 2)
})

test('concurrent allocation hands out every number exactly once', async (t) => {
  const adapter = await open(t)
  const taken = await Promise.all(
    Array.from({ length: 25 }, () =>
      nextSequenceNumber(adapter, 'sale.order', { scope: acme, random: () => 0.5 }),
    ),
  )
  const sorted = [...taken].sort((a, b) => a - b)
  assert.equal(new Set(taken).size, 25, 'no number was handed out twice')
  assert.deepEqual(
    sorted,
    Array.from({ length: 25 }, (_, i) => i + 1),
    'and none was skipped',
  )
})

test('a sequence name is a qualified identifier, not free text', async (t) => {
  const adapter = await open(t)
  for (const bad of ['', 'Sale.Order', 'sale order', 'sale-order', '1sale', 'sale.']) {
    await assert.rejects(
      () => nextSequenceNumber(adapter, bad, { scope: acme }),
      (error: unknown) => (error as { code?: string }).code === 'E_SEQUENCE_NAME',
      bad,
    )
  }
})

test('a preview reads the sequence without spending it', async (t) => {
  const adapter = await open(t)
  const manifest = manifestOf()
  registerFunctions([numbered])
  await migrateOne(adapter, manifest)

  const preview = await callFn('numbered.issue', {}, { adapter, manifest, scope: acme, dryRun: true })
  assert.deepEqual(preview.value, { ref: 'D00001' })

  // The real command that follows must not skip the number the preview showed.
  const real = await callFn('numbered.issue', {}, { adapter, manifest, scope: acme })
  assert.deepEqual(real.value, { ref: 'D00001' })
})

test('a number taken inside a transaction goes back when the transaction does', async (t) => {
  const adapter = await open(t)
  const manifest = manifestOf()
  registerFunctions([numbered])
  await migrateOne(adapter, manifest)

  assert.deepEqual((await callFn('numbered.issue', {}, { adapter, manifest, scope: acme })).value, {
    ref: 'D00001',
  })
  await assert.rejects(() => callFn('numbered.issueThenFail', {}, { adapter, manifest, scope: acme }))

  // Whether numbers are gapless is decided by where they are taken. Inside the
  // transaction that writes the document, a rollback takes the number back too.
  assert.deepEqual((await callFn('numbered.issue', {}, { adapter, manifest, scope: acme })).value, {
    ref: 'D00002',
  })
})
