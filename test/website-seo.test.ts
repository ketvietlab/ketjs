import assert from 'node:assert/strict'
import { test } from 'node:test'
import { callFn, compose, migrateOne, registerFunctions, sqliteAdapter } from '@ketvietlab/ketjs'
import type { Adapter, Manifest } from '@ketvietlab/ketjs'
import { address, paperTheme, partner, website, websiteSeo } from '@ketvietlab/ketsuite'
import {
  isReservedPath,
  reservedPrefixes,
  robotsTxt,
  safeOgImage,
  sameSiteCanonical,
  sitemapXml,
} from '../packages/ketsuite/src/modules/website_seo/projection.ts'

const SCOPE = { company: 'acme', branches: null }
const modules = [address, partner, website, websiteSeo, paperTheme]
const manifest = compose(modules)

const boot = async (): Promise<{ db: Adapter; manifest: Manifest }> => {
  const db = sqliteAdapter()
  await db.open()
  await migrateOne(db, manifest)
  registerFunctions(modules)
  return { db, manifest }
}

const call = async (db: Adapter, name: string, input: Record<string, unknown>) =>
  (await callFn(name, input, { adapter: db, manifest, scope: SCOPE })).value

const layout = [{ type: 'website.rich_text', settings: { heading: 'H', body: 'Body copy.' } }]

/** A site with one domain and one published entry — the shape both files read. */
const seedSite = async (db: Adapter) => {
  await call(db, 'website.saveSite', {
    id: 'site1',
    name: 'moc',
    title: 'Mộc',
    defaultLocale: 'vi',
    theme: 'theme_paper',
  })
  await call(db, 'website.saveDomain', {
    id: 'dom1',
    siteId: 'site1',
    host: 'moc.example',
    primary: true,
  })
  await call(db, 'website.saveEntry', {
    id: 'e1',
    siteId: 'site1',
    type: 'website.page',
    slug: 'gioi-thieu',
    path: '/gioi-thieu',
    title: 'Giới thiệu',
    layout,
  })
  await call(db, 'website.publishEntry', { id: 'e1' })
}

// --- projection: pure rules, no adapter -------------------------------------

const HOSTS = ['moc.example']

test('seo: a canonical may only point back at the site that declares it', () => {
  assert.equal(sameSiteCanonical('/gioi-thieu', HOSTS), '/gioi-thieu')
  assert.equal(sameSiteCanonical('https://moc.example/gioi-thieu', HOSTS), 'https://moc.example/gioi-thieu')
  assert.equal(sameSiteCanonical('https://competitor.example/x', HOSTS), null)
  assert.equal(sameSiteCanonical('javascript:alert(1)', HOSTS), null)
  assert.equal(sameSiteCanonical('', HOSTS), null)
})

test('seo: a leading slash does not make a value site-relative', () => {
  // Every one of these resolves to competitor.example in a browser: a backslash
  // is normalised to a slash for http(s), and tab/CR/LF are stripped before the
  // URL is parsed. Testing only for a leading "//" let all of them through.
  const escapes = [
    '//competitor.example/x',
    '/\\competitor.example/x',
    '/\\/competitor.example/x',
    '/\t/competitor.example/x',
    '/\n/competitor.example/x',
    '/\r/competitor.example/x',
  ]
  for (const value of escapes) {
    assert.equal(sameSiteCanonical(value, HOSTS), null, JSON.stringify(value))
    // And they must not survive by being resolved against the site either.
    const resolved = new URL(value, 'https://moc.example/page').host
    assert.equal(resolved, 'competitor.example', 'the vector still resolves off-site')
  }
})

test('seo: credentials in an absolute canonical are refused', () => {
  // The host check alone accepts this, and toString() would publish the userinfo.
  assert.equal(sameSiteCanonical('https://evil@moc.example/x', HOSTS), null)
  // Userinfo that makes the real host a different one was already refused.
  assert.equal(sameSiteCanonical('https://moc.example@competitor.example/', HOSTS), null)
})

test('seo: an og:image is held to the same relative rules', () => {
  assert.equal(safeOgImage('/anh/tra.jpg'), '/anh/tra.jpg')
  assert.equal(safeOgImage('https://cdn.example/tra.jpg'), 'https://cdn.example/tra.jpg')
  assert.equal(safeOgImage('//evil.example/x.png'), null)
  assert.equal(safeOgImage('/\\evil.example/x.png'), null)
  assert.equal(safeOgImage('javascript:alert(1)'), null)
  assert.equal(safeOgImage('x'.repeat(2049)), null)
})

