import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { invoicingPoliciesListScreen } from '../packages/ketsuite/src/modules/sale_backend/screens/invoicing-policies-list.tsx'
import { invoicingPolicyCreateScreen } from '../packages/ketsuite/src/modules/sale_backend/screens/invoicing-policy-create.tsx'

const messages: Record<string, string> = {
  'sale_backend.action.cancel': 'Huỷ',
  'sale_backend.action.savePolicy': 'Thiết lập chính sách',
  'sale_backend.error.invalid': 'Dữ liệu chưa hợp lệ',
  'sale_backend.field.invoicePolicy': 'Chính sách lập hoá đơn',
  'sale_backend.field.product': 'Sản phẩm',
  'sale_backend.invoicePolicy.delivery': 'Theo số lượng giao',
  'sale_backend.invoicePolicy.order': 'Theo số lượng đặt',
  'sale_backend.policies.title': 'Chính sách lập hoá đơn',
  'sale_backend.policy.edit.hint': 'Chọn sản phẩm và cách tính số lượng có thể lập hoá đơn.',
  'sale_backend.policy.edit.title': 'Thiết lập chính sách lập hoá đơn',
  'sale_backend.policy.empty': 'Chưa có sản phẩm',
  'sale_backend.policy.emptyHint': 'Tạo sản phẩm trước khi thiết lập chính sách.',
  'sale_backend.policy.subtitle': 'Kiểm soát thời điểm sản phẩm được phép lập hoá đơn.',
  'sale_backend.policy.summary.delivery': 'Theo số lượng giao',
  'sale_backend.policy.summary.order': 'Theo số lượng đặt',
  'sale_backend.policy.summary.total': 'Tổng sản phẩm',
  'backend.chrome.more': 'Thêm thao tác',
  'backend.chrome.next': 'Trang sau',
  'backend.chrome.previous': 'Trang trước',
  'backend.table.columns': 'Cột',
  'backend.table.selectAll': 'Chọn tất cả dòng',
  'backend.table.selectRow': 'Chọn dòng',
}

const translate = ((key: string, params?: Record<string, unknown>) => {
  let value = messages[key] ?? key
  for (const [name, replacement] of Object.entries(params ?? {}))
    value = value.replaceAll(`{${name}}`, String(replacement))
  return value
}) as Translator
translate.locale = 'vi'
translate.has = (key) => key in messages
translate.resolves = translate.has

test('invoicing policies list: keeps product policies and moves editing to the dedicated form', () => {
  const html = renderToString(
    invoicingPoliciesListScreen(
      translate,
      {
        createHref:
          '/admin/sales/invoicing-policies/new?lang=vi&returnTo=%2Fadmin%2Fsales%2Finvoicing-policies%3Flang%3Dvi',
        total: 12,
        rows: [
          { id: 'desk', name: 'Bàn làm việc', invoicePolicy: 'order' },
          { id: 'chair', name: 'Ghế công thái học', invoicePolicy: 'delivery' },
          { id: 'lamp', name: 'Đèn bàn' },
        ],
      },
      {
        chrome: {
          search: { name: 'q', placeholder: 'Tìm sản phẩm…' },
          pager: { from: 1, to: 3, total: 12 },
        },
      },
    ),
  )

  assert.match(html, /data-ui="list-page"/)
  assert.match(html, /data-ui="list-page-title"[\s\S]*?Chính sách lập hoá đơn/)
  assert.match(html, /Tổng sản phẩm: 12 · Theo số lượng đặt: 2 · Theo số lượng giao: 1/)
  assert.match(html, /data-ui="list-page-actions"[\s\S]*?href="\/admin\/sales\/invoicing-policies\/new/)
  assert.match(html, /returnTo=%2Fadmin%2Fsales%2Finvoicing-policies%3Flang%3Dvi/)
  assert.match(html, /data-ui="list-page-controls"[\s\S]*?data-ui="chrome-search"/)
  assert.match(html, /data-col="name"[\s\S]*?Bàn làm việc/)
  assert.match(html, /data-col="policy"[\s\S]*?Theo số lượng đặt/)
  assert.match(html, /data-value="delivery"[\s\S]*?Theo số lượng giao/)
  assert.doesNotMatch(html, /invoicing-policy-form|record-form|record-workspace|mail\.chatter/)
})

test('invoicing policies list: preserves the product setup empty state without an inline form', () => {
  const html = renderToString(
    invoicingPoliciesListScreen(translate, {
      createHref:
        '/admin/sales/invoicing-policies/new?lang=vi&returnTo=%2Fadmin%2Fsales%2Finvoicing-policies%3Flang%3Dvi',
      rows: [],
    }),
  )

  assert.match(html, /data-ui="empty"[\s\S]*?Chưa có sản phẩm/)
  assert.match(html, /Tạo sản phẩm trước khi thiết lập chính sách\./)
  assert.match(html, /Tổng sản phẩm: 0 · Theo số lượng đặt: 0 · Theo số lượng giao: 0/)
  assert.doesNotMatch(html, /record-form|mail\.chatter/)
})

test('invoicing policy create: keeps selection, radio policy, validation and external actions', () => {
  const html = renderToString(
    invoicingPolicyCreateScreen(
      translate,
      {
        action:
          '/admin/sales/invoicing-policies/new?lang=vi&returnTo=%2Fadmin%2Fsales%2Finvoicing-policies%3Flang%3Dvi',
        cancelHref: '/admin/sales/invoicing-policies?lang=vi',
        errors: ['Dữ liệu chưa hợp lệ'],
        fields: [
          {
            name: 'templateId',
            label: 'Sản phẩm',
            type: 'select',
            options: [
              { value: 'desk', label: 'Bàn làm việc' },
              { value: 'chair', label: 'Ghế công thái học' },
            ],
            required: true,
          },
          {
            name: 'invoicePolicy',
            label: 'Chính sách lập hoá đơn',
            type: 'radio',
            options: [
              { value: 'order', label: 'Theo số lượng đặt' },
              { value: 'delivery', label: 'Theo số lượng giao' },
            ],
            required: true,
          },
        ],
      },
      {},
    ),
  )

  assert.match(
    html,
    /data-ui="form-page" data-scope="sales-invoicing-policy-form-page" data-has-aside="false"/,
  )
  assert.match(html, /data-ui="form-page-title"[\s\S]*?Thiết lập chính sách lập hoá đơn/)
  assert.match(html, /data-ui="form-page-actions"[\s\S]*?type="submit" form="invoicing-policy-form"/)
  assert.match(html, /href="\/admin\/sales\/invoicing-policies\?lang=vi"[\s\S]*?Huỷ/)
  assert.match(html, /id="invoicing-policy-form"/)
  assert.doesNotMatch(html, /id="invoicing-policy-form"[\s\S]*?data-ui="form-actions"/)
  assert.match(html, /name="templateId"[\s\S]*?Bàn làm việc[\s\S]*?Ghế công thái học/)
  assert.match(html, /type="radio" name="invoicePolicy"[^>]*value="order"/)
  assert.match(html, /type="radio" name="invoicePolicy"[^>]*value="delivery"/)
  assert.match(html, /Dữ liệu chưa hợp lệ/)
  assert.doesNotMatch(html, /form-page-aside|mail\.chatter|activity\.record/)
})
