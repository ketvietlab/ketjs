import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import type { IncomingMessage } from 'node:http'
import test from 'node:test'
import { createDemo2Routes, createDemoRoutes } from '../apps/design-system/demo.tsx'

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
    assert.match(String(response.body), /data-ui="app-navigation"/)
    assert.match(String(response.body), /data-ui="navigation-drawer"/)
    assert.match(String(response.body), /data-ui="navigation-item"/)
    assert.doesNotMatch(String(response.body), /class="demo-sidebar"/)
    assert.doesNotMatch(String(response.body), /catalogue-specimen/)
  }
})

test('submenu demo: keeps the original demo intact and exposes 18 dense application modules', () => {
  const original = String(createDemoRoutes()['/demo'](new URL('http://localhost/demo')).body)
  assert.doesNotMatch(original, /data-demo-submenu/)

  const html = String(createDemo2Routes()['/demo2'](new URL('http://localhost/demo2')).body)
  assert.match(html, /data-demo-submenu/)
  assert.equal([...html.matchAll(/data-ui="navigation-item"/g)].length, 18)
  assert.equal([...html.matchAll(/data-ui="navigation-group"/g)].length, 4)
  assert.equal([...html.matchAll(/data-ui="tab"/g)].length, 4)
  assert.equal([...html.matchAll(/data-demo-submenu-trigger/g)].length, 1)
  assert.equal([...html.matchAll(/data-demo-submenu-child="true"/g)].length, 3)
  assert.match(html, /Điều hướng Tổng quan/)
  assert.match(html, /aria-label="Phân tích Tổng quan"/)
  assert.match(html, /data-demo-submenu-children="true"[^>]*hidden/)
  assert.match(html, /href="\/demo2\?theme=light&amp;module=crm"/)
  assert.match(html, /href="\/demo2\?theme=light&amp;view=orders"/)
  assert.doesNotMatch(html, /(?:href|action)="\/demo(?:[?/]|&quot;)/)
})

test('submenu demo: every main module owns four links and one expanding submenu with three destinations', () => {
  const modules = [
    'overview',
    'crm',
    'sales',
    'purchase',
    'products',
    'inventory',
    'warehouse',
    'delivery',
    'projects',
    'support',
    'accounting',
    'cashflow',
    'expenses',
    'billing',
    'reports',
    'people',
    'marketing',
    'settings',
  ]
  const route = createDemo2Routes()['/demo2']
  for (const module of modules) {
    const query =
      module === 'overview'
        ? ''
        : module === 'sales'
          ? '?view=orders'
          : module === 'delivery'
            ? '?view=board'
            : `?module=${module}`
    const html = String(route(new URL(`http://localhost/demo2${query}`)).body)
    assert.equal([...html.matchAll(/data-ui="tab"/g)].length, 4, module)
    assert.equal([...html.matchAll(/data-demo-submenu-trigger/g)].length, 1, module)
    assert.equal([...html.matchAll(/data-demo-submenu-child="true"/g)].length, 3, module)
    assert.equal([...html.matchAll(/data-ui="navigation-item"[^>]*data-active="true"/g)].length, 1, module)
  }
})

test('submenu demo: nested selection is URL-owned and the board submenu filters its columns', () => {
  const routes = createDemo2Routes()
  const nested = String(routes['/demo2'](new URL('http://localhost/demo2?module=inventory&child=1')).body)
  assert.match(nested, /data-demo-submenu-trigger="true" data-active="true"[^>]*aria-expanded="true"/)
  assert.doesNotMatch(nested, /data-demo-submenu-children="true"[^>]*hidden/)
  assert.match(nested, /data-demo-submenu-child="true" data-active="true"/)
  assert.match(nested, /Luân chuyển hàng: 5 mục cần chú ý/)

  const board = String(routes['/demo2'](new URL('http://localhost/demo2?view=board&status=shipping')).body)
  assert.match(board, /data-demo-board="true" data-filtered="true"/)
  assert.match(board, /data-ui="tab" data-active="true"[^>]*href="[^"]*status=shipping/)
  assert.equal([...board.matchAll(/data-ui="section-title"/g)].length, 1)
})

test('sales demo: mobile page actions share the available width evenly', () => {
  const styles = String(createDemoRoutes()['/demo/styles.css']().body)
  assert.match(styles, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/)
  assert.match(styles, /\[data-ui="action"\] \{\s*width: 100%/)
})

test('sales demo: overview columns use the same grouped surface hierarchy', () => {
  const html = String(createDemoRoutes()['/demo'](new URL('http://localhost/demo?theme=light')).body).replace(
    /<!--k\[?-->/gu,
    '',
  )
  assert.match(html, /data-ui="surface"[\s\S]*data-ui="surface-title"[\s\S]*?Ưu tiên hôm nay/)
  assert.doesNotMatch(html, /data-ui="section-title">Ưu tiên hôm nay/)
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
