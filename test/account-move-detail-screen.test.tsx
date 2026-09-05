import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { moveDetailScreen } from '../packages/ketsuite/src/modules/account_backend/screens/move-detail.tsx'

const messages: Record<string, string> = {
  'account_backend.action.addLine': 'Thêm dòng',
  'account_backend.action.cancel': 'Huỷ',
  'account_backend.action.post': 'Ghi sổ',
  'account_backend.action.reverse': 'Đảo bút toán',
  'account_backend.empty': 'Chưa có dòng',
  'account_backend.emptyHint': 'Thêm dòng đầu tiên.',
  'account_backend.field.accountId': 'Tài khoản',
  'account_backend.field.amountTotal': 'Tổng tiền',
  'account_backend.field.credit': 'Có',
  'account_backend.field.debit': 'Nợ',
  'account_backend.field.moveType': 'Loại',
  'account_backend.field.name': 'Diễn giải',
  'account_backend.field.partnerId': 'Đối tác',
  'account_backend.field.residual': 'Còn lại',
  'account_backend.lines.add': 'Thêm dòng bút toán',
  'account_backend.lines.title': 'Dòng bút toán',
  'account_backend.move.actions': 'Thao tác chứng từ',
  'account_backend.move.collaboration': 'Trao đổi',
  'account_backend.move.refused': 'Không thể thực hiện',
  'account_backend.moveState.draft': 'Nháp',
  'account_backend.moveState.posted': 'Đã ghi sổ',
  'account_backend.moveType.entry': 'Bút toán',
  'account_backend.moveType.out_invoice': 'Hoá đơn khách hàng',
  'account_backend.paymentState.paid': 'Đã thanh toán',
}

const translate = ((key: string) => messages[key] ?? key) as Translator
translate.locale = 'vi'
translate.has = (key) => key in messages
translate.resolves = translate.has

test('draft move FormPage keeps record facts, versioned actions, line editor values and one-third collaboration rail', () => {
  const html = renderToString(
    moveDetailScreen(translate, {
      move: {
        id: 'entry-1',
        name: 'entry-1',
        ref: 'Điều chỉnh cuối kỳ',
        moveType: 'entry',
        state: 'draft',
        paymentState: 'paid',
        currency: 'VND',
        amountTotal: '5000000',
        revision: 3,
      },
      lines: [
        {
          id: 'line-debit',
          name: 'Nợ ngân hàng',
          accountId: 'bank',
          debit: '5000000',
          credit: '0',
          amountResidual: '0',
        },
        {
          id: 'line-credit',
          name: 'Có doanh thu',
          accountId: 'revenue',
          debit: '0',
          credit: '5000000',
          amountResidual: '0',
        },
      ],
      frame: {},
      accountOptions: [
        { value: 'bank', label: '112 · Tiền gửi' },
        { value: 'revenue', label: '511 · Doanh thu' },
      ],
      action: '/admin/accounting/entries/entry-1?lang=vi',
      collaboration: (
        <>
          <div data-island="mail.chatter" />
          <div data-island="activity.record" />
        </>
      ),
      printActions: (
        <a href="/admin/accounting/entries/entry-1/print" data-print="move">
          In chứng từ
        </a>
      ),
      lineId: 'line-retry-1',
      reversalId: 'reversal-unused',
      rejected: {
        messages: ['Mỗi dòng chỉ được ghi một bên'],
        fields: { debit: 'Mỗi dòng chỉ được ghi một bên' },
        values: {
          action: 'add-line',
          lineId: 'line-retry-1',
          name: 'Giá trị nhập dở',
          accountId: 'missing-account',
          partnerId: 'partner-1',
          debit: '10',
          credit: '10',
        },
      },
    }),
  )

  assert.match(html, /data-ui="form-page" data-scope="account-move-detail-form-page" data-has-aside="true"/)
  assert.match(html, /data-ui="form-page-aside"[\s\S]*?mail\.chatter[\s\S]*?activity\.record/)
  assert.match(html, /Điều chỉnh cuối kỳ/)
  assert.match(html, /Tổng tiền:[\s\S]*?5\.000\.000/)
  assert.match(html, /name="action" value="post"[\s\S]*?name="expectedRevision" value="3"/)
  assert.match(html, /name="action" value="cancel"[\s\S]*?name="expectedRevision" value="3"/)
  assert.match(html, /data-print="move"[\s\S]*?In chứng từ/)
  assert.match(html, /112 · Tiền gửi/)
  assert.match(html, /id="account-move-line-form"/)
  assert.match(html, /name="lineId" value="line-retry-1"/)
  assert.match(html, /name="name"[^>]*value="Giá trị nhập dở"/)
  assert.match(html, /<option value="missing-account" selected="true">/)
  assert.match(html, /name="debit"[^>]*value="10"[^>]*aria-invalid="true"/)
  assert.doesNotMatch(html, /account_backend\.paymentState|data-ui="record-workspace"|data-ui="record-aside"/)
})

test('posted invoice FormPage keeps payment lifecycle, stable reversal and hides draft line editing', () => {
  const html = renderToString(
    moveDetailScreen(translate, {
      move: {
        id: 'invoice-1',
        name: 'SAL/2026/00001',
        partnerId: 'customer',
        moveType: 'out_invoice',
        state: 'posted',
        paymentState: 'paid',
        currency: 'VND',
        amountTotal: '100000',
        revision: 1,
      },
      lines: [],
      frame: {},
      accountOptions: [],
      action: '/admin/accounting/customer-invoices/invoice-1?lang=vi',
      collaboration: <div data-island="mail.chatter" />,
      lineId: 'line-unused',
      reversalId: 'reversal-retry-1',
    }),
  )

  assert.match(html, /SAL\/2026\/00001/)
  assert.match(html, /Đã ghi sổ/)
  assert.match(html, /Đã thanh toán/)
  assert.match(html, /name="action" value="reverse"/)
  assert.match(html, /name="reversalId" value="reversal-retry-1"/)
  assert.doesNotMatch(html, /id="account-move-line-form"|name="action" value="post"/)
  assert.doesNotMatch(html, /data-ui="record-workspace"/)
})
