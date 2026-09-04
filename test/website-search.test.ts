import assert from 'node:assert/strict'
import { test } from 'node:test'
import { callFn, compose, migrateOne, registerFunctions, sqliteAdapter } from '@ketvietlab/ketjs'
import type { Adapter } from '@ketvietlab/ketjs'
import { address, paperTheme, partner, website } from '@ketvietlab/ketsuite'

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

const seedSite = async (db: Adapter, id = 'site1', name = 'moc') => {
  await call(db, 'website.saveSite', {
    id,
    name,
    title: 'Mộc',
    defaultLocale: 'vi',
    theme: 'theme_paper',
  })
}

const publish = async (db: Adapter, id: string, title: string, opts: Record<string, unknown> = {}) => {
  await call(db, 'website.saveEntry', {
    id,
    siteId: 'site1',
    type: 'website.post',
    slug: id,
    path: `/${id}`,
    title,
    layout,
    ...opts,
  })
  await call(db, 'website.publishEntry', { id })
}

type Hit = { id: string; title: string }

test('search: a draft is never a public result', async () => {
  const db = await boot()
  await seedSite(db)
  await publish(db, 'p1', 'Chuyện bên ấm trà')
  await call(db, 'website.saveEntry', {
    id: 'p2',
    siteId: 'site1',
    type: 'website.post',
    slug: 'p2',
    path: '/p2',
    title: 'Chuyện chưa kể',
    layout,
  })

  const hits = (await call(db, 'website.searchPublished', { siteId: 'site1', q: 'chuyện' })) as Hit[]
  assert.deepEqual(
    hits.map((h) => h.id),
    ['p1'],
  )
})

test('search: drafts do not consume the scan window', async () => {
  const db = await boot()
  await seedSite(db)
  // Unpublished entries used to be fetched and discarded, spending the budget
  // before the published ones were reached.
  for (let i = 0; i < 60; i += 1) {
    await call(db, 'website.saveEntry', {
      id: `d${i}`,
      siteId: 'site1',
      type: 'website.post',
      slug: `d${i}`,
      path: `/d${i}`,
      title: 'Chuyện nháp',
      layout,
    })
  }
  await publish(db, 'p1', 'Chuyện bên ấm trà')

  const hits = (await call(db, 'website.searchPublished', { siteId: 'site1', q: 'chuyện' })) as Hit[]
  assert.deepEqual(
    hits.map((h) => h.id),
    ['p1'],
  )
})

test('search: paging past the first page returns the later matches', async () => {
  const db = await boot()
  await seedSite(db)
  for (let i = 0; i < 25; i += 1) await publish(db, `p${String(i).padStart(2, '0')}`, `Trà số ${i}`)

  const first = (await call(db, 'website.searchPublished', {
    siteId: 'site1',
    q: 'trà',
    limit: 10,
    offset: 0,
  })) as Hit[]
  const third = (await call(db, 'website.searchPublished', {
    siteId: 'site1',
    q: 'trà',
    limit: 10,
    offset: 20,
  })) as Hit[]

  assert.equal(first.length, 10)
  assert.equal(third.length, 5, 'the tail of the result set is reachable')
  const overlap = first.filter((h) => third.some((t) => t.id === h.id))
  assert.deepEqual(overlap, [], 'pages do not repeat rows')
})

test('search: the count is what the pages add up to', async () => {
  const db = await boot()
  await seedSite(db)
  for (let i = 0; i < 25; i += 1) await publish(db, `p${String(i).padStart(2, '0')}`, `Trà số ${i}`)
  await publish(db, 'other', 'Gốm Bát Tràng')

  const total = (await call(db, 'website.countSearchPublished', { siteId: 'site1', q: 'trà số' })) as {
    count: number
    capped: boolean
  }
  assert.equal(total.count, 25)
  assert.equal(total.capped, false)
})

test('search: a term shorter than two characters asks nothing of the database', async () => {
  const db = await boot()
  await seedSite(db)
  await publish(db, 'p1', 'Trà')
  assert.deepEqual(await call(db, 'website.searchPublished', { siteId: 'site1', q: 'a' }), [])
  assert.deepEqual(await call(db, 'website.countSearchPublished', { siteId: 'site1', q: '' }), {
    count: 0,
    capped: false,
  })
})

test('search: a site that is not being served has no public search', async () => {
  const db = await boot()
  await seedSite(db)
  await publish(db, 'p1', 'Chuyện bên ấm trà')
  await call(db, 'website.saveSite', {
    id: 'site1',
    name: 'moc',
    title: 'Mộc',
    defaultLocale: 'vi',
    theme: 'theme_paper',
    active: false,
  })
  assert.deepEqual(await call(db, 'website.searchPublished', { siteId: 'site1', q: 'chuyện' }), [])
})

test('search: results are the published title, not the draft that replaced it', async () => {
  const db = await boot()
  await seedSite(db)
  await publish(db, 'p1', 'Chuyện bên ấm trà')
  // A newer draft exists but has not been published.
  await call(db, 'website.saveEntry', {
    id: 'p1',
    siteId: 'site1',
    type: 'website.post',
    slug: 'p1',
    path: '/p1',
    title: 'Tiêu đề nháp chưa duyệt',
    layout,
  })

  const hits = (await call(db, 'website.searchPublished', { siteId: 'site1', q: 'chuyện' })) as Hit[]
  assert.equal(hits[0]?.title, 'Chuyện bên ấm trà')
  const draft = (await call(db, 'website.searchPublished', { siteId: 'site1', q: 'nháp' })) as Hit[]
  assert.deepEqual(draft, [], 'an unpublished title is not searchable')
})

test('search: a scheduled republish does not delist what is already live', async () => {
  const db = await boot()
  await seedSite(db)
  await publish(db, 'p1', 'Chuyện bên ấm trà')
  // A newer revision is queued for later. The entry's status becomes
  // 'scheduled' while the revision already published stays public.
  const next = (await call(db, 'website.saveEntry', {
    id: 'p1',
    siteId: 'site1',
    type: 'website.post',
    slug: 'p1',
    path: '/p1',
    title: 'Chuyện bên ấm trà, bản mới',
    layout,
  })) as { revisionId: string }
  await call(db, 'website.publishEntry', {
    id: 'p1',
    expectedRevisionId: next.revisionId,
    publishAt: new Date(Date.now() + 60_000).toISOString(),
  })

  const hits = (await call(db, 'website.searchPublished', { siteId: 'site1', q: 'chuyện' })) as Hit[]
  assert.deepEqual(
    hits.map((h) => h.title),
    ['Chuyện bên ấm trà'],
    'the live revision is still findable, and it is the live one',
  )
})
