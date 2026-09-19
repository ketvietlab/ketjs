import { roomsScreen } from '../packages/ketsuite/src/modules/hospitality_core/screens/rooms.tsx'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { collectionSearchFrame } from '../packages/ketsuite/src/modules/backend/collection-search.ts'
import { RecordForm } from '../packages/ketsuite/src/ui/index.ts'
import { ListScreenFrame as WebsiteFrame } from '../packages/ketsuite/src/modules/website_backend/screens/page-frame.tsx'
import { ListScreenFrame as LoyaltyFrame } from '../packages/ketsuite/src/modules/loyalty_backend/screens/page-frame.tsx'
import { ListScreenFrame as HospitalityFrame } from '../packages/ketsuite/src/modules/hospitality_core/screens/page-frame.tsx'
import { ListScreenFrame as BillingFrame } from '../packages/ketsuite/src/modules/hospitality_billing/screens/page-frame.tsx'
import {
  contentScreen,
  sitesScreen,
} from '../packages/ketsuite/src/modules/website_backend/screens/index.tsx'
import { ordersScreen } from '../packages/ketsuite/src/modules/pos_backend/screens.tsx'
import { billingScreen } from '../packages/ketsuite/src/modules/hospitality_billing/screens/billing.tsx'

const translate = ((key: string) => key) as Translator
translate.locale = 'en'
translate.has = () => true
translate.resolves = () => true

test('domain filters compose with compact search and paging in every experience frame', () => {
  for (const Frame of [WebsiteFrame, LoyaltyFrame, HospitalityFrame, BillingFrame]) {
    const html = renderToString(
      Frame({
        translator: translate,
        title: 'Collection',
        frame: {
          chrome: {
            search: { name: 'q', value: 'Suite', placeholder: 'Find', keep: { lang: 'vi' } },
            pager: { from: 1, to: 30, total: 31, next: '/list?lang=vi&page=2' },
          },
        },
        controls: (
          <RecordForm
            action="/domain-filter"
            method="get"
            fields={[
              {
                name: 'property',
                label: 'Property',
                type: 'select',
                value: 'hotel',
                options: [{ value: 'hotel', label: 'Hotel' }],
              },
            ]}
            hidden={{ lang: 'vi' }}
            submit="Apply"
            submitVariant="secondary"
          />
        ),
        body: <p>Collection body</p>,
      }),
    )
    assert.match(html, /data-ui="list-chrome"[^>]*data-layout="command"/)
    assert.match(html, /name="q"[^>]*value="Suite"/)
    assert.match(html, /<details\b[\s\S]*action="\/domain-filter"[\s\S]*<\/details>/)
    assert.match(html, /name="property"[\s\S]*value="hotel"[^>]*selected/)
    assert.equal((html.match(/data-ui="pager-range"/g) ?? []).length, 1)
    assert.ok(html.indexOf('data-ui="pager-range"') < html.indexOf('Collection body'))
  }
})

