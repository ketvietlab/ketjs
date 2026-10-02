import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { bootWebsiteStudio } from './fixtures/website-studio.ts'

test('Studio authors real page trees and LiveDoc revisions with CAS, history and lifecycle', async (t) => {
  const { app } = await bootWebsiteStudio()
  t.after(() => app.close())
  const editor = app.client.anonymous()
  await editor.login({ login: 'studio-editor', password: 'studio-local' })
  const request = async (name: string, input: Row, key?: string) => {
    const response = await editor.post('/website/api/' + name, JSON.stringify(input), {
      headers: { 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}) },
    })
    return { status: response.status, ...((await response.json()) as { ok: boolean; value: Row }) }
  }
  const call = async (name: string, input: Row, key?: string) => {
    const r = await request(name, input, key)
    assert.equal(r.status, 200, JSON.stringify(r))
    return r.value
  }
  const layout = [
    {
      id: 'node-cols',
      type: 'website.columns',
      settings: { responsive: { mobile: 'stack' } },
      slots: {
        left: [
          {
            id: 'node-call',
            type: 'website.callout',
            settings: { heading: 'Tư vấn', ctaLabel: 'Liên hệ', ctaHref: '/lien-he' },
          },
        ],
        right: [{ id: 'node-quote', type: 'website.quote', settings: { body: 'Chăm sóc mỗi ngày' } }],
      },
    },
  ]
  const input = {
    id: 'studio-tree',
    siteId: 'site-a',
    type: 'page',
    title: 'Cây nội dung',
    path: '/tree',
    layout,
    expectedRevisionId: null,
  }
  const created = await call('website.saveEntry', input, 'create-tree')
  const retried = await call('website.saveEntry', input, 'create-tree')
  assert.equal(retried.revisionId, created.revisionId)
  assert.deepEqual(((await call('website.getEntry', { id: input.id })).entry as Row).layout, layout)
  const templates = await call('website_studio.listResources', { siteId: 'site-a', kind: 'templates' })
  assert.ok((templates.rows as Row[]).length)
  const settings = await call('website_studio.savePageSettings', {
    id: input.id,
    siteId: 'site-a',
    title: 'Cây đã sửa',
    path: '/tree-2',
    seo: { title: 'SEO', description: 'Mô tả', canonical: '', indexing: 'index' },
    expectedRevisionId: created.revisionId,
  })
  assert.equal(
    (await request('website.saveEntry', { ...input, expectedRevisionId: created.revisionId })).status,
    400,
  )
  const before = (
    await call('website_studio.preview', { id: input.id, siteId: 'site-a', revisionId: created.revisionId })
  ).entry as Row
  assert.equal(before.title, 'Cây nội dung')
  const restored = await call('website_studio.restoreEntry', {
    id: input.id,
    siteId: 'site-a',
    revisionId: created.revisionId,
    expectedRevisionId: settings.revisionId,
  })
  assert.notEqual(restored.revisionId, created.revisionId)
  await call('website_studio.setEntryArchived', {
    id: input.id,
    siteId: 'site-a',
    archived: true,
    expectedRevisionId: restored.revisionId,
  })
  assert.equal(
    (
      (await call('website.listEntries', { siteId: 'site-a', type: 'page', status: 'trash' })).rows as Row[]
    ).some((e) => e.id === input.id),
    true,
  )
  await call('website_studio.setEntryArchived', {
    id: input.id,
    siteId: 'site-a',
    archived: false,
    expectedRevisionId: restored.revisionId,
  })
  const doc = JSON.stringify([
    { type: 'h2', delta: [{ insert: 'Bài viết thật' }] },
    { type: 'p', delta: [{ insert: 'Nội dung', attributes: { bold: true } }] },
  ])
  const post = {
    id: 'studio-article',
    siteId: 'site-a',
    type: 'post',
    title: 'Bài viết',
    path: '/blog/bai-viet',
    layout: [],
    bodyDoc: doc,
    bodyText: 'forged',
    expectedRevisionId: null,
  }
  const saved = await call('website.saveEntry', post, 'create-article')
  assert.equal((await call('website.saveEntry', post, 'create-article')).revisionId, saved.revisionId)
  const entry = (await call('website.getEntry', { id: post.id })).entry as Row
  assert.equal(entry.bodyDoc, doc)
  assert.equal(entry.bodyText, 'Bài viết thật\n\nNội dung')
  assert.equal(
    (
      await request('website.saveEntry', {
        ...post,
        bodyDoc: 'not json',
        expectedRevisionId: saved.revisionId,
      })
    ).status,
    400,
  )
  assert.equal(((await call('website.getEntry', { id: post.id })).entry as Row).revisionId, saved.revisionId)
  const history = await call('website_studio.entryHistory', { id: input.id, siteId: 'site-a' })
  assert.equal((history.revisions as Row[]).length, 3)
})

