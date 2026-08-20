import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  callFn,
  compose,
  createTheme,
  defineTheme,
  migrateOne,
  registerFunctions,
  sqliteAdapter,
} from 'ketjs'
import type { Adapter, Manifest } from 'ketjs'
import { paperTheme, website, websiteForm, websiteMenu, websiteSeo } from 'ketsuite'
import { ketsuite } from '../apps/ketsuite/app.ts'

const SCOPE = { company: 'acme', branches: null }
const altTheme = defineTheme({
  name: 'theme_alt_test',
  depends: ['website'],
  templates: {
    layout: '<html><body>{% region "website.page" %}</body></html>',
    'website.page': '<article class="alt">{% sections %}</article>',
    'website.hero': '<h1>{{ heading }}</h1>',
    'website.rich_text': '<div>{{ body }}</div>',
  },
})
const modules = [website, websiteMenu, websiteSeo, websiteForm, paperTheme, altTheme]
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

const layout = [{ type: 'website.rich_text', settings: { heading: 'About', body: 'Independent content.' } }]

test('cms: content types and taxonomies compose into a discoverable registry', () => {
  assert.deepEqual(Object.keys(manifest.contentTypes).sort(), ['website.page', 'website.post'])
  assert.deepEqual(manifest.contentTypes['website.post']?.taxonomies, ['website.category', 'website.tag'])
  assert.deepEqual(manifest.taxonomies['website.category']?.contentTypes, ['website.post'])
})

test('cms: domains resolve isolated sites with their locale and selected KTL theme', async () => {
  const { db } = await boot()
  await call(db, 'website.saveSite', {
    id: 'vi-site',
    name: 'Vietnam',
    title: 'Khách sạn Mây',
    defaultLocale: 'vi',
    theme: 'theme_paper',
  })
  await call(db, 'website.saveSite', {
    id: 'en-site',
    name: 'English',
    title: 'Cloud Hotel',
    defaultLocale: 'en',
    theme: 'theme_alt_test',
  })
  await call(db, 'website.saveDomain', {
    id: 'en-domain',
    siteId: 'en-site',
    host: 'EN.Example.test.',
    primary: true,
  })

  assert.deepEqual(await call(db, 'website.resolveSite', { host: 'en.example.test' }), {
    id: 'en-site',
    title: 'Cloud Hotel',
    locale: 'en',
    theme: 'theme_alt_test',
    tokens: null,
  })
  await db.close()
})

test('cms: saves immutable revisions and publishes a stable revision per site', async () => {
  const { db } = await boot()
  await call(db, 'website.saveSite', {
    id: 'site',
    name: 'Main',
    title: 'Main site',
    defaultLocale: 'vi',
    theme: 'theme_paper',
  })
  const first = (await call(db, 'website.saveEntry', {
    id: 'about',
    siteId: 'site',
    type: 'website.page',
    slug: 'about',
    path: '/about',
    title: 'About v1',
    layout,
    fields: {},
  })) as { ok: boolean; revisionId: string; version: number }
  assert.equal(first.version, 1)
  await call(db, 'website.publishEntry', { id: 'about' })

  const second = (await call(db, 'website.saveEntry', {
    id: 'about',
    siteId: 'site',
    type: 'website.page',
    slug: 'about',
    path: '/about',
    title: 'About v2 draft',
    layout,
    fields: {},
  })) as { revisionId: string; version: number }
  assert.equal(second.version, 2)
  assert.notEqual(second.revisionId, first.revisionId)

  const live = (await call(db, 'website.getEntryByPath', { siteId: 'site', path: '/about' })) as {
    title: string
  }
  assert.equal(live.title, 'About v1', 'a later draft does not move the published revision')
  assert.equal(((await call(db, 'website.listRevisions', { entryId: 'about' })) as unknown[]).length, 2)

  const preview = (await call(db, 'website.createPreviewToken', { entryId: 'about' })) as { token: string }
  const held = (await call(db, 'website.previewEntry', { token: preview.token })) as {
    revision: { title: string }
  }
  assert.equal(held.revision.title, 'About v2 draft')
  await db.close()
})

