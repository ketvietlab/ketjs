import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { LinkButton } from '../packages/ketsuite/src/ui/index.ts'
import {
  openingBalanceDetailScreen,
  openingBalancesListScreen,
  periodClosesListScreen,
} from '../packages/ketsuite/src/modules/account_backend/screens/index.ts'

const translate = ((key: string) => key) as Translator
translate.locale = 'en'
translate.has = () => true
translate.resolves = translate.has

test('account wave 1 screens keep rejected opening and close actions visible', () => {
  const opening = renderToString(
    openingBalanceDetailScreen(translate, {
      frame: {},
      batch: {
        id: 'opening-1',
        accountingDate: '2026-01-01',
        sourceChecksum: 'checksum',
        state: 'validated',
        controlDebit: '10',
        controlCredit: '10',
      },
      lines: [],
      action: '/admin/accounting/opening-balances/opening-1',
      currency: 'USD',
      errors: ['The posting period is locked'],
    }),
  )
  assert.match(opening, /The posting period is locked/)

  const closes = renderToString(
    periodClosesListScreen(translate, {
      frame: {},
      rows: [],
      action: '/admin/accounting/period-closes',
      fields: [],
      rowHref: (row) => `/admin/accounting/period-closes/${String(row.id)}`,
      errors: ['The close period overlaps an existing period'],
    }),
  )
  assert.match(closes, /data-ui="form-errors" role="alert"/)
  assert.match(closes, /The close period overlaps an existing period/)
  assert.match(closes, /data-ui="disclosure"[^>]*open/)
})

test('opening balances keep creation in the header while period close forms stay in the body', () => {
  const frame = {
    chrome: { search: { name: 'q', value: '', placeholder: 'Search' } },
    extras: {
      'topbar.end': (
        <LinkButton
          label="Export periods"
          href="/admin/accounting/period-closes/export?lang=vi"
          variant="secondary"
        />
      ),
    },
  }
  const opening = renderToString(
    openingBalancesListScreen(translate, {
      frame,
      rows: [
        {
          id: 'opening-1',
          accountingDate: '2026-01-01',
          state: 'draft',
          controlDebit: '10',
          sourceChecksum: 'source',
        },
      ],
      createHref: '/admin/accounting/opening-balances/new?lang=vi',
      rowHref: (row) => `/admin/accounting/opening-balances/${String(row.id)}?lang=vi`,
    }),
  )
  const closes = renderToString(
    periodClosesListScreen(translate, {
      frame,
      rows: [
        {
          id: 'period-1',
          periodKey: '2026-01',
          dateFrom: '2026-01-01',
          dateTo: '2026-01-31',
          state: 'open',
          blockerCount: 0,
        },
      ],
      action: '/admin/accounting/period-closes?lang=vi',
      fields: [],
      rowHref: (row) => `/admin/accounting/period-closes/${String(row.id)}?lang=vi`,
    }),
  )
  for (const html of [opening, closes]) {
    assert.match(html, /data-ui="ket-table"/)
    assert.ok(html.indexOf('data-ui="chrome-search"') < html.indexOf('data-ui="ket-table"'))
  }
  assert.ok(
    opening.indexOf('href="/admin/accounting/opening-balances/new?lang=vi"') <
      opening.indexOf('data-ui="chrome-search"'),
  )
  assert.equal(opening.match(/data-ui="list-page-actions"/g)?.length, 1)
  const headerStart = closes.indexOf('data-ui="list-page-header"')
  const header = closes.slice(headerStart, closes.indexOf('</header>', headerStart))
  assert.match(header, /data-ui="list-page-tools"[\s\S]*?Export periods/)
  assert.doesNotMatch(header, /close-create-form|data-ui="record-form"|data-ui="disclosure"/)
  assert.ok(closes.indexOf('data-ui="chrome-search"') < closes.indexOf('data-ui="list-page-body"'))
  assert.ok(closes.indexOf('data-ui="list-page-body"') < closes.indexOf('id="close-create-form"'))
  assert.ok(closes.indexOf('id="close-create-form"') < closes.indexOf('data-ui="ket-table"'))
  assert.match(closes, /action="\/admin\/accounting\/period-closes\?lang=vi"/)
})
