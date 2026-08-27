import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { paymentFormScreen } from '../packages/ketsuite/src/modules/account_backend/screens/payment-form.tsx'
import { paymentsListScreen } from '../packages/ketsuite/src/modules/account_backend/screens/payments-list.tsx'

const messages: Record<string, string> = {
  'account_backend.action.cancelEdit': 'Huỷ',
  'account_backend.action.registerPayment': 'Ghi nhận thanh toán',
  'account_backend.field.date': 'Ngày',
  'account_backend.field.name': 'Tên',
  'account_backend.field.partnerId': 'Đối tác',
  'account_backend.field.paymentAmount': 'Số tiền',
  'account_backend.field.paymentType': 'Loại thanh toán',
  'account_backend.field.state': 'Trạng thái',
  'account_backend.partnerType.customer': 'Khách hàng',
  'account_backend.payment.create.hint': 'Chọn sổ, tài khoản đối ứng và khoản cần đối soát.',
  'account_backend.payment.create.title': 'Ghi nhận thanh toán',
  'account_backend.payment.empty': 'Chưa có thanh toán',
  'account_backend.payment.emptyHint': 'Ghi nhận khoản đầu tiên.',
  'account_backend.payment.subtitle': 'Theo dõi tiền thu, tiền chi và đối soát.',
  'account_backend.payment.summary.inbound': 'Tiền thu',
  'account_backend.payment.summary.open': 'Khoản mở',
  'account_backend.payment.summary.outbound': 'Tiền chi',
  'account_backend.payment.summary.total': 'Tổng thanh toán',
  'account_backend.paymentStatus.paid': 'Đã thanh toán',
  'account_backend.paymentType.inbound': 'Tiền thu',
  'account_backend.payments.title': 'Thanh toán',
  'backend.chrome.next': 'Trang sau',
  'backend.chrome.previous': 'Trang trước',
}

const translate = ((key: string) => messages[key] ?? key) as Translator
translate.locale = 'vi'
translate.has = (key) => key in messages
translate.resolves = translate.has

test('payments ListPage keeps filters, summaries and journal-entry destinations', () => {
  const html = renderToString(
    paymentsListScreen(translate, {
      frame: {
        chrome: {
          search: {
            name: 'q',
            value: 'PAY/HTTP',
            placeholder: 'Thanh toán',
            facets: [{ label: 'Đã thanh toán', without: '/admin/accounting/payments?lang=vi' }],
            menus: [],
          },
          pager: { from: 1, to: 1, total: 1, prev: null, next: null },
        },
      },
      rows: [
        {
          id: 'payment-http',
          name: 'PAY/HTTP',
          date: '2026-08-27',
          paymentType: 'inbound',
          partnerType: 'customer',
          partnerId: 'customer-http',
          amount: '125000',
          currency: 'VND',
          state: 'paid',
          moveId: 'payment-http:move',
        },
      ],
      createHref: '/admin/accounting/payments/new?lang=vi&returnTo=%2Fadmin%2Faccounting%2Fpayments',
      rowHref: () => '/admin/accounting/entries/payment-http%3Amove?lang=vi',
      partnerLabel: () => 'Khách hàng HTTP',
      summary: { total: 3, inbound: 2, outbound: 1, open: 4 },
    }),
  )

  assert.match(html, /data-ui="list-page"/)
  assert.match(html, /data-ui="chrome-search"[\s\S]*?value="PAY\/HTTP"/)
  assert.match(html, /data-ui="facet"[\s\S]*?Đã thanh toán/)
  assert.match(html, /Tổng thanh toán: 3[\s\S]*?Tiền thu: 2[\s\S]*?Tiền chi: 1[\s\S]*?Khoản mở: 4/)
  assert.match(html, /data-row-href="\/admin\/accounting\/entries\/payment-http%3Amove\?lang=vi"/)
  assert.match(html, /Khách hàng HTTP · Khách hàng/)
  assert.match(html, /href="\/admin\/accounting\/payments\/new\?lang=vi&amp;returnTo=/)
  assert.doesNotMatch(html, /payment-register-form|data-ui="form-page"|data-ui="modal-layer"|mail\.chatter/)
})

test('payment FormPage preserves all fields, rejected relation bundles and stable identity', () => {
  const html = renderToString(
    paymentFormScreen(translate, {
      frame: {},
      action: '/admin/accounting/payments/new?lang=vi',
      cancelHref: '/admin/accounting/payments?lang=vi&state=paid',
      paymentId: 'payment-retry-token',
      errors: ['Tài khoản không phù hợp'],
      fields: [
        { name: 'name', label: 'Tên', value: 'PAY/RETRY' },
        { name: 'paymentType', label: 'Loại thanh toán', value: 'outbound' },
        { name: 'partnerType', label: 'Loại đối tác', value: 'supplier' },
        {
          name: 'partnerId',
          label: 'Đối tác',
          control: (
            <div data-island="backend.relation-select" data-value="supplier-retry">
              <input name="partnerId" value="supplier-retry" />
            </div>
          ),
        },
        { name: 'journalId', label: 'Sổ nhật ký', value: 'bank' },
        {
          name: 'destinationAccountId',
          label: 'Tài khoản đối ứng',
          error: 'Tài khoản không phù hợp',
          control: (
            <div data-island="backend.relation-select" data-value="missing-account">
              <input name="destinationAccountId" value="missing-account" />
            </div>
          ),
        },
        { name: 'amount', label: 'Số tiền', value: '125000' },
        { name: 'date', label: 'Ngày', value: '2026-08-27' },
        { name: 'memo', label: 'Ghi chú', value: 'Giá trị nhập dở' },
        { name: 'paymentReference', label: 'Tham chiếu', value: 'REF-1' },
        { name: 'reconcileLineId', label: 'Khoản mở', value: 'line-1' },
      ],
    }),
  )

  assert.match(html, /data-ui="form-page" data-scope="account-payment-form-page"/)
  assert.match(html, /id="payment-register-form"/)
  assert.match(html, /type="hidden" name="action" value="register"/)
  assert.match(html, /type="hidden" name="id" value="payment-retry-token"/)
  for (const name of [
    'name',
    'paymentType',
    'partnerType',
    'partnerId',
    'journalId',
    'destinationAccountId',
    'amount',
    'date',
    'memo',
    'paymentReference',
    'reconcileLineId',
  ])
    assert.match(html, new RegExp(`name="${name}"`), name)
  assert.equal((html.match(/data-island="backend\.relation-select"/g) ?? []).length, 2)
  assert.match(html, /data-value="supplier-retry"/)
  assert.match(html, /data-value="missing-account"/)
  assert.match(html, /href="\/admin\/accounting\/payments\?lang=vi&amp;state=paid"/)
  assert.doesNotMatch(html, /data-ui="list-page"|data-ui="modal-layer"|mail\.chatter/)
})
