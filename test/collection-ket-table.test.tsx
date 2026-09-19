import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { KetTable, ListPage } from '@ketvietlab/design-system'
import type { KetTableServerProps } from '@ketvietlab/design-system'
import { collectionTable } from '../packages/ketsuite/src/ui/table.tsx'
import { ketTableDemoConfig } from '../packages/design-system/src/interactions/ket-table/demo.ts'

const translate = ((key: string) => key) as Translator
type Row = { id: string; name: string; amount: string }
const row: Row = { id: 'a/b', name: 'A & B', amount: '9007199254740993.01' }

test('KetTable server collection preserves semantic cells, exact values, native navigation and external bulk forms', () => {
  const html = renderToString(
    collectionTable(translate, {
      rows: [row],
      id: (item) => item.id,
      caption: 'Accounts',
      responsive: 'stack',
      rowHref: (item) => `/admin/accounts/${encodeURIComponent(item.id)}?lang=vi`,
      selection: { formId: 'bulk-accounts', field: 'chosen', action: '/bulk', actions: [] },
      columns: [
        {
          key: 'name',
          label: 'Name',
          cell: (item) => <strong>{item.name}</strong>,
          sort: { href: '?sort=name:desc&lang=vi', direction: 'asc', label: 'Sort name' },
        },
        {
          key: 'amount',
          label: 'Amount',
          align: 'end',
          cell: (item) => <span data-amount={item.amount}>{item.amount}</span>,
        },
      ],
    }),
  )
  assert.match(html, /data-ui="ket-table" data-server="true" data-responsive="stack"/)
  assert.match(html, /data-ui="kt-caption"[^>]*>[\s\S]*?Accounts/)
  assert.match(html, /data-ui="kt-row-link"[^>]*href="\/admin\/accounts\/a%2Fb\?lang=vi"/)
  assert.match(html, /<strong>[\s\S]*?A &amp; B[\s\S]*?<\/strong>/)
  assert.match(html, /data-amount="9007199254740993.01"/)
  assert.match(html, /name="chosen.a\/b" value="1" form="bulk-accounts"/)
  assert.match(html, /aria-sort="ascending"/)
  assert.match(html, /href="\?sort=name:desc&amp;lang=vi"/)
  assert.doesNotMatch(html, /data-ui="table"|kt-select-persisted|\[object Object\]/)
})

test('KetTable server groups retain URL expansion, leaf paging and closed rows', () => {
  const props: KetTableServerProps<Row> = {
    rows: [],
    id: (item) => item.id,
    columns: [{ key: 'name', label: 'Name', cell: (item) => item.name }],
    labels: ketTableDemoConfig.labels,
    groups: [
      {
        id: 'open',
        label: 'Open',
        count: 3,
        open: true,
        href: '?closed=open',
        rows: [row],
        pager: { label: '1 / 3', next: '?groupPage=2&lang=vi' },
      },
      {
        id: 'closed',
        label: 'Closed',
        count: 1,
        open: false,
        href: '?open=closed',
        rows: [{ ...row, name: 'Hidden child' }],
      },
    ],
  }
  const html = renderToString(<KetTable {...props} />)
  assert.match(html, /data-ui="kt-group-toggle" href="\?closed=open" aria-expanded="true"/)
  assert.match(html, /data-direction="next" href="\?groupPage=2&amp;lang=vi"/)
  assert.match(html, /A &amp; B/)
  assert.doesNotMatch(html, /Hidden child|data-ui="empty"/)
})

test('operational collection order is context, filter, actions, table', () => {
  const html = renderToString(
    <ListPage
      variant="operational"
      title="Accounts"
      context="Breadcrumbs"
      controls="Filter"
      actions="Create"
      body="Rows"
    />,
  )
  const hooks = ['list-page-context', 'list-page-controls', 'list-page-actions', 'list-page-body']
  const positions = hooks.map((hook) => html.indexOf(`data-ui="${hook}"`))
  assert.ok(
    positions.every((position, index) => position >= 0 && (!index || position > positions[index - 1]!)),
  )
  const css = readFileSync('packages/design-system/src/interactions/ket-table/styles.css', 'utf8')
  assert.match(css, /data-responsive="stack"/)
  assert.match(css, /content: attr\(data-label\)/)
})
