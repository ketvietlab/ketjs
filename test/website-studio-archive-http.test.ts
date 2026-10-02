import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { bootWebsiteStudio } from './fixtures/website-studio.ts'

const doc = (text: string) => JSON.stringify([{ type: 'p', delta: [{ insert: text }] }])

/**
 * A category or tag has a public page of its own, built from the posts that went out, with
 * the head tags its editor set; the sitemap lists it once a post is there, and leaves out what
 * an editor asked crawlers not to index.
 */
test('Studio archives: category and tag pages, Open Graph and the sitemap', async (t) => {
  const { app, fixture } = await bootWebsiteStudio()
  t.after(() => app.close())
  await fixture('website.saveDomain', {
    id: 'archive-domain',
    siteId: 'site-a',
    host: '127.0.0.1',
    primary: true,
  })
  const login = async (name: string) => {
    const client = app.client.anonymous()
    await client.login({ login: name, password: 'studio-local' })
    return async (fn: string, input: Row) => {
      const response = await client.post('/website/api/' + fn, JSON.stringify(input), {
        headers: { 'content-type': 'application/json' },
      })
      const body = (await response.json()) as { value: Row }
      assert.equal(response.status, 200, JSON.stringify(body))
      return body.value
    }
  }
  const editor = await login('studio-editor')
  const publisher = await login('studio-publisher')
  const term = (id: string, siteId: string, values: Row) =>
    editor('website_studio.saveResource', {
      siteId,
      kind: 'taxonomy',
      id,
      expectedRevisionId: null,
      values: {
        descriptionDoc: doc(''),
        seoTitle: '',
        seoDescription: '',
        canonical: '',
        indexing: 'index',
        parent: '',
        ...values,
      },
    })
  await term('cat-tea', 'site-a', {
    title: 'Trà',
    slug: 'tra',
    taxonomyType: 'category',
    descriptionDoc: doc('Mọi điều về trà'),
    seoTitle: 'Trà ngon',
    seoDescription: 'Bài viết về trà',
  })
  await term('tag-hidden', 'site-a', { title: 'Ẩn', slug: 'an', taxonomyType: 'tag', indexing: 'noindex' })
  const empty = await term('tag-empty', 'site-a', { title: 'Rỗng', slug: 'rong', taxonomyType: 'tag' })
  await term('tag-page', 'site-a', {
    title: 'Trang',
    slug: 'trang',
    taxonomyType: 'tag',
    descriptionDoc: JSON.stringify([
      { type: 'p', delta: [{ insert: 'Một' }] },
      { type: 'p', delta: [{ insert: 'Hai' }] },
      { type: 'p', delta: [] },
    ]),
  })
  await term('cat-other', 'site-a2', { title: 'Khác', slug: 'khac', taxonomyType: 'category' })

  const post = async (id: string, values: Row, publish = true) => {
    const saved = await publisher('website.saveEntry', {
      id,
      siteId: 'site-a',
      type: 'post',
      path: `/${id}`,
      layout: [],
      bodyDoc: doc('Nội dung'),
      expectedRevisionId: null,
      ...values,
    })
    if (publish) await publisher('website.publishEntry', { id, expectedRevisionId: saved.revisionId })
  }
  // Published in this order, dated the other way: the page follows the date on the post.
  await post('bai-1', {
    title: 'Trà sen',
    category: 'cat-tea',
    tags: ['tag-hidden'],
    publishedAt: '2026-09-20',
    excerpt: 'Hương sen',
  })
  await post('bai-2', {
    title: 'Trà nhài',
    category: 'cat-tea',
    publishedAt: '2026-09-01',
    fields: { seo: { title: '', description: '', canonical: '', indexing: 'noindex', image: '' } },
  })
  await post('bai-3', { title: 'Bản nháp riêng', category: 'cat-tea' }, false)

  const visitor = app.client.anonymous()
  const get = async (path: string) => {
    const response = await visitor.get(path)
    // The hydration markers sit between every tag and say nothing about the page.
    return { status: response.status, body: (await response.text()).replace(/<!--k\[?-->/g, '') }
  }

  const category = await get('/category/tra')
  assert.equal(category.status, 200)
  assert.match(category.body, /class="wt-public-archive"><h1>Trà<\/h1>/)
  assert.match(category.body, /Mọi điều về trà/)
  assert.match(category.body, /href="\/bai-1">Trà sen<\/a>.*Hương sen.*href="\/bai-2">Trà nhài<\/a>/s)
  assert.doesNotMatch(category.body, /Bản nháp riêng/)
  assert.match(category.body, /<title>Trà ngon<\/title>/)
  assert.match(
    category.body,
    /<meta property="og:type" content="website"><meta property="og:title" content="Trà ngon"><meta property="og:description" content="Bài viết về trà">/,
  )
  assert.match(category.body, /<link rel="canonical" href="\/category\/tra">/)
  assert.doesNotMatch(category.body, /name="robots"/)
  assert.match((await get('/bai-1')).body, /<meta property="og:type" content="article">/)

  const hidden = await get('/tag/an')
  assert.equal(hidden.status, 200)
  assert.match(hidden.body, /<meta name="robots" content="noindex">/)
  assert.match((await get('/tag/rong')).body, /Chưa có bài viết\./)
  // Another site's category, and a category path a tag does not answer.
  assert.equal((await get('/category/khac')).status, 404)
  assert.equal((await get('/category/an')).status, 404)

  for (let i = 1; i <= 21; i += 1)
    await post(`trang-${i}`, {
      title: `Bài ${i}`,
      tags: ['tag-page'],
      publishedAt: `2026-08-${String(i).padStart(2, '0')}`,
    })
  const first = await get('/tag/trang')
  assert.match(first.body, /<a rel="next" href="\/tag\/trang\/page\/2">/)
  assert.doesNotMatch(first.body, /rel="prev"|Bài 1</)
  // Two paragraphs and a trailing empty one, with no SEO text of its own.
  assert.match(first.body, /<meta name="description" content="Một Hai"><meta property="og:type"/)
  assert.match(first.body, /<meta property="og:description" content="Một Hai">/)
  const second = await get('/tag/trang/page/2')
  assert.equal(second.status, 200)
  assert.match(second.body, /<a rel="prev" href="\/tag\/trang">/)
  assert.match(second.body, /<link rel="canonical" href="\/tag\/trang\/page\/2">/)
  assert.deepEqual(
    [...second.body.matchAll(/<h2><a href="([^"]+)"/g)].map((m) => m[1]),
    ['/trang-1'],
  )
  assert.equal((await get('/tag/trang/page/3')).status, 404)

  const sitemap = (await get('/sitemap.xml')).body
  const listed = [...sitemap.matchAll(/<loc>https?:\/\/[^/]+([^<]*)<\/loc>/g)].map((m) => m[1])
  assert.ok(
    listed.includes('/bai-1') && listed.includes('/category/tra') && listed.includes('/tag/trang'),
    sitemap,
  )
  for (const path of ['/bai-2', '/bai-3', '/tag/an', '/tag/rong', '/category/khac'])
    assert.ok(!listed.includes(path), `${path} in ${sitemap}`)

  // An archived term has no page.
  await editor('website_studio.archiveResource', {
    siteId: 'site-a',
    kind: 'taxonomy',
    id: 'tag-empty',
    expectedRevisionId: empty.revisionId,
    confirmed: true,
  })
  assert.equal((await get('/tag/rong')).status, 404)
})
