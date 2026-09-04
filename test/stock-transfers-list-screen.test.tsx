import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { transfersListScreen } from '../packages/ketsuite/src/modules/stock_backend/screens/transfers-list.tsx'

const messages: Record<string, string> = {
  'stock_backend.transfers': 'Dịch chuyển',
  'stock_backend.transfer.list.title': 'Phiếu chuyển kho',
  'stock_backend.transfer.list.subtitle': 'Theo dõi nhập, xuất và dịch chuyển nội bộ tại một nơi.',
  'stock_backend.transfer.list.records.title': 'Phiếu chuyển kho',
  'stock_backend.transfer.list.col.reference': 'Tham chiếu',
  'stock_backend.transfer.list.col.source': 'Từ',
  'stock_backend.transfer.list.col.destination': 'Đến',
  'stock_backend.transfer.list.col.scheduledDate': 'Ngày dự kiến',
  'stock_backend.transfer.list.col.operationType': 'Loại hoạt động',
  'stock_backend.transfer.list.col.state': 'Trạng thái',
  'stock_backend.transfer.list.empty': 'Chưa có phiếu chuyển kho',
  'stock_backend.transfer.list.emptyHint': 'Tạo phiếu đầu tiên để bắt đầu xử lý hàng hóa.',
  'stock_backend.state.assigned': 'Sẵn sàng',
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
  formId: 'stock-transfer-bulk',
  action: '/admin/stock/transfers/bulk?lang=vi',
  actions: [{ id: 'cancel', label: 'Hủy đã chọn' }],
}

test('stock transfers list: keeps create, search and table navigation in the ListPage hierarchy', () => {
  const html = renderToString(
    transfersListScreen(
      translate,
      {
        createHref: '/admin/stock/transfers/new?lang=vi',
        total: 27,
        table: { selection },
        rows: [
          {
            id: 'pick-027',
            name: 'WH/INT/00027',
            operationType: 'Dịch chuyển nội bộ',
            source: 'KTT/Tồn kho',
            destination: 'KTT/Đóng gói',
            scheduledDate: '26/08/2026 09:30',
            state: 'assigned',
            href: '/admin/stock/transfers/pick-027?lang=vi',
          },
        ],
      },
      {
        chrome: {
          search: { name: 'q', placeholder: 'Tìm phiếu chuyển kho…' },
          pager: { from: 1, to: 1, total: 27 },
          selection,
        },
      },
    ),
  )

  assert.equal(html.match(/data-ui="list-page-title"/g)?.length, 1)
  assert.doesNotMatch(html, /data-ui="topbar"/)
  assert.match(
    html,
    /data-ui="list-page-title-row"[\s\S]*?data-ui="list-page-actions"[\s\S]*?href="\/admin\/stock\/transfers\/new\?lang=vi"/,
  )
  assert.match(html, /data-ui="list-page-actions"[\s\S]*?data-ui="bulk-form"/)
  assert.match(
    html,
    /data-ui="list-page-controls"[\s\S]*?data-ui="chrome-search"[\s\S]*?data-ui="list-page-body"[\s\S]*?data-ui="list-page-footer"[\s\S]*?Phiếu chuyển kho: 27/,
  )
  assert.match(html, /data-col="name"[\s\S]*?WH\/INT\/00027/)
  assert.match(html, /href="\/admin\/stock\/transfers\/pick-027\?lang=vi"/)
  assert.match(html, /data-ui="row-select"[^>]*form="stock-transfer-bulk"/)
  assert.doesNotMatch(html, /transfer-create-form/)
})

test('stock transfers list: keeps the empty state and create action on the list baseline', () => {
  const html = renderToString(
    transfersListScreen(translate, {
      createHref: '/admin/stock/transfers/new?lang=vi',
      rows: [],
    }),
  )

  assert.match(html, /data-ui="list-page"/)
  assert.match(html, /data-ui="empty"/)
  assert.match(html, /Chưa có phiếu chuyển kho/)
  assert.match(html, /Phiếu chuyển kho: 0/)
  assert.match(html, /href="\/admin\/stock\/transfers\/new\?lang=vi"/)
})
