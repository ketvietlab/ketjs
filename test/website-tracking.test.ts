import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { bootWebsiteStudio } from './fixtures/website-studio.ts'

test('commerce site tracking is live configuration, validated and absent in staff/preview', async (t) => {
  const { app, fixture } = await bootWebsiteStudio(undefined, { deployment: 'commerce' })
  t.after(() => app.close())
  await fixture('website.saveDomain', {
    id: 'tracking-domain',
    siteId: 'site-a',
    host: '127.0.0.1',
    primary: true,
  })
  await fixture('website.saveStudioStyle', {
    siteId: 'site-a',
    expectedRevisionId: 'initial',
    values: { preset: 'retail' },
  })
  const entry = (await fixture('website.getEntry', { id: 'page-site-a' })).entry as Row
  await fixture('website.publishEntry', { id: entry.id, expectedRevisionId: entry.revisionId })
  const before = (await fixture('website.getEntry', { id: entry.id })).entry as Row
  assert.ok(before.publishedRevisionId)
  const visitor = app.client.anonymous()
  assert.doesNotMatch(await (await visitor.get('/')).text(), /data-website-gtm/)
  const designer = app.client.anonymous()
  await designer.login({ login: 'studio-designer', password: 'studio-local' })
  const send = async (fn: string, input: Row) => {
    const response = await designer.post('/website/api/' + fn, JSON.stringify(input), {
      headers: { 'content-type': 'application/json' },
    })
    return { status: response.status, ...((await response.json()) as { value: Row }) }
  }
  const readiness = (await send('website_studio.siteReadiness', { siteId: 'site-a' })).value
  const site = readiness.site as Row
  const changed = await send('website_studio.saveResource', {
    siteId: site.id,
    kind: 'sites',
    id: site.id,
    expectedRevisionId: site.revisionId,
    values: { googleTagManagerId: 'GTM-WN52Z58' },
  })
  assert.equal(changed.status, 200, JSON.stringify(changed))
  assert.equal(changed.value.googleTagManagerId, 'GTM-WN52Z58')
  const page = await visitor.get('/')
  assert.equal(page.status, 200)
  assert.match(await page.text(), /data-website-gtm="GTM-WN52Z58"/)
  assert.match(
    page.headers.get('content-security-policy')!,
    /script-src 'self' 'unsafe-eval' https:\/\/www\.googletagmanager\.com/,
  )
  assert.doesNotMatch(
    page.headers
      .get('content-security-policy')!
      .split(';')
      .find((d: string) => d.includes('script-src'))!,
    /unsafe-inline/,
  )
  assert.equal((await visitor.get('/_ket/asset/website_backend/gtm.mjs')).status, 200)
  assert.doesNotMatch(await (await designer.get('/')).text(), /data-website-gtm/)
  const preview = await send('website_studio.createPreview', {
    siteId: 'site-a',
    id: entry.id,
    revisionId: entry.revisionId,
    audience: 'link',
    minutes: 30,
  })
  assert.equal(preview.status, 200, JSON.stringify(preview))
  const previewPage = await visitor.get(
    '/_ket/preview?token=' + encodeURIComponent(String(preview.value.token)),
  )
  assert.equal(previewPage.status, 200)
  assert.doesNotMatch(await previewPage.text(), /data-website-gtm/)
  assert.doesNotMatch(
    previewPage.headers.get('content-security-policy') ?? '',
    /unsafe-eval|googletagmanager/,
  )
  const args = { id: 'site-a', name: 'site-a', title: 'site-a', defaultLocale: 'vi', theme: 'theme_paper' }
  const invalid = await app.fixture.call<Row>(
    'website.saveSite',
    { ...args, googleTagManagerId: 'https://bad.test/' },
    { scope: { company: 'studio-a', branches: null } },
  )
  assert.equal(invalid.value.ok, false)
  await fixture('website.saveSite', args)
  assert.equal(
    (await fixture('website.resolveSite', { host: '127.0.0.1' })).googleTagManagerId,
    'GTM-WN52Z58',
  )
  const after = (await fixture('website.getEntry', { id: entry.id })).entry as Row
  assert.equal(after.publishedRevisionId, before.publishedRevisionId)
  await fixture('website.saveSite', { ...args, googleTagManagerId: '' })
  const cleared = await visitor.get('/')
  assert.doesNotMatch(await cleared.text(), /data-website-gtm/)
  assert.doesNotMatch(cleared.headers.get('content-security-policy') ?? '', /unsafe-eval|googletagmanager/)
})
