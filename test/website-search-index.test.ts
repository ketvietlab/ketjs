import assert from 'node:assert/strict'
import { test } from 'node:test'
import { callFn, compose, migrateOne, registerFunctions, sqliteAdapter } from '@ketvietlab/ketjs'
import type { Adapter } from '@ketvietlab/ketjs'
import { address, paperTheme, partner, website, websiteSearch } from '@ketvietlab/ketsuite'

/**
 * The index is derived data. It never decides what is public — the publication
 * does — so the tests that matter are: it offers nothing the reader refuses, it
 * can be rebuilt in pieces, and when it is behind it says so rather than
 * answering from a set that is no longer being served.
 */

const SCOPE = { company: 'acme', branches: null }
const modules = [address, partner, website, websiteSearch, paperTheme]
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
type Search = {
  hits: Array<{ id: string; path: string; title: string }>
  total: number
  stale: boolean
  indexed: boolean
}

const site = async (db: Adapter) =>
  call(db, 'website.saveSite', {
    id: 'site1',
    name: 'moc',
    title: 'Mộc',
    defaultLocale: 'vi',
    theme: 'theme_paper',
  })

const write = async (db: Adapter, id: string, title: string, publish = true) => {
  await call(db, 'website.saveEntry', {
    id,
    siteId: 'site1',
    type: 'website.post',
    slug: id,
    path: `/${id}`,
    title,
    layout,
  })
  if (publish) await call(db, 'website.publishEntry', { id })
}

const search = async (db: Adapter, q: string, extra: Record<string, unknown> = {}) =>
  (await call(db, 'website_search.searchIndexed', { siteId: 'site1', q, ...extra })) as Search

test('index: a search builds it on first use and answers from it', async () => {
  const db = await boot()
  await site(db)
  await write(db, 'tra', 'Chuyện bên ấm trà')
  await write(db, 'gom', 'Gốm Bát Tràng')

  const found = await search(db, 'chuyện')
  assert.equal(found.indexed, true)
  assert.deepEqual(
    found.hits.map((h) => h.path),
    ['/tra'],
  )
  assert.equal(found.total, 1)

  const status = (await call(db, 'website_search.indexStatus', { siteId: 'site1' })) as {
    state: string
    current: boolean
    documentCount: number
  }
  assert.equal(status.state, 'ready')
  assert.equal(status.current, true)
  assert.equal(status.documentCount, 2)
})

test('index: it offers nothing the public reader would refuse', async () => {
  const db = await boot()
  await site(db)
  await write(db, 'live', 'Trà sống')
  await write(db, 'draft', 'Trà nháp', false)

  await call(db, 'website_search.reindexSite', { siteId: 'site1', passes: 10 })
  const found = await search(db, 'trà')
  for (const hit of found.hits) {
    assert.ok(
      await call(db, 'website.getEntryByPath', { siteId: 'site1', path: hit.path }),
      `${hit.path} is indexed but the reader will not serve it`,
    )
  }
  assert.deepEqual(
    found.hits.map((h) => h.path),
    ['/live'],
  )
})

test('index: a rebuild can be taken one pass at a time', async () => {
  const db = await boot()
  await site(db)
  // More than one batch, so the checkpoint is exercised rather than skipped.
  for (let i = 0; i < 250; i += 1) await write(db, `p${String(i).padStart(3, '0')}`, `Trà số ${i}`)

  const first = (await call(db, 'website_search.reindexSite', { siteId: 'site1' })) as {
    done: boolean
    documentCount: number
  }
  assert.equal(first.done, false, 'one pass should not finish 250 entries')
  assert.ok(first.documentCount > 0 && first.documentCount < 250)

  const rest = (await call(db, 'website_search.reindexSite', { siteId: 'site1', passes: 10 })) as {
    done: boolean
    documentCount: number
  }
  assert.equal(rest.done, true, 'and it resumes rather than starting again')
  assert.equal(rest.documentCount, 250, 'every entry indexed exactly once')
})

test('index: a resumed rebuild does not index anything twice', async () => {
  const db = await boot()
  await site(db)
  for (let i = 0; i < 250; i += 1) await write(db, `p${String(i).padStart(3, '0')}`, `Trà số ${i}`)
  await call(db, 'website_search.reindexSite', { siteId: 'site1' })
  await call(db, 'website_search.reindexSite', { siteId: 'site1', passes: 10 })

  const found = await search(db, 'trà số 249')
  assert.equal(found.total, 1, 'the tail is reachable and appears once')
  const all = await search(db, 'trà số', { limit: 100 })
  assert.equal(all.total, 250)
})

test('index: publishing a set makes the old index stale, and it rebuilds', async () => {
  const db = await boot()
  await site(db)
  await write(db, 'one', 'Trà một')
  await call(db, 'website_search.reindexSite', { siteId: 'site1', passes: 10 })

  await call(db, 'website.saveEntry', {
    id: 'two',
    siteId: 'site1',
    type: 'website.post',
    slug: 'two',
    path: '/two',
    title: 'Trà hai',
    layout,
  })
  await call(db, 'website.preparePublication', { id: 'pub1', siteId: 'site1', entryIds: ['two'] })
  await call(db, 'website.activatePublication', { id: 'pub1' })

  // The index was built before the publication existed, so it is behind.
  const status = (await call(db, 'website_search.indexStatus', { siteId: 'site1' })) as {
    current: boolean
  }
  assert.equal(status.current, false)

  const found = await search(db, 'trà')
  assert.deepEqual(found.hits.map((h) => h.path).sort(), ['/one', '/two'])
  assert.equal(found.stale, false, 'a small site rebuilds within the inline budget')
})

