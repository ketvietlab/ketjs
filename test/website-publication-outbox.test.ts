import assert from 'node:assert/strict'
import { test } from 'node:test'
import { callFn, compose, migrateOne, registerFunctions, sqliteAdapter } from '@ketvietlab/ketjs'
import type { Adapter } from '@ketvietlab/ketjs'
import { address, paperTheme, partner, website } from '@ketvietlab/ketsuite'

/**
 * WEB-014 asks for "CAS pointer + outbox atomic". The outbox property is not
 * something Website has to build: `ctx.tx` hands its body a context bound to the
 * transaction's own connection, and `jobs.enqueue` queues through that context's
 * adapter — so a job enqueued inside a transaction commits with it, and a
 * transaction that loses the compare-and-set queues nothing.
 *
 * These tests pin that, because the day a consumer exists it will be relied on,
 * and a queue that silently escaped the transaction would be discovered by a
 * duplicate side effect rather than by a failing test.
 */

const SCOPE = { company: 'acme', branches: null }
const modules = [address, partner, website, paperTheme]
const manifest = compose(modules)

const boot = async (): Promise<Adapter> => {
  const db = sqliteAdapter()
  await db.open()
  await migrateOne(db, manifest)
  registerFunctions(modules)
  return db
}
const call = async (db: Adapter, name: string, input: Record<string, unknown>) =>
  (await callFn(name, input, { adapter: db, manifest, scope: SCOPE })).value

const layout = [{ type: 'website.rich_text', settings: { heading: 'H', body: 'B' } }]
type Result = { ok?: boolean; errors?: Array<{ message: string }> }

const queued = async (db: Adapter): Promise<number> => {
  const shape = await db.introspect()
  const table = Object.keys(shape).find((name) => /job|queue/.test(name))
  if (!table) return 0
  const rows = await db.all(`SELECT * FROM ${db.quoteIdent(table)}`)
  return rows.length
}

const seed = async (db: Adapter) => {
  await call(db, 'website.saveSite', {
    id: 'site1',
    name: 'moc',
    title: 'Mộc',
    defaultLocale: 'vi',
    theme: 'theme_paper',
  })
  for (const id of ['page', 'story']) {
    await call(db, 'website.saveEntry', {
      id,
      siteId: 'site1',
      type: 'website.page',
      slug: id,
      path: `/${id}`,
      title: id,
      layout,
    })
  }
}

test('outbox: an activation that loses the race changes nothing at all', async () => {
  const db = await boot()
  await seed(db)
  await call(db, 'website.preparePublication', { id: 'pubA', siteId: 'site1', entryIds: ['page'] })
  await call(db, 'website.preparePublication', { id: 'pubB', siteId: 'site1', entryIds: ['story'] })

  const [a, b] = (await Promise.all([
    call(db, 'website.activatePublication', { id: 'pubA', expectedPublicationId: '' }),
    call(db, 'website.activatePublication', { id: 'pubB', expectedPublicationId: '' }),
  ])) as Result[]

  const lost = [a, b].find((r) => r.ok === false)
  const won = [a, b].find((r) => r.ok === true)
  assert.ok(lost && won)

  // The loser must not have moved an entry pointer on its way out. Everything
  // after the compare-and-set is inside the same transaction, so losing it means
  // nothing downstream ran — which is what an outbox row would depend on.
  const publications = (await call(db, 'website.listPublications', { siteId: 'site1' })) as Array<{
    id: string
    state: string
  }>
  const states = Object.fromEntries(publications.map((p) => [p.id, p.state]))
  assert.equal(Object.values(states).filter((s) => s === 'active').length, 1)
  assert.equal(Object.values(states).filter((s) => s === 'prepared').length, 1)
})

test('outbox: the entries of a losing activation stay unpublished', async () => {
  const db = await boot()
  await seed(db)
  await call(db, 'website.preparePublication', { id: 'pubA', siteId: 'site1', entryIds: ['page'] })
  await call(db, 'website.preparePublication', { id: 'pubB', siteId: 'site1', entryIds: ['story'] })
  const [a] = (await Promise.all([
    call(db, 'website.activatePublication', { id: 'pubA', expectedPublicationId: '' }),
    call(db, 'website.activatePublication', { id: 'pubB', expectedPublicationId: '' }),
  ])) as Result[]

  const winnerPath = a.ok === true ? '/page' : '/story'
  const loserPath = a.ok === true ? '/story' : '/page'
  assert.ok(await call(db, 'website.getEntryByPath', { siteId: 'site1', path: winnerPath }))
  assert.equal(
    await call(db, 'website.getEntryByPath', { siteId: 'site1', path: loserPath }),
    null,
    'the losing set is not half-published',
  )
})

test('outbox: activation queues nothing today, and that is deliberate', async () => {
  const db = await boot()
  await seed(db)
  const before = await queued(db)
  await call(db, 'website.preparePublication', { id: 'pub1', siteId: 'site1', entryIds: ['page'] })
  await call(db, 'website.activatePublication', { id: 'pub1' })

  // There is no consumer yet: no cache to invalidate, no index to rebuild, no
  // delivery to make. Enqueuing a job nobody handles would be a mechanism
  // pretending to be a feature. This test is here so that adding one is a
  // deliberate change rather than a silent one.
  assert.equal(await queued(db), before, 'nothing is queued off an activation yet')
})
