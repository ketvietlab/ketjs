import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderToString } from '@ketvietlab/ketjs-view'
import { compose, translator } from '@ketvietlab/ketjs'
import backend from '@ketvietlab/ketsuite/backend'
import { listChrome, PAGE_SIZE, pageOf, pager, searchOf, withParam } from '@ketvietlab/ketsuite/backend'
import type { ListChrome } from '@ketvietlab/ketsuite/backend'

const _ = translator(compose([backend], { headless: true }), 'vi')
const at = (href: string): URL => new URL(href, 'http://x')
const render = (c: ListChrome): string => renderToString(listChrome(_, 'Trang', c))

const base: ListChrome = {}

test('paging: the URL is the state, so a page is a link somebody can send', () => {
  assert.equal(pageOf(at('/admin/website/pages')), 1, 'no parameter means the first page')
  assert.equal(pageOf(at('/admin/website/pages?page=4')), 4)
  assert.equal(pageOf(at('/admin/website/pages?page=0')), 1, 'nonsense falls back rather than throwing')
  assert.equal(pageOf(at('/admin/website/pages?page=-2')), 1)
  assert.equal(pageOf(at('/admin/website/pages?page=abc')), 1)
  assert.equal(searchOf(at('/admin/website/pages?q=%20%20')), undefined, 'whitespace is not a search')
  assert.equal(searchOf(at('/admin/website/pages?q=hoa')), 'hoa')
})

test('paging: changing a filter goes back to page one', () => {
  assert.equal(
    withParam(at('/admin/product/templates?view=list&page=3'), 'q', 'xoai'),
    '/admin/product/templates?view=list&q=xoai',
    'a new search on page three would otherwise show an empty page three',
  )
  assert.equal(
    withParam(at('/admin/product/templates?page=3'), 'page', '4'),
    '/admin/product/templates?page=4',
    'paging keeps paging',
  )
  assert.equal(
    withParam(at('/admin/product/templates?q=x&page=2'), 'q', null),
    '/admin/product/templates',
    'removing the last one leaves a clean URL',
  )
})

test('paging: a list that fits on one page has no pager at all', () => {
  assert.equal(pager(at('/admin/website/pages'), 1, 12, 12), null)
  assert.equal(
    pager(at('/admin/website/pages'), 1, PAGE_SIZE, PAGE_SIZE),
    null,
    'exactly full is still one page',
  )
})

test('paging: the range says what is on screen, and the ends are dead rather than missing', () => {
  const first = pager(at('/admin/website/pages'), 1, 30, 84)!
  assert.deepEqual([first.from, first.to, first.total], [1, 30, 84])
  assert.equal(first.prev, null, 'no previous page from the first')
  assert.equal(first.next, '/admin/website/pages?page=2')

  const last = pager(at('/admin/website/pages?page=3'), 3, 24, 84)!
  assert.deepEqual([last.from, last.to], [61, 84])
  assert.equal(last.next, null)
  assert.equal(last.prev, '/admin/website/pages?page=2')
})

test('chrome: a control with nothing to say is not rendered', () => {
  const html = render(base)
  assert.ok(!html.includes('data-ui="pager"'), 'no pager when the caller passed none')
  assert.ok(!html.includes('data-ui="chrome-search"'))
  assert.ok(!html.includes('data-ui="chrome-create"'))
  assert.ok(!html.includes('data-ui="view-switch"'))
})

test('chrome: a single view is not a choice, so no switcher appears', () => {
  const one = render({
    ...base,
    views: [{ id: 'list', label: 'Danh sách', icon: '☰', path: '?view=list', active: true }],
  })
  assert.ok(!one.includes('data-ui="view-switch"'))
})

test('chrome: the title is the title — no breadcrumb repeating the sidebar', () => {
  const html = render(base)
  assert.match(html, /<h1 data-ui="title">[\s\S]*Trang/)
  assert.ok(!html.includes('data-ui="crumb"'), 'the sidebar already says which app and which entry')
})