test('index: a site too large to rebuild inline still answers, and says it is behind', async () => {
  const db = await boot()
  await site(db)
  // Well past what three inline passes can cover.
  for (let i = 0; i < 900; i += 1) await write(db, `p${String(i).padStart(3, '0')}`, `Trà số ${i}`)

  const found = await search(db, 'trà số 1')
  assert.equal(found.indexed, true, 'a visitor is not blocked on a full rebuild')
  assert.equal(found.stale, true, 'and the caller is told the answer is partial')

  // Finishing the rebuild settles it.
  await call(db, 'website_search.reindexSite', { siteId: 'site1', passes: 50 })
  assert.equal((await search(db, 'trà số 1')).stale, false)
})

test('index: a site that is not being served has no index and no answer', async () => {
  const db = await boot()
  await site(db)
  await write(db, 'tra', 'Trà')
  await call(db, 'website_search.reindexSite', { siteId: 'site1', passes: 10 })
  await call(db, 'website.saveSite', {
    id: 'site1',
    name: 'moc',
    title: 'Mộc',
    defaultLocale: 'vi',
    theme: 'theme_paper',
    active: false,
  })
  const found = await search(db, 'trà')
  assert.deepEqual(found.hits, [])
  assert.equal(found.indexed, false)
})

test('index: a term below the floor never touches the index', async () => {
  const db = await boot()
  await site(db)
  await write(db, 'tra', 'Trà')
  const found = await search(db, 'a')
  assert.deepEqual(found.hits, [])
  assert.equal(found.indexed, false, 'and it does not build one to answer nothing')
  const status = (await call(db, 'website_search.indexStatus', { siteId: 'site1' })) as { state: string }
  assert.equal(status.state, 'absent')
})

test('index: searching is anonymous, because a visitor has no session', () => {
  assert.equal(manifest.functions['website_search.searchIndexed']?.anonymous, true)
  assert.notEqual(manifest.functions['website_search.reindexSite']?.anonymous, true)
})

/**
 * The index made the write side cheap and left the read side a scan: every
 * document of the site pulled into memory on every keystroke and filtered in
 * JavaScript, which is exactly what the model's own comment says the index
 * exists to stop.
 */
test('search: a page of hits does not read the whole site', async () => {
  const db = await boot()
  await site(db)
  for (let i = 0; i < 12; i += 1) await write(db, `p${i}`, `Trang so ${i}`)
  await call(db, 'website_search.reindexSite', { siteId: 'site1', passes: 50 })

  // Rows returned per read, which is the difference the change is about: the
  // old code read every document of the site and sliced in JavaScript, so one
  // read came back with twelve rows however small the page was.
  const widest: number[] = []
  const watched = new Proxy(db, {
    get(target, key: string | symbol) {
      const held = Reflect.get(target, key) as unknown
      if (key !== 'all' || typeof held !== 'function') return held
      return async (...args: unknown[]) => {
        const rows = (await (held as (...a: unknown[]) => Promise<unknown[]>).apply(target, args)) ?? []
        widest.push(rows.length)
        return rows
      }
    },
  })

  const answer = (
    await callFn(
      'website_search.searchIndexed',
      { siteId: 'site1', q: 'trang', limit: 3 },
      { adapter: watched as Adapter, manifest, scope: SCOPE },
    )
  ).value as Search

  assert.equal(answer.hits.length, 3, 'the page is the size that was asked for')
  assert.equal(answer.total, 12, 'and the total counts what was not returned')
  assert.ok(widest.length > 0, 'the search reads something')
  assert.ok(
    Math.max(...widest) <= 3,
    `a read came back with ${Math.max(...widest)} rows for a page of 3: the match is not in the query`,
  )
})

test('search: a wildcard a visitor typed is a character, not a pattern', async () => {
  const db = await boot()
  await site(db)
  await write(db, 'giam-gia', 'Giam 50% hom nay')
  await write(db, 'khac', 'Chuyen khac')
  await call(db, 'website_search.reindexSite', { siteId: 'site1', passes: 50 })

  // Two characters, so this reaches the query rather than stopping at the
  // minimum term length - which is what made an earlier version of this test
  // pass without the escaping doing anything.
  assert.equal(
    (await search(db, '%%')).total,
    0,
    'unescaped, this is "anything" twice over and returns the whole site',
  )
  assert.equal(
    (await search(db, 'gia_')).total,
    0,
    'unescaped, the underscore matches any character and this finds "giam"',
  )

  // And the literal a visitor actually meant still matches.
  const real = await search(db, '50%')
  assert.equal(real.total, 1)
  assert.equal(real.hits[0]?.title, 'Giam 50% hom nay')
})

test('search: the sweep is what keeps the index level between publications', () => {
  // reindexSite said in its own comment that it existed so "an operator or a
  // job" could drive a rebuild, and there was no job: between publications the
  // index only caught up through searchIndexed, three passes at a time, paid
  // for by whichever visitors searched first.
  const sweep = manifest.jobs['website_search.indexSweep']
  assert.ok(sweep, 'the sweep must be composed')
  assert.equal(sweep?.crossCompany, true, 'every legal entity has sites of its own')
  assert.deepEqual(sweep?.schedule, { every: '1h' })
  assert.ok(manifest.jobs['website_search.rebuildStale'], 'and the per-company pass it queues')
})
