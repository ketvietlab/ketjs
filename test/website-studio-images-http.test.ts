import assert from 'node:assert/strict'
import { test } from 'node:test'
import { storageFromConfig } from '@ketvietlab/ketjs'
import type { Row } from '@ketvietlab/ketjs'
import { bootWebsiteStudio } from './fixtures/website-studio.ts'
import sharp from 'sharp'

test('Studio images are private leases, claimed atomically and collected with retry and historical protection', async (t) => {
  let failRemoval = false
  const remaining = new Set<string>()
  const { app } = await bootWebsiteStudio(undefined, {
    worker: true,
    openStorage: async (config) => {
      const store = await storageFromConfig(config)
      return {
        ...store,
        put: async (key, body, meta) => {
          const result = await store.put(key, body, meta)
          remaining.add(key)
          return result
        },
        remove: async (key) => {
          if (failRemoval) throw new Error('simulated object store outage')
          await store.remove(key)
          assert.equal(await store.head(key), null)
          remaining.delete(key)
        },
      }
    },
  })
  t.after(() => app.close())
  const editor = app.client.anonymous()
  await editor.login({ login: 'studio-editor', password: 'studio-local' })
  const reader = app.client.anonymous()
  await reader.login({ login: 'studio-reader', password: 'studio-local' })
  const call = async (name: string, input: Row) => {
    const response = await editor.post('/website/api/' + name, JSON.stringify(input), {
      headers: { 'content-type': 'application/json' },
    })
    return { status: response.status, ...((await response.json()) as { value: Row }) }
  }
  const pixels = await sharp({ create: { width: 1600, height: 900, channels: 3, background: '#497b65' } })
    .png()
    .toBuffer()
  const form = (bytes = pixels) => {
    const data = new FormData()
    data.append('file', new Blob([new Uint8Array(bytes)], { type: 'image/png' }), 'landscape.png')
    data.append('public', 'true')
    return data
  }
  const upload = async () => {
    const response = await editor.post('/website/images/page-site-a/image?site=site-a', form())
    assert.equal(response.status, 201, await response.clone().text())
    return (await response.json()) as Row
  }
  assert.equal((await reader.post('/website/images/page-site-a/image?site=site-a', form())).status, 403)
  const foreign = await editor.post('/website/images/page-site-b/image?site=site-b', form())
  assert.equal(foreign.status, 404, await foreign.text())
  assert.equal(
    (
      await editor.post(
        '/website/images/page-site-a/image?site=site-a',
        form(Buffer.from('<script>x</script>')),
      )
    ).status,
    400,
  )
  const image = await upload(),
    abandoned = await upload(),
    rejected = await upload()
  assert.equal(image.public, false)
  assert.equal((await app.client.anonymous().get(String(image.url))).status, 404)
  assert.equal((await reader.get(String(image.url))).status, 404, 'pending is only visible to its uploader')
  assert.equal((await editor.get(String(image.url))).status, 200)
  const entry = (await call('website.getEntry', { id: 'page-site-a' })).value.entry as Row
  const saved = await call('website.saveEntry', {
    ...entry,
    layout: [{ id: 'image-first', type: 'website.image', settings: { image: image.url, alt: 'Ảnh thử' } }],
    expectedRevisionId: entry.revisionId,
  })
  assert.equal(saved.status, 200, JSON.stringify(saved))
  assert.equal((await reader.get(String(image.url))).status, 200)
  assert.equal(
    (await app.client.anonymous().get(String(image.url))).status,
    404,
    'saved draft is still private',
  )
  assert.equal(
    (
      await call('website.saveEntry', {
        ...entry,
        layout: [{ id: 'image-other', type: 'website.image', settings: { image: rejected.url, alt: 'CAS' } }],
        expectedRevisionId: entry.revisionId,
      })
    ).status,
    400,
  )
  assert.equal(
    (await call('website.saveEntry', { ...entry, layout: [], expectedRevisionId: saved.value.revisionId }))
      .status,
    200,
  )
  assert.equal(
    (
      await call('website.saveEntry', {
        id: 'other-page',
        siteId: 'site-a',
        type: 'page',
        title: 'Other',
        path: '/other',
        layout: [],
        expectedRevisionId: null,
      })
    ).status,
    200,
  )
  const other = (await call('website.getEntry', { id: 'other-page' })).value.entry as Row
  assert.equal(
    (
      await call('website.saveEntry', {
        ...other,
        layout: [
          {
            id: 'image-other',
            type: 'website.image',
            settings: { image: abandoned.url, alt: 'Wrong entry' },
          },
        ],
        expectedRevisionId: other.revisionId,
      })
    ).status,
    400,
  )
  const publisher = app.client.anonymous()
  await publisher.login({ login: 'studio-publisher', password: 'studio-local' })
  const restored = await call('website_studio.restoreEntry', {
    id: entry.id,
    siteId: 'site-a',
    revisionId: saved.value.revisionId,
    expectedRevisionId: ((await call('website.getEntry', { id: entry.id })).value.entry as Row).revisionId,
  })
  const published = await publisher.post(
    '/website/api/website.publishEntry',
    JSON.stringify({ id: entry.id, expectedRevisionId: restored.value.revisionId, publishAt: null }),
    { headers: { 'content-type': 'application/json' } },
  )
  assert.equal(published.status, 200, await published.clone().text())
  assert.equal((await app.client.anonymous().get(String(image.url))).status, 200)
  const age = async () =>
    app.fixture.withTenant('', async ({ adapter }) => {
      await adapter.run(
        `UPDATE website_image_asset SET "expiresAt" = '2000-01-01T00:00:00Z' WHERE state = 'pending'`,
      )
      await adapter.run(
        `UPDATE ket_job SET scheduled_at = '2000-01-01T00:00:00Z' WHERE job = 'website.collectImages' AND state IN ('scheduled','retryable','available')`,
      )
    })
  await age()
  failRemoval = true
  await app.drainJobs()
  await app.fixture.withTenant('', async ({ adapter }) => {
    assert.ok((await adapter.all(`SELECT id FROM website_image_asset WHERE state = 'deleting'`)).length)
  })
  failRemoval = false
  await age()
  await app.drainJobs()
  assert.equal((await editor.get(String(abandoned.url))).status, 404)
  assert.equal((await editor.get(String(rejected.url))).status, 404)
  assert.equal(
    (await editor.get(String(image.url))).status,
    200,
    'revision history and published content retain the object',
  )
  await app.fixture.withTenant('', async ({ adapter }) => {
    const rows = await adapter.all('SELECT * FROM website_image_asset')
    assert.equal(rows.length, 1)
    assert.equal(rows[0]!.id, image.id)
    const refs = await adapter.all('SELECT * FROM website_image_reference')
    assert.equal(refs.length, 2)
    assert.equal(
      remaining.size,
      1,
      'unclaimed object bytes are removed, not just hidden by the download route',
    )
  })
})

