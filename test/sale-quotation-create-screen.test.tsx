import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { quotationCreateScreen } from '../packages/ketsuite/src/modules/sale_backend/screens/quotation-create.tsx'

const messages: Record<string, string> = {
  'sale_backend.action.cancel': 'Hủy',
  'sale_backend.action.create': 'Tạo báo giá',
  'sale_backend.field.clientOrderRef': 'Tham chiếu khách hàng',
  'sale_backend.field.customer': 'Khách hàng',
  'sale_backend.field.notes': 'Ghi chú',
  'sale_backend.field.paymentTerm': 'Điều khoản thanh toán',
  'sale_backend.field.pricelist': 'Bảng giá',
  'sale_backend.field.validityDate': 'Hiệu lực đến',
  'sale_backend.field.warehouse': 'Kho giao hàng',
  'sale_backend.quotation.create.hint': 'Chọn khách hàng, kho giao hàng và điều kiện thương mại.',
  'sale_backend.quotation.create.title': 'Tạo báo giá',
}

const translate = ((key: string) => messages[key] ?? key) as Translator
translate.locale = 'vi'
translate.has = (key) => key in messages
translate.resolves = translate.has

test('sales quotation create: preserves dynamic fields, validation and retained list state', () => {
  const html = renderToString(
    quotationCreateScreen(
      translate,
      {
        action: '/admin/sales/quotations/new?state=draft&lang=vi',
        cancelHref: '/admin/sales/quotations?state=draft&lang=vi',
        errors: ['Dữ liệu chưa hợp lệ'],
        fields: [
          {
            name: 'partnerId',
            label: 'Khách hàng',
            type: 'select',
            required: true,
            options: [{ value: '', label: '—' }],
            control: <span data-test-control="customer">Bộ chọn khách hàng</span>,
          },
          { name: 'clientOrderRef', label: 'Tham chiếu khách hàng' },
          {
            name: 'warehouseId',
            label: 'Kho giao hàng',
            type: 'select',
            required: true,
            options: [
              { value: '', label: '—' },
              { value: 'wh', label: 'Kho trung tâm' },
            ],
          },
          {
            name: 'pricelistId',
            label: 'Bảng giá',
            type: 'select',
            options: [{ value: '', label: '—' }],
          },
          {
            name: 'paymentTermId',
            label: 'Điều khoản thanh toán',
            type: 'select',
            options: [{ value: '', label: '—' }],
          },
          { name: 'validityDate', label: 'Hiệu lực đến', type: 'date' },
          { name: 'notes', label: 'Ghi chú', type: 'textarea', span: 'full' },
        ],
      },
      {},
    ),
  )

  assert.equal(html.match(/data-ui="form-page"/g)?.length, 1)
  assert.match(html, /data-scope="sale-quotation-create-form-page"/)
  assert.match(html, /data-ui="form-page-title"[^>]*>[\s\S]*?Tạo báo giá/)
  assert.match(html, /data-ui="form-page-actions"[\s\S]*?type="submit"[^>]*form="quotation-create-form"/)
  assert.match(html, /href="\/admin\/sales\/quotations\?state=draft&amp;lang=vi"/)
  assert.match(html, /id="quotation-create-form"/)
  assert.match(html, /data-scope="sale-quotation-create"/)
  assert.match(html, /action="\/admin\/sales\/quotations\/new\?state=draft&amp;lang=vi"/)
  assert.match(html, /data-ui="form-errors"[^>]*role="alert"[\s\S]*?Dữ liệu chưa hợp lệ/)
  assert.match(
    html,
    /data-test-control="customer"[\s\S]*?name="clientOrderRef"[\s\S]*?name="warehouseId"[\s\S]*?name="pricelistId"[\s\S]*?name="paymentTermId"[\s\S]*?name="validityDate"[\s\S]*?name="notes"/,
  )
  assert.match(html, /name="warehouseId"[^>]*required/)
  assert.match(html, /name="validityDate"[^>]*type="date"|type="date"[^>]*name="validityDate"/)
  assert.match(html, /name="notes"[^>]*data-ui="form-control"|data-ui="form-control"[^>]*name="notes"/)
  assert.doesNotMatch(html, /data-ui="form-actions"/)
  assert.doesNotMatch(html, /data-ui="record-workspace"|data-ui="form-page-aside"/)
  assert.doesNotMatch(html, /data-island="mail\.chatter"/)
})
