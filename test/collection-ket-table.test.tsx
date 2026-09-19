import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { KetTable, ListPage, LinkButton } from '@ketvietlab/design-system'
import type { KetTableServerProps } from '@ketvietlab/design-system'
import { collectionTable } from '../packages/ketsuite/src/ui/table.tsx'
import { ketTableDemoConfig } from '../packages/design-system/src/interactions/ket-table/demo.ts'
import { ListPage as CollectionPage } from '../packages/ketsuite/src/ui/list-page.tsx'
import { collectionActions, collectionControls } from '../packages/ketsuite/src/ui/collection.tsx'
import type { Frame } from '../packages/ketsuite/src/ui/layout.tsx'

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

test('operational collection order is context, title/create/tools, filter, table', () => {
  const html = renderToString(
    <ListPage
      variant="operational"
      actionsPlacement="header"
      title="Accounts"
      context="Breadcrumbs"
      headerActions="Create"
      controls="Filter"
      actions="Export"
      body="Rows"
    />,
  )
  const positions = ['Breadcrumbs', 'Accounts', 'Create', 'Export', 'Filter', 'Rows'].map((text) =>
    html.indexOf(text),
  )
  assert.ok(
    positions.every((position, index) => position >= 0 && (!index || position > positions[index - 1]!)),
  )
  const css = readFileSync('packages/design-system/src/interactions/ket-table/styles.css', 'utf8')
  assert.match(css, /data-responsive="stack"/)
  assert.match(css, /content: attr\(data-label\)/)
})

test('collection frame places creation and tools together in the header and preserves permission-controlled creation', () => {
  const frame: Frame = {
    chrome: {
      create: { label: 'Create record', path: '/records?record=example:new&lang=vi' },
      search: { name: 'q', value: 'saved query', placeholder: 'Filter records' },
      selection: {
        formId: 'bulk-records',
        action: '/records/bulk',
        actions: [{ id: 'archive', label: 'Archive selected' }],
      },
    },
  }
  const render = (current: Frame, headerActions?: ReturnType<typeof LinkButton> | null) =>
    renderToString(
      <CollectionPage
        variant="operational"
        frame={current}
        title="Records"
        headerActions={headerActions}
        controls={collectionControls(translate, 'Records', current)}
        actions={collectionActions(translate, current)}
        body="Record rows"
      />,
    )
  const html = render(frame)
  const headerStart = html.indexOf('data-ui="list-page-header"')
  const header = html.slice(headerStart, html.indexOf('</header>', headerStart))
  assert.match(header, /href="\/records\?record=example:new&amp;lang=vi"/)
  assert.equal(html.match(/>Create record</g)?.length, 1)
  assert.ok(html.indexOf('Create record') < html.indexOf('data-ui="list-page-controls"'))
  assert.match(header, /data-ui="list-page-tools"[\s\S]*?data-ui="bulk-form"/)
  assert.ok(html.indexOf('data-ui="bulk-form"') < html.indexOf('data-ui="list-page-controls"'))
  assert.equal(html.match(/data-ui="list-page-actions"/g)?.length, 1)
  assert.match(header, /id="bulk-records"[^>]*action="\/records\/bulk"/)
  assert.match(html, /value="saved query"/)
  assert.doesNotMatch(render({ chrome: { ...frame.chrome, create: null } }), /Create record/)
  assert.doesNotMatch(render(frame, null), /Create record/)
  assert.match(render(frame, null), /data-ui="bulk-form"/)
  assert.doesNotMatch(
    render({ chrome: { create: frame.chrome!.create } }, null),
    /data-kv-page-identity="actions"/,
  )
  const override = render(frame, <LinkButton label="Schedule record" href="/schedule" variant="primary" />)
  assert.match(override, /Schedule record/)
  assert.doesNotMatch(override, /Create record/)
  assert.equal(collectionActions(translate, { chrome: { create: frame.chrome!.create } }), undefined)
})
