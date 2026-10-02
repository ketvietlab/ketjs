import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToString } from '@ketvietlab/ketjs-view'
import { createKetTableView, KetTable } from '@ketvietlab/design-system'
import { ketTableDemoConfig } from '../packages/design-system/src/interactions/ket-table/demo.ts'

test('KetTable: descriptive wrapping preserves the complete value and native record link in both renderers', () => {
  const name = 'A long product description with meaningful detail that must remain readable'
  const rows = [{ id: 'item', name, price: 12000 }]
  const island = createKetTableView({
    id: 'wrapped-table',
    config: {
      ...ketTableDemoConfig,
      columns: [
        { key: 'name', label: 'Product', wrap: true, format: { kind: 'text', field: 'name' } },
        { key: 'price', label: 'Price', format: { kind: 'number', field: 'price' } },
      ],
      rows,
      rowHrefTemplate: '/products/{id}',
    },
  }).view()
  const server = (
    <KetTable
      columns={[
        { key: 'name', label: 'Product', wrap: true, cell: (row: (typeof rows)[number]) => row.name },
        { key: 'price', label: 'Price', cell: (row: (typeof rows)[number]) => String(row.price) },
      ]}
      rows={rows}
      id={(row) => row.id}
      rowHref={(row) => `/products/${row.id}`}
      labels={ketTableDemoConfig.labels}
    />
  )
  for (const view of [island, server]) {
    const output = renderToString(view)
    assert.match(output, /data-ui="kt-cell" data-col="name"[^>]*data-wrap="true"/)
    assert.doesNotMatch(output, /data-ui="kt-cell" data-col="price"[^>]*data-wrap=/)
    assert.match(output, /href="\/products\/item"/)
    assert.ok(output.includes(name))
  }
})

test('KetTable: URL-driven pagination and sorting preserve the server state', () => {
  const html = renderToString(
    createKetTableView({
      id: 'navigation-table',
      config: {
        ...ketTableDemoConfig,
        columns: [{ ...ketTableDemoConfig.columns[0]!, sortHref: '?sort=name:desc&page=1' }],
        manager: { listFunction: '', pageSize: 30 },
        page: 2,
        total: 70,
        sort: { field: 'name', direction: 'asc' },
        pager: { prev: '?page=1', next: '?page=3' },
      },
    }).view(),
  )
  assert.match(html, /aria-sort="ascending"/)
  assert.match(html, /<a data-ui="kt-sort-button" href="\?sort=name:desc&amp;page=1"/)
  assert.match(html, /31–60 \/ 70/)
  assert.match(html, /data-direction="next" href="\?page=3"/)
  assert.doesNotMatch(html, /<button data-ui="kt-pager-button"/)
})

test('KetTable: pre-expanded nested groups, native leaf paging and closed nodes render correctly', () => {
  const html = renderToString(
    createKetTableView({
      id: 'nested-table',
      config: {
        ...ketTableDemoConfig,
        manager: undefined,
        groupBy: ['type', 'category'],
        groups: [
          {
            id: 'goods',
            label: 'Goods',
            count: 40,
            open: true,
            href: '?close=goods',
            children: [
              {
                id: 'wear',
                label: 'Workwear',
                count: 35,
                open: true,
                href: '?close=wear',
                rows: [ketTableDemoConfig.rows[0]!],
                pager: { label: '31–35 / 35', prev: '?groupPage=1' },
              },
              {
                id: 'hidden',
                label: 'Closed',
                count: 5,
                open: false,
                href: '?open=hidden',
                rows: [{ id: 'hidden-row', name: 'Should not render' }],
              },
            ],
          },
        ],
      },
    }).view(),
  )
  assert.match(html, /href="\?close=wear" aria-expanded="true"/)
  assert.match(html, /data-row="p1"/)
  assert.match(html, /31–35 \/ 35/)
  assert.match(html, /href="\?groupPage=1"/)
  assert.doesNotMatch(html, /data-row="hidden-row"/)
})

test('KetTable: empty grouped results expose an empty state and external paging is not duplicated', () => {
  for (const groupBy of [[], ['type']]) {
    const html = renderToString(
      createKetTableView({
        id: 'empty-table',
        config: {
          ...ketTableDemoConfig,
          rows: [],
          total: 0,
          groupBy,
          groups: [],
          pager: false,
        },
      }).view(),
    )
    assert.match(html, /data-ui="empty"/)
    assert.doesNotMatch(html, /data-ui="kt-pager"/)
  }
})

test('KetTable: currency cells retain database decimal precision and the requested locale', () => {
  const html = renderToString(
    createKetTableView({
      id: 'decimal-table',
      config: {
        ...ketTableDemoConfig,
        locale: 'en-US',
        columns: [
          { key: 'price', label: 'Price', format: { kind: 'currency', field: 'price', currency: 'USD' } },
        ],
        rows: [{ id: 'large-price', price: '9007199254740993.25' }],
      },
    }).view(),
  )
  assert.match(html, /value="9007199254740993\.25"/)
  assert.match(html, /9,007,199,254,740,993\.25/)
})
