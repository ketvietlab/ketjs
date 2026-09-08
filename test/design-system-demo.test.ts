import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import type { IncomingMessage } from 'node:http'
import test from 'node:test'
import { createDemoRoutes } from '../apps/design-system/demo.tsx'

const request = (values: Record<string, string>, origin = 'http://127.0.0.1:4000') =>
  Object.assign(Readable.from([new URLSearchParams(values).toString()]), {
    method: 'POST',
    headers: { origin },
  }) as IncomingMessage
const url = new URL('http://127.0.0.1:4000/demo/action')
const valid = {
  intent: 'create',
  return: '/demo',
  customer: 'New customer',
  address: '12 Example Street',
  product: 'CF-01',
  quantity: '3',
  date: '2026-09-09',
  email: 'demo@example.com',
}

test('sales demo: public page compositions use one canonical pattern', () => {
  const routes = createDemoRoutes()
  for (const view of ['overview', 'orders', 'record', 'board']) {
    const response = routes['/demo'](new URL(`http://localhost/demo?view=${view}`))
    assert.equal(response.status, 200)
    assert.match(String(response.body), /data-presentation="grouped"/)
    assert.equal([...String(response.body).matchAll(/data-pattern="/g)].length, 1)
    assert.match(String(response.body), /type="module" src="\/demo\/client.js"/)
    assert.doesNotMatch(String(response.body), /catalogue-specimen/)
  }
})

test('sales demo: collection paging belongs to ListChrome above the table', () => {
  const routes = createDemoRoutes()
  for (const query of ['', '&page=2', '&q=missing']) {
    const html = String(routes['/demo'](new URL(`http://localhost/demo?view=orders${query}`)).body)
    assert.doesNotMatch(html, /data-ui="list-page-footer"|data-ui="pager-pages"/)
    assert.match(html, /data-ui="list-chrome"[\s\S]*data-ui="pager-bar"[\s\S]*data-ui="list-page-body"/)
    assert.match(
      html,
      query === '' ? /1–8 \/ 12 đơn hàng/ : query === '&page=2' ? /9–12 \/ 12 đơn hàng/ : /0–0 \/ 0 đơn hàng/,
    )
  }
})

test('sales demo: search and status filters keep the current sort', () => {
  const html = String(
    createDemoRoutes()['/demo'](new URL('http://localhost/demo?view=orders&q=SO&sort=asc')).body,
  )
  assert.match(html, /data-ui="list-search"[\s\S]*name="sort" value="asc"/)
  assert.match(html, /data-ui="list-facet"[^>]*href="[^"]*q=SO[^"]*sort=asc/)
  assert.match(html, /data-ui="list-facet"[^>]*href="[^"]*sort=asc[^"]*status=draft/)
})

test('sales demo: validates and persists a created record without touching other instances', async () => {
  const routes = createDemoRoutes()
  const invalid = await routes['/demo/action'](url, request({ ...valid, quantity: '0' }))
  assert.equal(invalid.status, 422)
  assert.match(String(invalid.body), /aria-invalid="true"/)
  assert.match(String(invalid.body), /value="New customer"/)
  const created = await routes['/demo/action'](url, request(valid))
  assert.equal(created.status, 303)
  assert.match(created.headers!.location, /id=SO-1043/)
  const exported = routes['/demo/export'](new URL('http://localhost/demo/export?id=SO-1043'))
  assert.match(String(exported.body), /New customer/)
  assert.match(String(exported.body), /960000/)
  assert.doesNotMatch(
    String(createDemoRoutes()['/demo/export'](new URL('http://localhost/demo/export')).body),
    /New customer/,
  )
})

test('sales demo: rejects cross-origin writes and off-site redirects', async () => {
  const routes = createDemoRoutes()
  assert.equal((await routes['/demo/action'](url, request(valid, 'https://example.com'))).status, 403)
  assert.equal(
    (await routes['/demo/action'](url, request({ ...valid, return: '//example.com' }))).status,
    400,
  )
  assert.equal(
    (await routes['/demo/action'](url, request({ ...valid, intent: 'save', id: 'missing' }))).status,
    404,
  )
})
