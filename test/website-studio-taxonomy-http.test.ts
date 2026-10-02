import assert from 'node:assert/strict'
import { test } from 'node:test'
import { tableNameFor } from '@ketvietlab/ketjs'
import type { Row } from '@ketvietlab/ketjs'
import { bootWebsiteStudio } from './fixtures/website-studio.ts'

const doc = (...blocks: Row[]) => JSON.stringify(blocks)
const paragraph = (text: string) => ({ type: 'p', delta: [{ insert: text }] })

/**
 * Categories and tags are edited in the Studio the way the Atlas draws them: a LiveDoc
 * description, head tags for the term's page, compare-and-set, and archive that refuses
 * while a post or a child term still names the term.
 */
test('Studio categories and tags: create, edit, conflict and archive on the real host', async (t) => {
  const { app, fixture } = await bootWebsiteStudio()
  t.after(() => app.close())
  // Saved before terms had revisions, the way existing data arrives.
  await fixture('website.saveTerm', {
    id: 'legacy-tag',
    siteId: 'site-a',
    taxonomy: 'website.tag',
    slug: 'cu',
    name: 'Cũ',
  })
  const q = app.adapter!.quoteIdent.bind(app.adapter)
  await app.adapter!.run(
    `UPDATE ${q(tableNameFor('website.TaxonomyTerm'))} SET ${q('revisionId')} = NULL WHERE ${q('id')} = 'legacy-tag'`,
  )
  const login = async (name: string) => {
    const client = app.client.anonymous()
    await client.login({ login: name, password: 'studio-local' })
    return async (fn: string, input: Row, key?: string) => {
      const response = await client.post('/website/api/' + fn, JSON.stringify(input), {
        headers: { 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}) },
      })
      return {
        status: response.status,
        ...((await response.json()) as { code?: string; message?: string; value: Row }),
      }
    }
  }
  const editor = await login('studio-editor')
  const reader = await login('studio-reader')
  const ok = async (fn: string, input: Row, key?: string) => {
    const result = await editor(fn, input, key)
    assert.equal(result.status, 200, JSON.stringify(result))
    return result.value
  }
  const refused = async (fn: string, input: Row, message: string) => {
    const result = await editor(fn, input)
    assert.notEqual(result.status, 200, JSON.stringify(input))
    assert.equal(result.message, message)
    return result
  }
  const values = (more: Row = {}) => ({
    title: 'Trà xanh',
    slug: 'tra-xanh',
    taxonomyType: 'category',
    descriptionDoc: doc(paragraph('Lá trà non'), { type: 'divider', delta: [] }, paragraph('Hái sớm')),
    seoTitle: 'Trà xanh Mộc',
    seoDescription: 'Các bài về trà xanh',
    canonical: '/category/tra-xanh',
    indexing: 'index',
    parent: '',
    ...more,
  })
  const save = (id: string, expectedRevisionId: unknown, more: Row = {}) =>
    editor('website_studio.saveResource', {
      siteId: 'site-a',
      kind: 'taxonomy',
      id,
      expectedRevisionId,
      values: values(more),
    })

  const created = await ok(
    'website_studio.saveResource',
    { siteId: 'site-a', kind: 'taxonomy', id: 'cat-green', expectedRevisionId: null, values: values() },
    'cat-green',
  )
  assert.equal(created.path, '/category/tra-xanh')
  assert.equal(created.description, 'Lá trà non\n\n\n\nHái sớm')
  assert.deepEqual(
    [created.seoTitle, created.seoDescription, created.canonical, created.indexing, created.postCount],
    ['Trà xanh Mộc', 'Các bài về trà xanh', '/category/tra-xanh', 'index', 0],
  )
  const read = await ok('website_studio.getResource', { siteId: 'site-a', kind: 'taxonomy', id: 'cat-green' })
  assert.equal(read.revisionId, created.revisionId)
  assert.equal(read.descriptionDoc, created.descriptionDoc)

  // A second tab that read before this save cannot overwrite it.
  const edited = (await save('cat-green', created.revisionId, { title: 'Trà xanh Thái' })).value
  assert.equal(edited.title, 'Trà xanh Thái')
  const stale = await save('cat-green', created.revisionId, { title: 'Ghi đè' })
  assert.equal(stale.code, 'conflict')
  assert.equal(
    (await ok('website_studio.getResource', { siteId: 'site-a', kind: 'taxonomy', id: 'cat-green' })).title,
    'Trà xanh Thái',
  )

  // What the form may carry is checked, not stored as sent.
  const current = edited.revisionId
  await refused(
    'website_studio.saveResource',
    {
      siteId: 'site-a',
      kind: 'taxonomy',
      id: 'cat-green',
      expectedRevisionId: current,
      values: values({ canonical: 'javascript:alert(1)' }),
    },
    'Thông tin SEO không hợp lệ: canonical cần là đường dẫn nội bộ hoặc địa chỉ HTTPS.',
  )
  await refused(
    'website_studio.saveResource',
    {
      siteId: 'site-a',
      kind: 'taxonomy',
      id: 'cat-green',
      expectedRevisionId: current,
      values: values({ descriptionDoc: doc({ type: 'image', delta: [], src: '/website/files/x', alt: '' }) }),
    },
    'Nội dung mô tả không hợp lệ.',
  )
  await refused(
    'website_studio.saveResource',
    {
      siteId: 'site-a',
      kind: 'taxonomy',
      id: 'cat-green',
      expectedRevisionId: current,
      values: values({ cover: '/anh.jpg' }),
    },
    'Ảnh của chuyên mục và thẻ chưa được hỗ trợ trên hệ thống này.',
  )
  await refused(
    'website_studio.saveResource',
    {
      siteId: 'site-a',
      kind: 'taxonomy',
      id: 'cat-green',
      expectedRevisionId: current,
      values: values({ taxonomyType: 'tag' }),
    },
    'Không đổi chuyên mục thành thẻ hoặc ngược lại.',
  )
  assert.equal(
    (
      await reader('website_studio.saveResource', {
        siteId: 'site-a',
        kind: 'taxonomy',
        id: 'cat-green',
        expectedRevisionId: current,
        values: values(),
      })
    ).status,
    403,
  )

  // A term saved before revisions existed is still editable, by the version it shows.
  const legacy = await ok('website_studio.getResource', {
    siteId: 'site-a',
    kind: 'taxonomy',
    id: 'legacy-tag',
  })
  assert.equal(legacy.revisionId, 'legacy-tag@0')
  assert.equal(
    (await save('legacy-tag', legacy.revisionId, { title: 'Cũ mà mới', slug: 'cu', taxonomyType: 'tag' }))
      .status,
    200,
  )

  // A child category and a post both hold the term in place.
  const child = await ok(
    'website_studio.saveResource',
    {
      siteId: 'site-a',
      kind: 'taxonomy',
      id: 'cat-child',
      expectedRevisionId: null,
      values: values({ title: 'Con', slug: 'con', parent: 'cat-green' }),
    },
    'cat-child',
  )
  const post = await ok('website.saveEntry', {
    id: 'green-post',
    siteId: 'site-a',
    type: 'post',
    title: 'Bài trà',
    path: '/bai-tra',
    layout: [],
    category: 'cat-green',
    bodyDoc: doc(paragraph('Mở đầu'), { type: 'divider', delta: [] }),
    expectedRevisionId: null,
  })
  const used = await ok('website_studio.getResource', { siteId: 'site-a', kind: 'taxonomy', id: 'cat-green' })
  assert.equal(used.postCount, 1)
  assert.deepEqual((used.usage as Row[]).map((u) => u.id).sort(), ['cat-child', 'green-post'])
  const archive = (id: string, revisionId: unknown, confirmed = true) =>
    editor('website_studio.archiveResource', {
      siteId: 'site-a',
      kind: 'taxonomy',
      id,
      expectedRevisionId: revisionId,
      confirmed,
    })
  assert.equal(
    (await archive('cat-green', used.revisionId, false)).message,
    'Xác nhận lưu trữ trước khi tiếp tục.',
  )
  assert.equal((await archive('cat-green', used.revisionId)).message, 'Đang được dùng tại: Con, Bài trà.')

  assert.equal((await archive('cat-child', child.revisionId)).status, 200)
  await ok('website.saveEntry', {
    id: 'green-post',
    siteId: 'site-a',
    type: 'post',
    title: 'Bài trà',
    path: '/bai-tra',
    layout: [],
    category: '',
    expectedRevisionId: post.revisionId,
  })
  assert.equal((await archive('cat-green', 'cu')).code, 'conflict')
  assert.equal((await archive('cat-green', used.revisionId)).status, 200)

  const rows = (await ok('website_studio.listResources', { siteId: 'site-a', kind: 'taxonomy' }))
    .rows as Row[]
  assert.deepEqual(rows.map((r) => r.id).sort(), ['legacy-tag'])
  assert.equal(
    (await editor('website_studio.getResource', { siteId: 'site-a', kind: 'taxonomy', id: 'cat-green' }))
      .code,
    'notFound',
  )
  // An archived term is no longer offered to a post.
  const latest = (await ok('website.getEntry', { id: 'green-post' })).entry as Row
  await refused(
    'website.saveEntry',
    {
      id: 'green-post',
      siteId: 'site-a',
      type: 'post',
      title: 'Bài trà',
      path: '/bai-tra',
      layout: [],
      category: 'cat-green',
      expectedRevisionId: latest.revisionId,
    },
    'Chuyên mục hoặc thẻ không thuộc website này.',
  )
})

test('website terms: a tag takes no parent, whoever calls', async (t) => {
  const { app, fixture } = await bootWebsiteStudio()
  t.after(() => app.close())
  await fixture('website.saveTerm', {
    id: 'tag-1',
    siteId: 'site-a',
    taxonomy: 'website.tag',
    slug: 'mot',
    name: 'Một',
  })
  const result = (
    await app.fixture.call<Row>(
      'website.saveTerm',
      { id: 'tag-2', siteId: 'site-a', taxonomy: 'website.tag', slug: 'hai', name: 'Hai', parentId: 'tag-1' },
      { scope: { company: 'studio-a', branches: null } },
    )
  ).value
  assert.deepEqual(result.errors, [{ field: 'parentId', message: 'website.error.invalidParent' }])
})
