import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  callFn,
  compose,
  defineModule,
  defineTheme,
  migrateOne,
  registerFunctions,
  sqliteAdapter,
} from '@ketvietlab/ketjs'
import type { Adapter, Manifest, Placement } from '@ketvietlab/ketjs'
import { address, paperTheme, partner, website } from '@ketvietlab/ketsuite'

const SCOPE = { company: 'acme', branches: null }

/**
 * A module that provides one section, and a theme that draws it.
 *
 * Composing it in one manifest and leaving it out of another is how a
 * deployment dropping a module is reproduced: the database does not change,
 * because the module owns no models - only the registry of what can be drawn.
 */
const extra = defineModule({
  name: 'extra_sections',
  depends: ['website'],
  sections: { 'extra.banner': { title: 'Bang thong bao', settings: { text: 'text' } } },
})

const extraTheme = defineTheme({
  name: 'theme_extra_test',
  depends: ['website', 'extra_sections'],
  templates: {
    layout: '<html><body>{% region "website.page" %}</body></html>',
    'website.page': '<main>{% sections %}</main>',
    'website.hero': '<h1>{{ heading }}</h1>',
    'website.rich_text': '<p>{{ body }}</p>',
    'website.columns': '<div>{% slot "left" %}{% slot "right" %}</div>',
    'extra.banner': '<aside>{{ text }}</aside>',
  },
})

const withExtra = [address, partner, website, extra, extraTheme]
const withoutExtra = [address, partner, website, paperTheme]
const full: Manifest = compose(withExtra)
const reduced: Manifest = compose(withoutExtra)

const boot = async (): Promise<Adapter> => {
  const db = sqliteAdapter()
  await db.open()
  await migrateOne(db, full)
  registerFunctions(withExtra)
  registerFunctions(withoutExtra)
  return db
}

const on = (manifest: Manifest) => async (db: Adapter, name: string, input: Record<string, unknown>) =>
  (await callFn(name, input, { adapter: db, manifest, scope: SCOPE })).value

const before = on(full)
const after = on(reduced)

type Result = {
  ok?: boolean
  errors?: Array<{ field?: string; message: string }>
  unrenderable?: Array<{ entryId: string; path: string; errors: Array<{ message: string }> }>
  missingSections?: string[]
  checked?: number
}

const banner: Placement = { type: 'extra.banner', settings: { text: 'Chao' } }
const paragraph: Placement = { type: 'website.rich_text', settings: { body: 'Binh thuong' } }

const seed = async (db: Adapter, layout: Placement[] = [banner], id = 'p1', path = '/trang') => {
  await before(db, 'website.saveSite', {
    id: 'site1',
    name: 'moc',
    title: 'Moc',
    defaultLocale: 'vi',
    theme: 'theme_extra_test',
  })
  return (await before(db, 'website.saveEntry', {
    id,
    siteId: 'site1',
    type: 'website.page',
    slug: path.slice(1),
    path,
    title: 'Trang',
    layout,
    fields: {},
  })) as Result
}

test('preflight: a page the deployment can no longer draw is not published', async () => {
  const db = await boot()
  await seed(db)

  // The module is gone. The stored page still places its section.
  const refused = (await after(db, 'website.publishEntry', { id: 'p1' })) as Result
  assert.equal(refused.ok, false)
  assert.equal(refused.errors?.[0]?.message, 'website.error.entryUnrenderable')
  assert.match(
    String(refused.unrenderable?.[0]?.errors[0]?.message),
    /no composed module provides this section/u,
    'the refusal says which section, not just that something is wrong',
  )
  assert.equal(refused.unrenderable?.[0]?.path, '/trang')
})

test('preflight: the same page publishes fine while the module is composed', async () => {
  const db = await boot()
  await seed(db)
  const published = (await before(db, 'website.publishEntry', { id: 'p1' })) as Result
  assert.equal(published.ok, true, 'nothing is gated that was renderable all along')
})

test('preflight: a publication naming such a page is refused, and names it', async () => {
  const db = await boot()
  await seed(db)

  const refused = (await after(db, 'website.preparePublication', {
    id: 'pub1',
    siteId: 'site1',
    entryIds: ['p1'],
  })) as Result
  assert.equal(refused.ok, false)
  assert.equal(refused.errors?.[0]?.field, 'p1', 'a caller publishing twenty pages needs the one')
  assert.equal(refused.errors?.[0]?.message, 'website.error.publicationUnrenderable')
})

