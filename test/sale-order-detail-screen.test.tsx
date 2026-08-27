import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { linkButton } from '../packages/ketsuite/src/ui/index.ts'
import { orderDetailScreen } from '../packages/ketsuite/src/modules/sale_backend/screens/order-detail.tsx'

const messages: Record<string, string> = {
  'sale_backend.action.addLine': 'Thêm dòng',
  'sale_backend.action.cancel': 'Huỷ',
  'sale_backend.action.confirm': 'Xác nhận',
  'sale_backend.action.createInvoice': 'Tạo hoá đơn',
  'sale_backend.action.lock': 'Khoá',
  'sale_backend.action.removeLine': 'Xoá dòng',
  'sale_backend.action.reset': 'Đặt lại về nháp',
  'sale_backend.action.send': 'Gửi báo giá',
  'sale_backend.action.sync': 'Đồng bộ giao hàng',
  'sale_backend.action.unlock': 'Mở khoá',
  'sale_backend.deliveries.title': 'Phiếu giao hàng',
  'sale_backend.detail.title': 'Chi tiết đơn bán',
  'sale_backend.field.actions': 'Thao tác',
  'sale_backend.field.amountTax': 'Thuế',
  'sale_backend.field.amountTotal': 'Tổng cộng',
  'sale_backend.field.amountUntaxed': 'Trước thuế',
  'sale_backend.field.clientOrderRef': 'Tham chiếu khách hàng',
  'sale_backend.field.customer': 'Khách hàng',
  'sale_backend.field.dateOrder': 'Ngày đặt hàng',
  'sale_backend.field.delivered': 'Đã giao',
  'sale_backend.field.invoiceStatus': 'Trạng thái hoá đơn',
  'sale_backend.field.invoiced': 'Đã lập hoá đơn',
  'sale_backend.field.name': 'Số chứng từ',
  'sale_backend.field.notes': 'Ghi chú',
  'sale_backend.field.paymentTerm': 'Điều khoản thanh toán',
  'sale_backend.field.priceUnit': 'Đơn giá',
  'sale_backend.field.pricelist': 'Bảng giá',
  'sale_backend.field.product': 'Sản phẩm',
  'sale_backend.field.quantity': 'Số lượng',
  'sale_backend.field.state': 'Trạng thái',
  'sale_backend.field.subtotal': 'Thành tiền',
  'sale_backend.field.validityDate': 'Có hiệu lực đến',
  'sale_backend.field.warehouse': 'Kho',
  'sale_backend.invoice.hint': 'Tạo hoá đơn cho phần cần lập.',
  'sale_backend.invoice.title': 'Lập hoá đơn khách hàng',
  'sale_backend.invoiceStatus.no': 'Chưa cần lập',
  'sale_backend.invoiceStatus.to invoice': 'Chờ lập hoá đơn',
  'sale_backend.invoices.title': 'Hoá đơn khách hàng',
  'sale_backend.lines.add': 'Thêm sản phẩm',
  'sale_backend.lines.addHint': 'Chọn sản phẩm và số lượng.',
  'sale_backend.lines.empty': 'Chưa có dòng sản phẩm',
  'sale_backend.lines.emptyHint': 'Thêm ít nhất một sản phẩm.',
  'sale_backend.lines.hint': 'Sản phẩm và tiến độ thực hiện.',
  'sale_backend.lines.title': 'Dòng đơn hàng',
  'sale_backend.order.actions.label': 'Thao tác đơn hàng',
  'sale_backend.order.collaboration.label': 'Trao đổi về đơn hàng',
  'sale_backend.order.information.hint': 'Thông tin thương mại và vận hành.',
  'sale_backend.order.information.title': 'Thông tin đơn hàng',
  'sale_backend.order.kicker': 'Đơn bán hàng',
  'sale_backend.order.locked': 'Đã khoá',
  'sale_backend.quotation.kicker': 'Báo giá',
  'sale_backend.state.cancel': 'Đã huỷ',
  'sale_backend.state.draft': 'Bản nháp',
  'sale_backend.state.sale': 'Đơn bán hàng',
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

const collaboration = (
  <>
    <div data-island="mail.chatter">Chatter</div>
    <div data-island="activity.record">Hoạt động</div>
  </>
)

const editor = <div data-island="sale.editor" data-scope="sale-order" />

test('sale quotation detail: FormPage keeps editable lines, header actions and collaboration rail', () => {
  const html = renderToString(
    orderDetailScreen(
      translate,
      {
        action: '/admin/sales/quotations/quotation-1?lang=vi',
        collaboration,
        editor,
        integration: <div data-island="sale.loyalty">Loyalty</div>,
        printActions: linkButton({
          label: 'In báo giá',
          href: '/reports/sale.quotation/quotation-1?lang=vi',
        }),
        errors: ['productId'],
        order: {
          id: 'quotation-1',
          name: 'S00001',
          state: 'draft',
          partnerName: 'Khách hàng Minh Anh',
          dateOrder: '2026-08-27T08:00:00.000Z',
          validityDate: '2026-09-27T00:00:00.000Z',
          clientOrderRef: 'PO-MA-01',
          warehouseName: 'Kho chính',
          pricelistName: 'Bán lẻ',
          paymentTermName: 'Thanh toán ngay',
          notes: 'Giao giờ hành chính',
          invoiceStatus: 'no',
          amountUntaxed: '1000000',
          amountTax: '100000',
          amountTotal: '1100000',
          currency: 'VND',
          lines: [
            {
              id: 'line-1',
              name: 'Ghế công thái học',
              productUomQty: '1',
              qtyDelivered: '0',
              qtyInvoiced: '0',
              priceUnit: '1000000',
              priceSubtotal: '1000000',
            },
          ],
        },
        lineFields: [
          { name: 'productId', label: 'Sản phẩm', type: 'select', required: true },
          { name: 'productUomQty', label: 'Số lượng', type: 'decimal', required: true },
        ],
        invoiceFields: [],
      },
      {},
    ),
  )

  assert.match(html, /data-ui="form-page" data-scope="sale-order-form-page" data-has-aside="true"/)
  assert.match(html, /data-ket-slot="sale\.order-header"/)
  assert.match(html, /data-ket-slot="sale\.order-body"/)
  assert.match(html, /data-ui="form-page-title"[\s\S]*?S00001/)
  assert.match(html, /Báo giá · Khách hàng Minh Anh/)
  assert.match(html, /data-ui="form-page-status"[\s\S]*?Bản nháp/)
  assert.match(html, /data-ui="form-page-meta"[\s\S]*?Trước thuế: 1\.000\.000/)
  assert.match(html, /Thuế: 100\.000[\s\S]*?Tổng cộng: 1\.100\.000[\s\S]*?Chưa cần lập/)
  assert.match(html, /data-ui="form-page-actions"[\s\S]*?name="action" value="send"/)
  assert.match(html, /name="action" value="confirm"/)
  assert.match(html, /name="action" value="cancel"/)
  assert.match(html, /href="\/reports\/sale\.quotation\/quotation-1\?lang=vi"/)
  assert.match(html, /data-ui="form-page-controller"[\s\S]*?data-island="sale\.editor"/)
  assert.match(html, /data-island="sale\.loyalty"/)
  assert.match(html, /data-col="product"[\s\S]*?Ghế công thái học/)
  assert.match(html, /name="action" value="remove-line"[\s\S]*?name="lineId" value="line-1"/)
  assert.match(html, /id="sale-order-line-form"[\s\S]*?name="productId"[\s\S]*?name="productUomQty"/)
  assert.match(html, /Dữ liệu chưa hợp lệ|productId/)
  assert.match(html, /data-ui="form-page-aside"[\s\S]*?data-island="mail\.chatter"/)
  assert.match(html, /data-island="activity\.record"/)
  assert.doesNotMatch(html, /data-ui="record-workspace"|data-ui="record-aside"/)
})

test('sale order detail: keeps invoice, delivery and locale-aware accounting workflow', () => {
  const html = renderToString(
    orderDetailScreen(
      translate,
      {
        action: '/admin/sales/orders/order-1?lang=vi',
        collaboration,
        editor,
        locale: '?lang=vi',
        order: {
          id: 'order-1',
          name: 'S00002',
          state: 'sale',
          locked: true,
          partnerName: 'Công ty An Nhiên',
          warehouseName: 'Kho chính',
          invoiceStatus: 'to invoice',
          amountUntaxed: '2000000',
          amountTax: '200000',
          amountTotal: '2200000',
          currency: 'VND',
          lines: [
            {
              id: 'line-2',
              name: 'Bàn làm việc',
              productUomQty: '2',
              qtyDelivered: '2',
              qtyInvoiced: '0',
              priceUnit: '1000000',
              priceSubtotal: '2000000',
            },
          ],
          moves: [
            { id: 'move-1', pickingId: 'delivery-1', origin: 'WH/OUT/00001', state: 'done', quantity: '2' },
          ],
          invoices: [
            {
              id: 'invoice-1',
              name: 'INV/2026/001',
              state: 'posted',
              amountTotal: '1100000',
              currency: 'VND',
            },
          ],
        },
        lineFields: [],
        invoiceFields: [
          { name: 'journalId', label: 'Sổ nhật ký', type: 'select', required: true },
          { name: 'revenueAccountId', label: 'Tài khoản doanh thu', type: 'select', required: true },
          { name: 'receivableAccountId', label: 'Tài khoản phải thu', type: 'select', required: true },
        ],
      },
      {},
    ),
  )

  assert.match(html, /Đơn bán hàng · Công ty An Nhiên/)
  assert.match(html, /data-ui="form-page-status"[\s\S]*?data-tone="positive"[\s\S]*?Đã khoá/)
  assert.match(html, /name="action" value="sync"/)
  assert.match(html, /name="action" value="unlock"/)
  assert.match(html, /name="action" value="cancel"/)
  assert.doesNotMatch(html, /name="action" value="add-line"|name="action" value="remove-line"/)
  assert.match(html, /id="sale-order-invoice-form"[\s\S]*?name="action" value="invoice"/)
  assert.match(html, /name="journalId"[\s\S]*?name="revenueAccountId"[\s\S]*?name="receivableAccountId"/)
  assert.match(html, /href="\/admin\/stock\/transfers\/delivery-1\?lang=vi"[\s\S]*?WH\/OUT\/00001/)
  assert.match(html, /href="\/admin\/accounting\/customer-invoices\/invoice-1\?lang=vi"/)
  assert.match(html, /INV\/2026\/001[\s\S]*?1\.100\.000/)
  assert.match(html, /data-ui="form-page-aside"[\s\S]*?data-island="mail\.chatter"/)
})

test('sale order partial keeps stable FormPage slots without duplicating collaboration', () => {
  const html = renderToString(
    orderDetailScreen(
      translate,
      {
        action: '/admin/sales/quotations/quotation-2?lang=vi',
        collaboration,
        editor,
        order: {
          id: 'quotation-2',
          name: 'S00003',
          state: 'cancel',
          partnerName: 'Khách hàng Hoàng Gia',
          invoiceStatus: 'no',
          amountUntaxed: '0',
          amountTax: '0',
          amountTotal: '0',
          currency: 'VND',
        },
        lineFields: [],
        invoiceFields: [],
      },
      {},
      true,
    ),
  )

  assert.match(html, /<ket-fragments data-title="S00003">/)
  assert.match(html, /<template data-ket-slot="sale\.order-header">/)
  assert.match(html, /<template data-ket-slot="sale\.order-body">/)
  assert.match(html, /name="action" value="reset"/)
  assert.doesNotMatch(html, /data-ui="shell"|data-ui="form-page-aside"|mail\.chatter|activity\.record/)
})

test('FormPage keeps a two-to-one rail and adds a gap after responsive wrapping', async () => {
  const css = await readFile(
    new URL('../packages/design-system/src/patterns/patterns.css', import.meta.url),
    'utf8',
  )

  assert.match(
    css,
    /\[data-ui="form-page-layout"\][^{]*\{[^}]*grid-template-columns:\s*minmax\(0, 2fr\) minmax\(0, 1fr\)/,
  )
  assert.match(
    css,
    /@media \(max-width: 63\.9375rem\)[\s\S]*?\[data-ui="form-page-layout"\][^{]*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);[^}]*row-gap:\s*var\(--kv-space-5\)/,
  )
})
