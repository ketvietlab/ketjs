import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { customerInvoiceFormScreen } from '../packages/ketsuite/src/modules/account_backend/screens/customer-invoice-form.tsx'
import { customerInvoicesListScreen } from '../packages/ketsuite/src/modules/account_backend/screens/customer-invoices-list.tsx'

const messages: Record<string, string> = {
  'account_backend.action.cancelEdit': 'Huỷ',
  'account_backend.action.create': 'Tạo',
  'account_backend.customerInvoice.create.hint': 'Nhập khách hàng, dòng doanh thu, thuế và công nợ.',
  'account_backend.customerInvoice.create.title': 'Tạo hoá đơn khách hàng',
  'account_backend.customerInvoice.empty': 'Chưa có hoá đơn',
  'account_backend.customerInvoice.emptyHint': 'Tạo hoá đơn đầu tiên.',
  'account_backend.customerInvoice.subtitle': 'Theo dõi hoá đơn bán hàng và thanh toán.',
  'account_backend.customerInvoice.summary.draft': 'Bản nháp',
  'account_backend.customerInvoice.summary.posted': 'Đã ghi sổ',
  'account_backend.customerInvoice.summary.total': 'Tổng hoá đơn',
  'account_backend.customerInvoice.summary.unpaid': 'Chưa thanh toán',
  'account_backend.customerInvoices.title': 'Hoá đơn khách hàng',
  'account_backend.field.amountTotal': 'Tổng tiền',
  'account_backend.field.date': 'Ngày',
  'account_backend.field.moveType': 'Loại',
  'account_backend.field.name': 'Số',
  'account_backend.field.partnerId': 'Khách hàng',
  'account_backend.field.paymentState': 'Thanh toán',
  'account_backend.field.state': 'Trạng thái',
  'account_backend.moveState.posted': 'Đã ghi sổ',
  'account_backend.moveType.out_invoice': 'Hoá đơn khách hàng',
  'account_backend.paymentState.partial': 'Thanh toán một phần',
  'backend.chrome.next': 'Trang sau',
  'backend.chrome.previous': 'Trang trước',
}

const translate = ((key: string) => messages[key] ?? key) as Translator
translate.locale = 'vi'
translate.has = (key) => key in messages
translate.resolves = translate.has

test('customer invoices ListPage keeps filters, customer, lifecycle, payment and monetary columns', () => {
  const html = renderToString(
    customerInvoicesListScreen(translate, {
      frame: {
        chrome: {
          search: {
            name: 'q',
            value: 'ACME',
            placeholder: 'Hoá đơn khách hàng',
            facets: [{ label: 'Đã ghi sổ', without: '/admin/accounting/customer-invoices?lang=vi' }],
            menus: [],
          },
          pager: { from: 1, to: 1, total: 1, prev: null, next: null },
        },
      },
      rows: [
        {
          id: 'invoice-1',
          name: 'SAL/2026/00001',
          partnerId: 'customer',
          date: '2026-08-27T00:00:00.000Z',
          moveType: 'out_invoice',
          state: 'posted',
          paymentState: 'partial',
          amountTotal: '1234567',
          currency: 'VND',
        },
      ],
      createHref:
        '/admin/accounting/customer-invoices/new?lang=vi&returnTo=%2Fadmin%2Faccounting%2Fcustomer-invoices%3Flang%3Dvi',
      rowHref: (row) => `/admin/accounting/customer-invoices/${String(row.id)}?lang=vi`,
      partnerLabel: () => 'ACME',
      summary: { total: 8, draft: 2, posted: 6, unpaid: 3 },
    }),
  )

  assert.match(html, /data-ui="list-page"/)
  assert.match(html, /href="\/admin\/accounting\/customer-invoices\/new\?lang=vi&amp;returnTo=/)
  assert.match(html, /data-ui="chrome-search"[\s\S]*?name="q"[\s\S]*?value="ACME"/)
  assert.match(html, /Tổng hoá đơn: 8[\s\S]*?Bản nháp: 2[\s\S]*?Đã ghi sổ: 6[\s\S]*?Chưa thanh toán: 3/)
  assert.match(html, /data-col="partner"[\s\S]*?ACME/)
  assert.match(html, /data-col="state"[\s\S]*?data-tone="positive"/)
  assert.match(html, /data-col="payment"[\s\S]*?data-tone="warning"[\s\S]*?Thanh toán một phần/)
  assert.match(html, /data-col="total"[^>]*data-kind="currency"[\s\S]*?1\.234\.567/)
  assert.match(html, /data-row-href="\/admin\/accounting\/customer-invoices\/invoice-1\?lang=vi"/)
  assert.doesNotMatch(html, /id="customer-invoice-create-form"|data-ui="record-workspace"|mail\.chatter/)
})

test('customer invoice FormPage keeps every document field, relations, errors and retry identity', () => {
  const names = [
    'journalId',
    'moveType',
    'partnerId',
    'invoiceDate',
    'paymentTermId',
    'ref',
    'description',
    'productId',
    'productUomId',
    'quantity',
    'priceUnit',
    'discount',
    'lineAccountId',
    'counterpartAccountId',
    'taxId',
    'secondTaxId',
    'taxAccountId',
  ]
  const relations = new Set(['partnerId', 'lineAccountId', 'counterpartAccountId', 'taxAccountId'])
  const html = renderToString(
    customerInvoiceFormScreen(translate, {
      frame: {},
      action:
        '/admin/accounting/customer-invoices/new?lang=vi&returnTo=%2Fadmin%2Faccounting%2Fcustomer-invoices%3Flang%3Dvi',
      cancelHref: '/admin/accounting/customer-invoices?lang=vi',
      idempotencyKey: 'invoice-request-1',
      errors: ['Tài khoản doanh thu không tồn tại'],
      fields: names.map((name) =>
        relations.has(name)
          ? {
              name,
              label: name,
              error: name === 'lineAccountId' ? 'Tài khoản doanh thu không tồn tại' : null,
              control: (
                <div data-island="backend.relation-select" data-name={name} data-selected={`${name}-value`} />
              ),
            }
          : { name, label: name, value: `${name}-value` },
      ),
    }),
  )

  assert.match(html, /data-ui="form-page" data-scope="account-customer-invoice-form-page"/)
  assert.match(html, /id="customer-invoice-create-form"/)
  assert.match(html, /type="hidden" name="id" value="invoice-request-1"/)
  for (const name of names) assert.match(html, new RegExp(`(?:name|data-name)="${name}"`), `missing ${name}`)
  assert.equal((html.match(/data-island="backend\.relation-select"/g) ?? []).length, 4)
  assert.match(html, /data-ui="form-errors" role="alert"/)
  assert.match(html, /form="customer-invoice-create-form"[\s\S]*?Tạo/)
  assert.match(html, /href="\/admin\/accounting\/customer-invoices\?lang=vi"/)
  assert.doesNotMatch(html, /data-ui="list-page"|data-ui="modal-layer"|mail\.chatter/)
})
