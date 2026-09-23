import assert from 'node:assert/strict'
import { test } from 'node:test'
import { html, renderToString } from '@ketvietlab/ketjs-view'
import type { Translator } from '@ketvietlab/ketjs'
import {
  productsScreen,
  templateColumns,
} from '../packages/ketsuite/src/modules/product_backend/screens/list.tsx'
import { ketTable } from '../packages/ketsuite/src/ui/client/ket-table-view.tsx'
import { ketTableDemoConfig } from '../packages/design-system/src/interactions/ket-table/demo.ts'

const messages: Record<string, string> = {
  'product_backend.menu.app': 'Sản phẩm',
  'product_backend.screen.title': 'Danh mục sản phẩm',
  'product_backend.screen.description': 'Quản lý hàng hoá và dịch vụ trong một danh mục thống nhất.',
  'product_backend.screen.results': '{count} sản phẩm',
  'product_backend.screen.empty.message': 'Chưa có sản phẩm nào.',
  'product_backend.screen.empty.hint': 'Tạo mẫu sản phẩm đầu tiên để bắt đầu.',
  'product_backend.col.name': 'Tên',
  'product_backend.col.type': 'Loại',
  'product_backend.col.category': 'Nhóm',
  'product_backend.col.uom': 'Đơn vị',
  'product_backend.col.variants': 'Biến thể',
  'product_backend.field.isStorable': 'Theo dõi tồn kho',
  'product_backend.field.listPrice': 'Giá bán',
  'product_backend.type.goods': 'Hàng hoá',
  'product_backend.type.service': 'Dịch vụ',
  'product_backend.value.yes': 'Có',
  'product_backend.value.no': 'Không',
  'backend.table.id': 'ID',
  'backend.table.columns': 'Cột',
  'backend.table.selectAll': 'Chọn tất cả',
  'backend.table.selectRow': 'Chọn dòng',
  'backend.chrome.removeFilter': 'Bỏ bộ lọc',
  'backend.chrome.more': 'Thêm',
  'backend.chrome.previous': 'Trang trước',
  'backend.chrome.next': 'Trang sau',
  'backend.chrome.views': 'Kiểu hiển thị',
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

const recordHref = (id: string) => `/admin/product/templates?record=product.template:${id}&lang=vi`

const rows = [
  {
    id: 'ao-khoac-gio',
    name: 'Áo khoác gió vận hành',
    type: 'goods',
    categoryId: 'dong-phuc',
    categoryName: 'Đồng phục',
    uomId: 'cai',
    uomName: 'Cái',
    listPrice: 485000,
    isStorable: true,
    variants: 4,
    image: { src: '/files/ao-khoac', alt: 'Áo khoác gió vận hành' },
  },
]

const grid = (items = rows) =>
  ketTable({
    id: 'product-table',
    config: {
      ...ketTableDemoConfig,
      columns: templateColumns(translate),
      rows: items,
      total: items.length,
      pager: false,
      rowHrefTemplate: recordHref('{id}'),
      labels: {
        ...ketTableDemoConfig.labels,
        empty: translate('product_backend.screen.empty.message'),
        emptyHint: translate('product_backend.screen.empty.hint'),
      },
    },
  }).view()

test('product list: follows the design-system list hierarchy without a duplicate topbar', () => {
  const html = renderToString(
    productsScreen(
      translate,
      rows,
      'list',
      recordHref,
      {
        viewer: {
          name: 'Nguyễn Quản Trị',
          company: 'ket-viet',
          companies: ['ket-viet'],
          companyName: 'Công ty Kết Việt',
          branch: 'hcm',
          branchName: 'Chi nhánh Hồ Chí Minh',
          contextPath: '/admin/context?lang=vi',
        },
        chrome: {
          layout: 'catalogue',
          section: 'Sản phẩm',
          create: { label: 'Tạo mới', path: '/admin/product/templates/new?lang=vi' },
          selection: {
            formId: 'product-template-bulk',
            action: '/admin/product/templates/bulk',
            actions: [{ id: 'archive', label: 'Lưu trữ' }],
          },
          search: { name: 'q', placeholder: 'Tìm sản phẩm…' },
          searchContent: <div data-ui="search-filter-test-marker">Bộ lọc mới</div>,
          pager: { from: 1, to: 1, total: 24 },
          views: [
            { id: 'list', label: 'Danh sách', icon: 'list', path: '?view=list', active: true },
            { id: 'kanban', label: 'Thẻ', icon: 'layout-grid', path: '?view=kanban', active: false },
          ],
        },
      },
      grid(),
      24,
      undefined,
    ),
  )

  assert.equal(html.match(/data-ui="list-page-title"/g)?.length, 1)
  assert.equal(html.match(/data-ui="topbar"/g), null)
  assert.match(html, /data-ui="list-page" data-variant="operational"/)
  assert.match(
    html,
    /data-ui="list-page-context"[\s\S]*?Sản phẩm[\s\S]*?Danh mục sản phẩm[\s\S]*?data-ui="page-context-viewer" href="\/admin\/context\?lang=vi"/,
  )
  assert.match(html, /Công ty Kết Việt[\s\S]*?Chi nhánh Hồ Chí Minh/)
  assert.match(html, /data-ui="list-page-description"/)
  assert.match(
    html,
    /data-ui="list-page-title-row"[\s\S]*?data-ui="list-page-actions"[\s\S]*?data-variant="primary"/,
  )
  const headerStart = html.indexOf('data-ui="list-page-header"')
  const header = html.slice(headerStart, html.indexOf('</header>', headerStart))
  assert.match(header, /href="\/admin\/product\/templates\/new\?lang=vi"/)
  assert.match(
    header,
    /data-ui="list-page-tools"[^>]* hidden[\s\S]*?data-ui="bulk-form" id="product-template-bulk" method="post" action="\/admin\/product\/templates\/bulk"/,
  )
  assert.doesNotMatch(
    html.slice(html.indexOf('</header>', headerStart)),
    /data-ui="list-page-actions"|data-ui="list-page-tools"/,
  )
  assert.equal(html.match(/href="\/admin\/product\/templates\/new\?lang=vi"/g)?.length, 1)
  assert.match(html, /href="\/admin\/product\/templates\/new\?lang=vi"/)
  assert.match(
    html,
    /data-ui="list-page-toolbar"[\s\S]*?data-ui="list-page-controls"[\s\S]*?search-filter-test-marker/,
  )
  assert.match(
    html,
    /data-ui="chrome-search-content"[\s\S]*?search-filter-test-marker[\s\S]*?data-ui="chrome-tail"/,
  )
  assert.doesNotMatch(html, /data-ui="chrome-search"/)
  assert.match(html, /data-ui="ket-table"/)
  assert.doesNotMatch(html, /data-ui="table"/)
  assert.match(html, /data-ui="list-chrome"[\s\S]*?data-ui="pager"[\s\S]*?data-ui="view-switch"/)
  assert.doesNotMatch(html, /data-ui="list-page-status"/)
  assert.match(html, /data-ui="list-page-body"[\s\S]*?data-ui="list-page-footer"[^>]*>[\s\S]*?24 sản phẩm/)
  const controls = html.slice(
    html.indexOf('data-ui="list-page-controls"'),
    html.indexOf('data-ui="list-page-body"'),
  )
  assert.doesNotMatch(controls, /data-ui="bulk-form"/)
  assert.match(html, /data-col="name"[\s\S]*?data-ui="thumbnail"[\s\S]*?Áo khoác gió vận hành/)
  assert.match(html, /data-col="listPrice"[^>]*data-priority="primary"/)
  assert.match(html, /href="\/admin\/product\/templates\?record=product\.template:ao-khoac-gio&amp;lang=vi"/)
})

test('product list: keeps empty and kanban states inside the same page baseline', () => {
  const empty = renderToString(productsScreen(translate, [], 'list', recordHref, {}, grid([]), 0))
  assert.match(empty, /data-ui="list-page"/)
  assert.match(empty, /data-ui="empty"/)
  assert.match(empty, /Chưa có sản phẩm nào/)
  assert.match(empty, /0 sản phẩm/)

  const kanban = renderToString(productsScreen(translate, rows, 'kanban', recordHref, {}, null, 1))
  assert.match(kanban, /data-ui="kanban"/)
  assert.match(kanban, /data-ui="list-page-body"/)
  assert.match(
    kanban,
    /href="\/admin\/product\/templates\?record=product\.template:ao-khoac-gio&amp;lang=vi"/,
  )
})

test('product list: renders contributed catalogue actions beside native actions', () => {
  const htmlOutput = renderToString(
    productsScreen(
      translate,
      rows,
      'list',
      recordHref,
      {},
      grid(),
      1,
      html`<a data-ui="action" href="/admin/channels/products">Kênh bán</a>`,
    ),
  )

  const headerStart = htmlOutput.indexOf('data-ui="list-page-header"')
  const headerEnd = htmlOutput.indexOf('</header>', headerStart)
  assert.match(htmlOutput.slice(headerStart, headerEnd), /data-ui="list-page-tools"[\s\S]*?Kênh bán/)
  assert.doesNotMatch(htmlOutput.slice(headerEnd), /data-ui="list-page-actions"|data-ui="list-page-tools"/)
  assert.match(htmlOutput, /href="\/admin\/channels\/products"/)
})