test('seo: reserved namespaces come from the routes the deployment serves', () => {
  // Derived, not hardcoded: a list written by hand drifts from the routes that
  // actually answer, and a page published at /login would then be advertised
  // while the user module serves that path.
  const prefixes = reservedPrefixes([
    '/admin/website/pages',
    '/login',
    '/website/forms/{id}/submit',
    '/{slug}',
    'not-a-path',
  ])
  assert.ok(prefixes.includes('/admin'))
  assert.ok(prefixes.includes('/login'))
  assert.ok(prefixes.includes('/website'))
  assert.ok(prefixes.includes('/api'), 'reserved as a family rather than a registered route')
  assert.ok(prefixes.includes('/internal/v1'))
  assert.ok(!prefixes.some((p) => p.startsWith('/{')), 'a parameter segment reserves nothing')

  assert.ok(isReservedPath('/admin', prefixes))
  assert.ok(isReservedPath('/admin/website/pages', prefixes))
  assert.ok(isReservedPath('/login', prefixes))
  assert.ok(!isReservedPath('/gioi-thieu', prefixes))
  // A page whose slug merely starts with the same letters is not reserved.
  assert.ok(!isReservedPath('/administrative-notes', prefixes))
})

test('seo: a sitemap escapes what it did not author', () => {
  const xml = sitemapXml('https://moc.example', [{ path: '/tra?a=1&b=2', lastModified: '2026-09-04' }])
  assert.ok(xml.includes('<loc>https://moc.example/tra?a=1&amp;b=2</loc>'))
  assert.ok(xml.includes('<lastmod>2026-09-04</lastmod>'))
  assert.ok(!xml.includes('&b=2'), 'a bare ampersand would make the document invalid XML')
})

test('seo: an unresolvable host disallows everything rather than guessing', () => {
  const prefixes = ['/admin', '/api']
  assert.equal(
    robotsTxt('https://moc.example', { indexable: false, prefixes }),
    'User-agent: *\nDisallow: /\n',
  )
  const open = robotsTxt('https://moc.example', { indexable: true, prefixes })
  assert.ok(open.includes('Sitemap: https://moc.example/sitemap.xml'))
  for (const prefix of prefixes) {
    assert.ok(open.includes(`Disallow: ${prefix}/`), `${prefix} subtree`)
    assert.ok(open.includes(`Disallow: ${prefix}$`), `${prefix} exact`)
  }
  // A bare prefix would also hide a page that merely starts with those letters.
  assert.ok(!/Disallow: \/admin\n/.test(open))
})

// --- functions: the write path the extended fields never had ----------------

test('seo: entry metadata round-trips through the module that declared the fields', async () => {
  const { db } = await boot()
  await seedSite(db)

  const saved = (await call(db, 'website_seo.saveEntrySeo', {
    entryId: 'e1',
    metaDescription: 'Trà và gốm thủ công.',
    canonical: '/gioi-thieu',
    noindex: false,
  })) as { ok: boolean }
  assert.equal(saved.ok, true)

  const read = (await call(db, 'website_seo.getEntrySeo', { entryId: 'e1' })) as Record<string, unknown>
  assert.equal(read.metaDescription, 'Trà và gốm thủ công.')
  assert.equal(read.canonical, '/gioi-thieu')
  assert.equal(read.noindex, false)
})

test('seo: a canonical naming another host is refused as data, not thrown', async () => {
  const { db } = await boot()
  await seedSite(db)

  const result = (await call(db, 'website_seo.saveEntrySeo', {
    entryId: 'e1',
    canonical: 'https://competitor.example/gioi-thieu',
  })) as { ok: boolean; errors?: Array<{ field: string; message: string }> }
  assert.equal(result.ok, false)
  assert.equal(result.errors?.[0]?.field, 'canonical')
  assert.equal(result.errors?.[0]?.message, 'website_seo.error.foreignCanonical')

  const read = (await call(db, 'website_seo.getEntrySeo', { entryId: 'e1' })) as Record<string, unknown>
  assert.equal(read.canonical, null, 'a rejected write leaves the previous value alone')
})

test('seo: a description longer than the limit is refused', async () => {
  const { db } = await boot()
  await seedSite(db)
  const result = (await call(db, 'website_seo.saveEntrySeo', {
    entryId: 'e1',
    metaDescription: 'x'.repeat(321),
  })) as { ok: boolean; errors?: Array<{ field: string }> }
  assert.equal(result.ok, false)
  assert.equal(result.errors?.[0]?.field, 'metaDescription')
})

// --- sitemap: the filter is the publication itself --------------------------

test('seo: the sitemap lists exactly what publication made public', async () => {
  const { db } = await boot()
  await seedSite(db)

  let entries = (await call(db, 'website_seo.sitemapEntries', { siteId: 'site1' })) as Array<{
    path: string
  }>
  assert.deepEqual(
    entries.map((e) => e.path),
    ['/gioi-thieu'],
  )

  // A draft has no published revision, so it is absent without a second switch.
  await call(db, 'website.saveEntry', {
    id: 'e2',
    siteId: 'site1',
    type: 'website.page',
    slug: 'nhap',
    path: '/nhap',
    title: 'Nháp',
    layout,
  })
  entries = (await call(db, 'website_seo.sitemapEntries', { siteId: 'site1' })) as Array<{ path: string }>
  assert.deepEqual(
    entries.map((e) => e.path),
    ['/gioi-thieu'],
    'a draft is not public',
  )

  // noindex removes a published page from the sitemap too: one intent, one effect.
  await call(db, 'website_seo.saveEntrySeo', { entryId: 'e1', noindex: true })
  entries = (await call(db, 'website_seo.sitemapEntries', { siteId: 'site1' })) as Array<{ path: string }>
  assert.deepEqual(entries, [], 'noindex and sitemap cannot disagree')
})

