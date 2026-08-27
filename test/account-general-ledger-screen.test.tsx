import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { generalLedgerScreen } from '../packages/ketsuite/src/modules/account_backend/screens/general-ledger.tsx'

const messages: Record<string, string> = {
  'account_backend.action.calculate': 'Calculate',
  'account_backend.field.accountId': 'Account',
  'account_backend.field.credit': 'Credit',
  'account_backend.field.date': 'Date',
  'account_backend.field.debit': 'Debit',
  'account_backend.field.entry': 'Journal entry',
  'account_backend.field.name': 'Description',
  'account_backend.generalLedger.title': 'General ledger',
  'account_backend.ledger.empty': 'No matching movements',
  'account_backend.ledger.emptyHint': 'Change the filters.',
  'account_backend.ledger.filter.hint': 'Choose an account and period.',
  'account_backend.ledger.filter.title': 'Ledger filters',
  'account_backend.ledger.kicker': 'Ledger detail',
  'account_backend.ledger.result.hint': 'Posted journal items.',
  'account_backend.ledger.result.title': 'Account movements',
  'account_backend.ledger.subtitle': 'Track debits and credits.',
  'account_backend.ledger.summary.credit': 'Total credit',
  'account_backend.ledger.summary.debit': 'Total debit',
  'account_backend.ledger.summary.lines': 'Journal items',
}

const translate = ((key: string) => messages[key] ?? key) as Translator
translate.locale = 'en'
translate.has = (key) => key in messages
translate.resolves = translate.has

const clean = (html: string): string => html.replace(/<!--[^>]*-->/g, '')

test('general ledger stays specialized and reports full-result totals above a paged table', () => {
  const html = clean(
    renderToString(
      generalLedgerScreen(translate, {
        frame: {},
        action: '/admin/accounting/general-ledger',
        currency: 'VND',
        hidden: { q: 'service', lang: 'en' },
        fields: [
          { name: 'accountId', label: 'Account', value: 'income' },
          { name: 'dateFrom', label: 'From', type: 'date', value: '2026-06-01' },
          { name: 'dateTo', label: 'To', type: 'date', value: '2026-06-30' },
        ],
        rows: [
          {
            id: 'line/1',
            moveId: 'entry/1',
            move: { name: 'JE/2026/001', date: '2026-06-30T20:30:00.000Z' },
            accountId: 'income',
            name: 'Consulting service',
            debit: '0',
            credit: '125000',
          },
        ],
        summary: { lines: 42, debit: 125000, credit: 250000 },
        accountLabel: () => '511 · Sales revenue',
        entryHref: (row) => `/admin/accounting/entries/${encodeURIComponent(String(row.moveId))}?lang=en`,
      }),
    ),
  )

  assert.match(html, /data-ui="record-workspace"/)
  assert.doesNotMatch(html, /data-ui="list-page"|data-ui="form-page"|data-ui="modal-layer"|mail\.chatter/)
  assert.match(html, /data-ui="record-fact-value">42</)
  assert.match(html, /125[,.]000[\s\S]*Total debit/)
  assert.match(html, /250[,.]000[\s\S]*Total credit/)
  assert.equal((html.match(/data-ui="row"/g) ?? []).length, 1)
  assert.match(html, /href="\/admin\/accounting\/entries\/entry%2F1\?lang=en"/)
  assert.match(html, /511 · Sales revenue/)
  assert.match(html, /type="hidden" name="q" value="service"/)
  assert.match(html, /type="hidden" name="lang" value="en"/)
})

test('general ledger keeps rejected filters visible with an explanatory error and empty result', () => {
  const error = 'The selected account is no longer available. Clear the account filter.'
  const html = clean(
    renderToString(
      generalLedgerScreen(translate, {
        frame: {},
        action: '/admin/accounting/general-ledger',
        currency: 'VND',
        fields: [
          { name: 'accountId', label: 'Account', value: 'missing', error },
          { name: 'dateFrom', label: 'From', type: 'date', value: '2026-07-01' },
          { name: 'dateTo', label: 'To', type: 'date', value: '2026-06-30' },
        ],
        rows: [],
        summary: { lines: 0, debit: 0, credit: 0 },
        errors: [error],
      }),
    ),
  )

  assert.match(html, /data-ui="form-errors" role="alert"/)
  assert.match(html, /The selected account is no longer available/)
  assert.match(html, /name="accountId"[^>]*value="missing"/)
  assert.match(html, /No matching movements/)
})
