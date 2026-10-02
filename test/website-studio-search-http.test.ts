import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { bootWebsiteStudio } from './fixtures/website-studio.ts'

const doc = (text: string) => JSON.stringify([{ type: 'p', delta: [{ insert: text }] }])

/**
 * A visitor searches a Studio site from any page and lands on `/search`: what was published,
 * found by the words in its body as well as its title, narrowed to pages or posts, a page of
 * results at a time. Publishing or withdrawing one entry is enough for the next search to see it.
 */
test('Studio search: the results page, its filters and an index that follows each publish', async (t) => {
  const { app, fixture } = await bootWebsiteStudio()
  t.after(() => app.close())
  await fixture('website.saveDomain', {
    id: 'search-domain',
    siteId: 'site-a',
    host: '127.0.0.1',
    primary: true,
  })
  const client = app.client.anonymous()
  await client.login({ login: 'studio-publisher', password: 'studio-local' })
  const call = async (fn: string, input: Row) => {
    const response = await client.post('/website/api/' + fn, JSON.stringify(input), {
      headers: { 'content-type': 'application/json' },
    })
    const body = (await response.json()) as { value: Row }
    assert.equal(response.status, 200, JSON.stringify(body))
    return body.value
  }
  const publish = async (id: string) => {
    const entry = (await call('website.getEntry', { id })).entry as Row
    await call('website.publishEntry', { id, expectedRevisionId: entry.revisionId })
  }
  const save = async (id: string, values: Row, published = true) => {
    await call('website.saveEntry', {
      id,
      siteId: 'site-a',
      type: 'post',
      path: `/${id}`,
      layout: [],
      expectedRevisionId: null,
      ...values,
    })
    if (published) await publish(id)
  }
  await publish('page-site-a')
  await save('tra-sen', { title: 'Trà sen', bodyDoc: doc('Hương thơm của Hồ Tây vào mùa hè') })
  await save('tra-nhai', { title: 'Trà nhài', excerpt: 'Nhài trắng', bodyDoc: doc('Hái lúc sáng sớm') })
  await save('gioi-thieu', {
    type: 'page',
    title: 'Giới thiệu',
    layout: [
      {
        id: 'section-intro',
        type: 'website.rich_text',
        settings: { heading: 'Vườn', body: 'Chúng tôi ở hồ tây' },
      },
    ],
  })
  await save('ban-nhap', { title: 'Bản nháp', bodyDoc: doc('Hồ Tây chưa xuất bản') }, false)

  const visitor = app.client.anonymous()
  const get = async (path: string) => {
    const response = await visitor.get(path)
    // The hydration markers sit between every tag and say nothing about the page.
    return { status: response.status, body: (await response.text()).replace(/<!--k\[?-->/g, '') }
  }
  const found = (body: string) => [...body.matchAll(/<h2><a href="([^"]+)"/g)].map((m) => m[1]).sort()

  // The words of the body and of a page's sections are found, not only the title.
  const all = await get('/search?q=h%E1%BB%93+t%C3%A2y')
  assert.equal(all.status, 200)
  assert.deepEqual(found(all.body), ['/gioi-thieu', '/tra-sen'])
  assert.match(all.body, /<p role="status">2 kết quả<\/p>/)
  assert.match(all.body, /<title>Tìm kiếm: hồ tây<\/title>/)
  assert.match(all.body, /<meta name="robots" content="noindex">/)
  assert.match(all.body, /<input type="search" name="q" value="hồ tây"/)
  // A post with no excerpt is described by the start of its body.
  assert.match(all.body, /href="\/tra-sen">Trà sen<\/a>.*<p>Hương thơm của Hồ Tây vào mùa hè<\/p>/s)
  // The page has its own form, so the header leaves its box out.
  assert.doesNotMatch(all.body, /wt-public-search-box/)

  const posts = await get('/search?q=h%E1%BB%93+t%C3%A2y&type=post')
  assert.deepEqual(found(posts.body), ['/tra-sen'])
  assert.match(posts.body, /<option value="post" selected/)
  assert.deepEqual(found((await get('/search?q=h%E1%BB%93+t%C3%A2y&type=page')).body), ['/gioi-thieu'])
  // An unknown type searches everything rather than nothing.
  assert.deepEqual(found((await get('/search?q=h%E1%BB%93+t%C3%A2y&type=x')).body), [
    '/gioi-thieu',
    '/tra-sen',
  ])

  assert.match((await get('/search?q=h')).body, /Nhập ít nhất 2 ký tự\./)
  assert.match((await get('/search?q=kh%C3%B4ng+c%C3%B3')).body, /Không tìm thấy kết quả phù hợp\./)
  const empty = await get('/search')
  assert.equal(empty.status, 200)
  assert.doesNotMatch(empty.body, /role="status"/)
  assert.equal((await visitor.post('/search', '')).status, 405)

  // Every other page offers the box.
  assert.match(
    (await get('/tra-sen')).body,
    /<form class="wt-public-search-box" role="search" action="\/search" method="get"><input type="search" name="q"/,
  )

  // The index was built by the searches above; one publish and one withdrawal reach it.
  await save('tra-moi', { title: 'Trà mới', bodyDoc: doc('Cũng từ hồ Tây') })
  const withdrawn = (await call('website.getEntry', { id: 'gioi-thieu' })).entry as Row
  await call('website_studio.setEntryArchived', {
    siteId: 'site-a',
    id: 'gioi-thieu',
    archived: true,
    expectedRevisionId: withdrawn.revisionId,
  })
  assert.deepEqual(found((await get('/search?q=h%E1%BB%93+t%C3%A2y')).body), ['/tra-moi', '/tra-sen'])

  for (let i = 1; i <= 21; i += 1) await save(`moc-${i}`, { title: `Mộc ${i}`, bodyDoc: doc('gỗ mộc') })
  const first = await get('/search?q=g%E1%BB%97+m%E1%BB%99c&type=post')
  assert.match(first.body, /<p role="status">21 kết quả<\/p>/)
  assert.equal(found(first.body).length, 20)
  const next = /<a rel="next" href="([^"]+)">/.exec(first.body)?.[1]?.replaceAll('&amp;', '&')
  assert.equal(next, '/search?q=g%E1%BB%97+m%E1%BB%99c&type=post&page=2')
  const second = await get(next)
  assert.equal(found(second.body).length, 1)
  assert.match(second.body, /<a rel="prev" href="\/search\?q=g%E1%BB%97\+m%E1%BB%99c&amp;type=post">/)
  assert.doesNotMatch(second.body, /rel="next"/)
})
