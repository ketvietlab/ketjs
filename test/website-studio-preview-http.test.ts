import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { bootWebsiteStudio } from './fixtures/website-studio.ts'

test('Studio preview links pin a revision, honour their audience and can be taken back one at a time', async (t) => {
  const { app, fixture } = await bootWebsiteStudio()
  t.after(() => app.close())
  await fixture('website.saveDomain', {
    id: 'preview-domain',
    siteId: 'site-a',
    host: '127.0.0.1',
    primary: true,
  })
  await fixture('website.saveStudioStyle', {
    siteId: 'site-a',
    expectedRevisionId: 'initial',
    values: { preset: 'cosmetics', footer: 'Chân trang xem trước' },
  })
  const login = async (name: string) => {
    const client = app.client.anonymous()
    await client.login({ login: `studio-${name}`, password: 'studio-local' })
    return client
  }
  const editor = await login('editor')
  const reader = await login('reader')
  const send = async (client: typeof editor, fn: string, input: Row) => {
    const response = await client.post('/website/api/' + fn, JSON.stringify(input), {
      headers: { 'content-type': 'application/json' },
    })
    return { status: response.status, ...((await response.json()) as { value: Row; code?: string }) }
  }
  const call = async (fn: string, input: Row, client = editor) => {
    const r = await send(client, fn, input)
    assert.equal(r.status, 200, JSON.stringify(r))
    return r.value
  }
  const id = 'page-site-a'
  const shared = (await call('website.getEntry', { id })).entry as Row
  const sharedRevision = shared.revisionId
  const draft = await call('website.saveEntry', {
    ...shared,
    title: 'Bản nháp chưa hỏi ý kiến',
    expectedRevisionId: sharedRevision,
  })
  assert.notEqual(draft.revisionId, sharedRevision)
  const create = (audience: string, minutes: number, client = editor) =>
    send(client, 'website_studio.createPreview', {
      siteId: 'site-a',
      id,
      revisionId: sharedRevision,
      audience,
      minutes,
    })
  const studioPreview = (token: string, client = editor) =>
    send(client, 'website_studio.preview', { siteId: 'site-a', id, token })
  const publicPreview = async (token: string, client = app.client.anonymous()) => {
    const response = await client.get(`/_ket/preview?token=${encodeURIComponent(token)}`)
    return { response, body: (await response.text()).replace(/<!--.*?-->/g, '') }
  }

  assert.equal((await create('link', 4)).status, 400, 'shorter than five minutes is refused')
  assert.equal((await create('link', 1441)).status, 400, 'longer than a day is refused')
  assert.equal((await create('everyone', 30)).status, 400, 'only staff or link')
  assert.equal((await create('link', 30, reader)).status, 403, 'a reader cannot share a draft')

  const link = (await create('link', 1440)).value
  const lifetime = Date.parse(String(link.expiresAt)) - Date.now()
  assert.ok(lifetime > 23 * 3600_000 && lifetime <= 24 * 3600_000, 'a day-long link lives a day')
  const opened = await call('website_studio.preview', { siteId: 'site-a', id, token: link.token })
  assert.equal(
    (opened.entry as Row).revisionId,
    sharedRevision,
    'the link shows the revision it was made for',
  )
  assert.equal((opened.preview as Row).audience, 'link')
  // Where the ERP and the site share a host, the address keeps the port the Studio was opened on.
  const shareUrl = String((opened.preview as Row).url)
  assert.match(shareUrl, /^http:\/\/127\.0\.0\.1:\d+\/_ket\/preview\?token=/)
  assert.match(await (await fetch(shareUrl)).text(), /Trang site-a/, 'the address handed out opens the draft')
  const outside = await publicPreview(String(link.token))
  assert.equal(outside.response.status, 200)
  assert.equal(outside.response.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive')
  assert.match(outside.body, /Trang site-a/)
  assert.match(
    outside.body,
    /data-theme-preset="cosmetics"/,
    'the draft wears the site style it would publish with',
  )
  assert.match(outside.body, /Chân trang xem trước/)
  assert.doesNotMatch(
    outside.body,
    /Bản nháp chưa hỏi ý kiến/,
    'a later draft does not leak through an older link',
  )

  const staff = (await create('staff', 30)).value
  assert.equal(
    (
      (await call('website_studio.preview', { siteId: 'site-a', id, token: staff.token }, reader))
        .preview as Row
    ).url,
    null,
  )
  assert.doesNotMatch(
    (await publicPreview(String(staff.token))).body,
    /Trang site-a/,
    'a staff link forwarded outside opens nothing',
  )
  assert.match((await publicPreview(String(staff.token), editor)).body, /Trang site-a/, 'staff still open it')

  assert.equal(
    (await send(editor, 'website_studio.revokePreview', { siteId: 'site-a2', token: link.token })).status,
    404,
    'a link is revoked only through its own site',
  )
  assert.deepEqual(await call('website_studio.revokePreview', { siteId: 'site-a', token: link.token }), {
    revoked: true,
  })
  const revoked = await publicPreview(String(link.token))
  assert.doesNotMatch(revoked.body, /Trang site-a/, 'revoked means closed')
  assert.equal(revoked.response.status, 404, 'a closed link is not a page')
  assert.equal(revoked.response.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive')
  assert.equal((await app.client.anonymous().get('/khong-co-trang')).status, 404)
  const closed = await studioPreview(String(link.token))
  assert.equal(closed.code, 'expired')
  assert.equal((await studioPreview(String(staff.token))).status, 200, 'revoking one link leaves the others')
  await app.fixture.withTenant('', ({ adapter }) =>
    adapter.run(
      `UPDATE website_preview_token SET "expiresAt" = '2000-01-01T00:00:00Z' WHERE "revokedAt" IS NULL`,
    ),
  )
  assert.equal((await studioPreview(String(staff.token))).code, 'expired', 'a link lapses on its own')
  assert.equal((await publicPreview(String(staff.token), editor)).response.status, 404)

  await fixture('website.saveDomain', {
    id: 'other-domain',
    siteId: 'site-a2',
    host: 'shop.example.test',
    primary: true,
  })
  const elsewhere = (
    await send(editor, 'website_studio.createPreview', {
      siteId: 'site-a2',
      id: 'page-site-a2',
      audience: 'link',
      minutes: 30,
    })
  ).value
  const away = await call('website_studio.preview', {
    siteId: 'site-a2',
    id: 'page-site-a2',
    token: elsewhere.token,
  })
  assert.equal(
    (away.preview as Row).url,
    `http://shop.example.test/_ket/preview?token=${encodeURIComponent(String(elsewhere.token))}`,
    'outsiders get the site address, not the ERP one',
  )
})
