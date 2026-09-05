import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { partnerLedgerScreen } from '../packages/ketsuite/src/modules/account_backend/screens/partner-statement.tsx'

const messages: Record<string, string> = {
  'account_backend.action.calculate': 'Calculate',
  'account_backend.field.accountId': 'Account',
  'account_backend.field.credit': 'Credit',
  'account_backend.field.date': 'Date',
  'account_backend.field.debit': 'Debit',
  'account_backend.field.entry': 'Journal entry',
  'account_backend.field.name': 'Description',
  'account_backend.field.residual': 'Residual',
  'account_backend.partnerLedger.empty': 'No partner movements',
  'account_backend.partnerLedger.emptyHint': 'Change the reporting window.',
  'account_backend.partnerLedger.filter.hint': 'Choose a partner and period.',
  'account_backend.partnerLedger.filter.title': 'Partner filters',
  'account_backend.partnerLedger.kicker': 'Partner receivables and payables',
  'account_backend.partnerLedger.result.hint': 'Posted receivable and payable items.',
  'account_backend.partnerLedger.result.title': 'Partner movements',
  'account_backend.partnerLedger.select': 'No partner selected',
  'account_backend.partnerLedger.selectHint': 'Choose a partner.',
  'account_backend.partnerLedger.subtitle': 'Track partner balances.',
  'account_backend.partnerLedger.summary.credit': 'Total credit',
  'account_backend.partnerLedger.summary.debit': 'Total debit',
  'account_backend.partnerLedger.summary.residual': 'Residual',
  'account_backend.partnerStatement.title': 'Partner ledger',
}

const translate = ((key: string) => messages[key] ?? key) as Translator
translate.locale = 'en'
translate.has = (key) => key in messages
translate.resolves = translate.has

const clean = (html: string): string => html.replace(/<!--[^>]*-->/g, '')

test('partner statement stays specialized and reports full-result totals above a paged table', () => {
  const html = clean(
    renderToString(
      partnerLedgerScreen(translate, {
        frame: {},
        action: '/admin/accounting/partner-statement',
        currency: 'VND',
        selected: true,
        hidden: { q: 'consulting', lang: 'en' },
        fields: [
          { name: 'partnerId', label: 'Partner', value: 'customer' },
          { name: 'dateFrom', label: 'From', type: 'date', value: '2026-06-01' },
          { name: 'dateTo', label: 'To', type: 'date', value: '2026-06-30' },
        ],
        rows: [
          {
            id: 'line/1',
            moveId: 'invoice/1',
            move: { name: 'INV/2026/001', date: '2026-06-30T20:30:00.000Z' },
            accountId: 'receivable',
            name: 'Consulting service',
            debit: '125000',
            credit: '0',
            amountResidual: '100000',
          },
        ],
        summary: { debit: 250000, credit: 50000, residual: 200000 },
        accountLabel: () => '1311 · Trade receivables',
        entryHref: (row) => `/admin/accounting/entries/${encodeURIComponent(String(row.moveId))}?lang=en`,
      }),
    ),
  )

  assert.match(html, /data-ui="record-workspace"/)
  assert.doesNotMatch(html, /data-ui="form-page"|data-ui="modal-layer"|mail\.chatter/)
  assert.match(html, /250[,.]000[\s\S]*Total debit/)
  assert.match(html, /50[,.]000[\s\S]*Total credit/)
  assert.match(html, /200[,.]000[\s\S]*Residual/)
  assert.equal((html.match(/data-ui="row"/g) ?? []).length, 1)
  assert.match(html, /1311 · Trade receivables/)
  assert.match(html, /href="\/admin\/accounting\/entries\/invoice%2F1\?lang=en"/)
  assert.match(html, /type="hidden" name="q" value="consulting"/)
  assert.match(html, /type="hidden" name="lang" value="en"/)
})

test('partner statement keeps rejected selection and range errors visible in an empty result', () => {
  const partnerError = 'The selected partner is no longer available. Clear the partner filter.'
  const rangeError = 'The end date must be on or after the start date.'
  const html = clean(
    renderToString(
      partnerLedgerScreen(translate, {
        frame: {},
        action: '/admin/accounting/partner-statement',
        currency: 'VND',
        selected: true,
        fields: [
          { name: 'partnerId', label: 'Partner', value: 'missing', error: partnerError },
          { name: 'dateFrom', label: 'From', type: 'date', value: '2026-07-01', error: rangeError },
          { name: 'dateTo', label: 'To', type: 'date', value: '2026-06-30', error: rangeError },
        ],
        rows: [],
        summary: { debit: 0, credit: 0, residual: 0 },
        errors: [partnerError, rangeError],
      }),
    ),
  )

  assert.match(html, /data-ui="form-errors" role="alert"/)
  assert.match(html, /The selected partner is no longer available/)
  assert.match(html, /The end date must be on or after the start date/)
  assert.match(html, /name="partnerId"[^>]*value="missing"/)
  assert.match(html, /No partner movements/)
})
