import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import {
  forecastScreen,
  type ForecastScreenOptions,
} from '../packages/ketsuite/src/modules/stock_backend/screens/forecast.tsx'

const messages: Record<string, string> = {
  'stock_backend.action.calculate': 'Tính dự báo',
  'stock_backend.field.location': 'Vị trí',
  'stock_backend.field.product': 'Sản phẩm',
  'stock_backend.field.uom': 'Đơn vị',
  'stock_backend.field.warehouse': 'Kho hàng',
  'stock_backend.forecast': 'Dự báo tồn kho',
  'stock_backend.forecast.available': 'Có thể sử dụng',
  'stock_backend.forecast.empty': 'Chưa chọn sản phẩm',
  'stock_backend.forecast.emptyHint': 'Chọn một sản phẩm lưu kho để tính tồn dự báo.',
  'stock_backend.forecast.filter.hint': 'Vị trí được chọn sẽ ưu tiên hơn kho hàng.',
  'stock_backend.forecast.filter.title': 'Phạm vi dự báo',
  'stock_backend.forecast.incoming': 'Sắp nhận',
  'stock_backend.forecast.kicker': 'Báo cáo tồn dự báo',
  'stock_backend.forecast.location.help': 'Để trống để tính toàn bộ kho đã chọn.',
  'stock_backend.forecast.onHand': 'Tồn thực tế',
  'stock_backend.forecast.outgoing': 'Sắp xuất',
  'stock_backend.forecast.reserved': 'Đã giữ chỗ',
  'stock_backend.forecast.result.hint': 'Tồn thực tế + sắp nhận − sắp xuất = tồn dự báo.',
  'stock_backend.forecast.result.title': 'Khả năng đáp ứng',
  'stock_backend.forecast.subtitle': 'Chọn sản phẩm và phạm vi kho để xem khả năng đáp ứng dự kiến.',
  'stock_backend.forecast.summary.locations': 'Vị trí',
  'stock_backend.forecast.summary.products': 'Sản phẩm lưu kho',
  'stock_backend.forecast.summary.warehouses': 'Kho hàng',
  'stock_backend.forecast.title': 'Dự báo tồn kho',
  'stock_backend.forecast.value': 'Dự báo',
}

const translate = ((key: string) => messages[key] ?? key) as Translator
translate.locale = 'vi'
translate.has = (key) => key in messages
translate.resolves = translate.has

const base: ForecastScreenOptions = {
  products: [{ value: 'coffee', label: 'Cà phê hạt · CF-01' }],
  warehouses: [{ value: 'wh-hn', label: 'Kho Hà Nội' }],
  locations: [
    { value: 'stock', label: 'Kho Hà Nội / Tồn kho' },
    { value: 'pack', label: 'Kho Hà Nội / Đóng gói' },
  ],
  productId: '',
  warehouseId: 'wh-hn',
  locationId: '',
  action: '/vi/admin/stock/forecast',
  lang: 'vi',
}

test('stock forecast specialized surface: preserves GET filter scope and empty guidance', () => {
  const html = renderToString(forecastScreen(translate, base, {}))

  assert.match(html, /data-ui="record-workspace"/)
  assert.match(html, /id="forecast-filter-form"/)
  assert.match(html, /data-scope="stock-forecast"/)
  assert.match(html, /method="get"/)
  assert.match(html, /action="\/vi\/admin\/stock\/forecast"/)
  assert.match(html, /name="lang" value="vi"/)
  assert.match(html, /name="productId"[\s\S]*?value="coffee"/)
  assert.match(html, /name="warehouseId"[\s\S]*?value="wh-hn"[^>]*selected/)
  assert.match(html, /name="locationId"[\s\S]*?value="stock"[\s\S]*?value="pack"/)
  assert.match(html, /Tính dự báo/)
  assert.match(html, /Chưa chọn sản phẩm/)
  assert.doesNotMatch(html, /data-ui="table"/)
  assert.match(html, /data-ui="record-fact-value"[^>]*>[\s\S]*?1[\s\S]*?Sản phẩm lưu kho/)
  assert.match(html, /data-ui="record-fact-value"[^>]*>[\s\S]*?1[\s\S]*?Kho hàng/)
  assert.match(html, /data-ui="record-fact-value"[^>]*>[\s\S]*?2[\s\S]*?Vị trí/)
})

test('stock forecast specialized surface: preserves one-row availability equation and tones', () => {
  const html = renderToString(
    forecastScreen(
      translate,
      {
        ...base,
        productId: 'coffee',
        locationId: 'stock',
        productLabel: 'Cà phê hạt · CF-01',
        scopeLabel: 'Vị trí: Kho Hà Nội / Tồn kho',
        row: {
          id: 'coffee',
          onHand: '20',
          reserved: '4',
          available: '16',
          incoming: '8',
          outgoing: '25',
          forecasted: '-1',
          uom: 'kg',
        },
      },
      {},
    ),
  )

  assert.match(html, /data-ui="record-heading"[^>]*>[\s\S]*?Cà phê hạt · CF-01/)
  assert.match(html, /data-ui="record-subtitle"[^>]*>[\s\S]*?Vị trí: Kho Hà Nội \/ Tồn kho/)
  assert.match(html, /data-ui="record-fact-value"[^>]*>[\s\S]*?20[\s\S]*?Tồn thực tế/)
  assert.match(html, /data-ui="record-fact-value"[^>]*>[\s\S]*?\+ 8[\s\S]*?Sắp nhận/)
  assert.match(html, /data-ui="record-fact-value"[^>]*>[\s\S]*?− 25[\s\S]*?Sắp xuất/)
  assert.match(html, /data-ui="record-fact-value"[^>]*>[\s\S]*?= -1[\s\S]*?Dự báo/)
  assert.match(html, /data-ui="table"/)
  assert.match(html, /data-col="available"[\s\S]*?data-tone="positive"[\s\S]*?16/)
  assert.match(html, /data-col="forecasted"[\s\S]*?data-tone="danger"[\s\S]*?-1/)
  assert.match(html, /data-col="uom"[\s\S]*?kg/)
})