test('seo: each field is a partial update', async () => {
  const { db } = await boot()
  await seedSite(db)
  await call(db, 'website_seo.saveEntrySeo', {
    entryId: 'e1',
    metaDescription: 'Trà và gốm thủ công.',
    canonical: '/gioi-thieu',
  })

  // Setting one field must not erase the others.
  await call(db, 'website_seo.saveEntrySeo', { entryId: 'e1', noindex: true })
  let read = (await call(db, 'website_seo.getEntrySeo', { entryId: 'e1' })) as Record<string, unknown>
  assert.equal(read.metaDescription, 'Trà và gốm thủ công.')
  assert.equal(read.canonical, '/gioi-thieu')
  assert.equal(read.noindex, true)

  // And the direction that matters: editing a description must not silently
  // re-list a page that was deliberately delisted.
  await call(db, 'website_seo.saveEntrySeo', { entryId: 'e1', metaDescription: 'Mô tả mới.' })
  read = (await call(db, 'website_seo.getEntrySeo', { entryId: 'e1' })) as Record<string, unknown>
  assert.equal(read.noindex, true, 'editing one field must not re-index a delisted page')
  const entries = (await call(db, 'website_seo.sitemapEntries', { siteId: 'site1' })) as unknown[]
  assert.deepEqual(entries, [])
})

test('seo: an explicit null clears a field', async () => {
  const { db } = await boot()
  await seedSite(db)
  await call(db, 'website_seo.saveEntrySeo', { entryId: 'e1', canonical: '/gioi-thieu' })
  await call(db, 'website_seo.saveEntrySeo', { entryId: 'e1', canonical: null })
  const read = (await call(db, 'website_seo.getEntrySeo', { entryId: 'e1' })) as Record<string, unknown>
  assert.equal(read.canonical, null)
})

test('seo: a site that is not being served has no sitemap', async () => {
  const { db } = await boot()
  await seedSite(db)
  // Being prepared: resolveSite refuses to serve it, so nothing may list it.
  await call(db, 'website.saveSite', {
    id: 'site1',
    name: 'moc',
    title: 'Mộc',
    defaultLocale: 'vi',
    theme: 'theme_paper',
    active: false,
  })
  const entries = (await call(db, 'website_seo.sitemapEntries', { siteId: 'site1' })) as unknown[]
  assert.deepEqual(entries, [], 'an inactive site must not have its paths enumerated')
})

test('seo: drafts do not consume the sitemap budget', async () => {
  const { db } = await boot()
  await seedSite(db)
  // Paths sorting before the published one. Filtering after a plain LIMIT over
  // a path ordering would return an empty sitemap here.
  for (let i = 0; i < 40; i += 1) {
    await call(db, 'website.saveEntry', {
      id: `d${i}`,
      siteId: 'site1',
      type: 'website.page',
      slug: `aaa-${i}`,
      path: `/aaa-${String(i).padStart(3, '0')}`,
      title: `Nháp ${i}`,
      layout,
    })
  }
  const entries = (await call(db, 'website_seo.sitemapEntries', { siteId: 'site1' })) as Array<{
    path: string
  }>
  assert.deepEqual(
    entries.map((e) => e.path),
    ['/gioi-thieu'],
  )
})

test('seo: a page published under a served namespace is never listed', async () => {
  const { db } = await boot()
  await seedSite(db)
  // `/api` is reserved as a family whether or not a module registered a route
  // under it in this composition, so a CMS page there can never be reached.
  await call(db, 'website.saveEntry', {
    id: 'shadow',
    siteId: 'site1',
    type: 'website.page',
    slug: 'tai-lieu',
    path: '/api/tai-lieu',
    title: 'Tài liệu',
    layout,
  })
  await call(db, 'website.publishEntry', { id: 'shadow' })
  const entries = (await call(db, 'website_seo.sitemapEntries', { siteId: 'site1' })) as Array<{
    path: string
  }>
  assert.deepEqual(
    entries.map((e) => e.path),
    ['/gioi-thieu'],
    'a reserved namespace is never advertised',
  )
})

test('seo: a sitemap never crosses into another site', async () => {
  const { db } = await boot()
  await seedSite(db)
  await call(db, 'website.saveSite', {
    id: 'site2',
    name: 'an-nhien',
    title: 'An Nhiên',
    defaultLocale: 'vi',
    theme: 'theme_paper',
  })
  await call(db, 'website.saveEntry', {
    id: 'e9',
    siteId: 'site2',
    type: 'website.page',
    slug: 'khac',
    path: '/khac',
    title: 'Khác',
    layout,
  })
  await call(db, 'website.publishEntry', { id: 'e9' })

  const entries = (await call(db, 'website_seo.sitemapEntries', { siteId: 'site1' })) as Array<{
    path: string
  }>
  assert.deepEqual(
    entries.map((e) => e.path),
    ['/gioi-thieu'],
  )
})
