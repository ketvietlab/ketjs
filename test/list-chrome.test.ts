import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderToString } from 'ketjs-view'
import { compose, translator } from 'ketjs'
import backend from 'ketsuite/backend'
import { listChrome, PAGE_SIZE, pageOf, pager, searchOf, withParam } from 'ketsuite/backend'
import type { ListChrome } from 'ketsuite/backend'

const _ = translator(compose([backend], { headless: true }), 'vi')
const at = (href: string): URL => new URL(href, 'http://x')
const render = (c: ListChrome): string => renderToString(listChrome(_, c))

const base: ListChrome = { crumbs: [{ label: 'Trang' }] }

test('paging: the URL is the state, so a page is a link somebody can send', () => {
  assert.equal(pageOf(at('/admin/pages')), 1, 'no parameter means the first page')
  assert.equal(pageOf(at('/admin/pages?page=4')), 4)
  assert.equal(pageOf(at('/admin/pages?page=0')), 1, 'nonsense falls back rather than throwing')
  assert.equal(pageOf(at('/admin/pages?page=-2')), 1)
  assert.equal(pageOf(at('/admin/pages?page=abc')), 1)
  assert.equal(searchOf(at('/admin/pages?q=%20%20')), undefined, 'whitespace is not a search')
  assert.equal(searchOf(at('/admin/pages?q=hoa')), 'hoa')
})

test('paging: changing a filter goes back to page one', () => {
  assert.equal(withParam(at('/admin/products?view=list&page=3'), 'q', 'xoai'), '/admin/products?view=list&q=xoai',
    'a new search on page three would otherwise show an empty page three')
  assert.equal(withParam(at('/admin/products?page=3'), 'page', '4'), '/admin/products?page=4', 'paging keeps paging')
  assert.equal(withParam(at('/admin/products?q=x&page=2'), 'q', null), '/admin/products', 'removing the last one leaves a clean URL')
})

test('paging: a list that fits on one page has no pager at all', () => {
  assert.equal(pager(at('/admin/pages'), 1, 12, 12), null)
  assert.equal(pager(at('/admin/pages'), 1, PAGE_SIZE, PAGE_SIZE), null, 'exactly full is still one page')
})

test('paging: the range says what is on screen, and the ends are dead rather than missing', () => {
  const first = pager(at('/admin/pages'), 1, 30, 84)!
  assert.deepEqual([first.from, first.to, first.total], [1, 30, 84])
  assert.equal(first.prev, null, 'no previous page from the first')
  assert.equal(first.next, '/admin/pages?page=2')

  const last = pager(at('/admin/pages?page=3'), 3, 24, 84)!
  assert.deepEqual([last.from, last.to], [61, 84])
  assert.equal(last.next, null)
  assert.equal(last.prev, '/admin/pages?page=2')
})

test('chrome: a control with nothing to say is not rendered', () => {
  const html = render(base)
  assert.ok(!html.includes('data-ui="pager"'), 'no pager when the caller passed none')
  assert.ok(!html.includes('data-ui="chrome-search"'))
  assert.ok(!html.includes('data-ui="chrome-create"'))
  assert.ok(!html.includes('data-ui="view-switch"'))
})

test('chrome: a single view is not a choice, so no switcher appears', () => {
  const one = render({ ...base, views: [{ id: 'list', label: 'Danh sách', icon: '☰', path: '?view=list', active: true }] })
  assert.ok(!one.includes('data-ui="view-switch"'))
})

test('chrome: the last crumb is where you are, and is not a link', () => {
  const html = render({ crumbs: [{ label: 'Quản trị', path: '/admin' }, { label: 'Trang' }] })
  assert.match(html, /<a data-ui="crumb" href="\/admin">/)
  assert.match(html, /<span data-ui="crumb" aria-current="page">/)
})

test('chrome: a facet shows what was filtered and where the × undoes it', () => {
  const html = render({ ...base, search: { name: 'q', value: 'xoai', placeholder: 'Tìm', facets: [{ label: 'Tìm: xoai', without: '/admin/products' }] } })
  assert.match(html, /data-ui="facet-label">[\s\S]*Tìm: xoai/)
  assert.match(html, /<a data-ui="facet-remove" href="\/admin\/products"/)
  assert.match(html, /value="xoai"/, 'the box still holds what was typed')
})

test('chrome: an exhausted arrow stays in place, disabled, so the toolbar does not resize', () => {
  const html = render({ ...base, pager: { from: 1, to: 30, total: 84, prev: null, next: '/p?page=2' } })
  assert.match(html, /<span data-ui="pager-step" data-dir="prev" aria-disabled="true">/)
  assert.match(html, /<a data-ui="pager-step" data-dir="next" href="\/p\?page=2"/)
  assert.match(html, /data-ui="pager-range">[\s\S]*1-30 \/ 84/)
})

test('chrome: an empty list says nothing rather than "1-0 / 0"', () => {
  const html = render({ ...base, pager: { from: 1, to: 0, total: 0, prev: null, next: null } })
  assert.match(html, /data-ui="pager-range">[\s\S]*>0</)
})

test('chrome: every control is a link or a form, so the back button needs no help', () => {
  const html = render({
    crumbs: [{ label: 'a' }],
    create: { label: 'Mới', path: '/new' },
    search: { name: 'q', value: '', placeholder: 'Tìm' },
    pager: { from: 1, to: 30, total: 84, prev: null, next: '/p?page=2' },
    views: [
      { id: 'list', label: 'L', icon: '☰', path: '?view=list', active: true },
      { id: 'kanban', label: 'K', icon: '▦', path: '?view=kanban', active: false },
    ],
  })
  assert.ok(!html.includes('<button'), 'no button means no handler means no client state')
  assert.ok(!html.includes('onclick'))
  assert.match(html, /<form data-ui="chrome-search" method="get"/)
})

test('chrome: searching keeps the rest of the URL, because a GET form replaces all of it', () => {
  const html = render({ ...base, search: { name: 'q', value: '', placeholder: 'Tìm', keep: { view: 'kanban' } } })
  assert.match(html, /<input type="hidden" name="view" value="kanban">/,
    'without this, searching while looking at the cards throws you back to the list')
})
