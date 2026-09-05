import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { pickingTypeCreateScreen } from '../packages/ketsuite/src/modules/stock_backend/screens/picking-type-create.tsx'
import { pickingTypesListScreen } from '../packages/ketsuite/src/modules/stock_backend/screens/picking-types-list.tsx'

const messages: Record<string, string> = {
  'backend.chrome.next': 'Trang sau',
  'backend.chrome.previous': 'Trang trước',
  'backend.table.columns': 'Cột',
  'stock_backend.action.cancel': 'Hủy',
  'stock_backend.action.create': 'Tạo',
  'stock_backend.backorder.always': 'Luôn tạo',
  'stock_backend.backorder.ask': 'Hỏi khi hoàn tất',
  'stock_backend.backorder.never': 'Không tạo',
  'stock_backend.field.backorder': 'Tạo backorder',
  'stock_backend.field.destinationLocation': 'Vị trí đích',
  'stock_backend.field.sourceLocation': 'Vị trí nguồn',
  'stock_backend.field.warehouse': 'Kho hàng',
  'stock_backend.pickingType.col.backorder': 'Backorder',
  'stock_backend.pickingType.col.code': 'Loại thao tác',
  'stock_backend.pickingType.col.name': 'Loại hoạt động',
  'stock_backend.pickingType.col.route': 'Vị trí mặc định',
  'stock_backend.pickingType.col.warehouse': 'Kho hàng',
  'stock_backend.pickingType.create.hint': 'Chọn kho, loại luồng, vị trí mặc định và chính sách backorder.',
  'stock_backend.pickingType.create.title': 'Tạo loại hoạt động',
  'stock_backend.pickingType.empty': 'Chưa có loại hoạt động',
  'stock_backend.pickingType.emptyHint': 'Tạo loại hoạt động đầu tiên để luân chuyển hàng.',
  'stock_backend.pickingType.field.backorder.help':
    'Cách xử lý số lượng còn lại khi hoàn tất một phần phiếu.',
  'stock_backend.pickingType.field.code': 'Loại thao tác',
  'stock_backend.pickingType.field.name': 'Tên loại hoạt động',
  'stock_backend.pickingType.field.name.placeholder': 'Ví dụ: Nhập kho cửa hàng',
  'stock_backend.pickingType.incoming': 'Nhập kho',
  'stock_backend.pickingType.internal': 'Dịch chuyển nội bộ',
  'stock_backend.pickingType.outgoing': 'Xuất kho',
  'stock_backend.pickingType.subtitle': 'Cấu hình luồng nhập, xuất và điều chuyển mặc định của từng kho.',
  'stock_backend.pickingType.summary.incoming': 'Luồng nhập',
  'stock_backend.pickingType.summary.internal': 'Luồng nội bộ',
  'stock_backend.pickingType.summary.outgoing': 'Luồng xuất',
  'stock_backend.pickingType.title': 'Loại hoạt động',
  'stock_backend.pickingTypes': 'Loại hoạt động',
}

const translate = ((key: string) => messages[key] ?? key) as Translator
translate.locale = 'vi'
translate.has = (key) => key in messages
translate.resolves = translate.has

