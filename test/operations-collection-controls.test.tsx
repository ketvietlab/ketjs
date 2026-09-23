import {
  loadSaleOrderCollection,
  loadSalePartnerNames,
} from '../packages/ketsuite/src/modules/sale_backend/order-collection.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { collectionSearchFrame } from '../packages/ketsuite/src/modules/backend/collection-search.ts'
import { bomsListScreen } from '../packages/ketsuite/src/modules/manufacturing_backend/screens/boms-list.tsx'
import { transfersListScreen } from '../packages/ketsuite/src/modules/stock_backend/screens/transfers-list.tsx'
import { quotationsListScreen } from '../packages/ketsuite/src/modules/sale_backend/screens/quotations-list.tsx'
import { purchaseOrdersListScreen } from '../packages/ketsuite/src/modules/purchase_backend/screens/purchase-orders-list.tsx'
import { accountsListScreen } from '../packages/ketsuite/src/modules/account_backend/screens/accounts-list.tsx'
import { openingBalancesListScreen } from '../packages/ketsuite/src/modules/account_backend/screens/opening-balances.tsx'
import { periodClosesListScreen } from '../packages/ketsuite/src/modules/account_backend/screens/period-closes.tsx'

const translate = ((key: string) => key) as Translator
translate.locale = 'en'
translate.has = () => true
translate.resolves = translate.has

const urlFor = (path: string) =>
  new URL(`https://ket.test${path}?q=record&state=draft&sort=name&lang=vi&page=2`)
const frameFor = (url: URL) => collectionSearchFrame(url, {}, 'Search records')
const entries = Array.from({ length: 35 }, (_, index) => ({
  id: `record-${index + 1}`,
  name: `record ${String(index + 1).padStart(2, '0')}`,
}))
const links = (html: string) =>
  [...html.matchAll(/href="([^"]+)"/g)].map(
    (match) => new URL(match[1].replaceAll('&amp;', '&'), 'https://ket.test'),
  )

const assertPage = (html: string) => {
  assert.match(html, /data-layout="command"/)
  assert.match(html, /31-35 \/ 35/)
  assert.doesNotMatch(html, />record 01</)
  assert.match(html, />record 31</)
  assert.match(html, />record 35</)
  assert.doesNotMatch(html, /data-view="kanban"|data-ui="col-config"/)
  const previous = links(html).find((url) => url.searchParams.get('page') === '1')
  assert.ok(previous)
  for (const [key, value] of Object.entries({ q: 'record', state: 'draft', sort: 'name', lang: 'vi' })) {
    assert.equal(previous.searchParams.get(key), value)
  }
  assert.ok(links(html).some((url) => url.searchParams.has('columns')))
  assert.ok(html.indexOf('data-ui="chrome-search"') < html.indexOf('data-ui="pager"'))
  assert.ok(html.indexOf('data-ui="pager"') < html.indexOf('data-ui="ket-table"'))
}

test('manufacturing complete collection pages real rows and keeps exact decimal text', () => {
  const url = urlFor('/admin/manufacturing/boms')
  const rows = entries.map((row) => ({
    ...row,
    code: row.name,
    product: 'Finished product',
    quantity: '1234567890.123456789',
  }))
  const render = (target: URL) =>
    renderToString(
      bomsListScreen(
        translate,
        {
          rows,
          createHref: '/admin/manufacturing/boms?create=1&lang=vi',
        },
        frameFor(target),
      ),
    )
  const html = render(url)
  assertPage(html)
  assert.match(html, /1234567890\.123456789/)
  const toggle = links(html).find(
    (target) =>
      target.searchParams.has('columns') &&
      !target.searchParams.get('columns')!.split(',').includes('quantity'),
  )
  assert.ok(toggle)
  assert.equal(toggle.searchParams.get('page'), '2')
  const hidden = render(toggle)
  assert.doesNotMatch(hidden, /data-col="quantity"/)
  assert.match(hidden, />record 31</)
})

