import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import {
  stockRouteDetailScreen,
  type StockRouteDetailOptions,
} from '../packages/ketsuite/src/modules/stock_backend/screens/stock-route-detail.tsx'

const messages: Record<string, string> = {
  'stock_backend.action.addRule': 'Thêm quy tắc',
  'stock_backend.action.save': 'Lưu',
  'stock_backend.col.name': 'Tên',
  'stock_backend.field.destinationLocation': 'Vị trí đích',
  'stock_backend.field.operationType': 'Loại hoạt động',
  'stock_backend.field.procureMethod': 'Phương thức cung ứng',
  'stock_backend.field.ruleAction': 'Hành động',
  'stock_backend.field.sequence': 'Thứ tự',
  'stock_backend.field.sourceLocation': 'Vị trí nguồn',
  'stock_backend.procureMethod.make_to_order': 'Theo đơn hàng',
  'stock_backend.procureMethod.make_to_stock': 'Từ tồn kho',
  'stock_backend.procureMethod.mts_else_mto': 'Tồn kho, nếu thiếu thì theo đơn',
  'stock_backend.ruleAction.pull': 'Kéo',
  'stock_backend.ruleAction.pull_push': 'Kéo & đẩy',
  'stock_backend.ruleAction.push': 'Đẩy',
  'stock_backend.stockRoute.detail.information.hint': 'Tên và thứ tự ưu tiên của tuyến.',
  'stock_backend.stockRoute.detail.information.title': 'Thông tin tuyến',
  'stock_backend.stockRoute.detail.rules.hint': 'Các bước dịch chuyển của tuyến.',
  'stock_backend.stockRoute.detail.rules.title': 'Quy tắc tuyến',
  'stock_backend.stockRoute.detail.summary.pull': 'Kéo',
  'stock_backend.stockRoute.detail.summary.push': 'Đẩy',
  'stock_backend.stockRoute.detail.summary.rules': 'Quy tắc',
  'stock_backend.stockRoute.field.name': 'Tên tuyến',
  'stock_backend.stockRoute.field.sequence.help': 'Số nhỏ được ưu tiên trước.',
  'stock_backend.stockRoute.rule.col.name': 'Tên quy tắc',
  'stock_backend.stockRoute.rule.create.hint': 'Thêm một bước cung ứng vào tuyến.',
  'stock_backend.stockRoute.rule.create.title': 'Thêm quy tắc',
  'stock_backend.stockRoute.rule.empty': 'Chưa có quy tắc',
  'stock_backend.stockRoute.rule.emptyHint': 'Thêm quy tắc để tuyến có thể dịch chuyển hàng.',
  'stock_backend.stockRoute.rule.name.placeholder': 'Ví dụ: Kho chính → Khu vực đóng gói',
  'stock_backend.stockRoute.status.active': 'Đang hoạt động',
  'stock_backend.stockRoute.status.archived': 'Đã lưu trữ',
}

const translate = ((key: string) => messages[key] ?? key) as Translator
translate.locale = 'vi'
translate.has = (key) => key in messages
translate.resolves = translate.has

const options: StockRouteDetailOptions = {
  route: { id: 'route-1', name: 'Giao hàng hai bước', sequence: 10, active: true },
  rows: [
    {
      id: 'rule-pull',
      name: 'Kệ xuất → Khu đóng gói',
      action: 'pull',
      actionLabel: 'Kéo',
      sequence: 10,
      source: 'Kho / Kệ xuất',
      destination: 'Kho / Đóng gói',
      operationType: 'Lấy hàng',
      procureMethod: 'Từ tồn kho',
    },
    {
      id: 'rule-push',
      name: 'Khu đóng gói → Kệ giao',
      action: 'push',
      actionLabel: 'Đẩy',
      sequence: 20,
      source: 'Kho / Đóng gói',
      destination: 'Kho / Kệ giao',
      operationType: 'Đóng gói',
      procureMethod: 'Theo đơn hàng',
    },
  ],
  locations: [
    { value: 'stock', label: 'Kho / Tồn kho' },
    { value: 'pack', label: 'Kho / Đóng gói' },
  ],
  pickingTypes: [
    { value: 'pick', label: 'Lấy hàng' },
    { value: 'pack', label: 'Đóng gói' },
  ],
  action: '/vi/admin/stock/routes/route-1',
  routeErrors: ['Tên tuyến không hợp lệ'],
  ruleErrors: ['Quy tắc không hợp lệ'],
}

test('stock route detail: uses FormPage with compact state, summary and external route save', () => {
  const html = renderToString(stockRouteDetailScreen(translate, options, {}))

  assert.match(html, /data-ui="form-page" data-scope="stock-route-form-page" data-has-aside="false"/)
  assert.match(html, /data-ui="form-page-title"[^>]*>[\s\S]*?Giao hàng hai bước/)
  assert.match(html, /data-ui="form-page-description"[^>]*>[\s\S]*?Thứ tự: 10/)
  assert.match(html, /data-ui="form-page-status"[\s\S]*?Đang hoạt động/)
  assert.match(html, /data-ui="form-page-actions"[\s\S]*?type="submit"[^>]*form="stock-route-detail-form"/)
  assert.match(html, /data-ui="form-page-meta"[\s\S]*?Quy tắc: 2[\s\S]*?Kéo: 1[\s\S]*?Đẩy: 1/)
  assert.doesNotMatch(html, /data-ui="form-page-aside"|data-ui="record-workspace"|Thông tin nhanh/)
})

test('stock route detail: preserves route form, rule table and complete add-rule form', () => {
  const html = renderToString(stockRouteDetailScreen(translate, options, {}))

  assert.match(html, /id="stock-route-detail-form"/)
  assert.match(html, /data-scope="stock-route"/)
  assert.match(html, /name="intent" value="route"/)
  assert.match(html, /name="name"[\s\S]*?name="sequence"/)
  assert.match(html, /Tên tuyến không hợp lệ/)
  assert.match(html, /data-ui="table"[\s\S]*?Kệ xuất → Khu đóng gói[\s\S]*?Khu đóng gói → Kệ giao/)
  assert.match(html, /id="stock-route-rule-form"/)
  assert.match(html, /data-scope="stock-route-rule"/)
  assert.match(html, /name="intent" value="rule"/)
  assert.match(
    html,
    /name="name"[\s\S]*?name="action"[\s\S]*?name="sequence"[\s\S]*?name="locationSrcId"[\s\S]*?name="locationDestId"[\s\S]*?name="pickingTypeId"[\s\S]*?name="procureMethod"/,
  )
  assert.match(html, /value="pull"[\s\S]*?value="push"[\s\S]*?value="pull_push"/)
  assert.match(html, /value="make_to_stock"[\s\S]*?value="make_to_order"[\s\S]*?value="mts_else_mto"/)
  assert.match(html, /value="stock"[\s\S]*?value="pack"/)
  assert.match(html, /Quy tắc không hợp lệ/)
})

test('stock route detail: renders the translated rules empty state', () => {
  const html = renderToString(stockRouteDetailScreen(translate, { ...options, rows: [] }, {}))

  assert.match(html, /Chưa có quy tắc/)
  assert.match(html, /Thêm quy tắc để tuyến có thể dịch chuyển hàng/)
  assert.doesNotMatch(html, /data-ui="table"/)
  assert.match(html, /data-ui="form-page-meta"[\s\S]*?Quy tắc: 0/)
})
