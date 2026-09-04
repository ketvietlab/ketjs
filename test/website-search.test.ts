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

  // Observing the adapter, not just the return value: the guard is worth nothing
  // if it sits below the queries it is supposed to save.
  const seen: string[] = []
  const original = db.all.bind(db)
  db.all = async (sql: string, params?: unknown[]) => {
    seen.push(sql)
    return original(sql, params)
  }
  try {
    assert.deepEqual(await call(db, 'website.searchPublished', { siteId: 'site1', q: 'a' }), [])
    assert.deepEqual(await call(db, 'website.countSearchPublished', { siteId: 'site1', q: '' }), {
      count: 0,
      capped: false,
    })
  } finally {
    db.all = original
  }
  assert.deepEqual(seen, [], 'a term too short to match must not reach the database')
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

test('search: a corpus larger than one batch is matched completely', async () => {
  const db = await boot()
  await seedSite(db)
  // Revisions are read in chunks of 200. A dropped tail or a duplicated chunk
  // is invisible until the corpus crosses that boundary.
  const total = 210
  for (let i = 0; i < total; i += 1) await publish(db, `p${String(i).padStart(3, '0')}`, `Trà số ${i}`)

  const count = (await call(db, 'website.countSearchPublished', { siteId: 'site1', q: 'trà số' })) as {
    count: number
    capped: boolean
  }
  assert.equal(count.count, total, 'every entry across both chunks is matched exactly once')
  assert.equal(count.capped, false)

  // And the very last one, which lives past the first chunk, is reachable.
  const tail = (await call(db, 'website.searchPublished', {
    siteId: 'site1',
    q: 'trà số 209',
  })) as Hit[]
  assert.equal(tail.length, 1)
})

test('search: a page under a namespace the deployment serves is not offered', async () => {
  const db = await boot()
  await seedSite(db)
  await publish(db, 'ok', 'Trà ngon')
  await call(db, 'website.saveEntry', {
    id: 'shadow',
    siteId: 'site1',
    type: 'website.post',
    slug: 'shadow',
    path: '/api/tra-ngon',
    title: 'Trà ngon',
    layout,
  })
  await call(db, 'website.publishEntry', { id: 'shadow' })

  const hits = (await call(db, 'website.searchPublished', { siteId: 'site1', q: 'trà' })) as Array<
    Hit & { path: string }
  >
  assert.deepEqual(
    hits.map((h) => h.path),
    ['/ok'],
    'a module route answers /api first, so the result would 404',
  )
})

test('search results and the public reader agree', async () => {
  const db = await boot()
  await seedSite(db)
  await publish(db, 'live', 'Trà sống')
  await publish(db, 'shadowed', 'Trà khuất', { path: '/api/khuat' })
  await call(db, 'website.saveEntry', {
    id: 'draft',
    siteId: 'site1',
    type: 'website.post',
    slug: 'draft',
    path: '/draft',
    title: 'Trà nháp',
    layout,
  })

  // Anything search offers must be openable, and nothing it withholds for a
  // publication reason may be openable either.
  const hits = (await call(db, 'website.searchPublished', { siteId: 'site1', q: 'trà' })) as Array<
    Hit & { path: string }
  >
  for (const hit of hits) {
    const page = await call(db, 'website.getEntryByPath', { siteId: 'site1', path: hit.path })
    assert.ok(page, `search offered ${hit.path} but the reader will not serve it`)
  }
  assert.equal(await call(db, 'website.getEntryByPath', { siteId: 'site1', path: '/draft' }), null)
})

test('search: an unserved site is closed to the reader too', async () => {
  const db = await boot()
  await seedSite(db)
  await publish(db, 'p1', 'Trà ngon')
  await call(db, 'website.saveSite', {
    id: 'site1',
    name: 'moc',
    title: 'Mộc',
    defaultLocale: 'vi',
    theme: 'theme_paper',
    active: false,
  })
  assert.deepEqual(await call(db, 'website.searchPublished', { siteId: 'site1', q: 'trà' }), [])
  assert.equal(
    await call(db, 'website.getEntryByPath', { siteId: 'site1', path: '/p1' }),
    null,
    'listing and reading must close together, not one before the other',
  )
})