test('stock transfers page complete rows and retain bulk selection and native record links', () => {
  const url = urlFor('/admin/stock/transfers')
  const selection = {
    formId: 'transfers-bulk',
    action: '/admin/stock/transfers/bulk?lang=vi',
    actions: [{ id: 'cancel', label: 'Cancel selected' }],
  }
  const html = renderToString(
    transfersListScreen(
      translate,
      {
        rows: entries.map((row) => ({
          ...row,
          operationType: 'Internal',
          source: 'Source',
          destination: 'Destination',
          scheduledDate: '2026-09-19',
          state: 'draft',
          href: `/admin/stock/transfers/${row.id}?lang=vi`,
        })),
        createHref: '/admin/stock/transfers/new?lang=vi',
        table: { selection },
      },
      frameFor(url),
    ),
  )
  assertPage(html)
  assert.equal(html.match(/data-ui="kt-row-select"/g)?.length, 5)
  assert.match(html, /form="transfers-bulk"/)
  const headerStart = html.indexOf('data-ui="list-page-header"')
  const header = html.slice(headerStart, html.indexOf('</header>', headerStart))
  assert.match(header, /href="\/admin\/stock\/transfers\/new\?lang=vi"/)
  assert.match(header, /data-ui="list-page-tools"[\s\S]*?id="transfers-bulk"/)
  assert.ok(html.indexOf('id="transfers-bulk"') < html.indexOf('data-ui="chrome-search"'))
  assert.match(html, /href="\/admin\/stock\/transfers\/record-31\?lang=vi"/)
})

test('sale quotation paging keeps full-collection summary and authorized print report', () => {
  const html = renderToString(
    quotationsListScreen(
      translate,
      {
        rows: entries.map((row) => ({
          ...row,
          partnerName: 'Customer',
          dateOrder: '2026-09-19',
          state: 'draft',
          amountTotal: '1.25',
          currency: 'USD',
        })),
        createHref: '/admin/sales/quotations/new?lang=vi',
        detailSuffix: '?lang=vi',
        printReport: { id: 'sale.quotation', title: 'Quotation' },
      },
      frameFor(urlFor('/admin/sales/quotations')),
    ),
  )
  assertPage(html)
  assert.match(html, /sale_backend.quotation.summary.draft: 35/)
  assert.match(html, /href="\/reports\/sale.quotation\/record-31\?lang=vi"/)
})

test('purchase orders preserve existing server page and do not invent a create action', () => {
  const url = urlFor('/admin/purchase/orders')
  const frame = frameFor(url)
  frame.chrome = {
    ...frame.chrome,
    pager: { from: 31, to: 35, total: 35, prev: '/admin/purchase/orders?page=1&lang=vi' },
  }
  const html = renderToString(
    purchaseOrdersListScreen(translate, {
      frame,
      rows: entries.slice(30).map((row) => ({
        ...row,
        partnerName: 'Vendor',
        dateOrder: '2026-09-19',
        state: 'purchase',
        amountTotal: '1.25',
        currency: 'USD',
      })),
      total: 35,
      detailSuffix: '?lang=vi',
      originHref: '/admin/purchase/rfqs?lang=vi',
    }),
  )
  assert.match(html, /31-35 \/ 35/)
  assert.match(html, />record 31</)
  assert.match(html, />record 35</)
  assert.ok(links(html).some((target) => target.searchParams.has('columns')))
  assert.ok(
    links(html).every((target) => !target.pathname.endsWith('/new') && !target.searchParams.has('create')),
  )
})

test('account grouped rows preserve groups and do not acquire a second pager', () => {
  const url = urlFor('/admin/accounting/accounts')
  url.searchParams.set('group', 'type')
  const row = { id: 'account-1', code: '101', name: 'Cash', accountType: 'asset_cash', active: true }
  const html = renderToString(
    accountsListScreen(translate, {
      frame: frameFor(url),
      rows: [],
      createHref: '/admin/accounting/accounts?create=1&lang=vi',
      rowHref: (entry) => `/admin/accounting/accounts/${entry.id}?lang=vi`,
      summary: { total: 1, asset: 1, liability: 0, profit: 0 },
      table: {
        groups: [
          {
            id: 'cash',
            label: 'Cash accounts',
            count: 1,
            depth: 0,
            open: true,
            href: '/admin/accounting/accounts?group=type',
            rows: [row],
          },
        ],
      },
    }),
  )
  assert.match(html, /Cash accounts/)
  assert.match(html, /data-col="code"/)
  assert.doesNotMatch(html, /data-ui="pager"/)
  assert.ok(
    links(html).some(
      (target) => target.searchParams.has('columns') && target.searchParams.get('group') === 'type',
    ),
  )
})