test('preflight: a module dropped between preparing and activating stops the activation', async () => {
  const db = await boot()
  await seed(db)
  const prepared = (await before(db, 'website.preparePublication', {
    id: 'pub1',
    siteId: 'site1',
    entryIds: ['p1'],
  })) as Result
  assert.equal(prepared.ok, true, 'preparing was fine: the module was still there')

  // The deploy happens here.
  const refused = (await after(db, 'website.activatePublication', { id: 'pub1' })) as Result
  assert.equal(refused.ok, false)
  assert.equal(refused.errors?.[0]?.message, 'website.error.publicationUnrenderable')
  assert.deepEqual(refused.missingSections, ['extra.banner'])
})

test('preflight: activation still works when nothing went missing', async () => {
  const db = await boot()
  await seed(db)
  await before(db, 'website.preparePublication', { id: 'pub1', siteId: 'site1', entryIds: ['p1'] })
  const activated = (await before(db, 'website.activatePublication', { id: 'pub1' })) as Result
  assert.equal(activated.ok, true)
})

test('preflight: the check can be run without publishing anything', async () => {
  const db = await boot()
  await seed(db)
  await seed(db, [paragraph], 'p2', '/on-dinh')

  const clean = (await before(db, 'website.preflightPublication', { siteId: 'site1' })) as Result
  assert.equal(clean.ok, true)
  assert.equal(clean.checked, 2)
  assert.deepEqual(clean.unrenderable, [])

  const broken = (await after(db, 'website.preflightPublication', { siteId: 'site1' })) as Result
  assert.equal(broken.ok, false)
  assert.equal(broken.checked, 2, 'both pages were looked at')
  assert.deepEqual(
    broken.unrenderable?.map((entry) => entry.entryId),
    ['p1'],
    'and only the one that breaks is reported',
  )
})

test('preflight: restoring an unrenderable revision is allowed, because that is how it gets fixed', async () => {
  const db = await boot()
  await seed(db)
  const revisions = (await before(db, 'website.listRevisions', { entryId: 'p1' })) as Array<{ id: string }>
  const original = revisions[0]?.id

  // Replace the page with something the reduced deployment can draw.
  await after(db, 'website.saveEntry', {
    id: 'p1',
    siteId: 'site1',
    type: 'website.page',
    slug: 'trang',
    path: '/trang',
    title: 'Trang',
    layout: [paragraph],
    fields: {},
  })

  // Getting the old content back is the only way to repair it. Refusing the
  // restore would trap the editor with a page they cannot recover and cannot
  // fix; a restore makes a draft, and the draft is not what a visitor reads.
  const restored = (await after(db, 'website.restoreRevision', {
    entryId: 'p1',
    revisionId: original,
  })) as Result
  assert.equal(restored.ok, true)

  // And it is still refused at the gate that matters.
  const refused = (await after(db, 'website.publishEntry', { id: 'p1' })) as Result
  assert.equal(refused.ok, false)
  assert.equal(refused.errors?.[0]?.message, 'website.error.entryUnrenderable')
})

test('preflight: an entry with no revision yet is not reported as broken', async () => {
  const db = await boot()
  await seed(db, [paragraph])
  const clean = (await after(db, 'website.preflightPublication', { siteId: 'site1' })) as Result
  assert.equal(clean.ok, true)
  assert.deepEqual(clean.unrenderable, [])
})

test('preflight: a scan that did not reach the whole site never answers "fine"', async () => {
  const db = await boot()
  await seed(db, [paragraph])

  // A thousand and one pages, written straight in: the point is the size of
  // the site, not the path that created it, and every one of them is clean.
  const now = new Date().toISOString()
  for (let n = 0; n < 1_001; n += 1)
    await db.run(
      `INSERT INTO website_entry
         ("companyId", "createdAt", "updatedAt", id, "siteId", type, slug, path, title, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['acme', now, now, `bulk-${n}`, 'site1', 'website.page', `b${n}`, `/b${n}`, `Trang ${n}`, 'draft'],
    )

  const answer = (await before(db, 'website.preflightPublication', { siteId: 'site1' })) as Result & {
    capped?: boolean
  }
  assert.equal(answer.capped, true, 'the site is larger than one scan')
  assert.deepEqual(answer.unrenderable, [], 'and nothing it reached was broken')
  assert.equal(
    answer.ok,
    false,
    'a partial scan cannot answer "is this site safe to publish" with yes, however clean the part it saw',
  )
})
