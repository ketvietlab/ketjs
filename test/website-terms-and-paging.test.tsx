import assert from 'node:assert/strict'
import { test } from 'node:test'
import { callFn, compose, migrateOne, registerFunctions, sqliteAdapter } from '@ketvietlab/ketjs'
import type { Adapter, ServeContext } from '@ketvietlab/ketjs'
import backend from '@ketvietlab/ketsuite/backend'
import {
  address,
  company,
  paperTheme,
  partner,
  storage,
  website,
  livedoc,
  user,
  websiteBackend,
  websiteForm,
  websiteMenu,
  websiteSearch,
  websiteSeo,
} from '@ketvietlab/ketsuite'

const SCOPE = { company: 'acme', branches: null }
const modules = [
  address,
  partner,
  company,
  storage,
  backend,
  website,
  websiteMenu,
  websiteSearch,
  websiteSeo,
  websiteForm,
  livedoc,
  user,
  websiteBackend,
  paperTheme,
]
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

type EntryTermRow = { termId: string; taxonomy: string; name: string }

const seed = async (db: Adapter) => {
  await call(db, 'website.saveSite', {
    id: 'site1',
    name: 'moc',
    title: 'Moc',
    defaultLocale: 'vi',
    theme: 'theme_paper',
  })
  await call(db, 'website.saveEntry', {
    id: 'p1',
    siteId: 'site1',
    type: 'website.page',
    slug: 'gioi-thieu',
    path: '/gioi-thieu',
    title: 'Gioi thieu',
    layout: [{ type: 'website.rich_text', settings: { body: 'x' } }],
  })
  await call(db, 'website.saveTerm', {
    id: 't1',
    siteId: 'site1',
    taxonomy: 'website.category',
    slug: 'tin-tuc',
    name: 'Tin tuc',
  })
}

/**
 * assignTerm shipped able to file a page under a term, with nothing that could
 * read the assignment back and nothing that could take it off - so the round
 * trip, not the assignment, is what has to hold.
 */
test('terms: a term can be assigned, listed back and taken off again', async () => {
  const db = await boot()
  await seed(db)

  assert.deepEqual(await call(db, 'website.listEntryTerms', { entryId: 'p1' }), [])

  await call(db, 'website.assignTerm', { id: 'a1', entryId: 'p1', termId: 't1' })
  const listed = (await call(db, 'website.listEntryTerms', { entryId: 'p1' })) as EntryTermRow[]
  assert.equal(listed.length, 1)
  assert.deepEqual(
    { termId: listed[0]?.termId, taxonomy: listed[0]?.taxonomy, name: listed[0]?.name },
    { termId: 't1', taxonomy: 'website.category', name: 'Tin tuc' },
  )

  await call(db, 'website.unassignTerm', { entryId: 'p1', termId: 't1' })
  assert.deepEqual(await call(db, 'website.listEntryTerms', { entryId: 'p1' }), [])
})

test('terms: the term is deletable again once nothing is filed under it', async () => {
  const db = await boot()
  await seed(db)
  await call(db, 'website.assignTerm', { id: 'a1', entryId: 'p1', termId: 't1' })

  // deleteTerm refuses while an assignment exists. Before unassignTerm that
  // made the term permanent, because no caller could clear the assignment.
  const blocked = (await call(db, 'website.deleteTerm', { id: 't1' })) as { ok?: boolean }
  assert.equal(blocked.ok, false)

  await call(db, 'website.unassignTerm', { entryId: 'p1', termId: 't1' })
  const freed = (await call(db, 'website.deleteTerm', { id: 't1' })) as { ok?: boolean }
  assert.equal(freed.ok, true)
})

test('terms: removing one that was never assigned is the state the caller asked for', async () => {
  const db = await boot()
  await seed(db)
  const result = (await call(db, 'website.unassignTerm', { entryId: 'p1', termId: 't1' })) as {
    ok?: boolean
  }
  assert.equal(result.ok, true)
})

/**
 * A GET must not be one of the ways to change state: a link prefetcher, a link
 * scanner or "open all in tabs" was enough to activate a publication or drop a
 * site member. The old per-action routes are gone; the Studio API is what is left.
 */
const studioApiGet = async (operation: string): Promise<number | undefined> => {
  const entry = manifest.routes['/website/api/{operation}']
  if (!entry) throw new Error('the Studio API is not composed')
  const route = entry.make({} as unknown as ServeContext)
  const req = { method: 'GET', headers: { host: 'moc.example' } }
  const result = await route(new URL(`http://moc.example/website/api/${operation}`), req as never, {
    operation,
  })
  return result.status
}

test('routes: nothing that changes state answers a GET', async () => {
  for (const operation of [
    'website.activatePublication',
    'website.rollbackPublication',
    'website.removeSiteMember',
    'website.restoreRevision',
    'website.revokePreviewTokens',
    'website.assignTerm',
    'website.unassignTerm',
  ])
    assert.equal(await studioApiGet(operation), 405, `${operation} must refuse a GET`)
})

test('routes: the domain APIs of this wave stay registered while the old screens are retired', () => {
  for (const key of ['website.assignTerm', 'website.unassignTerm', 'website.revokePreviewTokens'])
    assert.ok(manifest.functions[key], `${key} must stay registered`)
})
