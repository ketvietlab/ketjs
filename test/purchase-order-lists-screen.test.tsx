import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { purchaseOrdersListScreen } from '../packages/ketsuite/src/modules/purchase_backend/screens/purchase-orders-list.tsx'
import { rfqCreateScreen } from '../packages/ketsuite/src/modules/purchase_backend/screens/rfq-create.tsx'
import { rfqsListScreen } from '../packages/ketsuite/src/modules/purchase_backend/screens/rfqs-list.tsx'

const messages: Record<string, string> = {
  'backend.chrome.next': 'Trang sau',
  'backend.chrome.previous': 'Trang trước',
  'purchase_backend.action.cancel': 'Huỷ',
  'purchase_backend.action.createRfq': 'Tạo yêu cầu báo giá',
  'purchase_backend.dashboard.records': 'Bản ghi',
  'purchase_backend.dashboard.toApprove': 'Chờ duyệt',
  'purchase_backend.dashboard.toBill': 'Chờ lập hoá đơn',
  'purchase_backend.dashboard.toSend': 'Cần gửi',
  'purchase_backend.dashboard.waiting': 'Đang chờ',
  'purchase_backend.empty': 'Chưa có dữ liệu.',
  'purchase_backend.emptyHint': 'Tạo bản ghi đầu tiên để bắt đầu.',
  'purchase_backend.feedback.rejected': 'Chưa lưu được',
  'purchase_backend.feedback.rejectedField': 'Trường "{field}" chưa hợp lệ.',
  'purchase_backend.field.amountTotal': 'Tổng tiền',
  'purchase_backend.field.dateOrder': 'Ngày đặt hàng',
  'purchase_backend.field.invoiceStatus': 'Trạng thái lập hoá đơn',
  'purchase_backend.field.name': 'Số đơn',
  'purchase_backend.field.partnerRef': 'Tham chiếu nhà cung cấp',
  'purchase_backend.field.pickingType': 'Nhập vào',
  'purchase_backend.field.state': 'Trạng thái',
  'purchase_backend.field.vendor': 'Nhà cung cấp',
  'purchase_backend.invoiceStatus.no': 'Chưa cần lập hoá đơn',
  'purchase_backend.invoiceStatus.to invoice': 'Chờ lập hoá đơn',
  'purchase_backend.orders.empty': 'Chưa có đơn mua nào.',
  'purchase_backend.orders.emptyHint': 'Đơn mua sinh ra khi RFQ được xác nhận.',
  'purchase_backend.orders.openRequests': 'Mở yêu cầu báo giá',
  'purchase_backend.orders.title': 'Đơn mua hàng',
  'purchase_backend.rfqs.title': 'Yêu cầu báo giá',
  'purchase_backend.setup.hint': 'Chưa có: {missing}.',
  'purchase_backend.setup.openInventory': 'Mở cấu hình kho',
  'purchase_backend.setup.openPartners': 'Mở danh bạ đối tác',
  'purchase_backend.setup.pickingTypes': 'loại phiếu nhập kho',
  'purchase_backend.setup.title': 'Cần cấu hình trước',
  'purchase_backend.setup.vendors': 'nhà cung cấp',
  'purchase_backend.state.draft': 'RFQ',
  'purchase_backend.state.purchase': 'Đơn mua hàng',
  'purchase_backend.state.sent': 'RFQ đã gửi',
  'purchase_backend.state.to approve': 'Chờ duyệt',
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

test('purchase RFQ list keeps command search, filters, groups, pager and localized row navigation', () => {
  const rows = [
    {
      id: 'rfq-1',
      name: 'RFQ00001',
      partnerId: 'vendor-1',
      partnerName: 'NCC An Phú',
      dateOrder: '2026-08-20',
      state: 'draft',
      invoiceStatus: 'no',
      amountTotal: '1500000',
      currency: 'VND',
    },
  ]
  const html = renderToString(
    rfqsListScreen(translate, {
      frame: {
        chrome: {
          search: {
            name: 'q',
            value: 'RFQ00001',
            placeholder: 'Yêu cầu báo giá',
            facets: [{ label: 'RFQ', without: '/admin/purchase/rfqs?lang=vi' }],
            menus: [
              {
                id: 'filters',
                label: 'Bộ lọc',
                items: [
                  { id: 'draft', label: 'RFQ', path: '/admin/purchase/rfqs?state=draft', active: true },
                ],
              },
            ],
          },
          pager: {
            from: 31,
            to: 31,
            total: 61,
            prev: '/admin/purchase/rfqs?page=1&lang=vi',
            next: '/admin/purchase/rfqs?page=3&lang=vi',
          },
        },
      },
      rows,
      total: 61,
      createHref: '/admin/purchase/rfqs/new?lang=vi&returnTo=%2Fadmin%2Fpurchase%2Frfqs%3Flang%3Dvi',
      detailSuffix: '?lang=vi',
      setup: { pickingTypes: 1, vendors: 1 },
      table: {
        groups: [
          {
            id: 'state:draft',
            label: 'RFQ',
            count: 61,
            depth: 0,
            open: true,
            href: '/admin/purchase/rfqs?lang=vi',
            rows,
          },
        ],
      },
    }),
  )

  assert.match(html, /data-ui="list-page"/)
  assert.match(html, /href="\/admin\/purchase\/rfqs\/new\?lang=vi&amp;returnTo=/)
  assert.match(html, /data-ui="chrome-search"[\s\S]*?name="q"[\s\S]*?value="RFQ00001"/)
  assert.match(html, /data-ui="facet"[\s\S]*?RFQ/)
  assert.match(html, /data-ui="pager-range"[^>]*>[\s\S]*?31-31 \/ 61/)
  assert.match(html, /data-ui="group-row"[\s\S]*?data-ui="group-count"[\s\S]*?61/)
  assert.match(html, /data-row-href="\/admin\/purchase\/rfqs\/rfq-1\?lang=vi"/)
  assert.match(html, /data-col="vendor"[\s\S]*?NCC An Phú/)
  assert.match(html, /data-col="state"[\s\S]*?data-tone="neutral"[\s\S]*?RFQ/)
  assert.match(html, /data-col="total"[\s\S]*?1\.500\.000/)
  assert.doesNotMatch(html, /data-ui="form-page"|purchase-rfq-create|mail\.chatter/)
})

test('purchase RFQ create FormPage keeps all supplied fields, validation, setup and returnTo', () => {
  const html = renderToString(
    rfqCreateScreen(translate, {
      frame: {},
      action: '/admin/purchase/rfqs/new?lang=vi&returnTo=%2Fadmin%2Fpurchase%2Frfqs%3Fstate%3Ddraft',
      cancelHref: '/admin/purchase/rfqs?state=draft&lang=vi',
      invalid: 'partnerId',
      setup: { pickingTypes: 0, vendors: 1 },
      fields: [
        { name: 'partnerId', label: 'Nhà cung cấp', type: 'select', required: true },
        { name: 'partnerRef', label: 'Tham chiếu nhà cung cấp' },
        { name: 'pickingTypeId', label: 'Nhập vào', type: 'select', required: true },
        { name: 'dateOrder', label: 'Ngày đặt hàng', type: 'date' },
        { name: 'datePlanned', label: 'Ngày dự kiến nhận', type: 'date' },
        { name: 'notes', label: 'Ghi chú', type: 'textarea' },
      ],
    }),
  )

  assert.match(html, /data-ui="form-page" data-scope="purchase-rfq-create-form-page" data-has-aside="false"/)
  assert.match(html, /id="purchase-rfq-create"/)
  assert.match(html, /action="\/admin\/purchase\/rfqs\/new\?lang=vi&amp;returnTo=/)
  assert.match(html, /href="\/admin\/purchase\/rfqs\?state=draft&amp;lang=vi"/)
  assert.match(html, /data-ui="notice" data-tone="danger"[\s\S]*?partnerId/)
  assert.match(html, /data-ui="notice" data-tone="warning"[\s\S]*?loại phiếu nhập kho/)
  assert.match(
    html,
    /name="partnerId"[\s\S]*?name="partnerRef"[\s\S]*?name="pickingTypeId"[\s\S]*?name="dateOrder"[\s\S]*?name="datePlanned"[\s\S]*?name="notes"/,
  )
  assert.doesNotMatch(html, /data-ui="list-page"|mail\.chatter|data-ui="form-page-aside"/)
})

test('purchase orders list keeps business columns and empty handoff to RFQs without create form', () => {
  const listHtml = renderToString(
    purchaseOrdersListScreen(translate, {
      frame: {},
      detailSuffix: '?lang=vi',
      originHref: '/admin/purchase/rfqs?lang=vi',
      rows: [
        {
          id: 'po-1',
          name: 'PO00001',
          partnerName: 'NCC Minh Long',
          dateOrder: '2026-08-21',
          state: 'purchase',
          invoiceStatus: 'to invoice',
          amountTotal: '3000000',
          currency: 'VND',
        },
      ],
    }),
  )
  assert.match(listHtml, /data-ui="list-page"/)
  assert.match(listHtml, /data-row-href="\/admin\/purchase\/orders\/po-1\?lang=vi"/)
  assert.match(listHtml, /NCC Minh Long/)
  assert.match(listHtml, /Chờ lập hoá đơn/)
  assert.match(listHtml, /3\.000\.000/)
  assert.doesNotMatch(listHtml, /purchase-rfq-create|data-ui="form-page"|mail\.chatter/)

  const emptyHtml = renderToString(
    purchaseOrdersListScreen(translate, {
      frame: {},
      detailSuffix: '?lang=vi',
      originHref: '/admin/purchase/rfqs?lang=vi',
      rows: [],
    }),
  )
  assert.match(emptyHtml, /Chưa có đơn mua nào/)
  assert.match(emptyHtml, /href="\/admin\/purchase\/rfqs\?lang=vi"/)
})
