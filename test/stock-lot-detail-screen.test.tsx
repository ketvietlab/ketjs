import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import {
  lotDetailScreen,
  type LotDetailOptions,
} from '../packages/ketsuite/src/modules/stock_backend/screens/lot-detail.tsx'

const messages: Record<string, string> = {
  'stock_backend.action.save': 'Lưu',
  'stock_backend.field.lotSerial': 'Lô / Số sê-ri',
  'stock_backend.field.product': 'Sản phẩm',
  'stock_backend.lot.col.available': 'Khả dụng',
  'stock_backend.lot.col.location': 'Vị trí',
  'stock_backend.lot.col.onHand': 'Tồn kho',
  'stock_backend.lot.col.reserved': 'Đã giữ',
  'stock_backend.lot.collaboration.label': 'Trao đổi và hoạt động của lô hoặc sê-ri',
  'stock_backend.lot.empty': 'Chưa có tồn kho',
  'stock_backend.lot.emptyHint': 'Lô này chưa có số lượng tại vị trí nào.',
  'stock_backend.lot.field.description': 'Mô tả',
  'stock_backend.lot.field.reference': 'Tham chiếu nội bộ',
  'stock_backend.lot.field.reference.help': 'Mã tham chiếu tùy chọn.',
  'stock_backend.lot.information.hint': 'Thông tin nhận diện của lô hoặc sê-ri.',
  'stock_backend.lot.information.title': 'Thông tin lô',
  'stock_backend.lot.inventory.hint': 'Số lượng hiện có theo từng vị trí.',
  'stock_backend.lot.inventory.title': 'Tồn kho theo vị trí',
  'stock_backend.lot.status.active': 'Đang hoạt động',
  'stock_backend.lot.status.archived': 'Đã lưu trữ',
}

const translate = ((key: string) => messages[key] ?? key) as Translator
translate.locale = 'vi'
translate.has = (key) => key in messages
translate.resolves = translate.has

const options: LotDetailOptions = {
  lot: {
    id: 'lot-1',
    name: 'LOT-2026-001',
    productId: 'variant-1',
    productLabel: 'Cà phê hạt · CF-01',
    ref: 'NCC-08/2026',
    note: 'Lô nhập tháng 8',
    active: true,
  },
  rows: [
    {
      id: 'quant-1',
      location: 'Kho chính / Kệ A',
      quantity: '20',
      reserved: '3',
      available: '17',
      countsAsOnHand: true,
    },
  ],
  products: [{ value: 'variant-1', label: 'Cà phê hạt · CF-01' }],
  action: '/vi/admin/stock/lots/lot-1',
  collaboration: <div data-ui="stock-lot-chatter-fixture">Chatter</div>,
  editor: <div data-ui="stock-lot-editor-fixture">Editor</div>,
}

test('stock lot detail: uses FormPage with external save, inventory and collaboration rail', () => {
  const html = renderToString(lotDetailScreen(translate, options, {}))

  assert.match(html, /data-ui="form-page" data-scope="stock-lot-form-page" data-has-aside="true"/)
  assert.match(html, /data-ui="form-page-title"[^>]*>[\s\S]*?LOT-2026-001/)
  assert.match(html, /data-ui="form-page-description"[^>]*>[\s\S]*?Cà phê hạt · CF-01 · NCC-08\/2026/)
  assert.match(html, /data-ui="form-page-status"[\s\S]*?Đang hoạt động/)
  assert.match(html, /data-ui="form-page-actions"[\s\S]*?type="submit"[^>]*form="lot-detail-form"/)
  assert.match(html, /id="lot-detail-form"/)
  assert.match(html, /data-scope="stock-lot"/)
  assert.match(html, /name="productId"[\s\S]*?name="name"[\s\S]*?name="ref"[\s\S]*?name="note"/)
  assert.match(html, /data-ui="table"[\s\S]*?Kho chính \/ Kệ A[\s\S]*?17/)
  assert.match(html, /data-ui="form-page-controller"[\s\S]*?stock-lot-editor-fixture/)
  assert.match(html, /data-ui="form-page-aside"[^>]*aria-label="Trao đổi và hoạt động của lô hoặc sê-ri"/)
  assert.match(html, /stock-lot-chatter-fixture/)
  assert.doesNotMatch(html, /data-ui="record-workspace"/)
  assert.doesNotMatch(html, /Thông tin nhanh/)
})

test('stock lot detail partial: replaces only header and body to preserve editor and Chatter', () => {
  const html = renderToString(lotDetailScreen(translate, options, {}, true))

  assert.match(html, /<ket-fragments data-title="LOT-2026-001">/)
  assert.deepEqual(
    [...html.matchAll(/<template data-ket-slot="([^"]+)"/g)].map((match) => match[1]),
    ['stock.lot-header', 'stock.lot-body'],
  )
  assert.doesNotMatch(html, /stock-lot-editor-fixture|stock-lot-chatter-fixture/)
  assert.doesNotMatch(html, /data-ui="shell"|data-ui="form-page"/)
})
