import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { quotationsListScreen } from '../packages/ketsuite/src/modules/sale_backend/screens/quotations-list.tsx'

const messages: Record<string, string> = {
  'sale_backend.action.create': 'Tạo mới',
  'sale_backend.field.amountTotal': 'Tổng tiền',
  'sale_backend.field.customer': 'Khách hàng',
  'sale_backend.field.dateOrder': 'Ngày báo giá',
  'sale_backend.field.name': 'Báo giá',
  'sale_backend.field.state': 'Trạng thái',
  'sale_backend.field.validityDate': 'Hiệu lực đến',
  'sale_backend.quotation.empty': 'Chưa có báo giá',
  'sale_backend.quotation.emptyHint': 'Tạo báo giá đầu tiên để bắt đầu quy trình bán hàng.',
  'sale_backend.quotation.subtitle': 'Soạn, gửi và theo dõi báo giá trước khi xác nhận.',
  'sale_backend.quotation.summary.cancelled': 'Đã huỷ',
  'sale_backend.quotation.summary.draft': 'Bản nháp',
  'sale_backend.quotation.summary.sent': 'Đã gửi',
  'sale_backend.quotation.summary.total': 'Tổng báo giá',
  'sale_backend.quotation.title': 'Báo giá',
  'sale_backend.quotations.title': 'Báo giá',
  'sale_backend.state.cancel': 'Đã huỷ',
  'sale_backend.state.draft': 'Bản nháp',
  'sale_backend.state.sent': 'Đã gửi',
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
  formId: 'sale-quotation-bulk',
  action: '/admin/sales/quotations/bulk?state=draft&lang=vi',
  actions: [{ id: 'cancel', label: 'Huỷ báo giá đã chọn' }],
}

test('sales quotations list: preserves state, columns, reports and ListPage controls', () => {
  const html = renderToString(
    quotationsListScreen(
      translate,
      {
        createHref: '/admin/sales/quotations/new?state=draft&lang=vi',
        detailSuffix: '?lang=vi',
        printReport: { id: 'sale.quotation', title: 'Báo giá' },
        total: 18,
        table: { selection },
        rows: [
          {
            id: 'so-001',
            name: 'S00001',
            partnerName: 'Khách hàng Minh Anh',
            partnerId: 'customer',
            dateOrder: '2026-08-27T08:00:00.000Z',
            validityDate: '2026-09-30T00:00:00.000Z',
            state: 'draft',
            amountTotal: 1250000,
            currency: 'VND',
          },
          {
            id: 'so-002',
            name: 'S00002',
            partnerName: 'Công ty An Nhiên',
            dateOrder: '2026-08-26T08:00:00.000Z',
            validityDate: null,
            state: 'sent',
            amountTotal: 900000,
            currency: 'VND',
          },
          {
            id: 'so-003',
            name: 'S00003',
            partnerId: 'customer-3',
            dateOrder: '2026-08-25T08:00:00.000Z',
            validityDate: null,
            state: 'cancel',
            amountTotal: 0,
            currency: 'VND',
          },
        ],
      },
      {
        chrome: {
          search: { name: 'q', placeholder: 'Tìm báo giá…' },
          pager: { from: 1, to: 3, total: 18 },
          selection,
        },
      },
    ),
  )

  assert.equal(html.match(/data-ui="list-page-title"/g)?.length, 1)
  assert.doesNotMatch(html, /data-ui="topbar"/)
  assert.match(html, /href="\/admin\/sales\/quotations\/new\?state=draft&amp;lang=vi"/)
  assert.match(
    html,
    /data-ui="list-page-controls"[\s\S]*?data-ui="chrome-search"[\s\S]*?data-ui="list-page-body"[\s\S]*?data-ui="list-page-footer"[\s\S]*?Tổng báo giá: 18 · Bản nháp: 1 · Đã gửi: 1 · Đã huỷ: 1/,
  )
  assert.match(html, /data-col="name"[\s\S]*?S00001/)
  assert.match(html, /data-col="customer"[\s\S]*?Khách hàng Minh Anh/)
  assert.match(html, /data-col="date"[\s\S]*?2026-08-27/)
  assert.match(html, /data-col="validity"[\s\S]*?2026-09-30/)
  assert.match(html, /data-col="state"[\s\S]*?Bản nháp/)
  assert.match(html, /data-col="total"/)
  assert.match(html, /href="\/admin\/sales\/quotations\/so-001\?lang=vi"/)
  assert.match(html, /href="\/reports\/sale\.quotation\/so-001\?lang=vi"/)
  assert.match(html, /data-ui="row-select"[^>]*form="sale-quotation-bulk"/)
  assert.doesNotMatch(html, /quotation-create-form|data-island="mail\.chatter"/)
})

test('sales quotations list: keeps the quotation empty state and localized create action', () => {
  const html = renderToString(
    quotationsListScreen(translate, {
      createHref: '/admin/sales/quotations/new?lang=vi',
      detailSuffix: '?lang=vi',
      rows: [],
    }),
  )

  assert.match(html, /data-ui="list-page"/)
  assert.match(html, /data-ui="empty"[\s\S]*?Chưa có báo giá/)
  assert.match(html, /Tổng báo giá: 0 · Bản nháp: 0 · Đã gửi: 0 · Đã huỷ: 0/)
  assert.match(html, /href="\/admin\/sales\/quotations\/new\?lang=vi"/)
})