test('a new unsaved post can stage an image and claim it only when its first revision saves', async (t) => {
  const { app } = await bootWebsiteStudio()
  t.after(() => app.close())
  const editor = app.client.anonymous()
  await editor.login({ login: 'studio-editor', password: 'studio-local' })
  const bytes = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#497b65' } })
    .png()
    .toBuffer()
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(bytes)], { type: 'image/png' }), 'new.png')
  const uploaded = await editor.post('/website/images/new-post-image/image?site=site-a', form)
  assert.equal(uploaded.status, 201, await uploaded.clone().text())
  const image = (await uploaded.json()) as Row
  const saved = await editor.post(
    '/website/api/website.saveEntry',
    JSON.stringify({
      id: 'new-post-image',
      siteId: 'site-a',
      type: 'post',
      title: 'New post',
      path: '/new-post',
      layout: [],
      expectedRevisionId: null,
      bodyDoc: JSON.stringify([
        { type: 'image', delta: [], src: image.url, alt: 'Ảnh mới' },
        { type: 'p', delta: [] },
      ]),
    }),
    { headers: { 'content-type': 'application/json' } },
  )
  assert.equal(saved.status, 200, await saved.clone().text())
  await app.fixture.withTenant('', async ({ adapter }) => {
    const assets = await adapter.all('SELECT state FROM website_image_asset')
    assert.equal(assets[0]!.state, 'attached')
    assert.equal((await adapter.all('SELECT id FROM website_image_reference')).length, 1)
  })
})

