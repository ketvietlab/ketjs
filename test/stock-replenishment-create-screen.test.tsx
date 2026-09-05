import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { replenishmentCreateScreen } from '../packages/ketsuite/src/modules/stock_backend/screens/replenishment-create.tsx'

const messages: Record<string, string> = {
  'stock_backend.action.cancel': 'Hủy',
  'stock_backend.action.create': 'Tạo mới',
  'stock_backend.replenishment.create.title': 'Tạo quy tắc tái đặt hàng',
  'stock_backend.replenishment.create.hint': 'Chọn sản phẩm lưu kho, vị trí và mức tồn tối thiểu/tối đa.',
  'stock_backend.field.product': 'Sản phẩm',
  'stock_backend.field.warehouse': 'Kho hàng',
  'stock_backend.field.location': 'Vị trí',
  'stock_backend.field.trigger': 'Kích hoạt',
  'stock_backend.trigger.auto': 'Tự động',
  'stock_backend.trigger.manual': 'Thủ công',
  'stock_backend.field.minQuantity': 'Tồn tối thiểu',
  'stock_backend.field.maxQuantity': 'Tồn tối đa',
  'stock_backend.field.replenishmentUom': 'Đơn vị bổ sung',
  'stock_backend.field.route': 'Tuyến cung ứng',
}

const translate = ((key: string) => messages[key] ?? key) as Translator
translate.locale = 'vi'
translate.has = (key) => key in messages
translate.resolves = translate.has

test('stock replenishment create: preserves all rule fields, options and errors in FormPage', () => {
  const html = renderToString(
    replenishmentCreateScreen(
      translate,
      {
        products: [{ value: 'denim-blue', label: 'Vải denim xanh' }],
        warehouses: [{ value: 'central', label: 'Kho trung tâm' }],
        locations: [{ value: 'central-stock', label: 'Kho trung tâm/Tồn kho' }],
        units: [{ value: 'meter', label: 'Mét' }],
        routes: [{ value: 'buy', label: 'Mua hàng' }],
        action: '/admin/stock/replenishment/new?lang=vi',
        cancelHref: '/admin/stock/replenishment?lang=vi',
        errors: ['Sản phẩm và vị trí đã có quy tắc'],
      },
      {},
    ),
  )

  assert.equal(html.match(/data-ui="form-page"/g)?.length, 1)
  assert.match(html, /data-ui="form-page-actions"[\s\S]*?type="submit"[^>]*form="replenishment-create-form"/)
  assert.match(html, /href="\/admin\/stock\/replenishment\?lang=vi"/)
  assert.match(html, /id="replenishment-create-form"/)
  assert.match(html, /data-scope="stock-replenishment-create"/)
  assert.match(html, /action="\/admin\/stock\/replenishment\/new\?lang=vi"/)
  assert.match(html, /data-ui="form-errors"[^>]*role="alert"[\s\S]*?Sản phẩm và vị trí đã có quy tắc/)
  assert.match(html, /name="productId"[\s\S]*?value="denim-blue"/)
  assert.match(html, /name="warehouseId"[\s\S]*?value="central"/)
  assert.match(html, /name="locationId"[\s\S]*?value="central-stock"/)
  assert.match(html, /name="trigger"[\s\S]*?value="auto"[\s\S]*?value="manual"/)
  assert.match(html, /name="minQuantity"[^>]*value="0"/)
  assert.match(html, /name="maxQuantity"[^>]*value="0"/)
  assert.match(html, /name="replenishmentUomId"[\s\S]*?value="meter"/)
  assert.match(html, /name="routeId"[\s\S]*?value="buy"/)
  assert.doesNotMatch(html, /data-ui="form-actions"/)
  assert.doesNotMatch(html, /data-ui="record-workspace"|data-ui="form-page-aside"|data-ui="chatter"/)
})