test('opening balances and period closes page their rows while preserving the inline close form', () => {
  const opening = renderToString(
    openingBalancesListScreen(translate, {
      frame: frameFor(urlFor('/admin/accounting/opening-balances')),
      rows: entries.map((row) => ({
        ...row,
        accountingDate: row.name,
        state: 'draft',
        controlDebit: '1.25',
        currency: 'USD',
        sourceChecksum: 'checksum',
      })),
      createHref: '/admin/accounting/opening-balances/new?lang=vi',
      rowHref: (row) => `/admin/accounting/opening-balances/${String(row.id)}`,
    }),
  )
  assertPage(opening)
  const closes = renderToString(
    periodClosesListScreen(translate, {
      frame: frameFor(urlFor('/admin/accounting/period-closes')),
      rows: entries.map((row) => ({
        ...row,
        periodKey: row.name,
        dateFrom: '2026-09-01',
        dateTo: '2026-09-30',
        state: 'open',
        blockerCount: 0,
      })),
      action: '/admin/accounting/period-closes?lang=vi',
      fields: [],
      errors: ['Period overlaps'],
      rowHref: (row) => `/admin/accounting/period-closes/${String(row.id)}`,
    }),
  )
  assertPage(closes)
  assert.match(closes, /data-ui="disclosure"[^>]*open/)
  assert.match(closes, /Period overlaps/)
  assert.match(closes, /id="close-create-form"/)
})

test('sales collection reads beyond 500 orders before visible-field search and pagination', async () => {
  const history = Array.from({ length: 1035 }, (_, index) => ({
    id: `sale-${index + 1}`,
    name: `Order ${index + 1}`,
    partnerName: index >= 1000 ? 'Late customer' : 'Earlier customer',
    dateOrder: '2026-09-19',
    state: 'draft',
    amountTotal: '1.25',
    currency: 'USD',
  }))
  const calls: Array<{ limit: number; offset: number }> = []
  const all = await loadSaleOrderCollection(async (page) => {
    calls.push(page)
    return history.slice(page.offset, page.offset + page.limit)
  })
  assert.deepEqual(calls, [
    { limit: 500, offset: 0 },
    { limit: 500, offset: 500 },
    { limit: 500, offset: 1000 },
  ])
  assert.equal(all.length, 1035)
  const url = new URL('https://ket.test/admin/sales/quotations?q=Late%20customer&page=2&lang=vi')
  const matching = all.filter((row) => row.partnerName.toLocaleLowerCase().includes('late customer'))
  const html = renderToString(
    quotationsListScreen(
      translate,
      {
        rows: matching,
        createHref: '/admin/sales/quotations/new?lang=vi',
        detailSuffix: '?lang=vi',
      },
      frameFor(url),
    ),
  )
  assert.match(html, /31-35 \/ 35/)
  assert.match(html, />Order 1031</)
  assert.match(html, />Order 1035</)
  assert.doesNotMatch(html, />Order 1001</)
})

test('sales collection verifies the end after a full batch and propagates retrieval failures', async () => {
  const offsets: number[] = []
  const all = await loadSaleOrderCollection(async ({ offset }) => {
    offsets.push(offset)
    return offset === 0 ? Array.from({ length: 500 }, (_, id) => ({ id })) : []
  })
  assert.equal(all.length, 500)
  assert.deepEqual(offsets, [0, 500])
  await assert.rejects(
    loadSaleOrderCollection(async ({ offset }) => {
      if (offset) throw new Error('Order retrieval refused')
      return Array.from({ length: 500 }, (_, id) => ({ id }))
    }),
    /Order retrieval refused/,
  )
})

test('sales partner names remain complete beyond the explicit-ID lookup limit', async () => {
  const ids = Array.from({ length: 2035 }, (_, index) => `customer-${index + 1}`)
  const batches: string[][] = []
  const names = await loadSalePartnerNames(ids, async (batch) => {
    batches.push(batch)
    return batch.map((id) => ({ id, name: `Name of ${id}` }))
  })
  assert.deepEqual(
    batches.map((batch) => batch.length),
    [2000, 35],
  )
  assert.equal(names.size, 2035)
  assert.equal(names.get('customer-2035'), 'Name of customer-2035')
})