test('a site logo is uploaded against the site, kept by the style that names it and public while drawn', async (t) => {
  const { app, fixture } = await bootWebsiteStudio(undefined, { worker: true })
  t.after(() => app.close())
  const designer = app.client.anonymous()
  await designer.login({ login: 'studio-designer', password: 'studio-local' })
  const editor = app.client.anonymous()
  await editor.login({ login: 'studio-editor', password: 'studio-local' })
  const bytes = await sharp({ create: { width: 240, height: 60, channels: 4, background: '#00000000' } })
    .png()
    .toBuffer()
  const form = () => {
    const data = new FormData()
    data.append('file', new Blob([new Uint8Array(bytes)], { type: 'image/png' }), 'logo.png')
    return data
  }
  const upload = async (client: typeof designer, path: string) => {
    const response = await client.post(path, form())
    assert.equal(response.status, 201, await response.clone().text())
    return String(((await response.json()) as Row).url)
  }
  let revision = 'initial',
    answer = ''
  // The Studio saves the style through its theme resource, as the Kiểu dáng panel does.
  const style = async (logo: string) => {
    const response = await designer.post(
      '/website/api/website_studio.saveResource',
      JSON.stringify({
        siteId: 'site-a',
        kind: 'themes',
        id: 'site-a',
        expectedRevisionId: revision,
        values: { logo },
      }),
      { headers: { 'content-type': 'application/json' } },
    )
    answer = await response.clone().text()
    if (response.status !== 200) return false
    revision = String(((await response.json()) as { value: Row }).value.revisionId)
    return true
  }
  const anonymous = app.client.anonymous()

  assert.equal((await editor.post('/website/images/site-a/logo?site=site-a', form())).status, 403)
  assert.equal(
    (await designer.post('/website/images/page-site-a/logo?site=site-a', form())).status,
    403,
    'a logo belongs to the site, not to a page',
  )
  const pageImage = await upload(editor, '/website/images/page-site-a/image?site=site-a')
  assert.equal(await style(pageImage), false, "a page's image cannot become the logo")
  assert.match(answer, /Ảnh không hợp lệ/)
  assert.equal(await style('http://example.com/logo.png'), false, 'a plain-http logo is refused, not dropped')
  assert.match(answer, /Logo phải là ảnh tải lên/)

  const logo = await upload(designer, '/website/images/site-a/logo?site=site-a')
  assert.equal((await anonymous.get(logo)).status, 404, 'an unsaved logo is private')
  assert.equal(await style(logo), true, answer)
  assert.equal((await anonymous.get(logo)).status, 200, 'the saved style draws it')

  await fixture('website.saveDomain', {
    id: 'logo-domain',
    siteId: 'site-a',
    host: '127.0.0.1',
    primary: true,
  })
  const entry = (await fixture('website.getEntry', { id: 'page-site-a' })).entry as Row
  await fixture('website.publishEntry', { id: 'page-site-a', expectedRevisionId: entry.revisionId })
  assert.match(
    await (await anonymous.get('/')).text(),
    new RegExp(`<img class="wt-public-logo" src="${logo}" alt="[^"]*">`),
  )

  const replaced = await upload(designer, '/website/images/site-a/logo?site=site-a')
  assert.equal(await style(replaced), true, answer)
  assert.equal(await style(''), true, answer)
  const sweep = async () => {
    await app.fixture.withTenant('', async ({ adapter }) => {
      await adapter.run(
        `UPDATE website_image_asset SET "expiresAt" = '2000-01-01T00:00:00Z' WHERE state = 'pending'`,
      )
      await adapter.run(
        `UPDATE website_image_asset SET "unreferencedAt" = '2000-01-01T00:00:00Z' WHERE "unreferencedAt" IS NOT NULL`,
      )
      // The minute schedule does not tick in a test; run the sweep again as it would.
      await adapter.run(
        `UPDATE ket_job SET state = 'available', scheduled_at = '2000-01-01T00:00:00Z' WHERE job = 'website.collectImages'`,
      )
    })
    await app.drainJobs()
  }
  // The first sweep notices the replaced logo is drawn by nothing; the next one, a day on, removes it.
  await sweep()
  await sweep()
  assert.equal((await designer.get(replaced)).status, 404, 'a logo nothing draws any more is collected')
  assert.equal(
    (await anonymous.get(logo)).status,
    200,
    'the published page still draws the first logo after the style dropped it',
  )
})
