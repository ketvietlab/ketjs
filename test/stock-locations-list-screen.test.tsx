import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { locationsListScreen } from '../packages/ketsuite/src/modules/stock_backend/screens/locations-list.tsx'

const messages: Record<string, string> = {
  'stock_backend.action.create': 'Tạo mới',
  'stock_backend.location.col.location': 'Vị trí',
  'stock_backend.location.col.usage': 'Loại vị trí',
  'stock_backend.location.col.warehouse': 'Kho hàng',
  'stock_backend.location.configured.title': 'Cây vị trí',
  'stock_backend.location.empty': 'Chưa có vị trí kho',
  'stock_backend.location.emptyHint': 'Tạo vị trí đầu tiên để bắt đầu xây cây vị trí.',
  'stock_backend.location.subtitle': 'Phản ánh cấu trúc kho vật lý và vị trí ảo.',
  'stock_backend.location.title': 'Vị trí kho',
  'stock_backend.locations': 'Vị trí',
  'stock_backend.usage.internal': 'Nội bộ',
  'stock_backend.usage.view': 'Nhóm vị trí',
  'backend.chrome.more': 'Thêm thao tác',
  'backend.chrome.next': 'Trang sau',
  'backend.chrome.previous': 'Trang trước',
  'backend.table.columns': 'Cột',
  'backend.table.selectAll': 'Chọn tất cả dòng',
  'backend.table.selectRow': 'Chọn dòng',
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
  formId: 'stock-location-bulk',
  action: '/admin/stock/locations/bulk?lang=vi',
  actions: [{ id: 'archive', label: 'Lưu trữ đã chọn' }],
}

test('stock locations list: keeps hierarchy, columns, search and pager in ListPage', () => {
  const html = renderToString(
    locationsListScreen(
      translate,
      {
        createHref: '/admin/stock/locations/new?lang=vi',
        total: 24,
        table: { selection },
        rows: [
          {
            id: 'shelf-a-01',
            completeName: 'Kho trung tâm / Tồn kho / Kệ A-01',
            usage: 'internal',
            warehouse: 'Kho trung tâm',
          },
          {
            id: 'physical-view',
            completeName: 'Kho trung tâm / Vật lý',
            usage: 'view',
            warehouse: '',
          },
        ],
      },
      {
        chrome: {
          search: { name: 'q', placeholder: 'Tìm vị trí kho…' },
          pager: { from: 1, to: 2, total: 24 },
          selection,
        },
      },
    ),
  )

  assert.equal(html.match(/data-ui="list-page-title"/g)?.length, 1)
  assert.doesNotMatch(html, /data-ui="topbar"/)
  assert.match(html, /data-ui="list-page-actions"[\s\S]*?href="\/admin\/stock\/locations\/new\?lang=vi"/)
  assert.match(
    html,
    /data-ui="list-page-toolbar"[\s\S]*?Cây vị trí: 24[\s\S]*?data-ui="list-page-controls"[\s\S]*?data-ui="chrome-search"/,
  )
  assert.match(html, /Kho trung tâm \/ Tồn kho \/ Kệ A-01/)
  assert.match(html, /data-col="usage"[\s\S]*?Nội bộ/)
  assert.match(html, /data-col="warehouse"[\s\S]*?Kho trung tâm/)
  assert.match(html, /data-ui="row-select"[^>]*form="stock-location-bulk"/)
  assert.doesNotMatch(html, /location-create-form/)
})

test('stock locations list: keeps the empty state and create action on the list baseline', () => {
  const html = renderToString(
    locationsListScreen(translate, {
      createHref: '/admin/stock/locations/new?lang=vi',
      rows: [],
    }),
  )

  assert.match(html, /data-ui="list-page"/)
  assert.match(html, /data-ui="empty"/)
  assert.match(html, /Chưa có vị trí kho/)
  assert.match(html, /Cây vị trí: 0/)
  assert.match(html, /href="\/admin\/stock\/locations\/new\?lang=vi"/)
})
