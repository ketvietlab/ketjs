import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToString } from '@ketvietlab/ketjs-view'
import { TreeGrid } from '../packages/design-system/src/data-display/tree/index.tsx'

test('TreeGrid localizes its hierarchy heading and keeps metadata in independent columns', () => {
  const props = {
    label: 'Danh mục sản phẩm',
    rows: [
      { row: { id: 'a', title: 'Cha', count: 2 }, level: 1 },
      { row: { id: 'b', title: 'Tên con rất dài', count: 1 }, level: 2 },
    ],
    id: (r: { id: string }) => r.id,
    primary: (r: { title: string }) => r.title,
    columns: [{ key: 'count', label: 'Sản phẩm', cell: (r: { count: number }) => String(r.count) }],
  }
  const localized = renderToString(<TreeGrid {...props} primaryLabel="Tên" />)
  assert.match(localized, /<th scope="col">[\s\S]*?Tên/)
  assert.doesNotMatch(localized, />Name</)
  assert.match(localized, /aria-level="2"/)
  assert.equal((localized.match(/<td>/g) || []).length, 2)
  assert.match(renderToString(<TreeGrid {...props} />), />Name</)
})

test('TreeGrid rowHref makes the whole row one link in the hierarchy cell, without nesting links', () => {
  const props = {
    label: 'Danh mục',
    rows: [
      { row: { id: 'a', title: 'Cha' }, level: 1, hasChildren: true },
      { row: { id: 'b', title: 'Con' }, level: 2 },
    ],
    id: (r: { id: string }) => r.id,
    primary: (r: { title: string }) => r.title,
    columns: [{ key: 'id', label: 'Mã', cell: (r: { id: string }) => r.id }],
  }
  const linked = renderToString(<TreeGrid {...props} rowHref={(r) => `/c/${r.id}`} />)
  assert.match(
    linked,
    /<th scope="row"[^>]*data-linked="true"[^>]*>(?:<!--[^>]*-->)*<a data-ui="tree-grid-link" href="\/c\/b">/,
  )
  assert.equal((linked.match(/data-ui="tree-grid-link"/g) || []).length, 2)
  assert.equal((linked.match(/<td>/g) || []).length, 2, 'metadata cells stay plain')
  const plain = renderToString(<TreeGrid {...props} />)
  assert.doesNotMatch(plain, /tree-grid-link|data-linked/)
})
