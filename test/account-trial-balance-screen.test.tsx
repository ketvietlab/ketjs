import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { trialBalanceScreen } from '../packages/ketsuite/src/modules/account_backend/screens/trial-balance.tsx'

const messages: Record<string, string> = {
  'account_backend.action.calculate': 'Calculate',
  'account_backend.field.balance': 'Balance',
  'account_backend.field.code': 'Code',
  'account_backend.field.credit': 'Credit',
  'account_backend.field.debit': 'Debit',
  'account_backend.field.name': 'Name',
  'account_backend.trial.empty': 'No figures',
  'account_backend.trial.emptyHint': 'Change the range.',
  'account_backend.trial.filter.hint': 'Choose a reporting window.',
  'account_backend.trial.filter.title': 'Reporting period',
  'account_backend.trial.kicker': 'General ledger report',
  'account_backend.trial.result.hint': 'Debit and credit must balance.',
  'account_backend.trial.result.title': 'Balances by account',
  'account_backend.trial.subtitle': 'Reconcile movements by account.',
  'account_backend.trial.summary.balance': 'Difference',
  'account_backend.trial.summary.credit': 'Total credit',
  'account_backend.trial.summary.debit': 'Total debit',
  'account_backend.trialBalance.title': 'Trial balance',
}

const translate = ((key: string) => messages[key] ?? key) as Translator
translate.locale = 'en'
translate.has = (key) => key in messages
translate.resolves = translate.has

test('trial balance stays a specialized drillable report with locale-safe GET range', () => {
  const html = renderToString(
    trialBalanceScreen(translate, {
      frame: {},
      action: '/admin/accounting/trial-balance',
      locale: 'en',
      currency: 'VND',
      fields: [
        { name: 'dateFrom', label: 'From', value: '2026-06-01' },
        { name: 'dateTo', label: 'To', value: '2026-06-30' },
      ],
      rows: [
        {
          accountId: 'account-112',
          code: '112',
          name: 'Tiền gửi ngân hàng',
          nameEn: 'Bank accounts',
          debit: '125000',
          credit: '0',
          balance: '125000',
        },
        {
          accountId: 'account-511',
          code: '511',
          name: 'Doanh thu bán hàng',
          nameEn: 'Sales revenue',
          debit: '0',
          credit: '125000',
          balance: '-125000',
        },
      ],
      ledgerHref: (row) =>
        `/admin/accounting/general-ledger?accountId=${String(row.accountId)}&dateFrom=2026-06-01&dateTo=2026-06-30&lang=en`,
    }),
  )

  assert.match(html, /data-ui="record-workspace"/)
  assert.doesNotMatch(html, /data-ui="form-page"|data-ui="modal-layer"|mail\.chatter/)
  assert.match(html, /data-ui="date-picker" method="get" action="\/admin\/accounting\/trial-balance"/)
  assert.match(html, /type="hidden" name="lang" value="en"/)
  assert.match(html, /name="dateFrom"[^>]*value="2026-06-01"/)
  assert.match(html, /name="dateTo"[^>]*value="2026-06-30"/)
  assert.match(html, /Bank accounts/)
  assert.match(html, /Sales revenue/)
  assert.ok(html.indexOf('Bank accounts') < html.indexOf('Sales revenue'))
  assert.match(
    html,
    /href="\/admin\/accounting\/general-ledger\?accountId=account-112&amp;dateFrom=2026-06-01/,
  )
  assert.match(html, /Total debit[\s\S]*125[,.]000/)
  assert.match(html, /Total credit[\s\S]*125[,.]000/)
})

test('trial balance shows an inverted-range error without losing the empty report state', () => {
  const error = 'The end date must be on or after the start date.'
  const html = renderToString(
    trialBalanceScreen(translate, {
      frame: {},
      action: '/admin/accounting/trial-balance',
      locale: 'en',
      currency: 'VND',
      fields: [
        { name: 'dateFrom', label: 'From', value: '2026-07-01', error },
        { name: 'dateTo', label: 'To', value: '2026-06-30', error },
      ],
      rows: [],
      errors: [error],
    }),
  )

  assert.match(html, /data-tone="danger"/)
  assert.match(html, /The end date must be on or after the start date/)
  assert.equal((html.match(/data-ui="date-picker-error"/g) ?? []).length, 2)
  assert.match(html, /No figures/)
})
