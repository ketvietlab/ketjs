import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { collectionTable } from '../packages/ketsuite/src/ui/index.ts'
import { ListScreenFrame as WebsiteFrame } from '../packages/ketsuite/src/modules/website_backend/screens/page-frame.tsx'
import { ListScreenFrame as LoyaltyFrame } from '../packages/ketsuite/src/modules/loyalty_backend/screens/page-frame.tsx'
import { ListScreenFrame as HospitalityFrame } from '../packages/ketsuite/src/modules/hospitality_core/screens/page-frame.tsx'
import { ListScreenFrame as BillingFrame } from '../packages/ketsuite/src/modules/hospitality_billing/screens/page-frame.tsx'
import {
  contentScreen,
  entryTermsSection,
  revisionsScreen,
  siteDomainsScreen,
} from '../packages/ketsuite/src/modules/website_backend/screens/index.tsx'
import { ordersScreen } from '../packages/ketsuite/src/modules/pos_backend/screens.tsx'

const translate = ((key: string) => key) as Translator
translate.locale = 'en'
translate.has = () => true
translate.resolves = () => true

const ordered = (html: string, parts: string[]) => {
  let previous = -1
  for (const part of parts) {
    const current = html.indexOf(part)
    assert.ok(current > previous, `${part} must follow the preceding collection slot`)
    previous = current
  }
}

test('experience collection frames put functional filters before tools and the KetTable', () => {
  for (const Frame of [WebsiteFrame, LoyaltyFrame, HospitalityFrame, BillingFrame]) {
    const html = renderToString(
      Frame({
        translator: translate,
        title: 'Collection',
        frame: {
          chrome: {
            search: { name: 'q', value: 'A', placeholder: 'Find', keep: { lang: 'vi', state: 'open' } },
            create: { label: 'Create', path: '/new?lang=vi' },
          },
        },
        body: collectionTable(translate, {
          rows: [{ id: 'a', name: 'Alpha' }],
          id: (row) => row.id,
          columns: [{ key: 'name', label: 'Name', cell: (row) => row.name }],
        }),
      }),
    )
    ordered(html, [
      'data-ui="list-page-context"',
      'data-ui="list-page-controls"',
      'data-ui="list-page-actions"',
      'data-ui="ket-table"',
    ])
    assert.match(html, /name="q"[^>]*value="A"/)
    assert.match(html, /name="lang"[^>]*value="vi"/)
    assert.match(html, /href="\/new\?lang=vi"/)
    assert.equal((html.match(/data-ui="list-page-controls"/g) ?? []).length, 1)
    // The shared search owns one inline form and its mobile dialog counterpart.
    assert.equal((html.match(/name="q"/g) ?? []).length, 2)
  }
})

test('Website content retains the combined site/status/search GET form and localized row destination', () => {
  const html = renderToString(
    contentScreen(
      translate,
      [
        {
          id: 'page1',
          siteId: 'site1',
          title: 'Home',
          type: 'page',
          slug: 'home',
          path: '/',
          status: 'draft',
        },
      ],
      [{ value: 'site1', label: 'Site' }],
      'site1',
      {},
      '?lang=vi',
      undefined,
      null,
      { search: 'Home', status: 'draft' },
    ),
  )
  ordered(html, [
    'data-ui="list-page-context"',
    'data-ui="list-page-controls"',
    'data-ui="list-page-actions"',
    'data-ui="ket-table"',
  ])
  assert.match(html, /method="get"/)
  assert.match(html, /name="q"[^>]*value="Home"/)
  assert.match(html, /name="site"/)
  assert.match(html, /name="status"/)
  assert.match(html, /href="\/admin\/website\/pages\/page1\?lang=vi"/)
  const embedded = renderToString(
    entryTermsSection(
      translate,
      'page1',
      [{ id: 'assignment1', termId: 'term1', taxonomy: 'category', slug: 'news', name: 'News' }],
      [],
    ),
  )
  assert.match(embedded, /data-ui="table"/)
  assert.doesNotMatch(embedded, /data-ui="ket-table"/)
})

test('filtering revision rows keeps every revision available for comparison', () => {
  const revisions = [
    { id: 'r1', version: 1, kind: 'draft', createdAt: '2026-01-01' },
    { id: 'r2', version: 2, kind: 'published', createdAt: '2026-01-02' },
  ]
  const html = renderToString(
    revisionsScreen(
      translate,
      {
        id: 'page1',
        siteId: 'site1',
        title: 'Home',
        type: 'page',
        slug: 'home',
        path: '/',
        status: 'published',
      },
      revisions,
      {},
      '?lang=vi',
      undefined,
      null,
      [revisions[1]!],
    ),
  )
  assert.match(html, /value="r1"/)
  assert.match(html, /value="r2"/)
  assert.match(html, /data-row="r2"/)
  assert.doesNotMatch(html, /data-row="r1"/)
})

test('domain table filtering preserves primary-domain evidence and submitted draft', () => {
  const rows = [
    { id: 'primary', siteId: 'site1', host: 'primary.example', primary: true, redirectToPrimary: false },
    { id: 'alias', siteId: 'site1', host: 'alias.example', primary: false, redirectToPrimary: true },
  ]
  const html = renderToString(
    siteDomainsScreen(
      translate,
      { id: 'site1', name: 'Site', title: 'Site', defaultLocale: 'en', theme: 'paper', active: true },
      rows,
      {},
      { tableRows: [rows[1]!], values: { host: 'draft.example' }, errors: ['Refused'], locale: '?lang=vi' },
    ),
  )
  assert.match(html, /primary\.example/)
  assert.match(html, /value="draft\.example"/)
  assert.match(html, /Refused/)
  assert.match(html, /data-row="alias"/)
  assert.doesNotMatch(html, /data-row="primary"/)
})

test('POS orders preserve decimal display and record links in KetTable cells', () => {
  const html = renderToString(
    ordersScreen(translate, {}, [
      {
        id: 'order1',
        posReference: 'POS-1',
        partnerName: 'Guest',
        state: 'paid',
        amountTotal: '1234.56',
        currency: 'USD',
      },
    ]),
  )
  assert.match(html, /data-ui="ket-table"/)
  assert.match(html, /href="\/admin\/pos\/orders\/order1"/)
  assert.match(html, /1,234\.56/)
  assert.match(html, /Guest/)
})