test('stock operation types list: preserves columns, summaries, search and pager without inline create', () => {
  const html = renderToString(
    pickingTypesListScreen(
      translate,
      {
        createHref: '/vi/admin/stock/picking-types/new',
        rows: [
          {
            id: 'receipt',
            name: 'Nhập kho chính',
            code: 'incoming',
            warehouse: 'Kho Hà Nội',
            source: 'Nhà cung cấp',
            destination: 'Kho Hà Nội / Tồn kho',
            createBackorder: 'ask',
          },
          {
            id: 'delivery',
            name: 'Giao hàng',
            code: 'outgoing',
            warehouse: 'Kho Hà Nội',
            source: 'Kho Hà Nội / Tồn kho',
            destination: 'Khách hàng',
            createBackorder: 'always',
          },
          {
            id: 'internal',
            name: 'Dịch chuyển nội bộ',
            code: 'internal',
            warehouse: 'Kho Hà Nội',
            source: 'Kho Hà Nội / Tồn kho',
            destination: 'Kho Hà Nội / Đóng gói',
            createBackorder: 'never',
          },
        ],
      },
      {
        chrome: {
          search: { name: 'q', value: 'kho', placeholder: 'Tìm loại hoạt động…' },
          pager: {
            from: 1,
            to: 3,
            total: 18,
            next: '/vi/admin/stock/picking-types?page=2',
          },
        },
      },
    ),
  )

  assert.equal(html.match(/data-ui="list-page-title"/g)?.length, 1)
  assert.match(html, /href="\/vi\/admin\/stock\/picking-types\/new"/)
  assert.match(html, /data-ui="chrome-search"[\s\S]*?name="q"[\s\S]*?value="kho"/)
  assert.match(html, /data-ui="pager-range"[^>]*>[\s\S]*?1-3 \/ 18/)
  assert.match(html, /data-ui="pager-step" data-dir="next" href="\/vi\/admin\/stock\/picking-types\?page=2"/)
  assert.match(
    html,
    /data-ui="list-page-footer"[\s\S]*?Luồng nhập: 1[\s\S]*?Luồng xuất: 1[\s\S]*?Luồng nội bộ: 1/,
  )
  assert.match(html, /data-col="name"[\s\S]*?Nhập kho chính/)
  assert.match(html, /data-col="code"[\s\S]*?Nhập kho/)
  assert.match(html, /data-col="warehouse"[\s\S]*?Kho Hà Nội/)
  assert.match(html, /data-col="route"[\s\S]*?Nhà cung cấp → Kho Hà Nội \/ Tồn kho/)
  assert.doesNotMatch(html, /picking-type-create-form/)
})

test('stock operation types list: preserves the empty state and localized create action', () => {
  const html = renderToString(
    pickingTypesListScreen(translate, {
      createHref: '/vi/admin/stock/picking-types/new',
      rows: [],
    }),
  )

  assert.match(html, /data-ui="empty"/)
  assert.match(html, /Chưa có loại hoạt động/)
  assert.match(html, /Luồng nhập: 0[\s\S]*?Luồng xuất: 0[\s\S]*?Luồng nội bộ: 0/)
  assert.match(html, /href="\/vi\/admin\/stock\/picking-types\/new"/)
})

test('stock operation type create: keeps radio and select semantics with external actions', () => {
  const html = renderToString(
    pickingTypeCreateScreen(
      translate,
      {
        warehouses: [{ value: 'wh-hn', label: 'Kho Hà Nội' }],
        locations: [
          { value: 'supplier', label: 'Nhà cung cấp' },
          { value: 'stock', label: 'Kho Hà Nội / Tồn kho' },
        ],
        action: '/vi/admin/stock/picking-types/new',
        cancelHref: '/vi/admin/stock/picking-types',
        errors: ['Dữ liệu không hợp lệ'],
      },
      {},
    ),
  )

  assert.match(html, /data-ui="form-page" data-scope="picking-type-create" data-has-aside="false"/)
  assert.match(html, /data-ui="form-page-actions"[\s\S]*?type="submit"[^>]*form="picking-type-create-form"/)
  assert.match(html, /data-ui="form-page-actions"[\s\S]*?href="\/vi\/admin\/stock\/picking-types"/)
  assert.match(html, /id="picking-type-create-form"/)
  assert.match(html, /action="\/vi\/admin\/stock\/picking-types\/new"/)
  assert.match(html, /data-scope="picking-type-create"/)
  assert.match(html, /data-ui="form-errors"[\s\S]*?Dữ liệu không hợp lệ/)
  assert.match(html, /name="name"/)
  assert.match(html, /data-kind="radio"[\s\S]*?name="code"[^>]*value="incoming"/)
  assert.match(html, /name="code"[^>]*value="outgoing"/)
  assert.match(html, /name="code"[^>]*value="internal"[^>]*checked/)
  assert.match(html, /name="warehouseId"[\s\S]*?value="wh-hn"/)
  assert.match(html, /name="createBackorder"[\s\S]*?value="ask"[^>]*selected/)
  assert.match(html, /name="defaultLocationSrcId"[\s\S]*?value="supplier"/)
  assert.match(html, /name="defaultLocationDestId"[\s\S]*?value="stock"/)
  assert.doesNotMatch(html, /data-ui="record-workspace"|data-ui="form-page-aside"/)
})
