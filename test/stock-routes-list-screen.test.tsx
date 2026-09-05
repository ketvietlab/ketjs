import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { stockRoutesListScreen } from '../packages/ketsuite/src/modules/stock_backend/screens/stock-routes-list.tsx'

const messages: Record<string, string> = {
  'stock_backend.routes': 'Tuyến cung ứng',
  'stock_backend.stockRoute.list.title': 'Tuyến cung ứng',
  'stock_backend.stockRoute.list.subtitle': 'Định nghĩa thứ tự các luồng hàng chạy qua kho và vị trí.',
  'stock_backend.stockRoute.list.summary.total': 'Tổng tuyến',
  'stock_backend.stockRoute.list.col.name': 'Tuyến cung ứng',
  'stock_backend.stockRoute.list.col.sequence': 'Thứ tự',
  'stock_backend.stockRoute.list.col.rules': 'Quy tắc',
  'stock_backend.stockRoute.list.empty': 'Chưa có tuyến cung ứng',
  'stock_backend.stockRoute.list.emptyHint': 'Tạo tuyến đầu tiên để mô tả luồng hàng qua kho.',
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

const selection = {
  formId: 'stock-route-bulk',
  action: '/admin/stock/routes/bulk?lang=vi',
  actions: [{ id: 'archive', label: 'Lưu trữ đã chọn' }],
}

test('stock routes list: keeps localized create, search and row navigation in ListPage', () => {
  const html = renderToString(
    stockRoutesListScreen(
      translate,
      {
        createHref: '/admin/stock/routes/new?lang=vi',
        total: 12,
        table: { selection },
        rows: [
          {
            id: 'route-two-step-receipt',
            name: 'Nhận hàng hai bước',
            sequence: 10,
            ruleCount: 2,
            href: '/admin/stock/routes/route-two-step-receipt?lang=vi',
          },
        ],
      },
      {
        chrome: {
          search: { name: 'q', placeholder: 'Tìm tuyến cung ứng…' },
          pager: { from: 1, to: 1, total: 12 },
          selection,
        },
      },
    ),
  )

  assert.equal(html.match(/data-ui="list-page-title"/g)?.length, 1)
  assert.doesNotMatch(html, /data-ui="topbar"/)
  assert.match(
    html,
    /data-ui="list-page-title-row"[\s\S]*?data-ui="list-page-actions"[\s\S]*?href="\/admin\/stock\/routes\/new\?lang=vi"/,
  )
  assert.match(html, /data-ui="list-page-actions"[\s\S]*?data-ui="bulk-form"/)
  assert.match(
    html,
    /data-ui="list-page-controls"[\s\S]*?data-ui="chrome-search"[\s\S]*?data-ui="list-page-body"[\s\S]*?data-ui="list-page-footer"[\s\S]*?Tổng tuyến: 12/,
  )
  assert.match(html, /data-col="name"[\s\S]*?Nhận hàng hai bước/)
  assert.match(html, /data-col="sequence"[\s\S]*?>10</)
  assert.match(html, /data-col="ruleCount"[\s\S]*?>2</)
  assert.match(html, /href="\/admin\/stock\/routes\/route-two-step-receipt\?lang=vi"/)
  assert.match(html, /data-ui="row-select"[^>]*form="stock-route-bulk"/)
  assert.doesNotMatch(html, /stock-route-create-form/)
})

test('stock routes list: keeps the route empty state and create action on the list baseline', () => {
  const html = renderToString(
    stockRoutesListScreen(translate, {
      createHref: '/admin/stock/routes/new?lang=vi',
      rows: [],
    }),
  )

  assert.match(html, /data-ui="list-page"/)
  assert.match(html, /data-ui="empty"/)
  assert.match(html, /Chưa có tuyến cung ứng/)
  assert.match(html, /Tổng tuyến: 0/)
  assert.match(html, /href="\/admin\/stock\/routes\/new\?lang=vi"/)
})