test('chrome: catalogue layout keeps context and actions left while tools stay in one right cluster', () => {
  const html = render({
    layout: 'catalogue',
    section: 'Sản phẩm',
    create: { label: 'Tạo mới', path: '/new' },
    search: { name: 'q', placeholder: 'Tìm sản phẩm…' },
    pager: { from: 1, to: 30, total: 84, prev: null, next: '/p?page=2' },
  })
  assert.match(html, /data-ui="list-chrome" data-layout="catalogue"/)
  assert.match(html, /data-ui="list-context">[\s\S]*Sản phẩm/)
  assert.match(
    html,
    /data-ui="list-chrome-row">[\s\S]*data-ui="chrome-lead"[\s\S]*data-ui="chrome-tools"[\s\S]*data-ui="chrome-search"[\s\S]*data-ui="chrome-tail"/,
  )
})

test('chrome: a facet shows what was filtered and where the × undoes it', () => {
  const html = render({
    ...base,
    search: {
      name: 'q',
      value: 'xoai',
      placeholder: 'Tìm',
      facets: [{ label: 'Tìm: xoai', without: '/admin/product/templates' }],
    },
  })
  assert.match(html, /data-ui="facet-label">[\s\S]*Tìm: xoai/)
  assert.match(html, /<a data-ui="facet-remove" href="\/admin\/product\/templates"/)
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

test('chrome: navigation stays URL-driven while compact search uses an accessible modal', () => {
  const html = render({
    create: { label: 'Mới', path: '/new' },
    search: { name: 'q', value: '', placeholder: 'Tìm' },
    pager: { from: 1, to: 30, total: 84, prev: null, next: '/p?page=2' },
    views: [
      { id: 'list', label: 'L', icon: '☰', path: '?view=list', active: true },
      { id: 'kanban', label: 'K', icon: '▦', path: '?view=kanban', active: false },
    ],
  })
  assert.ok(!html.includes('onclick'))
  assert.equal((html.match(/<form data-ui="chrome-search"/g) ?? []).length, 2)
  assert.match(html, /data-presentation="inline" method="get" role="search" autocomplete="off"/)
  assert.match(html, /data-presentation="modal" method="get" role="search" autocomplete="off"/)
  assert.equal((html.match(/type="search"[^>]*autocomplete="off"/g) ?? []).length, 2)
  assert.match(
    html,
    /<button data-ui="chrome-search-toggle" type="button"[^>]*aria-controls="backend-global-filter"/,
  )
  assert.match(html, /<dialog data-ui="chrome-search-modal" id="backend-global-filter"/)
  assert.ok(!html.includes('data-ui="chrome-search-close"'))
  assert.match(html, /<button data-ui="chrome-search-apply" type="submit">[\s\S]*Áp dụng/)
})

test('chrome: searching keeps the rest of the URL, because a GET form replaces all of it', () => {
  const html = render({
    ...base,
    search: { name: 'q', value: '', placeholder: 'Tìm', keep: { view: 'kanban' } },
  })
  assert.match(
    html,
    /<input type="hidden" name="view" value="kanban" autocomplete="off">/,
    'without this, searching while looking at the cards throws you back to the list',
  )
})

test('chrome: resource menus sit after paging and before the product-style view switch', () => {
  const html = render({
    search: { name: 'q', value: '', placeholder: 'Tìm' },
    pager: { from: 1, to: 30, total: 84, prev: null, next: '/p?page=2' },
    tailMenus: [
      {
        id: 'assignee',
        label: 'Người phụ trách',
        icon: 'users',
        keep: { view: 'kanban', bucket: 'due' },
        search: {
          name: 'assigneeQ',
          placeholder: 'Tìm người phụ trách',
          submitLabel: 'Tìm',
        },
        items: [{ id: 'me', label: 'Tôi', path: '?assignee=me' }],
      },
    ],
    views: [
      { id: 'list', label: 'Danh sách', icon: 'list', path: '?view=list', active: false },
      { id: 'kanban', label: 'Thẻ', icon: 'layout-grid', path: '?view=kanban', active: true },
    ],
  })
  assert.match(html, /data-ui="pager"[\s\S]*data-ui="chrome-tail-menu"[\s\S]*data-ui="view-switch"/)
  assert.match(html, /name="view" value="kanban"/)
  assert.match(html, /name="bucket" value="due"/)
  assert.equal(
    (html.match(/data-ui="search-menu"/g) ?? []).length,
    1,
    'the assignee control is no longer duplicated inside global search',
  )
})
