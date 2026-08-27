import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { salesOrdersListScreen } from '../packages/ketsuite/src/modules/sale_backend/screens/sales-orders-list.tsx'

const messages: Record<string, string> = {
  'sale_backend.field.amountTotal': 'Tổng tiền',
  'sale_backend.field.customer': 'Khách hàng',
  'sale_backend.field.dateOrder': 'Ngày đặt hàng',
  'sale_backend.field.invoiceStatus': 'Trạng thái hoá đơn',
  'sale_backend.field.locked': 'Khoá',
  'sale_backend.field.name': 'Đơn bán',
  'sale_backend.invoiceStatus.invoiced': 'Đã lập hoá đơn',
  'sale_backend.invoiceStatus.no': 'Chưa cần lập',
  'sale_backend.invoiceStatus.to invoice': 'Chờ lập hoá đơn',
  'sale_backend.order.locked': 'Đã khoá',
  'sale_backend.order.unlocked': 'Chưa khoá',
  'sale_backend.orderList.empty': 'Chưa có đơn bán hàng',
  'sale_backend.orderList.emptyHint': 'Xác nhận báo giá để tạo đơn bán đầu tiên.',
  'sale_backend.orderList.subtitle': 'Theo dõi giao hàng, hoá đơn và trạng thái khoá.',
  'sale_backend.orderList.summary.invoiced': 'Đã lập hoá đơn',
  'sale_backend.orderList.summary.locked': 'Đã khoá',
  'sale_backend.orderList.summary.toInvoice': 'Chờ lập hoá đơn',
  'sale_backend.orderList.summary.total': 'Tổng đơn',
  'sale_backend.orderList.title': 'Đơn bán hàng',
  'sale_backend.orders.title': 'Đơn bán hàng',
  'backend.chrome.more': 'Thêm thao tác',
  'backend.chrome.next': 'Trang sau',
  'backend.chrome.previous': 'Trang trước',
  'backend.print.label': 'In',
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
  formId: 'sale-order-bulk',
  action: '/admin/sales/orders/bulk?lang=vi',
  actions: [{ id: 'lock', label: 'Khoá đơn đã chọn' }],
}

test('sales orders list: keeps status filters, navigation, print and ListPage controls', () => {
  const html = renderToString(
    salesOrdersListScreen(
      translate,
      {
        detailSuffix: '?lang=vi',
        printReport: { id: 'sale.salesOrder', title: 'Đơn bán hàng' },
        total: 22,
        table: { selection },
        rows: [
          {
            id: 'so-001',
            name: 'S00001',
            partnerName: 'Khách hàng Minh Anh',
            dateOrder: '2026-08-27T08:00:00.000Z',
            invoiceStatus: 'to invoice',
            locked: true,
            amountTotal: 1250000,
            currency: 'VND',
          },
          {
            id: 'so-002',
            name: 'S00002',
            partnerName: 'Công ty An Nhiên',
            dateOrder: '2026-08-26T08:00:00.000Z',
            invoiceStatus: 'invoiced',
            locked: true,
            amountTotal: 900000,
            currency: 'VND',
          },
          {
            id: 'so-003',
            name: 'S00003',
            partnerId: 'customer-3',
            dateOrder: '2026-08-25T08:00:00.000Z',
            invoiceStatus: 'no',
            locked: false,
            amountTotal: 0,
            currency: 'VND',
          },
        ],
      },
      {
        chrome: {
          search: { name: 'q', placeholder: 'Tìm đơn bán…' },
          pager: { from: 1, to: 3, total: 22 },
          selection,
        },
      },
    ),
  )

  assert.equal(html.match(/data-ui="list-page-title"/g)?.length, 1)
  assert.doesNotMatch(html, /data-ui="topbar"/)
  assert.match(
    html,
    /Tổng đơn: 22 · Chờ lập hoá đơn: 1 · Đã lập hoá đơn: 1 · Đã khoá: 2[\s\S]*?data-ui="list-page-controls"[\s\S]*?data-ui="chrome-search"/,
  )
  assert.match(html, /data-ui="list-page-actions"[\s\S]*?data-ui="bulk-form"/)
  assert.match(html, /data-col="name"[\s\S]*?S00001/)
  assert.match(html, /data-col="customer"[\s\S]*?Khách hàng Minh Anh/)
  assert.match(html, /data-col="date"[\s\S]*?2026-08-27/)
  assert.match(html, /data-col="invoice"[\s\S]*?Chờ lập hoá đơn/)
  assert.match(html, /data-col="locked"[\s\S]*?Đã khoá/)
  assert.match(html, /data-col="total"/)
  assert.match(html, /href="\/admin\/sales\/orders\/so-001\?lang=vi"/)
  assert.match(html, /href="\/reports\/sale\.salesOrder\/so-001\?lang=vi"/)
  assert.match(html, /data-ui="row-select"[^>]*form="sale-order-bulk"/)
  assert.doesNotMatch(html, /sale_backend\.action\.create|quotation-create-form/)
  assert.doesNotMatch(html, /data-island="mail\.chatter"|data-ui="form-page-aside"/)
})

test('sales orders list: keeps the confirmed-order empty state without a create form', () => {
  const html = renderToString(
    salesOrdersListScreen(translate, {
      detailSuffix: '?lang=vi',
      rows: [],
    }),
  )

  assert.match(html, /data-ui="list-page"/)
  assert.match(html, /data-ui="empty"[\s\S]*?Chưa có đơn bán hàng/)
  assert.match(html, /Xác nhận báo giá để tạo đơn bán đầu tiên/)
  assert.match(html, /Tổng đơn: 0 · Chờ lập hoá đơn: 0 · Đã lập hoá đơn: 0 · Đã khoá: 0/)
  assert.doesNotMatch(html, /data-ui="list-page-actions"|record-form|quotation-create-form/)
})
