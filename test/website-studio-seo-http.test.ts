import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { bootWebsiteStudio } from './fixtures/website-studio.ts'

/**
 * The SEO screen lists a site's pages with what search engines and shared links read from them,
 * writes that into the page itself and audits what the published pages still miss.
 */
test('Studio SEO: a page’s search metadata is listed, saved into the page and served once published', async (t) => {
  const { app, fixture } = await bootWebsiteStudio()
  t.after(() => app.close())
  await fixture('website.saveDomain', {
    id: 'seo-domain',
    siteId: 'site-a',
    host: '127.0.0.1',
    primary: true,
  })
  // A page in the trash is no longer served, so it has nothing to say to search engines.
  const trashed = await fixture('website.saveEntry', {
    id: 'page-trashed',
    siteId: 'site-a',
    type: 'website.page',
    title: 'Trang cũ',
    path: '/cu',
    slug: 'cu',
    fields: {},
    layout: [],
  })
  await fixture('website.trashEntry', { id: 'page-trashed', expectedRevisionId: trashed.revisionId })
  const clientFor = async (login: string) => {
    const client = app.client.anonymous()
    await client.login({ login, password: 'studio-local' })
    return async (name: string, input: Row) => {
      const response = await client.post('/website/api/' + name, JSON.stringify(input), {
        headers: { 'content-type': 'application/json' },
      })
      return { status: response.status, ...((await response.json()) as { value: Row; message?: string }) }
    }
  }
  const publisher = await clientFor('studio-publisher')
  const reader = await clientFor('studio-reader')
  const list = async (search = '') =>
    (await publisher('website_studio.listResources', { siteId: 'site-a', kind: 'seo', search })).value as {
      rows: Row[]
      creatable: boolean
      audit: { indexState: string; rows: Row[] }
    }
  const id = 'page-site-a'
  const record = async () =>
    (await publisher('website_studio.getResource', { siteId: 'site-a', kind: 'seo', id })).value
  const save = (expectedRevisionId: unknown, values: Row) =>
    publisher('website_studio.saveResource', {
      siteId: 'site-a',
      kind: 'seo',
      id,
      expectedRevisionId,
      values,
    })
  const publish = async () => {
    const { revisionId } = await record()
    assert.equal(
      (await publisher('website.publishEntry', { id, expectedRevisionId: revisionId })).status,
      200,
    )
  }

  // Only this site's pages; nothing to create apart from a page, and nothing live to audit yet.
  const empty = await list()
  assert.deepEqual(
    empty.rows.map((r) => [r.id, r.title, r.path, r.indexing, r.state]),
    [[id, 'Trang site-a', '/', 'index', 'draft']],
  )
  assert.equal(empty.creatable, false)
  assert.deepEqual([empty.audit.indexState, empty.audit.rows], ['empty', []])
  assert.equal((await list('khong-co')).rows.length, 0)
  assert.equal((await list('trang SITE')).rows.length, 1)
  assert.equal(
    (await publisher('website_studio.getResource', { siteId: 'site-a', kind: 'seo', id: 'page-site-a2' }))
      .status,
    404,
  )

  const before = await record()
  const values = {
    title: 'Lành · Mỹ phẩm',
    path: '/',
    description: 'Mỹ phẩm  thiên nhiên',
    image: '/media/lanh.jpg',
    indexing: 'index',
    canonical: '',
  }
  assert.equal(
    (
      await reader('website_studio.saveResource', {
        siteId: 'site-a',
        kind: 'seo',
        id,
        expectedRevisionId: before.revisionId,
        values,
      })
    ).status,
    403,
  )
  const saved = await save(before.revisionId, values)
  assert.equal(saved.status, 200, String(saved.message))
  assert.equal(saved.value.description, 'Mỹ phẩm  thiên nhiên')
  assert.notEqual(saved.value.revisionId, before.revisionId)
  // The page itself carries it: the Builder's settings panel reads the same values.
  const { entry } = (await publisher('website.getEntry', { id })).value as { entry: Row }
  assert.deepEqual(entry.seo, {
    title: 'Lành · Mỹ phẩm',
    description: 'Mỹ phẩm  thiên nhiên',
    image: '/media/lanh.jpg',
    canonical: '',
    indexing: 'index',
  })
  assert.equal(entry.title, 'Trang site-a', 'the page keeps its own title')
  const stale = await save(before.revisionId, { ...values, title: 'Cũ' })
  assert.equal(stale.status, 400)
  assert.match(String(stale.message), /đã thay đổi/)
  assert.equal((await save(saved.value.revisionId, { ...values, canonical: 'javascript:x' })).status, 400)

  await publish()
  const visitor = app.client.anonymous()
  const page = await (await visitor.get('/')).text()
  assert.match(page, /<title>Lành · Mỹ phẩm<\/title>/)
  assert.match(page, /<meta name="description" content="Mỹ phẩm thiên nhiên">/)
  const live = await list()
  assert.equal(live.audit.indexState, 'ready')
  assert.deepEqual(live.audit.rows, [], 'nothing is missing from the published page')

  // The audit reads the published page: a draft without a description is not live yet.
  const draft = await save((await record()).revisionId, {
    ...values,
    title: 'Trang site-a',
    description: '',
    image: '',
    indexing: 'noindex',
  })
  assert.equal(draft.status, 200, String(draft.message))
  assert.equal(draft.value.title, 'Trang site-a', 'the page’s own title shows when none is set')
  const { entry: untitled } = (await publisher('website.getEntry', { id })).value as { entry: Row }
  assert.equal((untitled.seo as Row).title, '', 'a later rename of the page still reaches search')
  assert.equal(((await record()) as Row).indexing, 'noindex')
  assert.deepEqual(
    (await list()).audit.rows.map((r) => [r.id, r.missing, r.indexLag]),
    [[id, [], true]],
  )
  await publish()
  assert.deepEqual(
    (await list()).audit.rows.map((r) => [r.id, r.missing, r.indexLag]),
    [[id, ['description', 'image'], false]],
  )
  const hidden = await (await visitor.get('/')).text()
  assert.match(hidden, /<meta name="robots" content="noindex">/)
  assert.doesNotMatch(hidden, /Lành · Mỹ phẩm/)

  const moved = await save((await record()).revisionId, { ...values, path: '/trang-chu' })
  assert.equal(moved.status, 200, String(moved.message))
  assert.equal(moved.value.path, '/trang-chu')
})
