import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { warehousesListScreen } from '../packages/ketsuite/src/modules/stock_backend/screens/warehouses-list.tsx'

const messages: Record<string, string> = {
  'stock_backend.warehouses': 'Kho hàng',
  'stock_backend.warehouse.title': 'Kho hàng',
  'stock_backend.warehouse.subtitle': 'Định nghĩa kho vật lý và luồng nhận, giao hàng của từng kho.',
  'stock_backend.warehouse.summary.total': 'Kho đang dùng',
  'stock_backend.warehouse.col.name': 'Kho hàng',
  'stock_backend.warehouse.col.code': 'Tên viết tắt',
  'stock_backend.warehouse.col.reception': 'Lô hàng đến',
  'stock_backend.warehouse.col.delivery': 'Lô hàng đi',
  'stock_backend.warehouse.empty': 'Chưa có kho hàng',
  'stock_backend.warehouse.emptyHint': 'Tạo kho đầu tiên để sinh vị trí và loại hoạt động mặc định.',
  'stock_backend.receptionSteps.two_steps': 'Nhận hàng hai bước',
  'stock_backend.deliverySteps.pick_pack_ship': 'Lấy hàng, đóng gói, giao hàng',
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

test('stock warehouses list: keeps columns and search in the ListPage hierarchy', () => {
  const html = renderToString(
    warehousesListScreen(
      translate,
      {
        createHref: '/admin/stock/warehouses/new?lang=vi',
        total: 8,
        rows: [
          {
            id: 'warehouse-central',
            name: 'Kho trung tâm',
            code: 'KTT',
            receptionSteps: 'two_steps',
            deliverySteps: 'pick_pack_ship',
          },
        ],
      },
      {
        chrome: {
          search: { name: 'q', placeholder: 'Tìm kho hàng…' },
          pager: { from: 1, to: 1, total: 8 },
        },
      },
    ),
  )

  assert.equal(html.match(/data-ui="list-page-title"/g)?.length, 1)
  assert.doesNotMatch(html, /data-ui="topbar"/)
  assert.match(
    html,
    /data-ui="list-page-title-row"[\s\S]*?data-ui="list-page-actions"[\s\S]*?href="\/admin\/stock\/warehouses\/new\?lang=vi"/,
  )
  assert.match(
    html,
    /data-ui="list-page-controls"[\s\S]*?data-ui="chrome-search"[\s\S]*?data-ui="list-page-body"[\s\S]*?data-ui="list-page-footer"[\s\S]*?Kho đang dùng: 8/,
  )
  assert.match(html, /data-col="name"[\s\S]*?Kho trung tâm/)
  assert.match(html, /data-col="code"[\s\S]*?data-ui="code"[\s\S]*?KTT/)
  assert.match(html, /Nhận hàng hai bước/)
  assert.match(html, /Lấy hàng, đóng gói, giao hàng/)
  assert.doesNotMatch(html, /warehouse-create-form/)
})

test('stock warehouses list: keeps the empty state and localized create action', () => {
  const html = renderToString(
    warehousesListScreen(translate, {
      createHref: '/admin/stock/warehouses/new?lang=vi',
      rows: [],
    }),
  )

  assert.match(html, /data-ui="list-page"/)
  assert.match(html, /data-ui="empty"/)
  assert.match(html, /Chưa có kho hàng/)
  assert.match(html, /Kho đang dùng: 0/)
  assert.match(html, /href="\/admin\/stock\/warehouses\/new\?lang=vi"/)
})
