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
import {
  address,
  paperTheme,
  partner,
  website,
  websiteBackend,
  websiteForm,
  websiteMenu,
  websiteSeo,
} from 'ketsuite'
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
const modules = [address, partner, website, websiteMenu, websiteSeo, websiteForm, paperTheme, altTheme]
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
const callAs = async (db: Adapter, actor: string, name: string, input: Record<string, unknown>) =>
  (await callFn(name, input, { adapter: db, manifest, scope: SCOPE, actor })).value

const layout = [{ type: 'website.rich_text', settings: { heading: 'About', body: 'Independent content.' } }]
const dateAfter = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)

test('cms: content types and taxonomies compose into a discoverable registry', () => {
  assert.deepEqual(Object.keys(manifest.contentTypes).sort(), ['website.page', 'website.post'])
  assert.deepEqual(manifest.contentTypes['website.post']?.taxonomies, ['website.category', 'website.tag'])
  assert.deepEqual(manifest.taxonomies['website.category']?.contentTypes, ['website.post'])
})

test('website backend: owns a primary application menu instead of hiding under administration', () => {
  assert.deepEqual(websiteBackend.menus?.website, {
    label: 'menu.app',
    icon: 'globe',
    sequence: 18,
  })
  assert.equal(websiteBackend.menus?.['website.content']?.parent, 'website')
  assert.equal(websiteBackend.menus?.['website.configuration']?.parent, 'website')
  assert.equal(websiteBackend.menus?.['website.sites']?.parent, 'website.configuration')
  assert.equal('admin.website' in (websiteBackend.menus ?? {}), false)
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
  assert.equal(await call(db, 'website.resolveSite', { host: 'unknown.example.test' }), null)
  await db.close()
})

test('customer auth: site realm, account and session stay separate from backend users', async () => {
  const { db } = await boot()
  await call(db, 'website.saveSite', {
    id: 'headless-site',
    name: 'Headless',
    title: 'Headless Store',
    defaultLocale: 'en',
    theme: 'theme_paper',
  })
  const realm = (await call(db, 'website.customerRealmForSite', { siteId: 'headless-site' })) as {
    id: string
  }
  assert.equal(realm.id, 'site:acme:headless-site')

  const registered = (await call(db, 'website.registerCustomer', {
    realmId: realm.id,
    displayName: 'Lan Anh',
    email: ' Lan.Anh@Example.Test ',
    password: 'correct-horse-battery-staple',
    rateKey: 'unit-register',
  })) as { ok: boolean; account: { id: string; partnerId: string; email: string } }
  assert.equal(registered.ok, true)
  assert.equal(registered.account.email, 'lan.anh@example.test')
  assert.match(registered.account.partnerId, /:partner$/)

  const rejected = (await call(db, 'website.authenticateCustomer', {
    realmId: realm.id,
    email: registered.account.email,
    password: 'wrong-password',
    rateKey: 'unit-login-wrong',
  })) as { ok: boolean }
  assert.equal(rejected.ok, false)
  const authenticated = (await call(db, 'website.authenticateCustomer', {
    realmId: realm.id,
    email: registered.account.email,
    password: 'correct-horse-battery-staple',
    rateKey: 'unit-login-good',
  })) as { ok: boolean; account: { id: string } }
  assert.equal(authenticated.ok, true)

  const session = (await call(db, 'website.startCustomerSession', {
    id: 'customer-session',
    accountId: authenticated.account.id,
    tokenDigest: 'opaque-token-digest',
  })) as { accountId: string }
  assert.equal(session.accountId, registered.account.id)
  const resolved = (await call(db, 'website.resolveCustomerSession', {
    siteId: 'headless-site',
    tokenDigest: 'opaque-token-digest',
  })) as { accountId: string }
  assert.equal(resolved.accountId, registered.account.id)
  await db.close()
})

