import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { lotCreateScreen } from '../packages/ketsuite/src/modules/stock_backend/screens/lot-create.tsx'

const messages: Record<string, string> = {
  'stock_backend.action.cancel': 'Hủy',
  'stock_backend.action.create': 'Tạo mới',
  'stock_backend.field.lotSerial': 'Số lô / sê-ri',
  'stock_backend.lot.create.hint': 'Gắn định danh truy xuất với đúng sản phẩm.',
  'stock_backend.lot.create.name.placeholder': 'Ví dụ: LOT-2026-008',
  'stock_backend.lot.create.product.help': 'Chỉ hiển thị biến thể hàng hóa đang hoạt động.',
  'stock_backend.lot.create.title': 'Tạo lô hoặc số sê-ri',
  'stock_backend.lot.field.description': 'Mô tả',
  'stock_backend.lot.field.product': 'Sản phẩm',
  'stock_backend.lot.field.reference': 'Tham chiếu nội bộ',
  'stock_backend.lot.information.hint': 'Sản phẩm, số lô hoặc sê-ri, tham chiếu và mô tả.',
  'stock_backend.lot.information.title': 'Thông tin',
}

const translate = ((key: string) => messages[key] ?? key) as Translator
translate.locale = 'vi'
translate.has = (key) => key in messages
translate.resolves = translate.has

test('stock lot create: renders the complete create form in a compact FormPage', () => {
  const html = renderToString(
    lotCreateScreen(
      translate,
      {
        products: [
          { value: 'variant-1', label: 'Cà phê rang · CF-01' },
          { value: 'variant-2', label: 'Trà sen · TS-02' },
        ],
        action: '/admin/stock/lots/new?lang=vi',
        cancelHref: '/admin/stock/lots?lang=vi',
        errors: ['Dữ liệu chưa hợp lệ'],
      },
      {},
    ),
  )

  assert.equal(html.match(/data-ui="form-page"/g)?.length, 1)
  assert.match(html, /data-ui="form-page-title"[^>]*>[\s\S]*?Tạo lô hoặc số sê-ri/)
  assert.match(html, /data-ui="form-page-actions"[\s\S]*?type="submit"[^>]*form="lot-create-form"/)
  assert.match(
    html,
    /href="\/admin\/stock\/lots\?lang=vi"[^>]*data-variant="secondary"|data-variant="secondary"[^>]*href="\/admin\/stock\/lots\?lang=vi"/,
  )
  assert.match(html, /id="lot-create-form"/)
  assert.match(html, /data-scope="lot-create"/)
  assert.match(html, /action="\/admin\/stock\/lots\/new\?lang=vi"/)
  assert.match(html, /data-ui="form-errors"[^>]*role="alert"[\s\S]*?Dữ liệu chưa hợp lệ/)
  assert.match(html, /name="productId"[\s\S]*?value="variant-1"[\s\S]*?value="variant-2"/)
  assert.match(html, /name="productId"[\s\S]*?name="name"[\s\S]*?name="ref"[\s\S]*?name="note"/)
  assert.match(html, /name="note"[^>]*data-ui="form-control"|data-ui="form-control"[^>]*name="note"/)
  assert.doesNotMatch(html, /data-ui="form-actions"/)
  assert.doesNotMatch(html, /data-ui="form-page-aside"|data-ui="chatter"/)
  assert.doesNotMatch(html, /data-ui="record-workspace"|data-ui="form-page-back"/)
  assert.match(html, /data-ui="form-page-context"[\s\S]*?data-ui="breadcrumbs"/)
})
