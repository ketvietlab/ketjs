import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { replenishmentListScreen } from '../packages/ketsuite/src/modules/stock_backend/screens/replenishment-list.tsx'

const messages: Record<string, string> = {
  'stock_backend.replenishment': 'Bổ sung hàng',
  'stock_backend.replenishment.title': 'Bổ sung hàng',
  'stock_backend.replenishment.subtitle': 'Theo dõi tồn dự báo và bổ sung hàng theo ngưỡng min/max.',
  'stock_backend.replenishment.summary.rules': 'Tổng quy tắc',
  'stock_backend.replenishment.col.product': 'Sản phẩm',
  'stock_backend.field.location': 'Vị trí',
  'stock_backend.replenishment.col.forecasted': 'Dự báo',
  'stock_backend.field.minQuantity': 'Tồn tối thiểu',
  'stock_backend.field.maxQuantity': 'Tồn tối đa',
  'stock_backend.replenishment.col.toOrder': 'Cần đặt',
  'stock_backend.field.replenishmentUom': 'Đơn vị bổ sung',
  'stock_backend.field.trigger': 'Kích hoạt',
  'stock_backend.replenishment.col.action': 'Thao tác',
  'stock_backend.action.run': 'Chạy bổ sung',
  'stock_backend.replenishment.empty': 'Chưa có quy tắc tái đặt hàng',
  'stock_backend.replenishment.emptyHint': 'Tạo quy tắc đầu tiên để nhận đề xuất bổ sung hàng.',
  'stock_backend.action.create': 'Tạo mới',
  'backend.table.columns': 'Cột',
  'backend.table.selectAll': 'Chọn tất cả dòng',
  'backend.table.selectRow': 'Chọn dòng',
  'backend.chrome.more': 'Thêm thao tác',
  'backend.chrome.previous': 'Trang trước',
  'backend.chrome.next': 'Trang sau',
}

const translate = ((key: string, params?: Record<string, unknown>) => {
  let value = messages[key] ?? key
  for (const [name, replacement] of Object.entries(params ?? {}))
    value = value.replaceAll(`{${name}}`, String(replacement))
  return value
}) as Translator
translate.locale = 'vi'
translate.has = (key) => key in messages
translate.resolves = translate.has

test('stock replenishment list: preserves operational columns and actions in ListPage', () => {
  const html = renderToString(
    replenishmentListScreen(
      translate,
      {
        createHref: '/admin/stock/replenishment/new?lang=vi',
        total: 14,
        rows: [
          {
            id: 'orderpoint-denim',
            product: 'Vải denim xanh',
            warehouse: 'Kho trung tâm',
            location: 'Tồn kho',
            trigger: 'auto',
            triggerLabel: 'Tự động',
            minQuantity: '100',
            maxQuantity: '500',
            forecasted: '80',
            toOrder: '420',
            replenishmentUom: 'Mét',
            runAction: '/admin/stock/replenishment/orderpoint-denim/run?lang=vi',
          },
        ],
      },
      {
        chrome: {
          search: { name: 'q', placeholder: 'Tìm quy tắc bổ sung…' },
          pager: { from: 1, to: 1, total: 14 },
        },
      },
    ),
  )

  assert.equal(html.match(/data-ui="list-page-title"/g)?.length, 1)
  assert.doesNotMatch(html, /data-ui="topbar"/)
  assert.match(html, /href="\/admin\/stock\/replenishment\/new\?lang=vi"/)
  assert.match(
    html,
    /data-ui="list-page-controls"[\s\S]*?data-ui="chrome-search"[\s\S]*?data-ui="list-page-body"[\s\S]*?data-ui="list-page-footer"[\s\S]*?Tổng quy tắc: 14/,
  )
  assert.match(html, /data-col="product"[\s\S]*?Vải denim xanh/)
  assert.match(html, /data-col="location"[\s\S]*?Kho trung tâm · Tồn kho/)
  assert.match(html, /data-col="forecasted"[\s\S]*?>80</)
  assert.match(html, /data-col="minimum"[\s\S]*?>100</)
  assert.match(html, /data-col="maximum"[\s\S]*?>500</)
  assert.match(html, /data-col="toOrder"[\s\S]*?data-tone="warning"[\s\S]*?420/)
  assert.match(html, /data-col="trigger"[\s\S]*?data-tone="positive"[\s\S]*?Tự động/)
  assert.match(
    html,
    /action="\/admin\/stock\/replenishment\/orderpoint-denim\/run\?lang=vi"[\s\S]*?Chạy bổ sung/,
  )
  assert.doesNotMatch(html, /replenishment-create-form/)
})

test('stock replenishment list: keeps the empty state and localized create action', () => {
  const html = renderToString(
    replenishmentListScreen(translate, {
      createHref: '/admin/stock/replenishment/new?lang=vi',
      rows: [],
    }),
  )

  assert.match(html, /data-ui="list-page"/)
  assert.match(html, /data-ui="empty"/)
  assert.match(html, /Chưa có quy tắc tái đặt hàng/)
  assert.match(html, /Tổng quy tắc: 0/)
  assert.match(html, /href="\/admin\/stock\/replenishment\/new\?lang=vi"/)
})
