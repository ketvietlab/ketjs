import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { linkButton } from '../packages/ketsuite/src/ui/index.ts'
import { purchaseOrderDetailScreen } from '../packages/ketsuite/src/modules/purchase_backend/screens/order-detail.tsx'

const messages: Record<string, string> = {
  'purchase_backend.action.addLine': 'Thêm dòng',
  'purchase_backend.action.approve': 'Phê duyệt',
  'purchase_backend.action.cancel': 'Huỷ',
  'purchase_backend.action.confirm': 'Xác nhận đơn',
  'purchase_backend.action.createBill': 'Tạo hoá đơn',
  'purchase_backend.action.lock': 'Khoá đơn',
  'purchase_backend.action.removeLine': 'Xoá dòng',
  'purchase_backend.action.requestApproval': 'Gửi duyệt',
  'purchase_backend.action.resetToDraft': 'Trả về nháp',
  'purchase_backend.action.send': 'Đánh dấu đã gửi',
  'purchase_backend.action.syncReceipts': 'Đồng bộ nhập hàng',
  'purchase_backend.action.unlock': 'Mở khoá',
  'purchase_backend.action.updateLine': 'Lưu dòng',
  'purchase_backend.bill.title': 'Tạo hoá đơn nhà cung cấp',
  'purchase_backend.bills.title': 'Hoá đơn nhà cung cấp',
  'purchase_backend.billState.posted': 'Đã ghi sổ',
  'purchase_backend.detail.title': 'Chi tiết đơn mua',
  'purchase_backend.feedback.rejected': 'Chưa lưu được',
  'purchase_backend.feedback.rejectedField': 'Trường "{field}" chưa hợp lệ.',
  'purchase_backend.feedback.rejectedHint': 'Kiểm tra các trường bắt buộc.',
  'purchase_backend.field.amountTotal': 'Tổng tiền',
  'purchase_backend.field.datePlanned': 'Ngày dự kiến nhận',
  'purchase_backend.field.expenseAccount': 'Tài khoản chi phí',
  'purchase_backend.field.invoiceStatus': 'Trạng thái lập hoá đơn',
  'purchase_backend.field.journal': 'Sổ nhật ký',
  'purchase_backend.field.name': 'Số đơn',
  'purchase_backend.field.payableAccount': 'Tài khoản phải trả',
  'purchase_backend.field.priceUnit': 'Đơn giá',
  'purchase_backend.field.product': 'Sản phẩm',
  'purchase_backend.field.productQty': 'Số lượng đặt',
  'purchase_backend.field.qtyInvoiced': 'Đã lập hoá đơn',
  'purchase_backend.field.qtyReceived': 'Đã nhận',
  'purchase_backend.field.state': 'Trạng thái',
  'purchase_backend.field.subtotal': 'Thành tiền',
  'purchase_backend.invoiceStatus.no': 'Chưa cần lập hoá đơn',
  'purchase_backend.invoiceStatus.to invoice': 'Chờ lập hoá đơn',
  'purchase_backend.lines.add': 'Thêm sản phẩm',
  'purchase_backend.lines.edit': 'Sửa',
  'purchase_backend.lines.empty': 'Yêu cầu chưa có dòng nào.',
  'purchase_backend.lines.emptyHint': 'Thêm ít nhất một sản phẩm.',
  'purchase_backend.lines.title': 'Dòng sản phẩm',
  'purchase_backend.moveState.done': 'Hoàn tất',
  'purchase_backend.receipts.title': 'Phiếu nhập',
  'purchase_backend.state.draft': 'RFQ',
  'purchase_backend.state.purchase': 'Đơn mua hàng',
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

test('purchase RFQ detail FormPage keeps header actions, editable lines, add form and rejection', () => {
  const html = renderToString(
    purchaseOrderDetailScreen(translate, {
      frame: {},
      actionPath: '/admin/purchase/rfqs/rfq-1?lang=vi',
      invalid: 'productId',
      printActions: linkButton({ label: 'In RFQ', href: '/reports/purchase.rfq/rfq-1?lang=vi' }),
      order: {
        id: 'rfq-1',
        name: 'RFQ00001',
        state: 'draft',
        partnerName: 'NCC An Phú',
        datePlanned: '2026-09-01T00:00:00.000Z',
        invoiceStatus: 'no',
        amountTotal: '1500000',
        currency: 'VND',
        lines: [
          {
            id: 'line-1',
            name: 'Bàn làm việc',
            productQty: '2',
            qtyReceived: '0',
            qtyInvoiced: '0',
            priceUnit: '750000',
            priceSubtotal: '1500000',
          },
        ],
      },
      lineFields: [
        { name: 'productId', label: 'Sản phẩm', type: 'select', required: true },
        { name: 'productQty', label: 'Số lượng đặt', type: 'decimal', required: true },
      ],
      billFields: [],
    }),
  )

  assert.match(html, /data-ui="form-page" data-scope="purchase-order-form-page" data-has-aside="false"/)
  assert.match(html, /data-ket-slot="purchase\.order-header"/)
  assert.match(html, /data-ket-slot="purchase\.order-body"/)
  assert.match(html, /data-ui="form-page-title"[^>]*>[\s\S]*?RFQ00001/)
  assert.match(html, /NCC An Phú · Ngày dự kiến nhận: 2026-09-01/)
  assert.match(html, /data-ui="form-page-status"[\s\S]*?data-tone="neutral"[\s\S]*?RFQ/)
  assert.match(html, /data-ui="form-page-meta"[\s\S]*?Chưa cần lập hoá đơn[\s\S]*?1\.500\.000/)
  assert.match(html, /data-ui="form-page-actions"[\s\S]*?name="action" value="send"/)
  assert.match(html, /name="action" value="confirm"/)
  assert.match(html, /name="action" value="request-approval"/)
  assert.match(html, /name="action" value="cancel"/)
  assert.match(html, /href="\/reports\/purchase\.rfq\/rfq-1\?lang=vi"/)
  assert.match(html, /data-ui="notice" data-tone="danger"[\s\S]*?productId/)
  assert.match(html, /data-col="name"[\s\S]*?Bàn làm việc/)
  assert.match(html, /name="action" value="update-line"/)
  assert.match(html, /name="action" value="remove-line"/)
  assert.match(html, /name="action" value="add-line"/)
  assert.match(html, /name="productId"[\s\S]*?name="productQty"/)
  assert.doesNotMatch(html, /name="action" value="bill"/)
  assert.doesNotMatch(html, /mail\.chatter|data-ui="form-page-aside"/)
})

test('purchase order detail FormPage keeps receipt, bill and vendor-bill workflow', () => {
  const html = renderToString(
    purchaseOrderDetailScreen(translate, {
      frame: {},
      actionPath: '/admin/purchase/orders/po-1?lang=vi',
      order: {
        id: 'po-1',
        name: 'PO00001',
        state: 'purchase',
        partnerName: 'NCC Minh Long',
        datePlanned: '2026-09-02',
        invoiceStatus: 'to invoice',
        amountTotal: '3000000',
        currency: 'VND',
        lines: [
          {
            id: 'line-2',
            name: 'Ghế công thái học',
            productQty: '2',
            qtyReceived: '2',
            qtyInvoiced: '1',
            priceUnit: '1500000',
            priceSubtotal: '3000000',
          },
        ],
        moves: [
          { id: 'move-1', pickingId: 'receipt-1', origin: 'WH/IN/00001', state: 'done', quantity: '2' },
        ],
        bills: [{ id: 'bill-1', name: 'BILL/2026/001', state: 'posted', amountTotal: '1500000' }],
      },
      lineFields: [],
      billFields: [
        { name: 'journalId', label: 'Sổ nhật ký', type: 'select', required: true },
        { name: 'expenseAccountId', label: 'Tài khoản chi phí', type: 'select', required: true },
        { name: 'payableAccountId', label: 'Tài khoản phải trả', type: 'select', required: true },
      ],
    }),
  )

  assert.match(html, /data-ui="form-page-status"[\s\S]*?data-tone="positive"[\s\S]*?Đơn mua hàng/)
  assert.match(html, /name="action" value="sync"/)
  assert.match(html, /name="action" value="lock"/)
  assert.match(html, /name="action" value="cancel"/)
  assert.doesNotMatch(html, /name="action" value="update-line"|name="action" value="add-line"/)
  assert.match(html, /name="action" value="bill"/)
  assert.match(html, /name="journalId"[\s\S]*?name="expenseAccountId"[\s\S]*?name="payableAccountId"/)
  assert.match(html, /href="\/admin\/stock\/transfers\/receipt-1"[\s\S]*?WH\/IN\/00001/)
  assert.match(html, /href="\/admin\/accounting\/vendor-bills\/bill-1"[\s\S]*?BILL\/2026\/001/)
  assert.match(html, /data-col="total"[\s\S]*?1\.500\.000/)
  assert.doesNotMatch(html, /mail\.chatter|data-ui="form-page-aside"/)
})
