import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bootWebsiteStudio } from './fixtures/website-studio.ts'

test('public Studio delivery uses the published style, native menu and server-rendered LiveDoc', async (t) => {
  const { app, fixture } = await bootWebsiteStudio(undefined, { worker: true })
  t.after(() => app.close())
  await fixture('website.saveDomain', {
    id: 'public-domain',
    siteId: 'site-a',
    host: '127.0.0.1',
    primary: true,
  })
  await fixture('website_menu.addMenuItem', {
    id: 'home',
    siteId: 'site-a',
    label: 'Trang chủ',
    href: '/',
    position: 0,
  })
  await fixture('website_menu.addMenuItem', {
    id: 'child',
    siteId: 'site-a',
    label: 'Bài viết',
    href: '/post',
    parentId: 'home',
    position: 1,
  })
  const style = await fixture('website.saveStudioStyle', {
    siteId: 'site-a',
    expectedRevisionId: 'initial',
    values: { preset: 'hotel', footer: 'Published footer' },
  })
  const saved = await fixture('website.saveEntry', {
    id: 'public-post',
    siteId: 'site-a',
    type: 'website.post',
    slug: 'post',
    path: '/post',
    title: 'Bài viết thử',
    fields: {
      bodyDoc: JSON.stringify([
        { type: 'p', delta: [{ insert: 'Nội dung public <script>not code</script>' }] },
      ]),
    },
    layout: [],
  })
  await fixture('website.publishEntry', { id: 'public-post', expectedRevisionId: saved.revisionId })
  const anonymous = app.client.anonymous()
  const response = await anonymous.get('/post')
  assert.equal(response.status, 200)
  const first = (await response.text()).replace(/<!--.*?-->/g, '')
  assert.match(first, /data-theme-preset="hotel"/)
  assert.match(first, /Published footer/)
  assert.match(first, /Nội dung public &lt;script&gt;not code&lt;\/script&gt;/)
  assert.match(first, /href="\/post"[^>]*>Bài viết/)
  assert.doesNotMatch(first, /<script>not code/)
  assert.match(first, /public\.css/)
  assert.equal((await anonymous.get('/_ket/asset/website_backend/public.css')).status, 200)
  const changed = await fixture('website.saveStudioStyle', {
    siteId: 'site-a',
    expectedRevisionId: style.revisionId,
    values: { preset: 'default', footer: 'Scheduled footer' },
  })
  assert.match(await (await anonymous.get('/post')).text(), /Published footer/)
  await fixture('website.publishEntry', {
    id: 'public-post',
    expectedRevisionId: saved.revisionId,
    publishAt: new Date(Date.now() + 3600000).toISOString(),
  })
  await fixture('website.saveStudioStyle', {
    siteId: 'site-a',
    expectedRevisionId: changed.revisionId,
    values: { footer: 'Private later footer' },
  })
  await app.fixture.withTenant('', async ({ adapter }) => {
    await adapter.run(
      `UPDATE website_entry SET "publishAt" = '2000-01-01T00:00:00Z' WHERE id = 'public-post'`,
    )
    await adapter.run(
      `UPDATE ket_job SET scheduled_at = '2000-01-01T00:00:00Z' WHERE job = 'website.publishScheduled' AND state IN ('scheduled', 'available', 'retryable')`,
    )
  })
  await app.drainJobs()
  const delivered = await (await anonymous.get('/post')).text()
  assert.match(delivered, /Scheduled footer/)
  assert.match(delivered, /data-theme-preset="default"/)
  assert.doesNotMatch(delivered, /Private later footer/)
  await fixture(
    'website.saveDomain',
    { id: 'ambiguous', siteId: 'site-b', host: '127.0.0.1', primary: true },
    'studio-b',
  )
  assert.doesNotMatch(await (await anonymous.get('/post')).text(), /Scheduled footer|Nội dung public/)
})
