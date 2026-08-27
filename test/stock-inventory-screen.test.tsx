import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { inventoryScreen } from '../packages/ketsuite/src/modules/stock_backend/screens/inventory.tsx'

const messages: Record<string, string> = {
  'stock_backend.action.apply': 'Áp dụng kiểm kê',
  'stock_backend.adjustment.hint': 'Nhập số lượng đã đếm tại kho.',
  'stock_backend.adjustment.title': 'Điều chỉnh tồn kho',
  'stock_backend.field.counted': 'Số lượng đã đếm',
  'stock_backend.field.inventoryLocation': 'Vị trí điều chỉnh',
  'stock_backend.field.location': 'Vị trí',
  'stock_backend.field.lot': 'Lô / Sê-ri',
  'stock_backend.field.product': 'Sản phẩm',
  'stock_backend.field.uom': 'Đơn vị tính',
  'stock_backend.inventory': 'Tồn kho',
  'stock_backend.inventory.adjustmentLocation.help': 'Vị trí ảo ghi nhận chênh lệch.',
  'stock_backend.inventory.applied.message': 'Chênh lệch đã được ghi nhận.',
  'stock_backend.inventory.applied.title': 'Đã áp dụng kiểm kê',
  'stock_backend.inventory.balances.hint': 'Tồn thực tế, đã giữ và có thể sử dụng.',
  'stock_backend.inventory.balances.title': 'Tồn kho hiện tại',
  'stock_backend.inventory.col.available': 'Có thể dùng',
  'stock_backend.inventory.col.location': 'Vị trí',
  'stock_backend.inventory.col.lot': 'Lô / Sê-ri',
  'stock_backend.inventory.col.onHand': 'Tồn thực tế',
  'stock_backend.inventory.col.product': 'Sản phẩm',
  'stock_backend.inventory.col.reference': 'Mã nội bộ',
  'stock_backend.inventory.col.reserved': 'Đã giữ',
  'stock_backend.inventory.configuration.action': 'Mở cấu hình vị trí',
  'stock_backend.inventory.configuration.message': 'Cần đủ sản phẩm, vị trí và đơn vị tính.',
  'stock_backend.inventory.configuration.title': 'Chưa đủ cấu hình để kiểm kê',
  'stock_backend.inventory.empty': 'Chưa có tồn kho',
  'stock_backend.inventory.emptyHint': 'Ghi nhận số đếm đầu tiên để tạo số dư.',
  'stock_backend.inventory.kicker': 'Vận hành kho',
  'stock_backend.inventory.summary.balances': 'Số dư',
  'stock_backend.inventory.summary.locations': 'Vị trí',
  'stock_backend.inventory.summary.onHand': 'Tồn thực tế',
  'stock_backend.inventory.workspace.subtitle': 'Điều chỉnh và theo dõi số dư tại cùng một nơi.',
  'stock_backend.inventory.workspace.title': 'Kiểm kê và tồn kho',
  'backend.table.columns': 'Cột',
  'backend.table.selectAll': 'Chọn tất cả dòng',
  'backend.table.selectRow': 'Chọn dòng',
}

const translate = ((key: string) => messages[key] ?? key) as Translator
translate.locale = 'vi'
translate.has = (key) => key in messages
translate.resolves = translate.has

test('stock inventory: preserves the adjustment task beside current balances', () => {
  const html = renderToString(
    inventoryScreen(
      translate,
      {
        rows: [
          {
            id: 'balance-1',
            product: 'Cà phê rang',
            reference: 'CF-01',
            location: 'Kho trung tâm / Tồn kho',
            lot: 'LOT-2026-08',
            quantity: '12',
            reserved: '2',
            available: '10',
          },
        ],
        products: [{ value: 'product-1', label: 'Cà phê rang · CF-01' }],
        locations: [{ value: 'stock', label: 'Kho trung tâm / Tồn kho' }],
        inventoryLocations: [{ value: 'adjustment', label: 'Điều chỉnh tồn kho' }],
        units: [{ value: 'unit', label: 'Đơn vị' }],
        lots: [{ value: 'lot-1', label: 'LOT-2026-08' }],
        action: '/admin/stock/inventory?lang=vi',
        locationsHref: '/admin/stock/locations?lang=vi',
        applied: true,
        errors: ['Kiểm tra lại số lượng'],
      },
      {},
    ),
  )

  assert.match(html, /data-ui="record-workspace"/)
  assert.doesNotMatch(html, /data-ui="list-page"|data-ui="form-page"/)
  assert.match(html, /Đã áp dụng kiểm kê[\s\S]*?Chênh lệch đã được ghi nhận/)
  assert.match(html, /id="inventory-adjustment-form"/)
  assert.match(html, /data-scope="inventory-adjustment"/)
  assert.match(html, /action="\/admin\/stock\/inventory\?lang=vi"/)
  assert.match(
    html,
    /name="productId"[\s\S]*?name="locationId"[\s\S]*?name="countedQuantity"[\s\S]*?name="productUomId"[\s\S]*?name="lotId"[\s\S]*?name="inventoryLocationId"/,
  )
  assert.match(html, /data-ui="form-errors"[^>]*role="alert"[\s\S]*?Kiểm tra lại số lượng/)
  assert.match(html, /data-ui="table"[\s\S]*?Cà phê rang[\s\S]*?CF-01/)
  assert.match(html, /Kho trung tâm \/ Tồn kho[\s\S]*?LOT-2026-08/)
  assert.match(html, /data-col="available"[\s\S]*?data-tone="positive"[\s\S]*?>10</)
  assert.match(
    html,
    /data-ui="record-fact-value"[^>]*>[\s\S]*?12[\s\S]*?data-ui="record-fact-label"[^>]*>[\s\S]*?Tồn thực tế/,
  )
  assert.match(
    html,
    /data-ui="record-fact-value"[^>]*>[\s\S]*?1[\s\S]*?data-ui="record-fact-label"[^>]*>[\s\S]*?Số dư/,
  )
  assert.match(
    html,
    /data-ui="record-fact-value"[^>]*>[\s\S]*?1[\s\S]*?data-ui="record-fact-label"[^>]*>[\s\S]*?Vị trí/,
  )
})

test('stock inventory: keeps configuration guidance and balance empty state when setup is incomplete', () => {
  const html = renderToString(
    inventoryScreen(
      translate,
      {
        rows: [],
        products: [],
        locations: [],
        inventoryLocations: [],
        units: [],
        lots: [],
        action: '/admin/stock/inventory?lang=vi',
        locationsHref: '/admin/stock/locations?lang=vi',
      },
      {},
    ),
  )

  assert.doesNotMatch(html, /inventory-adjustment-form/)
  assert.match(html, /Chưa đủ cấu hình để kiểm kê/)
  assert.match(html, /href="\/admin\/stock\/locations\?lang=vi"/)
  assert.match(html, /data-ui="empty"[\s\S]*?Chưa có tồn kho/)
  assert.match(html, /Điều chỉnh tồn kho[\s\S]*?Tồn kho hiện tại/)
})
