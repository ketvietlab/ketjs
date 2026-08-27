import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { warehouseCreateScreen } from '../packages/ketsuite/src/modules/stock_backend/screens/warehouse-create.tsx'

const messages: Record<string, string> = {
  'stock_backend.action.cancel': 'Hủy',
  'stock_backend.action.create': 'Tạo mới',
  'stock_backend.warehouse.create.title': 'Tạo kho hàng',
  'stock_backend.warehouse.create.hint':
    'Các vị trí, loại hoạt động và tuyến mặc định được sinh từ cấu hình này.',
  'stock_backend.warehouse.field.name': 'Tên kho',
  'stock_backend.warehouse.field.name.placeholder': 'Ví dụ: Kho trung tâm',
  'stock_backend.warehouse.field.code': 'Tên viết tắt',
  'stock_backend.warehouse.field.code.placeholder': 'Ví dụ: KTT',
  'stock_backend.warehouse.field.code.help': 'Mã ngắn duy nhất trong công ty, dùng làm tiền tố vận hành.',
  'stock_backend.field.receptionSteps': 'Lô hàng đến',
  'stock_backend.field.deliverySteps': 'Lô hàng đi',
  'stock_backend.receptionSteps.one_step': 'Nhận hàng một bước',
  'stock_backend.receptionSteps.two_steps': 'Nhận hàng hai bước',
  'stock_backend.receptionSteps.three_steps': 'Nhận hàng ba bước',
  'stock_backend.deliverySteps.ship_only': 'Giao hàng một bước',
  'stock_backend.deliverySteps.pick_ship': 'Lấy hàng, giao hàng',
  'stock_backend.deliverySteps.pick_pack_ship': 'Lấy hàng, đóng gói, giao hàng',
}

const translate = ((key: string) => messages[key] ?? key) as Translator
translate.locale = 'vi'
translate.has = (key) => key in messages
translate.resolves = translate.has

test('stock warehouse create: preserves all fields, defaults and errors in FormPage', () => {
  const html = renderToString(
    warehouseCreateScreen(
      translate,
      {
        action: '/admin/stock/warehouses/new?lang=vi',
        cancelHref: '/admin/stock/warehouses?lang=vi',
        errors: ['Mã kho đã tồn tại'],
      },
      {},
    ),
  )

  assert.equal(html.match(/data-ui="form-page"/g)?.length, 1)
  assert.match(html, /data-ui="form-page-title"[^>]*>[\s\S]*?Tạo kho hàng/)
  assert.match(html, /data-ui="form-page-description"[^>]*>[\s\S]*?Các vị trí, loại hoạt động/)
  assert.match(html, /data-ui="form-page-actions"[\s\S]*?type="submit"[^>]*form="warehouse-create-form"/)
  assert.match(
    html,
    /href="\/admin\/stock\/warehouses\?lang=vi"[^>]*data-variant="secondary"|data-variant="secondary"[^>]*href="\/admin\/stock\/warehouses\?lang=vi"/,
  )
  assert.match(html, /id="warehouse-create-form"/)
  assert.match(html, /data-scope="warehouse-create"/)
  assert.match(html, /action="\/admin\/stock\/warehouses\/new\?lang=vi"/)
  assert.match(html, /data-ui="form-errors"[^>]*role="alert"[\s\S]*?Mã kho đã tồn tại/)
  assert.match(html, /name="name"[^>]*placeholder="Ví dụ: Kho trung tâm"/)
  assert.match(html, /name="code"[^>]*placeholder="Ví dụ: KTT"/)
  assert.match(html, /Mã ngắn duy nhất trong công ty/)
  assert.match(html, /name="receptionSteps"[\s\S]*?value="one_step"[^>]*checked/)
  assert.match(html, /name="receptionSteps"[\s\S]*?value="two_steps"[\s\S]*?value="three_steps"/)
  assert.match(html, /name="deliverySteps"[\s\S]*?value="ship_only"[^>]*checked/)
  assert.match(html, /name="deliverySteps"[\s\S]*?value="pick_ship"[\s\S]*?value="pick_pack_ship"/)
  assert.doesNotMatch(html, /data-ui="form-actions"/)
  assert.doesNotMatch(html, /data-ui="record-workspace"|data-ui="form-page-aside"|data-ui="chatter"/)
})
