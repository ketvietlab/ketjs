import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  collectionSearchFrame,
  searchCollectionRows,
} from '../packages/ketsuite/src/modules/backend/collection-search.ts'

test('collection search uses visible labels, preserves decimal strings and excludes hidden identifiers', () => {
  const rows = [
    { id: 'secret-warehouse', name: 'Kho Thành Phẩm', quantity: '0.123456789012345678' },
    { id: 'other', name: 'Nguyên liệu', quantity: '100' },
  ]
  const display = (row: (typeof rows)[number]) => `${row.name} ${row.quantity}`
  const matches = searchCollectionRows(new URL('https://example.test/list?q=THÀNH'), rows, display)
  assert.deepEqual(matches, [rows[0]])
  assert.equal(matches[0]?.quantity, '0.123456789012345678')
  assert.deepEqual(searchCollectionRows(new URL('https://example.test/list?q=secret'), rows, display), [])
  assert.equal(searchCollectionRows(new URL('https://example.test/list?q=%20'), rows, display), rows)
})

test('collection GET search retains locale and repeated filters without reopening transient forms', () => {
  const url = new URL(
    'https://example.test/list?lang=vi&state=draft&state=sent&q=Kho&page=3&create=1&edit=a&invalid=1',
  )
  const viewer = { name: 'Operator', company: 'company-1', companies: ['company-1'] }
  const frame = collectionSearchFrame(url, { viewer }, 'Tìm kho')
  assert.equal(frame.viewer, viewer)
  assert.deepEqual(frame.chrome?.search, {
    name: 'q',
    value: 'Kho',
    placeholder: 'Tìm kho',
    keep: { lang: 'vi', state: ['draft', 'sent'] },
  })
  assert.equal(url.searchParams.get('create'), '1')
})

test('search dismisses record and workflow overlays while retaining ordinary collection tabs', () => {
  const overlay = new URL(
    'https://example.test/list?record=product.template:one&tab=variants&dialog=create&close=sprint-1&carryKey=request-1&state=active',
  )
  assert.deepEqual(collectionSearchFrame(overlay, {}, 'Search').chrome?.search?.keep, { state: 'active' })
  const collection = new URL('https://example.test/list?tab=active&state=draft')
  assert.deepEqual(collectionSearchFrame(collection, {}, 'Search').chrome?.search?.keep, {
    tab: 'active',
    state: 'draft',
  })
})
