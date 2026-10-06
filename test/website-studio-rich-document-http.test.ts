import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bootWebsiteStudio } from './fixtures/website-studio.ts'

test('commerce pages publish editable rich text, derive searchable text and reject unsafe documents', async (t) => {
  const { app, fixture } = await bootWebsiteStudio(undefined, { deployment: 'commerce' })
  t.after(() => app.close())
  await fixture('website.saveDomain', {
    id: 'rich-domain',
    siteId: 'site-a',
    host: '127.0.0.1',
    primary: true,
  })
  const bodyDoc = JSON.stringify([
    { type: 'h2', delta: [{ insert: 'In catalogue' }] },
    { type: 'p', delta: [{ insert: 'Giấy <script>x</script>', attributes: { bold: true } }] },
    { type: 'bullet', delta: [{ insert: 'Couche 300 gsm' }] },
  ])
  const saved = await fixture('website.saveEntry', {
    id: 'rich-page',
    siteId: 'site-a',
    type: 'website.page',
    slug: 'catalogue',
    path: '/p/CATALOG-A4',
    title: 'In catalogue',
    fields: {},
    layout: [
      { id: 'document-description', type: 'website.rich_text', settings: { body: 'Stale text', bodyDoc } },
    ],
  })
  const found = await fixture('website.getEntry', { id: 'rich-page' })
  assert.equal(
    (found.revision as { layout: Array<{ settings: { body: string } }> }).layout[0]?.settings.body,
    'In catalogue\n\nGiấy <script>x</script>\n\nCouche 300 gsm',
  )
  await fixture('website.publishEntry', { id: 'rich-page', expectedRevisionId: saved.revisionId })
  const response = await app.client.anonymous().get('/p/CATALOG-A4')
  assert.equal(response.status, 200)
  const html = await response.text()
  assert.match(html, /<h2[^>]*>In catalogue/)
  assert.match(html, /<b>Giấy &lt;script&gt;x&lt;\/script&gt;<\/b>/)
  assert.match(html, /<ul/)
  assert.doesNotMatch(html, /Stale text|<script>x<\/script>/)
  for (const bad of [
    'not json',
    JSON.stringify([{ type: 'p', delta: [{ insert: 'X', attributes: { link: 'javascript:alert(1)' } }] }]),
    JSON.stringify([{ type: 'image', delta: [], src: '/website/files/unclaimed', alt: 'X' }]),
  ]) {
    const result = await app.fixture.call(
      'website.saveEntry',
      {
        id: 'rich-page',
        siteId: 'site-a',
        type: 'website.page',
        slug: 'catalogue',
        path: '/p/CATALOG-A4',
        title: 'In catalogue',
        fields: {},
        expectedRevisionId: saved.revisionId,
        layout: [
          {
            id: 'document-description',
            type: 'website.rich_text',
            settings: { body: 'Unsafe', bodyDoc: bad },
          },
        ],
      },
      { scope: { company: 'studio-a', branches: null } },
    )
    assert.equal((result.value as { ok: boolean }).ok, false)
  }
})

test('commerce gallery albums publish mobile art direction and reject unsafe or unbounded settings', async (t) => {
  const { app, fixture } = await bootWebsiteStudio(undefined, { deployment: 'commerce' })
  t.after(() => app.close())
  await fixture('website.saveDomain', {
    id: 'album-domain',
    siteId: 'site-a',
    host: '127.0.0.1',
    primary: true,
  })
  const input = {
    id: 'album-page',
    siteId: 'site-a',
    type: 'website.page',
    slug: 'album',
    path: '/album',
    title: 'Inlano',
    fields: {},
    layout: [
      {
        id: 'album-slides',
        type: 'website.gallery',
        settings: {
          images: JSON.stringify([
            {
              src: 'https://example.com/banner.jpg',
              mobileSrc: 'https://example.com/mobile.jpg',
              alt: 'Inlano',
            },
          ]),
          galleryLayout: 'slideshow',
          rows: '1',
          interval: '5',
        },
      },
    ],
  }
  const saved = await fixture('website.saveEntry', input)
  await fixture('website.publishEntry', { id: input.id, expectedRevisionId: saved.revisionId })
  const response = await app.client.anonymous().get('/album')
  assert.equal(response.status, 200)
  assert.match(await response.text(), /srcset="https:\/\/example.com\/mobile.jpg"/)
  for (const changes of [
    { images: 'invalid json' },
    { images: JSON.stringify([{ src: 'javascript:alert(1)' }]) },
    { images: JSON.stringify([{ src: '/safe.jpg', mobileSrc: 'data:text/html,x' }]) },
    { images: JSON.stringify(Array.from({ length: 201 }, () => ({ src: '/safe.jpg' }))) },
    { rows: '4' },
    { interval: '0' },
    { galleryLayout: 'execute' },
  ]) {
    const result = await app.fixture.call(
      'website.saveEntry',
      {
        ...input,
        expectedRevisionId: saved.revisionId,
        layout: [{ ...input.layout[0], settings: { ...input.layout[0].settings, ...changes } }],
      },
      { scope: { company: 'studio-a', branches: null } },
    )
    assert.equal((result.value as { ok: boolean }).ok, false)
  }
})
