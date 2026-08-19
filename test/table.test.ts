import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderToString } from 'ketjs-view'
import { compose, translator } from 'ketjs'
import backend from 'ketsuite/backend'
import { badge, colsHref, colsOf, dataTable, initials, person, visibleColumns } from 'ketsuite/backend'
import type { Column, DataTable } from 'ketsuite/backend'

const _ = translator(compose([backend], { headless: true }), 'vi')

type Row = { id: string; name: string; qty: number }
const rows: Row[] = [{ id: 'a', name: 'Xoài', qty: 12 }, { id: 'b', name: 'Nhãn', qty: 3 }]

const columns: Array<Column<Row>> = [
  { key: 'name', label: 'Tên', cell: (r) => r.name },
  { key: 'qty', label: 'SL', cell: (r) => String(r.qty), align: 'end' },
  { key: 'id', label: 'Mã', cell: (r) => r.id, optional: true },
]

const table = (over: Partial<DataTable<Row>> = {}): DataTable<Row> =>
  ({ columns, rows, id: (r) => r.id, ...over })
const render = (over: Partial<DataTable<Row>> = {}): string => renderToString(dataTable(_, table(over)))

test('table: an optional column is off until the URL asks for it', () => {
  assert.deepEqual(visibleColumns(table()).map(c => c.key), ['name', 'qty'])
  assert.deepEqual(visibleColumns(table({ shown: ['id'] })).map(c => c.key), ['name', 'qty', 'id'])
  assert.deepEqual(visibleColumns(table({ shown: ['nope'] })).map(c => c.key), ['name', 'qty'],
    'a column nobody declares is ignored, not a crash')
})

test('table: a column that is off is absent from the HTML, not hidden by CSS', () => {
  const html = render()
  assert.ok(!html.includes('data-col="id"'), 'hiding in CSS would still ship the data to the browser')
  assert.ok(render({ shown: ['id'] }).includes('data-col="id"'))
})

test('table: no optional columns means no menu to configure them', () => {
  const plain = renderToString(dataTable(_, {
    columns: columns.slice(0, 2), rows, id: (r) => r.id, colsHref: () => '/x',
  }))
  assert.ok(!plain.includes('data-ui="col-config"'), 'a table with nothing to configure has no gear')
})

test('table: the menu offers the same list with one column more, or one fewer', () => {
  const html = render({ shown: ['id'], colsHref: (keys) => `/p?cols=${keys.join(',')}` })
  assert.match(html, /data-ui="col-toggle" data-on="true"\s+href="\/p\?cols="/,
    'a column that is on offers the list without it')

  const off = render({ shown: [], colsHref: (keys) => `/p?cols=${keys.join(',')}` })
  assert.match(off, /data-ui="col-toggle" data-on="false"\s+href="\/p\?cols=id"/)
})

test('table: the column menu is links, because a checkbox would need a handler', () => {
  const html = render({ shown: ['id'], colsHref: () => '/p' })
  assert.ok(!html.includes('<input'), 'no input means no form means no client state')
  assert.ok(!html.includes('<button'))
})

test('table: choosing a column keeps the page you are on', () => {
  const url = new URL('/admin/products?q=xoai&page=3', 'http://x')
  assert.equal(colsHref(url)(['id']), '/admin/products?q=xoai&page=3&cols=id',
    'showing one more column is not a new filter, so page three is still page three')
  assert.equal(colsHref(url)([]), '/admin/products?q=xoai&page=3', 'and the last one off leaves a clean URL')
})

test('table: reading the chosen columns out of the URL survives junk', () => {
  assert.deepEqual(colsOf(new URL('/p', 'http://x')), [])
  assert.deepEqual(colsOf(new URL('/p?cols=', 'http://x')), [])
  assert.deepEqual(colsOf(new URL('/p?cols=id,%20category%20,,', 'http://x')), ['id', 'category'])
})

test('table: numbers are right-aligned so a column can be read down', () => {
  const html = render()
  assert.match(html, /data-ui="col" data-col="qty" data-align="end"/)
  assert.match(html, /data-ui="cell" data-col="qty" data-align="end"/)
  assert.match(html, /data-ui="cell" data-col="name" data-align="start"/, 'text stays where it is')
})

test('badge: the tone says what it means, and the raw state comes along', () => {
  const html = renderToString(badge('Đã đăng', 'positive', 'published'))
  assert.match(html, /data-tone="positive"/)
  assert.match(html, /data-value="published"/, 'a stylesheet can still be more specific when it has to be')
})

test('avatar: initials come from the name people answer to', () => {
  assert.equal(initials('Nguyễn Quản Trị'), 'QT', 'Vietnamese puts the given name last')
  assert.equal(initials('Nguyễn Thị Hoàng Yến Vy'), 'YV', 'the last two, in reading order')
  assert.equal(initials('Admin'), 'A', 'one word is one letter')
  assert.equal(initials('   '), '?', 'an empty name is a question mark, not a crash')
})

test('avatar: the name is on the wrapper, so a screen reader is not read initials', () => {
  const html = renderToString(person('Nguyễn Quản Trị'))
  assert.match(html, /data-ui="avatar" title="Nguyễn Quản Trị" aria-hidden="true"/)
  assert.match(html, /data-ui="person-name">[\s\S]*Nguyễn Quản Trị/)
})
