import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { lotsListScreen } from '../packages/ketsuite/src/modules/stock_backend/screens/lots-list.tsx'

const messages: Record<string, string> = {
  'stock_backend.lots': 'Lô / Sê-ri',
  'stock_backend.lot.list.title': 'Lô và số sê-ri',
  'stock_backend.lot.list.subtitle': 'Theo dõi định danh, sản phẩm và tồn thực tế của từng lô hoặc số sê-ri.',
  'stock_backend.lot.list.summary.total': 'Tổng số',
  'stock_backend.lot.list.col.name': 'Lô / Sê-ri',
  'stock_backend.lot.list.col.product': 'Sản phẩm',
  'stock_backend.lot.list.col.reference': 'Tham chiếu nội bộ',
  'stock_backend.lot.list.col.onHand': 'Tồn thực tế',
  'stock_backend.lot.list.col.status': 'Trạng thái',
  'stock_backend.lot.list.empty': 'Chưa có lô hoặc số sê-ri',
  'stock_backend.lot.list.emptyHint': 'Tạo định danh đầu tiên để bắt đầu truy xuất hàng hóa.',
  'stock_backend.lot.status.active': 'Đang hoạt động',
  'stock_backend.lot.status.archived': 'Đã lưu trữ',
  'stock_backend.action.create': 'Tạo mới',
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

test('stock lots list: follows ListPage hierarchy and sends creation to the localized new form', () => {
  const html = renderToString(
    lotsListScreen(
      translate,
      {
        createHref: '/admin/stock/lots/new?lang=vi',
        total: 18,
        rows: [
          {
            id: 'lot-denim-2026',
            name: 'DENIM-2026-08',
            product: 'Vải denim xanh',
            reference: 'LOT-0082',
            onHand: '1.250',
            onHandValue: 1250,
            active: true,
            href: '/admin/stock/lots/lot-denim-2026?lang=vi',
          },
        ],
      },
      {
        extras: { 'topbar.end': '<span data-evidence="joint">joint</span>' },
      },
    ),
  )

  assert.equal(html.match(/data-ui="list-page-title"/g)?.length, 1)
  assert.doesNotMatch(html, /data-ui="topbar"/)
  assert.match(
    html,
    /data-ui="list-page-title-row"[\s\S]*?data-ui="list-page-actions"[\s\S]*?href="\/admin\/stock\/lots\/new\?lang=vi"/,
  )
  assert.match(html, /data-variant="primary"/)
  assert.match(html, /data-ui="list-page-toolbar"[\s\S]*?data-ui="list-page-status"[\s\S]*?Tổng số: 18/)
  assert.match(html, /data-col="name"[\s\S]*?DENIM-2026-08/)
  assert.match(html, /href="\/admin\/stock\/lots\/lot-denim-2026\?lang=vi"/)
  assert.doesNotMatch(html, /lot-create-form/)
})

test('stock lots list: keeps the empty state within the same list baseline', () => {
  const html = renderToString(
    lotsListScreen(translate, {
      createHref: '/admin/stock/lots/new?lang=vi',
      rows: [],
    }),
  )

  assert.match(html, /data-ui="list-page"/)
  assert.match(html, /data-ui="empty"/)
  assert.match(html, /Chưa có lô hoặc số sê-ri/)
  assert.match(html, /Tổng số: 0/)
  assert.match(html, /href="\/admin\/stock\/lots\/new\?lang=vi"/)
})
