import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { locationCreateScreen } from '../packages/ketsuite/src/modules/stock_backend/screens/location-create.tsx'

const messages: Record<string, string> = {
  'stock_backend.action.cancel': 'Hủy',
  'stock_backend.action.create': 'Tạo mới',
  'stock_backend.field.parentLocation': 'Vị trí cha',
  'stock_backend.field.usage': 'Loại sử dụng',
  'stock_backend.field.warehouse': 'Kho hàng',
  'stock_backend.location.create.hint': 'Đặt vị trí trong cây kho và chọn đúng loại sử dụng.',
  'stock_backend.location.create.title': 'Tạo vị trí',
  'stock_backend.location.field.name': 'Tên vị trí',
  'stock_backend.location.field.name.placeholder': 'Ví dụ: Kệ A-01',
  'stock_backend.location.field.usage.help': 'Loại vị trí quyết định cách tính tồn.',
  'stock_backend.location.field.warehouse.help': 'Chỉ chọn khi vị trí thuộc một kho cụ thể.',
  'stock_backend.usage.customer': 'Khách hàng',
  'stock_backend.usage.internal': 'Nội bộ',
  'stock_backend.usage.inventory': 'Điều chỉnh tồn',
  'stock_backend.usage.production': 'Sản xuất',
  'stock_backend.usage.supplier': 'Nhà cung cấp',
  'stock_backend.usage.transit': 'Trung chuyển',
  'stock_backend.usage.view': 'Nhóm vị trí',
}

const translate = ((key: string) => messages[key] ?? key) as Translator
translate.locale = 'vi'
translate.has = (key) => key in messages
translate.resolves = translate.has

test('stock location create: preserves hierarchy and usage options in a compact FormPage', () => {
  const html = renderToString(
    locationCreateScreen(
      translate,
      {
        parents: [{ value: 'stock-root', label: 'Kho trung tâm / Tồn kho' }],
        warehouses: [{ value: 'warehouse-main', label: 'Kho trung tâm' }],
        action: '/admin/stock/locations/new?lang=vi',
        cancelHref: '/admin/stock/locations?lang=vi',
        errors: ['Dữ liệu chưa hợp lệ'],
      },
      {},
    ),
  )

  assert.equal(html.match(/data-ui="form-page"/g)?.length, 1)
  assert.match(html, /data-ui="form-page-title"[^>]*>[\s\S]*?Tạo vị trí/)
  assert.match(html, /data-ui="form-page-actions"[\s\S]*?type="submit"[^>]*form="location-create-form"/)
  assert.match(
    html,
    /href="\/admin\/stock\/locations\?lang=vi"[^>]*data-variant="secondary"|data-variant="secondary"[^>]*href="\/admin\/stock\/locations\?lang=vi"/,
  )
  assert.match(html, /id="location-create-form"/)
  assert.match(html, /action="\/admin\/stock\/locations\/new\?lang=vi"/)
  assert.match(html, /data-ui="form-errors"[^>]*role="alert"[\s\S]*?Dữ liệu chưa hợp lệ/)
  assert.match(html, /name="name"[\s\S]*?name="parentId"[\s\S]*?name="usage"[\s\S]*?name="warehouseId"/)
  assert.match(html, /name="parentId"[\s\S]*?value=""[\s\S]*?value="stock-root"/)
  assert.match(
    html,
    /name="usage"[\s\S]*?value="internal"[\s\S]*?value="view"[\s\S]*?value="supplier"[\s\S]*?value="customer"[\s\S]*?value="inventory"[\s\S]*?value="production"[\s\S]*?value="transit"/,
  )
  assert.match(html, /name="usage"[\s\S]*?value="internal"[^>]*selected/)
  assert.match(html, /name="warehouseId"[\s\S]*?value=""[\s\S]*?value="warehouse-main"/)
  assert.match(html, /Loại vị trí quyết định cách tính tồn/)
  assert.match(html, /Chỉ chọn khi vị trí thuộc một kho cụ thể/)
  assert.doesNotMatch(html, /data-ui="form-actions"/)
  assert.doesNotMatch(html, /data-ui="form-page-aside"|data-ui="chatter"/)
  assert.doesNotMatch(html, /data-ui="record-workspace"/)
})
