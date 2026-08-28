import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import {
  openingBalanceDetailScreen,
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
})
