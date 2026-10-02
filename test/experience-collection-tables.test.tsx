import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { collectionTable } from '../packages/ketsuite/src/ui/index.ts'
import { ListScreenFrame as LoyaltyFrame } from '../packages/ketsuite/src/modules/loyalty_backend/screens/page-frame.tsx'
import { ListScreenFrame as HospitalityFrame } from '../packages/ketsuite/src/modules/hospitality_core/screens/page-frame.tsx'
import { ListScreenFrame as BillingFrame } from '../packages/ketsuite/src/modules/hospitality_billing/screens/page-frame.tsx'
import { ordersScreen } from '../packages/ketsuite/src/modules/pos_backend/screens.tsx'

const translate = ((key: string) => key) as Translator
translate.locale = 'en'
translate.has = () => true
translate.resolves = () => true

const ordered = (html: string, parts: string[]) => {
  let previous = -1
  for (const part of parts) {
    const current = html.indexOf(part, previous + 1)
    assert.ok(current > previous, `${part} must follow the preceding collection slot`)
    previous = current
  }
}

test('experience collection frames put Create and collection actions beside the title, then filters and KetTable', () => {
  for (const Frame of [LoyaltyFrame, HospitalityFrame, BillingFrame]) {
    const html = renderToString(
      Frame({
        translator: translate,
        title: 'Collection',
        actions: <a href="/export?lang=vi">Export</a>,
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
      'href="/new?lang=vi"',
      'href="/export?lang=vi"',
      '</header>',
      'data-ui="list-page-controls"',
      'data-ui="ket-table"',
    ])
    assert.doesNotMatch(
      html.slice(html.indexOf('data-ui="list-page-toolbar"')),
      /data-ui="list-page-actions"|data-ui="list-page-tools"/,
    )
    assert.match(html, /name="q"[^>]*value="A"/)
    assert.match(html, /name="lang"[^>]*value="vi"/)
    assert.match(html, /href="\/new\?lang=vi"/)
    assert.equal((html.match(/href="\/new\?lang=vi"/g) ?? []).length, 1)
    assert.equal((html.match(/data-ui="list-page-controls"/g) ?? []).length, 1)
    // The shared search owns one inline form and its mobile dialog counterpart.
    assert.equal((html.slice(html.indexOf('data-ui="list-page"')).match(/name="q"/g) ?? []).length, 2)
  }
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
