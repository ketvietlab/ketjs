import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { overviewScreen } from '../packages/ketsuite/src/modules/sale_backend/screens/overview.tsx'

const messages: Record<string, string> = {
  'sale_backend.action.create': 'Tạo báo giá',
  'sale_backend.dashboard.awaiting': 'Báo giá đang chờ phản hồi',
  'sale_backend.dashboard.queueEmpty': 'Không có báo giá đang chờ phản hồi.',
  'sale_backend.dashboard.draft': 'Báo giá',
  'sale_backend.dashboard.draftToday': '{count} mới hôm nay',
  'sale_backend.dashboard.flow.hint': 'Tiến độ từ báo giá đến lập hoá đơn',
  'sale_backend.dashboard.flow.title': 'Dòng bán hàng',
  'sale_backend.dashboard.recent.all': 'Xem tất cả',
  'sale_backend.dashboard.recent.hint': 'Các đơn bán được cập nhật mới nhất',
  'sale_backend.dashboard.recent.title': 'Đơn gần đây',
  'sale_backend.dashboard.saleValue': '{amount} tổng giá trị',
  'sale_backend.dashboard.sent': 'Báo giá đã gửi',
  'sale_backend.dashboard.sentValue': '{amount} chờ phản hồi',
  'sale_backend.dashboard.subtitle': 'Theo dõi báo giá, đơn bán và công việc cần xử lý.',
  'sale_backend.dashboard.title': 'Tổng quan bán hàng',
  'sale_backend.dashboard.toInvoice': 'Chờ lập hoá đơn',
  'sale_backend.dashboard.toInvoiceValue': '{amount} cần xử lý',
  'sale_backend.field.amountTotal': 'Tổng tiền',
  'sale_backend.field.customer': 'Khách hàng',
  'sale_backend.field.dateOrder': 'Ngày đặt hàng',
  'sale_backend.field.invoiceStatus': 'Trạng thái hoá đơn',
  'sale_backend.field.locked': 'Khoá',
  'sale_backend.field.name': 'Đơn bán',
  'sale_backend.invoiceStatus.to invoice': 'Chờ lập hoá đơn',
  'sale_backend.menu.orders': 'Đơn bán hàng',
  'sale_backend.order.locked': 'Đã khoá',
  'sale_backend.order.unlocked': 'Chưa khoá',
  'sale_backend.orderList.empty': 'Chưa có đơn bán hàng',
  'sale_backend.orderList.emptyHint': 'Xác nhận báo giá để tạo đơn bán đầu tiên.',
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

test('sales overview: remains a specialized KPI, pipeline and recent-work dashboard', () => {
  const html = renderToString(
    overviewScreen(translate, {
      frame: {},
      localeQuery: '?lang=vi',
      createHref: '/admin/sales/quotations?lang=vi&record=sale.order%3Anew',
      rowHref: (row) => `/admin/sales?lang=vi&record=sale.order%3A${String(row.id)}`,
      awaiting: [
        {
          id: 'so-awaiting',
          name: 'S00031',
          partnerName: 'Công ty Hoà Bình',
          dateOrder: '2026-08-28T02:00:00.000Z',
          invoiceStatus: 'no',
          locked: false,
          amountTotal: 4800000,
          currency: 'VND',
        },
      ],
      counts: {
        draft: 7,
        sent: 4,
        sale: 12,
        toInvoice: 3,
        draftToday: 2,
        sentTotal: 15000000,
        saleTotal: 82000000,
        toInvoiceTotal: 12500000,
        currency: 'VND',
      },
      recent: [
        {
          id: 'so-recent',
          name: 'S00027',
          partnerName: 'Khách hàng Minh Anh',
          dateOrder: '2026-08-27T08:30:00.000Z',
          invoiceStatus: 'to invoice',
          locked: false,
          amountTotal: 12500000,
          currency: 'VND',
        },
      ],
    }),
  )

  assert.match(html, /data-ui="dashboard-page"[^>]*data-variant="operational"/)
  assert.doesNotMatch(html, /data-ui="dashboard-page-context"|data-ui="breadcrumbs"/)
  assert.doesNotMatch(html, /data-ui="list-page"|data-ui="form-page"|data-ui="record-workspace"/)
  assert.match(html, /Tổng quan bán hàng/)
  // The primary action opens the quotation create modal over the quotation list.
  assert.match(html, /href="\/admin\/sales\/quotations\?lang=vi&amp;record=sale\.order%3Anew"/)
  assert.match(html, /href="\/admin\/sales\/quotations\?lang=vi&amp;preset=draft"/)
  assert.match(html, /href="\/admin\/sales\/quotations\?lang=vi&amp;preset=sent"/)
  assert.match(html, /data-ui="metric-value"[^>]*>[\s\S]*?7/)
  assert.match(html, /data-ui="metric-value"[^>]*>[\s\S]*?4/)
  assert.match(html, /data-ui="metric-value"[^>]*>[\s\S]*?12/)
  assert.match(html, /data-ui="metric-value"[^>]*>[\s\S]*?3/)
  assert.match(html, /2 mới hôm nay/)
  // Sent quotations are the queue to work, ahead of the recent orders.
  assert.match(html, /Báo giá đang chờ phản hồi[\s\S]*?S00031[\s\S]*?Công ty Hoà Bình[\s\S]*?Đơn gần đây/)
  assert.match(html, /Đơn gần đây[\s\S]*?S00027[\s\S]*?Khách hàng Minh Anh/)
  // A row opens its order in the record modal.
  assert.match(html, /href="\/admin\/sales\?lang=vi&amp;record=sale\.order%3Aso-awaiting"/)
  assert.match(html, /href="\/admin\/sales\?lang=vi&amp;record=sale\.order%3Aso-recent"/)
  assert.match(html, /href="\/admin\/sales\/orders\?lang=vi"/)
  assert.doesNotMatch(html, /data-island="mail\.chatter"|data-ui="form-page-aside"/)
})

test('sales overview: preserves KPI shortcuts and the empty recent-orders state', () => {
  const html = renderToString(
    overviewScreen(translate, {
      frame: {},
      localeQuery: '?lang=vi',
      counts: {
        draft: 0,
        sent: 0,
        sale: 0,
        toInvoice: 0,
        draftToday: 0,
        sentTotal: 0,
        saleTotal: 0,
        toInvoiceTotal: 0,
        currency: 'VND',
      },
      recent: [],
    }),
  )

  assert.equal(html.match(/data-ui="metric"/g)?.length, 4)
  assert.match(html, /Không có báo giá đang chờ phản hồi\./)
  assert.match(html, /data-ui="empty"[\s\S]*?Chưa có đơn bán hàng/)
  assert.match(html, /Xác nhận báo giá để tạo đơn bán đầu tiên/)
  // Without sale.createOrder the route passes no createHref, so there is no create action.
  assert.doesNotMatch(html, /record=sale\.order|quotations\/new|Tạo báo giá/)
  assert.match(html, /href="\/admin\/sales\/orders\?lang=vi"/)
  assert.doesNotMatch(html, /data-island="mail\.chatter"/)
})