test('cms: forms validate schema, store consent and rate-limit anonymous submissions', async () => {
  const { db } = await boot()
  await call(db, 'website.saveSite', {
    id: 'site',
    name: 'Main',
    title: 'Main site',
    defaultLocale: 'vi',
    theme: 'theme_paper',
  })
  await call(db, 'website_form.saveForm', {
    id: 'contact',
    siteId: 'site',
    name: 'Contact',
    schema: { fields: [{ name: 'email', type: 'email', required: true }] },
    successMessage: 'Thank you',
  })
  const bad = (await call(db, 'website_form.submitForm', {
    formId: 'contact',
    payload: { email: 'not-an-email' },
    rateKey: 'browser-a',
  })) as { ok: boolean }
  assert.equal(bad.ok, false)

  for (let index = 0; index < 5; index += 1) {
    const result = (await call(db, 'website_form.submitForm', {
      formId: 'contact',
      payload: { email: `guest${index}@example.test` },
      consent: true,
      rateKey: 'browser-a',
    })) as { ok: boolean; message: string }
    assert.deepEqual(result, { ok: true, message: 'Thank you' })
  }
  const limited = (await call(db, 'website_form.submitForm', {
    formId: 'contact',
    payload: { email: 'last@example.test' },
    rateKey: 'browser-a',
  })) as { ok: boolean; errors: Array<{ message: string }> }
  assert.equal(limited.ok, false)
  assert.equal(limited.errors[0]?.message, 'rate limit exceeded')
  assert.equal(
    ((await call(db, 'website_form.listSubmissions', { formId: 'contact' })) as unknown[]).length,
    5,
  )
  await db.close()
})

test('cms: the renderer selects one theme without mixing templates from the others', () => {
  const paper = createTheme(manifest, modules, { theme: 'theme_paper' }).renderRegion('website.page', {
    page: { path: '/' },
    sections: layout,
  })
  const alt = createTheme(manifest, modules, { theme: 'theme_alt_test' }).renderRegion('website.page', {
    page: { path: '/' },
    sections: layout,
  })
  assert.match(paper, /data-ket-section="page"/)
  assert.doesNotMatch(paper, /class="alt"/)
  assert.match(alt, /class="alt"/)
})

test('verticals: hospitality captures booking leads and retail converts a catalog item into checkout', async () => {
  const fullModules = [
    ...ketsuite.modules,
    ...(ketsuite.theme ? [ketsuite.theme] : []),
    ...(ketsuite.themes ?? []),
  ]
  const fullManifest = compose(fullModules)
  const db = sqliteAdapter()
  await db.open()
  await migrateOne(db, fullManifest)
  registerFunctions(fullModules)
  const fullCall = async (name: string, input: Record<string, unknown>) =>
    (await callFn(name, input, { adapter: db, manifest: fullManifest, scope: SCOPE })).value

  await fullCall('website.saveSite', {
    id: 'hospitality',
    name: 'Hospitality',
    title: 'Mây Retreat',
    defaultLocale: 'vi',
    theme: 'theme_hospitality',
  })
  const lead = (await fullCall('website_hospitality.requestBooking', {
    siteId: 'hospitality',
    guestName: 'Minh Anh',
    email: 'minhanh@example.test',
    checkIn: '2026-09-10',
    checkOut: '2026-09-12',
    adults: 2,
  })) as { ok: boolean; id: string }
  assert.equal(lead.ok, true)
  assert.equal(
    ((await fullCall('website_hospitality.listBookingLeads', { siteId: 'hospitality' })) as unknown[]).length,
    1,
  )

  await fullCall('website.saveSite', {
    id: 'retail',
    name: 'Retail',
    title: 'Kết Goods',
    defaultLocale: 'en',
    theme: 'theme_retail',
  })
  await fullCall('uom.saveUnit', {
    id: 'unit',
    name: 'Unit',
    relativeFactor: '1',
    sequence: 10,
    active: true,
  })
  await fullCall('product.saveTemplate', {
    id: 'canvas-bag',
    name: 'Canvas bag',
    type: 'goods',
    uomId: 'unit',
    listPrice: '250000',
    saleOk: true,
    purchaseOk: true,
  })
  await fullCall('product.saveVariant', {
    id: 'canvas-bag-natural',
    templateId: 'canvas-bag',
    defaultCode: 'BAG-NATURAL',
  })
  const catalog = (await fullCall('website_retail.listCatalog', {})) as Array<{ id: string }>
  assert.deepEqual(
    catalog.map((item) => item.id),
    ['canvas-bag-natural'],
  )
  const cart = (await fullCall('website_retail.createCart', { siteId: 'retail', currency: 'VND' })) as {
    id: string
    token: string
  }
  await fullCall('website_retail.addCartLine', {
    token: cart.token,
    productId: 'canvas-bag-natural',
    quantity: '2',
  })
  const held = (await fullCall('website_retail.getCart', { token: cart.token })) as {
    lines: unknown[]
    total: string
  }
  assert.equal(held.lines.length, 1)
  assert.equal(held.total, '500000')
  const checkout = (await fullCall('website_retail.checkoutCart', {
    token: cart.token,
    customerName: 'Alex',
    customerEmail: 'alex@example.test',
  })) as { ok: boolean; id: string }
  assert.deepEqual(checkout, { ok: true, id: cart.id })
  await db.close()
})
