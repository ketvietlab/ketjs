import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { stockRouteCreateScreen } from '../packages/ketsuite/src/modules/stock_backend/screens/stock-route-create.tsx'

const messages: Record<string, string> = {
  'stock_backend.action.cancel': 'Hủy',
  'stock_backend.action.create': 'Tạo mới',
  'stock_backend.field.sequence': 'Thứ tự',
  'stock_backend.stockRoute.create.hint': 'Tạo tuyến trước, sau đó cấu hình các quy tắc.',
  'stock_backend.stockRoute.create.title': 'Tạo tuyến cung ứng',
  'stock_backend.stockRoute.detail.information.hint': 'Tên và thứ tự ưu tiên của tuyến.',
  'stock_backend.stockRoute.detail.information.title': 'Thông tin tuyến',
  'stock_backend.stockRoute.field.name': 'Tên tuyến',
  'stock_backend.stockRoute.field.name.placeholder': 'Ví dụ: Nhận hàng hai bước',
  'stock_backend.stockRoute.field.sequence.help': 'Số nhỏ hơn được ưu tiên.',
}

const translate = ((key: string) => messages[key] ?? key) as Translator
translate.locale = 'vi'
translate.has = (key) => key in messages
translate.resolves = translate.has

test('stock route create: renders the preserved route fields in a compact FormPage', () => {
  const html = renderToString(
    stockRouteCreateScreen(
      translate,
      {
        action: '/admin/stock/routes/new?lang=vi',
        cancelHref: '/admin/stock/routes?lang=vi',
        errors: ['Dữ liệu chưa hợp lệ'],
      },
      {},
    ),
  )

  assert.equal(html.match(/data-ui="form-page"/g)?.length, 1)
  assert.match(html, /data-ui="form-page-title"[^>]*>[\s\S]*?Tạo tuyến cung ứng/)
  assert.match(html, /data-ui="form-page-actions"[\s\S]*?type="submit"[^>]*form="stock-route-create-form"/)
  assert.match(
    html,
    /href="\/admin\/stock\/routes\?lang=vi"[^>]*data-variant="secondary"|data-variant="secondary"[^>]*href="\/admin\/stock\/routes\?lang=vi"/,
  )
  assert.match(html, /id="stock-route-create-form"/)
  assert.match(html, /data-scope="stock-route-create"/)
  assert.match(html, /action="\/admin\/stock\/routes\/new\?lang=vi"/)
  assert.match(html, /data-ui="form-errors"[^>]*role="alert"[\s\S]*?Dữ liệu chưa hợp lệ/)
  assert.match(html, /name="name"[\s\S]*?name="sequence"/)
  assert.match(html, /name="name"[^>]*placeholder="Ví dụ: Nhận hàng hai bước"/)
  assert.match(html, /name="sequence"[^>]*value="10"/)
  assert.match(html, /Số nhỏ hơn được ưu tiên/)
  assert.doesNotMatch(html, /data-ui="form-actions"/)
  assert.doesNotMatch(html, /data-ui="form-page-aside"|data-ui="chatter"/)
  assert.doesNotMatch(html, /data-ui="record-workspace"|data-ui="form-page-back"|data-ui="breadcrumbs"/)
})