test('Studio page settings save a post’s metadata with its SEO, and only for a post', async (t) => {
  const { app } = await bootWebsiteStudio()
  t.after(() => app.close())
  const editor = app.client.anonymous()
  await editor.login({ login: 'studio-editor', password: 'studio-local' })
  const call = async (name: string, input: Row) => {
    const response = await editor.post('/website/api/' + name, JSON.stringify(input), {
      headers: { 'content-type': 'application/json' },
    })
    const body = (await response.json()) as { value: Row }
    assert.equal(response.status, 200, JSON.stringify(body))
    return body.value
  }
  const entryOf = async (id: string) => (await call('website.getEntry', { id })).entry as Row
  const post = await call('website.saveEntry', {
    id: 'settings-post',
    siteId: 'site-a',
    type: 'post',
    title: 'Bài viết',
    path: '/bai-viet',
    layout: [],
    author: 'Mai',
    expectedRevisionId: null,
  })
  const metadata = {
    author: 'Lan',
    excerpt: 'Tóm tắt mới',
    cover: '/anh/bia.jpg',
    coverAlt: 'Ấm trà trên bàn gỗ',
    publishedAt: '2026-09-30',
    tags: [],
    // Not post metadata: the panel cannot reach the layout through this field.
    layout: [{ id: 'x', type: 'website.rich_text', settings: { body: 'lọt' } }],
  }
  await call('website_studio.savePageSettings', {
    id: 'settings-post',
    siteId: 'site-a',
    title: 'Bài viết',
    path: '/bai-viet',
    seo: { title: 'SEO', description: '', canonical: '', image: '', indexing: 'index' },
    post: metadata,
    expectedRevisionId: post.revisionId,
  })
  const saved = await entryOf('settings-post')
  assert.deepEqual(
    [saved.author, saved.excerpt, saved.cover, saved.coverAlt, saved.publishedAt],
    ['Lan', 'Tóm tắt mới', '/anh/bia.jpg', 'Ấm trà trên bàn gỗ', '2026-09-30'],
  )
  assert.deepEqual(saved.layout, [])

  // A page has no post metadata to take.
  const page = await entryOf('page-site-a')
  await call('website_studio.savePageSettings', {
    id: 'page-site-a',
    siteId: 'site-a',
    title: 'Trang chủ',
    path: '/',
    seo: { title: '', description: '', canonical: '', image: '', indexing: 'index' },
    post: metadata,
    expectedRevisionId: page.revisionId,
  })
  assert.notEqual((await entryOf('page-site-a')).excerpt, 'Tóm tắt mới')
})

test('a post keeps only this site’s terms in their own roles, a real date and a described cover', async (t) => {
  const { app, fixture } = await bootWebsiteStudio()
  t.after(() => app.close())
  for (const [id, siteId, taxonomy, company] of [
    ['cat-a', 'site-a', 'website.category', 'studio-a'],
    ['tag-a', 'site-a', 'website.tag', 'studio-a'],
    ['tag-a2', 'site-a2', 'website.tag', 'studio-a'],
  ] as const)
    await fixture('website.saveTerm', { id, siteId, taxonomy, slug: id, name: id }, company)
  const editor = app.client.anonymous()
  await editor.login({ login: 'studio-editor', password: 'studio-local' })
  const send = async (name: string, input: Row) => {
    const response = await editor.post('/website/api/' + name, JSON.stringify(input), {
      headers: { 'content-type': 'application/json' },
    })
    return { status: response.status, ...((await response.json()) as { message?: string; value: Row }) }
  }
  let revisionId: unknown = null
  const save = async (post: Row) => {
    const result = await send('website.saveEntry', {
      id: 'terms-post',
      siteId: 'site-a',
      type: 'post',
      title: 'Bài viết',
      path: '/bai-viet',
      layout: [],
      expectedRevisionId: revisionId,
      ...post,
    })
    if (result.status === 200) revisionId = result.value.revisionId
    return result
  }
  const refused = async (post: Row, message: string) => {
    const result = await save(post)
    assert.equal(result.status, 400, JSON.stringify(post))
    assert.equal(result.message, message, JSON.stringify(post))
  }

  assert.equal(
    (await save({ category: 'cat-a', tags: ['tag-a', 'tag-a'], publishedAt: '2026-02-28' })).status,
    200,
  )
  const saved = ((await send('website.getEntry', { id: 'terms-post' })).value.entry ?? {}) as Row
  assert.deepEqual([saved.category, saved.tags], ['cat-a', ['tag-a']])

  const term = 'Chuyên mục hoặc thẻ không thuộc website này.'
  await refused({ category: 'tag-a' }, term)
  await refused({ tags: ['cat-a'] }, term)
  await refused({ tags: ['tag-a2'] }, term)
  await refused({ category: 'khong-co' }, term)
  await refused({ tags: { 0: 'tag-a' } }, term)
  await refused({ publishedAt: '2026-02-30' }, 'Ngày giờ không hợp lệ.')
  await refused({ publishedAt: '30/09/2026' }, 'Ngày giờ không hợp lệ.')
  await refused(
    { cover: '/anh/bia.jpg', coverAlt: ' ' },
    'Ảnh bìa cần có mô tả cho người không xem được ảnh.',
  )
  const described = await save({ cover: '/anh/bia.jpg', coverAlt: 'Ấm trà' })
  assert.equal(described.status, 200, JSON.stringify(described))
})