test('POS order pagination retains locale and filters and never changes decimal amounts', () => {
  const url = new URL('https://example.test/admin/pos/orders?lang=vi&state=paid&q=POS&page=2')
  const rows = Array.from({ length: 35 }, (_, index) => ({
    id: `order-${index + 1}`,
    posReference: `POS-${index + 1}`,
    partnerName: 'Guest',
    state: 'paid',
    amountTotal: '1234.56',
    currency: 'USD',
  }))
  const html = renderToString(ordersScreen(translate, collectionSearchFrame(url, {}, 'Orders'), rows))
  assert.equal(
    (html.match(/data-ui="ket-table-row"/g) ?? []).length || (html.match(/data-row="order-/g) ?? []).length,
    5,
  )
  assert.match(html, /31-35 \/ 35/)
  assert.match(html, /data-row="order-31"/)
  assert.doesNotMatch(html, /data-row="order-30"/)
  assert.match(html, /href="\/admin\/pos\/orders\?lang=vi&amp;state=paid&amp;q=POS&amp;page=1"/)
  assert.match(html, /1,234\.56/)
})

test('Website SQL paging remains one command pager and does not repaginate returned rows', () => {
  const frame = collectionSearchFrame(
    new URL('https://example.test/admin/website/pages?lang=vi&site=s1&status=draft&q=Home&page=2'),
    {},
    'Pages',
  )
  const rows = [
    {
      id: 'p31',
      siteId: 's1',
      type: 'website.page',
      slug: 'home',
      path: '/',
      title: 'Home',
      status: 'draft',
    },
  ]
  const html = renderToString(
    contentScreen(
      translate,
      rows,
      [{ value: 's1', label: 'Site' }],
      's1',
      frame,
      '?lang=vi',
      undefined,
      {
        from: 31,
        to: 31,
        total: 31,
        prev: '/admin/website/pages?lang=vi&site=s1&status=draft&q=Home&page=1',
      },
      { search: 'Home', status: 'draft' },
    ),
  )
  assert.match(html, /data-row="p31"/)
  assert.equal((html.match(/data-ui="pager-range"/g) ?? []).length, 1)
  assert.ok(html.indexOf('data-ui="pager-range"') < html.indexOf('data-ui="ket-table"'))
  assert.doesNotMatch(html, /data-ui="list-page-footer"/)
  assert.match(html, /name="status"[\s\S]*value="draft"[^>]*selected/)
})

test('billing pagination preserves the collection-wide eligible invoice action', () => {
  const rows = Array.from({ length: 31 }, (_, index) => ({
    folioId: `folio-${index}`,
    folioCode: `FOL-${index}`,
    guest: null,
    closedAt: null,
    folioState: 'closed',
    folioTotal: '100.25',
    chargeCount: 1,
    missingRules: [],
    blockers:
      index === 30
        ? []
        : [{ code: 'journal_missing' as const, repairHref: '/admin/accounting/journals/new' }],
    moveId: null,
    moveName: null,
    amountTotal: null,
    amountDue: null,
    paymentState: null,
  }))
  const frame = collectionSearchFrame(
    new URL('https://example.test/admin/hospitality/billing?page=1'),
    {},
    'Billing',
  )
  const html = renderToString(billingScreen(translate, rows, frame))
  assert.match(html, /1-30 \/ 31/)
  assert.doesNotMatch(html, /data-row="folio-30"/)
  assert.match(html, /hospitality_billing\.action\.invoiceAll/)
})

test('room filters preserve repeated query values, search and column state while resetting the page', () => {
  const frame = collectionSearchFrame(
    new URL(
      'https://example.test/admin/hospitality/rooms?lang=vi&property=hotel&q=Room&page=2&tag=one&tag=two&columns=code,name,status',
    ),
    {},
    'Rooms',
  )
  const rows = Array.from({ length: 35 }, (_, index) => ({
    id: `room-${index + 1}`,
    propertyId: 'hotel',
    roomTypeId: 'suite',
    code: `R-${index + 1}`,
    name: `Room ${index + 1}`,
    capacity: 2,
    status: 'available',
    active: true,
  }))
  const html = renderToString(
    roomsScreen(
      translate,
      { rows, properties: [], propertyId: 'hotel', roomTypes: [], buildings: [], floors: [] },
      'vi',
      frame,
    ),
  )
  assert.match(html, /31-35 \/ 35/)
  assert.match(html, /data-row="room-31"/)
  assert.doesNotMatch(html, /data-row="room-30"/)
  const form = html.match(/<form\b[^>]*action="\/admin\/hospitality\/rooms"[^>]*>[\s\S]*?<\/form>/)?.[0] ?? ''
  assert.match(form, /name="q"[^>]*value="Room"/)
  assert.match(form, /name="lang"[^>]*value="vi"/)
  assert.match(form, /name="columns"[^>]*value="code,name,status"/)
  assert.match(form, /name="tag"[^>]*value="one"/)
  assert.match(form, /name="tag"[^>]*value="two"/)
  assert.doesNotMatch(form, /name="page"/)
  assert.equal((form.match(/name="property"/g) ?? []).length, 1)
})

test('Website state filters retain search, locale and repeated context parameters', () => {
  const frame = collectionSearchFrame(
    new URL('https://example.test/admin/website/sites?q=Host&lang=vi&tag=one&tag=two&page=2'),
    {},
    'Sites',
  )
  const html = renderToString(
    sitesScreen(
      translate,
      [{ id: 'site', name: 'Host', title: 'Host', defaultLocale: 'vi', theme: 'paper', active: true }],
      frame,
      '?lang=vi',
    ),
  )
  const href = [...html.matchAll(/href="([^"]+)"/g)]
    .map((match) => match[1]!.replaceAll('&amp;', '&'))
    .find((href) => href.includes('state=active'))
  assert.ok(href)
  const query = new URL(href, 'https://example.test').searchParams
  assert.equal(query.get('q'), 'Host')
  assert.equal(query.get('lang'), 'vi')
  assert.deepEqual(query.getAll('tag'), ['one', 'two'])
  assert.equal(query.has('page'), false)
})