test('cms hardening: site membership filters reads and blocks cross-tenant ownership changes', async () => {
  const { db } = await boot()
  for (const id of ['alpha', 'beta'])
    await call(db, 'website.saveSite', {
      id,
      name: id,
      title: id.toUpperCase(),
      defaultLocale: 'en',
      theme: 'theme_paper',
    })
  await call(db, 'website.saveSiteMember', {
    id: 'alpha:alice',
    siteId: 'alpha',
    userId: 'alice',
    role: 'administrator',
  })
  await call(db, 'website.saveSiteMember', {
    id: 'beta:bob',
    siteId: 'beta',
    userId: 'bob',
    role: 'editor',
  })
  assert.deepEqual(
    ((await callAs(db, 'alice', 'website.listSites', {})) as Array<{ id: string }>).map((site) => site.id),
    ['alpha'],
  )
  assert.equal(
    ((await callAs(db, 'alice', 'website.listSiteMembers', { siteId: 'alpha' })) as unknown[]).length,
    1,
  )
  assert.deepEqual(await callAs(db, 'bob', 'website.listSiteMembers', { siteId: 'alpha' }), [])
  const lastAdmin = (await callAs(db, 'alice', 'website.removeSiteMember', {
    id: 'alpha:alice',
  })) as { ok: boolean; errors: Array<{ message: string }> }
  assert.equal(lastAdmin.ok, false)
  assert.equal(lastAdmin.errors[0]?.message, 'website.error.lastAdministrator')
  const created = (await callAs(db, 'alice', 'website.saveEntry', {
    id: 'alpha-page',
    siteId: 'alpha',
    type: 'website.page',
    slug: 'alpha-page',
    path: '/alpha-page',
    title: 'Alpha page',
    layout,
    fields: {},
  })) as { ok: boolean }
  assert.equal(created.ok, true)
  assert.equal(await callAs(db, 'bob', 'website.getEntry', { id: 'alpha-page' }), null)
  const moved = (await callAs(db, 'alice', 'website.saveEntry', {
    id: 'alpha-page',
    siteId: 'beta',
    type: 'website.page',
    slug: 'alpha-page',
    path: '/alpha-page',
    title: 'Moved',
    layout,
    fields: {},
  })) as { ok: boolean; errors: Array<{ message: string }> }
  assert.equal(moved.ok, false)
  assert.equal(moved.errors[0]?.message, 'website.error.immutableOwnership')
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

test('cms hardening: optimistic saves, pinned schedules and one-time previews reject replay', async () => {
  const { db } = await boot()
  await call(db, 'website.saveSite', {
    id: 'site',
    name: 'Main',
    title: 'Main site',
    defaultLocale: 'en',
    theme: 'theme_paper',
  })
  const first = (await call(db, 'website.saveEntry', {
    id: 'news',
    siteId: 'site',
    type: 'website.post',
    slug: 'news',
    path: '/blog/news',
    title: 'First',
    layout,
    fields: {},
  })) as { revisionId: string }
  await call(db, 'website.publishEntry', { id: 'news', expectedRevisionId: first.revisionId })
  const second = (await call(db, 'website.saveEntry', {
    id: 'news',
    siteId: 'site',
    type: 'website.post',
    slug: 'news',
    path: '/blog/news',
    title: 'Second',
    layout,
    fields: {},
    expectedRevisionId: first.revisionId,
  })) as { revisionId: string }
  const stale = (await call(db, 'website.saveEntry', {
    id: 'news',
    siteId: 'site',
    type: 'website.post',
    slug: 'news',
    path: '/blog/news',
    title: 'Stale writer',
    layout,
    fields: {},
    expectedRevisionId: first.revisionId,
  })) as { ok: boolean; errors: Array<{ message: string }> }
  assert.equal(stale.ok, false)
  assert.equal(stale.errors[0]?.message, 'website.error.editConflict')

  await call(db, 'website.publishEntry', {
    id: 'news',
    expectedRevisionId: second.revisionId,
    publishAt: new Date(Date.now() + 60_000).toISOString(),
  })
  const third = (await call(db, 'website.saveEntry', {
    id: 'news',
    siteId: 'site',
    type: 'website.post',
    slug: 'news',
    path: '/blog/news',
    title: 'Third after schedule',
    layout,
    fields: {},
    expectedRevisionId: second.revisionId,
  })) as { revisionId: string }
  const row = (await db.all('SELECT * FROM website_entry WHERE id = ?', ['news']))[0] as {
    scheduledRevisionId: string
  }
  assert.equal(row.scheduledRevisionId, second.revisionId)
  assert.notEqual(row.scheduledRevisionId, third.revisionId)
  assert.equal(
    (
      (await call(db, 'website.getEntryByPath', { siteId: 'site', path: '/blog/news' })) as {
        title: string
      }
    ).title,
    'First',
  )
  assert.deepEqual(await call(db, 'website.searchPublished', { siteId: 'site', q: 'Third' }), [])
  assert.equal(
    (
      (await call(db, 'website.searchPublished', { siteId: 'site', q: 'First' })) as Array<{
        title: string
      }>
    )[0]?.title,
    'First',
  )

  const preview = (await call(db, 'website.createPreviewToken', {
    entryId: 'news',
    oneTime: true,
  })) as { token: string }
  assert.ok(await call(db, 'website.previewEntry', { token: preview.token }))
  assert.equal(await call(db, 'website.previewEntry', { token: preview.token }), null)
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
    assert.equal(result.ok, true)
    assert.equal(result.message, 'Thank you')
  }
  const limited = (await call(db, 'website_form.submitForm', {
    formId: 'contact',
    payload: { email: 'last@example.test' },
    rateKey: 'browser-a',
  })) as { ok: boolean; errors: Array<{ message: string }> }
  assert.equal(limited.ok, false)
  assert.equal(limited.errors[0]?.message, 'website_form.error.rateLimit')
  const replayArgs = {
    formId: 'contact',
    payload: { email: 'once@example.test' },
    rateKey: 'browser-b',
    submissionKey: 'contact-once',
  }
  const once = (await call(db, 'website_form.submitForm', replayArgs)) as { id: string }
  const replay = (await call(db, 'website_form.submitForm', replayArgs)) as { id: string }
  assert.equal(replay.id, once.id)
  assert.equal(
    ((await call(db, 'website_form.listSubmissions', { formId: 'contact' })) as unknown[]).length,
    6,
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
    checkIn: dateAfter(10),
    checkOut: dateAfter(12),
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
  await fullCall('website_retail.saveCatalogItem', {
    id: 'retail:canvas-bag-natural',
    siteId: 'retail',
    productId: 'canvas-bag-natural',
    active: true,
    position: 10,
  })
  const catalog = (await fullCall('website_retail.listCatalog', { siteId: 'retail' })) as Array<{
    id: string
  }>
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
  await Promise.all([
    fullCall('website_retail.addCartLine', {
      token: cart.token,
      productId: 'canvas-bag-natural',
      quantity: '0.1',
    }),
    fullCall('website_retail.addCartLine', {
      token: cart.token,
      productId: 'canvas-bag-natural',
      quantity: '0.1',
    }),
  ])
  assert.equal(
    ((await fullCall('website_retail.getCart', { token: cart.token })) as { total: string }).total,
    '550000',
  )
  const checkout = (await fullCall('website_retail.checkoutCart', {
    token: cart.token,
    customerName: 'Alex',
    customerEmail: 'alex@example.test',
  })) as { ok: boolean; id: string }
  assert.deepEqual(checkout, { ok: true, id: cart.id })
  assert.deepEqual(
    await fullCall('website_retail.checkoutCart', {
      token: cart.token,
      customerName: 'Alex',
      customerEmail: 'alex@example.test',
    }),
    { ok: true, id: cart.id },
  )
  await db.close()
})
