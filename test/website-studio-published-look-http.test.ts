import assert from 'node:assert/strict'
import { test } from 'node:test'
import { callFn, compose, migrateOne, registerFunctions, sqliteAdapter } from '@ketvietlab/ketjs'
import type { Row } from '@ketvietlab/ketjs'
import { address, paperTheme, partner, website } from '@ketvietlab/ketsuite'
import { bootWebsiteStudio } from './fixtures/website-studio.ts'

/**
 * `site-a` is seeded the way every site created before the Studio exists: a KTL theme and no
 * Studio style. Its pages are authored in the Builder, which draws them in the Studio defaults.
 */
test('Studio publishing: an unstyled site goes live as the Builder drew it, head tags by revision', async (t) => {
  const { app, fixture } = await bootWebsiteStudio()
  t.after(() => app.close())
  await fixture('website.saveDomain', {
    id: 'look-domain',
    siteId: 'site-a',
    host: '127.0.0.1',
    primary: true,
  })
  const publisher = app.client.anonymous()
  await publisher.login({ login: 'studio-publisher', password: 'studio-local' })
  const call = async (name: string, input: Row) => {
    const response = await publisher.post('/website/api/' + name, JSON.stringify(input), {
      headers: { 'content-type': 'application/json' },
    })
    const body = (await response.json()) as { value: Row }
    assert.equal(response.status, 200, JSON.stringify(body))
    return body.value
  }
  const id = 'page-site-a'
  const settings = async (seo: Row) => {
    const { entry } = (await call('website.getEntry', { id })) as { entry: Row }
    return call('website_studio.savePageSettings', {
      id,
      siteId: 'site-a',
      title: 'Trang chủ',
      path: '/',
      seo: { canonical: '', image: '', ...seo },
      expectedRevisionId: entry.revisionId,
    })
  }
  const publish = async () => {
    const { entry } = (await call('website.getEntry', { id })) as { entry: Row }
    await call('website.publishEntry', { id, expectedRevisionId: entry.revisionId })
  }
  const visitor = app.client.anonymous()
  const page = async () => {
    const response = await visitor.get('/')
    assert.equal(response.status, 200)
    return response.text()
  }

  await settings({ title: 'Mộc · Trà', description: 'Trà và gốm', indexing: 'index' })
  await publish()
  const first = await page()
  // The Studio presenter in its default style, not the paper theme the site was created with.
  assert.match(first, /class="wt-public"/)
  assert.match(first, /data-theme-preset="default"[^>]*data-accent="green"/)
  assert.match(first, /<title>Mộc · Trà<\/title>/)
  assert.match(first, /<meta name="description" content="Trà và gốm">/)
  assert.doesNotMatch(first, /name="robots"/)

  // A draft's head tags are the draft's: the visitor keeps the published ones.
  await settings({ title: 'Bản nháp', description: 'Chưa duyệt', indexing: 'noindex' })
  const unchanged = await page()
  assert.match(unchanged, /<title>Mộc · Trà<\/title>/)
  assert.doesNotMatch(unchanged, /Bản nháp|Chưa duyệt|name="robots"/)

  await publish()
  const second = await page()
  assert.match(second, /<title>Bản nháp<\/title>/)
  assert.match(second, /<meta name="robots" content="noindex">/)
})

test('Studio publishing: a storefront without the Studio keeps its theme for an unstyled site', async () => {
  const modules = [address, partner, website, paperTheme]
  const manifest = compose(modules)
  const db = sqliteAdapter()
  await db.open()
  await migrateOne(db, manifest)
  registerFunctions(modules)
  const call = async (name: string, input: Row) =>
    (await callFn(name, input, { adapter: db, manifest, scope: { company: 'acme', branches: null } }))
      .value as Row
  await call('website.saveSite', {
    id: 'site1',
    name: 'moc',
    title: 'Moc',
    defaultLocale: 'vi',
    theme: 'theme_paper',
    active: true,
  })
  const saved = await call('website.saveEntry', {
    id: 'p1',
    siteId: 'site1',
    type: 'website.page',
    slug: 'home',
    path: '/',
    title: 'Trang chủ',
    layout: [{ type: 'website.rich_text', settings: { body: 'x' } }],
  })
  await call('website.publishEntry', { id: 'p1', expectedRevisionId: saved.revisionId })
  const served = await call('website.getEntryByPath', { siteId: 'site1', path: '/' })
  assert.equal(served.appearance, null, 'no Builder drew this page, so its theme still does')
})
