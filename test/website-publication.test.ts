import assert from 'node:assert/strict'
import { test } from 'node:test'
import { callFn, compose, migrateOne, registerFunctions, sqliteAdapter } from '@ketvietlab/ketjs'
import type { Adapter } from '@ketvietlab/ketjs'
import { address, paperTheme, partner, website } from '@ketvietlab/ketsuite'

/**
 * Publishing used to be per entry: a page went live the moment someone pressed
 * the button on it. A publication is the set, and activating it moves all of
 * them or none.
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

type Result = { ok?: boolean; id?: string; errors?: Array<{ field: string; message: string }> }
const layout = [{ type: 'website.rich_text', settings: { heading: 'H', body: 'B' } }]

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

const publicPath = async (db: Adapter, path: string) =>
  await call(db, 'website.getEntryByPath', { siteId: 'site1', path })

test('publication: preparing publishes nothing', async () => {
  const db = await boot()
  await seed(db)
  const prepared = (await call(db, 'website.preparePublication', {
    id: 'pub1',
    siteId: 'site1',
    entryIds: ['page', 'story'],
  })) as Result & { entryCount?: number }
  assert.equal(prepared.ok, true)
  assert.equal(prepared.entryCount, 2)

  // A proposal is not a publication. Nothing is readable yet.
  assert.equal(await publicPath(db, '/page'), null)
  assert.equal(await publicPath(db, '/story'), null)
})

test('publication: activating moves every entry, not the first one', async () => {
  const db = await boot()
  await seed(db)
  await call(db, 'website.preparePublication', { id: 'pub1', siteId: 'site1', entryIds: ['page', 'story'] })
  const activated = (await call(db, 'website.activatePublication', { id: 'pub1' })) as Result
  assert.equal(activated.ok, true)

  // The whole point: a visitor never sees half the set.
  assert.ok(await publicPath(db, '/page'))
  assert.ok(await publicPath(db, '/story'))
})

test('publication: two activations from the same base — exactly one wins', async () => {
  const db = await boot()
  await seed(db)
  await call(db, 'website.preparePublication', { id: 'pubA', siteId: 'site1', entryIds: ['page'] })
  await call(db, 'website.preparePublication', { id: 'pubB', siteId: 'site1', entryIds: ['story'] })

  const [a, b] = (await Promise.all([
    call(db, 'website.activatePublication', { id: 'pubA', expectedPublicationId: '' }),
    call(db, 'website.activatePublication', { id: 'pubB', expectedPublicationId: '' }),
  ])) as Result[]

  const won = [a, b].filter((r) => r.ok === true)
  const lost = [a, b].filter((r) => r.ok === false)
  assert.equal(won.length, 1, 'both believed they replaced the other')
  assert.equal(lost[0]?.errors?.[0]?.message, 'website.error.publicationStaleBase')
})

test('publication: replaying an activation is not an error', async () => {
  const db = await boot()
  await seed(db)
  await call(db, 'website.preparePublication', { id: 'pub1', siteId: 'site1', entryIds: ['page'] })
  assert.equal(((await call(db, 'website.activatePublication', { id: 'pub1' })) as Result).ok, true)
  assert.equal(
    ((await call(db, 'website.activatePublication', { id: 'pub1' })) as Result).ok,
    true,
    'it already happened',
  )
})

test('publication: preparing the same set twice returns the same publication', async () => {
  const db = await boot()
  await seed(db)
  const first = (await call(db, 'website.preparePublication', {
    id: 'pub1',
    siteId: 'site1',
    entryIds: ['page', 'story'],
  })) as Result & { contentHash?: string }
  const again = (await call(db, 'website.preparePublication', {
    id: 'pub1',
    siteId: 'site1',
    // Order is not identity: the same revisions are the same set.
    entryIds: ['story', 'page'],
  })) as Result & { contentHash?: string }
  assert.equal(again.ok, true)
  assert.equal(again.contentHash, first.contentHash)
})

test('publication: the same id for a different set is a conflict', async () => {
  const db = await boot()
  await seed(db)
  await call(db, 'website.preparePublication', { id: 'pub1', siteId: 'site1', entryIds: ['page'] })
  const clash = (await call(db, 'website.preparePublication', {
    id: 'pub1',
    siteId: 'site1',
    entryIds: ['story'],
  })) as Result
  assert.equal(clash.ok, false)
  assert.equal(clash.errors?.[0]?.message, 'website.error.publicationConflict')
})

test('publication: every refusal names the entry that caused it', async () => {
  const db = await boot()
  await seed(db)
  await call(db, 'website.saveSite', {
    id: 'site2',
    name: 'other',
    title: 'Other',
    defaultLocale: 'vi',
    theme: 'theme_paper',
  })
  await call(db, 'website.saveEntry', {
    id: 'elsewhere',
    siteId: 'site2',
    type: 'website.page',
    slug: 'x',
    path: '/x',
    title: 'X',
    layout,
  })
  const refused = (await call(db, 'website.preparePublication', {
    id: 'pub1',
    siteId: 'site1',
    entryIds: ['page', 'elsewhere'],
  })) as Result
  assert.equal(refused.ok, false)
  assert.equal(
    refused.errors?.[0]?.field,
    'elsewhere',
    'a caller publishing twenty pages needs to know which one',
  )
  assert.equal(refused.errors?.[0]?.message, 'website.error.publicationEntryOutsideSite')
})

test('publication: an empty or duplicated set is refused before anything is written', async () => {
  const db = await boot()
  await seed(db)
  assert.equal(
    ((await call(db, 'website.preparePublication', { id: 'p', siteId: 'site1', entryIds: [] })) as Result)
      .errors?.[0]?.message,
    'website.error.publicationEmpty',
  )
  assert.equal(
    (
      (await call(db, 'website.preparePublication', {
        id: 'p',
        siteId: 'site1',
        entryIds: ['page', 'page'],
      })) as Result
    ).errors?.[0]?.message,
    'website.error.publicationDuplicate',
  )
  assert.deepEqual(await call(db, 'website.listPublications', { siteId: 'site1' }), [])
})

test('publication: activating supersedes the one it replaced', async () => {
  const db = await boot()
  await seed(db)
  await call(db, 'website.preparePublication', { id: 'pub1', siteId: 'site1', entryIds: ['page'] })
  await call(db, 'website.activatePublication', { id: 'pub1' })
  await call(db, 'website.preparePublication', { id: 'pub2', siteId: 'site1', entryIds: ['story'] })
  const second = (await call(db, 'website.activatePublication', { id: 'pub2' })) as Result & {
    supersededId?: string
  }
  assert.equal(second.supersededId, 'pub1')

  const states = Object.fromEntries(
    (
      (await call(db, 'website.listPublications', { siteId: 'site1' })) as Array<{
        id: string
        state: string
      }>
    ).map((p) => [p.id, p.state]),
  )
  assert.deepEqual(states, { pub1: 'superseded', pub2: 'active' })
})

test('publication: rollback republishes the earlier set rather than undoing', async () => {
  const db = await boot()
  await seed(db)
  await call(db, 'website.preparePublication', { id: 'pub1', siteId: 'site1', entryIds: ['page'] })
  await call(db, 'website.activatePublication', { id: 'pub1' })
  await call(db, 'website.preparePublication', { id: 'pub2', siteId: 'site1', entryIds: ['story'] })
  await call(db, 'website.activatePublication', { id: 'pub2' })

  const back = (await call(db, 'website.rollbackPublication', { id: 'pub3', siteId: 'site1' })) as Result & {
    restoredFromId?: string
  }
  assert.equal(back.ok, true)
  assert.equal(back.restoredFromId, 'pub1')

  // History stays: the rollback is a new publication, prepared and awaiting
  // activation like any other.
  const all = (await call(db, 'website.listPublications', { siteId: 'site1' })) as Array<{
    id: string
    state: string
  }>
  assert.equal(all.length, 3)
  assert.equal(all.find((p) => p.id === 'pub3')?.state, 'prepared')
})

test('publication: rollback does not bring back a page that has since been trashed', async () => {
  const db = await boot()
  await seed(db)
  await call(db, 'website.preparePublication', { id: 'pub1', siteId: 'site1', entryIds: ['page'] })
  await call(db, 'website.activatePublication', { id: 'pub1' })
  await call(db, 'website.preparePublication', { id: 'pub2', siteId: 'site1', entryIds: ['story'] })
  await call(db, 'website.activatePublication', { id: 'pub2' })

  // Someone removes the page in between. Restoring a layout must not restore a
  // decision that has since been taken. Raw SQL because no function trashes an
  // entry yet — the state exists and the guard has to hold before one does.
  const raw = await db.all(
    `UPDATE ${db.quoteIdent('website_entry')} SET ${db.quoteIdent('status')} = 'trash' WHERE ${db.quoteIdent('id')} = 'page' RETURNING ${db.quoteIdent('id')}`,
  )
  assert.equal(raw.length, 1)

  const back = (await call(db, 'website.rollbackPublication', { id: 'pub3', siteId: 'site1' })) as Result
  assert.equal(back.ok, false)
  assert.equal(back.errors?.[0]?.message, 'website.error.publicationEntryTrashed')
})
