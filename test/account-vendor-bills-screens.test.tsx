import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { vendorBillFormScreen } from '../packages/ketsuite/src/modules/account_backend/screens/vendor-bill-form.tsx'
import { vendorBillsListScreen } from '../packages/ketsuite/src/modules/account_backend/screens/vendor-bills-list.tsx'

const messages: Record<string, string> = {
  'account_backend.action.cancelEdit': 'Huỷ',
  'account_backend.action.create': 'Tạo',
  'account_backend.field.amountTotal': 'Tổng tiền',
  'account_backend.field.date': 'Ngày',
  'account_backend.field.moveType': 'Loại',
  'account_backend.field.name': 'Số',
  'account_backend.field.partnerId': 'Nhà cung cấp',
  'account_backend.field.paymentState': 'Thanh toán',
  'account_backend.field.state': 'Trạng thái',
  'account_backend.moveState.posted': 'Đã ghi sổ',
  'account_backend.moveType.in_invoice': 'Hoá đơn nhà cung cấp',
  'account_backend.paymentState.partial': 'Thanh toán một phần',
  'account_backend.vendorBill.create.hint': 'Nhập nhà cung cấp, dòng chi phí, thuế và công nợ.',
  'account_backend.vendorBill.create.title': 'Tạo hoá đơn nhà cung cấp',
  'account_backend.vendorBill.empty': 'Chưa có hoá đơn',
  'account_backend.vendorBill.emptyHint': 'Tạo hoá đơn đầu tiên.',
  'account_backend.vendorBill.subtitle': 'Theo dõi hoá đơn mua hàng và thanh toán.',
  'account_backend.vendorBill.summary.draft': 'Bản nháp',
  'account_backend.vendorBill.summary.posted': 'Đã ghi sổ',
  'account_backend.vendorBill.summary.total': 'Tổng hoá đơn',
  'account_backend.vendorBill.summary.unpaid': 'Chưa thanh toán',
  'account_backend.vendorBills.title': 'Hoá đơn nhà cung cấp',
  'backend.chrome.next': 'Trang sau',
  'backend.chrome.previous': 'Trang trước',
}

const translate = ((key: string) => messages[key] ?? key) as Translator
translate.locale = 'vi'
translate.has = (key) => key in messages
translate.resolves = translate.has

test('vendor bills ListPage keeps filters, vendor, lifecycle, payment and monetary columns', () => {
  const html = renderToString(
    vendorBillsListScreen(translate, {
      frame: {
        chrome: {
          search: {
            name: 'q',
            value: 'ACME',
            placeholder: 'Hoá đơn nhà cung cấp',
            facets: [{ label: 'Đã ghi sổ', without: '/admin/accounting/vendor-bills?lang=vi' }],
            menus: [],
          },
          pager: { from: 1, to: 1, total: 1, prev: null, next: null },
        },
      },
      rows: [
        {
          id: 'bill-1',
          name: 'PUR/2026/00001',
          partnerId: 'vendor',
          date: '2026-08-27T00:00:00.000Z',
          moveType: 'in_invoice',
          state: 'posted',
          paymentState: 'partial',
          amountTotal: '1234567',
          currency: 'VND',
        },
      ],
      createHref:
        '/admin/accounting/vendor-bills/new?lang=vi&returnTo=%2Fadmin%2Faccounting%2Fvendor-bills%3Flang%3Dvi',
      rowHref: (row) => `/admin/accounting/vendor-bills/${String(row.id)}?lang=vi`,
      partnerLabel: () => 'ACME Supplier',
      summary: { total: 8, draft: 2, posted: 6, unpaid: 3 },
    }),
  )

  assert.match(html, /data-ui="list-page"/)
  assert.match(html, /href="\/admin\/accounting\/vendor-bills\/new\?lang=vi&amp;returnTo=/)
  assert.match(html, /data-ui="chrome-search"[\s\S]*?name="q"[\s\S]*?value="ACME"/)
  assert.match(html, /Tổng hoá đơn: 8[\s\S]*?Bản nháp: 2[\s\S]*?Đã ghi sổ: 6[\s\S]*?Chưa thanh toán: 3/)
  assert.match(html, /data-col="partner"[\s\S]*?ACME Supplier/)
  assert.match(html, /data-col="state"[\s\S]*?data-tone="positive"/)
  assert.match(html, /data-col="payment"[\s\S]*?data-tone="warning"/)
  assert.match(html, /data-col="total"[^>]*data-kind="currency"[\s\S]*?1\.234\.567/)
  assert.match(html, /data-row-href="\/admin\/accounting\/vendor-bills\/bill-1\?lang=vi"/)
  assert.doesNotMatch(html, /id="vendor-bill-create-form"|data-ui="record-workspace"|mail\.chatter/)
})

test('vendor bill FormPage keeps every document field, bundled relations, errors and retry identity', () => {
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
    vendorBillFormScreen(translate, {
      frame: {},
      action:
        '/admin/accounting/vendor-bills/new?lang=vi&returnTo=%2Fadmin%2Faccounting%2Fvendor-bills%3Flang%3Dvi',
      cancelHref: '/admin/accounting/vendor-bills?lang=vi',
      idempotencyKey: 'bill-request-1',
      errors: ['Tài khoản chi phí không tồn tại'],
      fields: names.map((name) =>
        relations.has(name)
          ? {
              name,
              label: name,
              error: name === 'lineAccountId' ? 'Tài khoản chi phí không tồn tại' : null,
              control: (
                <div data-island="backend.relation-select" data-name={name} data-selected={`${name}-value`} />
              ),
            }
          : { name, label: name, value: `${name}-value` },
      ),
    }),
  )

  assert.match(html, /data-ui="form-page" data-scope="account-vendor-bill-form-page"/)
  assert.match(html, /id="vendor-bill-create-form"/)
  assert.match(html, /type="hidden" name="id" value="bill-request-1"/)
  for (const name of names) assert.match(html, new RegExp(`(?:name|data-name)="${name}"`), `missing ${name}`)
  assert.equal((html.match(/data-island="backend\.relation-select"/g) ?? []).length, 4)
  assert.match(html, /data-ui="form-errors" role="alert"/)
  assert.match(html, /form="vendor-bill-create-form"[\s\S]*?Tạo/)
  assert.match(html, /href="\/admin\/accounting\/vendor-bills\?lang=vi"/)
  assert.doesNotMatch(html, /data-ui="list-page"|data-ui="modal-layer"|mail\.chatter/)
})
