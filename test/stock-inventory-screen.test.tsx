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

const options = {
  rows: [
    {
      id: 'balance-1',
      product: 'Cà phê rang',
      reference: 'CF-01',
      location: 'Kho trung tâm',
      lot: 'LOT-2026',
      quantity: '12',
      reserved: '2',
      available: '10',
    },
  ],
  products: [],
  locations: [],
  inventoryLocations: [],
  units: [],
  lots: [],
  action: '/admin/stock/inventory',
  locationsHref: '/admin/stock/locations',
}
test('inventory is a compact collection with count creation above table controls', () => {
  const html = renderToString(
    inventoryScreen(
      translate,
      {
        ...options,
        createHref: '/admin/stock/inventory?record=stock.count%3Anew',
        table: { rowHref: (row) => `/admin/stock/inventory?record=stock.count%3A${row.id}` },
      },
      {},
    ),
  )
  assert.match(html, /data-ui="list-page"/)
  assert.doesNotMatch(html, /data-ui="record-workspace"|inventory-adjustment-form/)
  assert.ok(html.indexOf('record=stock.count%3Anew') < html.indexOf('data-ui="kt-row"'))
  assert.match(html, /record=stock.count%3Abalance-1/)
  assert.match(html, /Cà phê rang/)
  assert.match(html, /CF-01/)
  assert.match(html, /LOT-2026/)
})
test('inventory read-only collection omits count creation and renders its empty state', () => {
  const html = renderToString(inventoryScreen(translate, { ...options, rows: [], createHref: null }, {}))
  assert.doesNotMatch(html, /record=stock.count%3Anew|inventory-adjustment-form/)
  assert.match(html, /Chưa có tồn kho/)
})
