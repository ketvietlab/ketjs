import { defineModule } from 'ketjs'
import { functions } from './functions.ts'
import { models } from './models.ts'
import { relations } from './relations.ts'
import { reportFunctions, reports } from './reports.ts'

export default defineModule({
  name: 'purchase',
  version: '0.1.0',
  depends: ['company', 'partner', 'product', 'uom', 'stock', 'account'],
  app: true,
  title: 'Mua hàng',
  summary: 'RFQ, đơn mua, nhập hàng và hoá đơn nhà cung cấp theo Odoo 19.',
  category: 'Mua hàng',
  models,
  extend: {
    'product.Template': { purchaseMethod: 'text?' },
    'stock.Move': { purchaseLineId: 'ref:purchase.OrderLine?' },
    'account.MoveLine': { purchaseLineId: 'ref:purchase.OrderLine?' },
  },
  relations,
  functions: { ...functions, ...reportFunctions },
  reports,
  messages: {
    vi: {
      'app.title': 'Mua hàng',
      'app.summary': 'RFQ, đơn mua, nhập hàng và hoá đơn nhà cung cấp theo Odoo 19.',
      'app.category': 'Mua hàng',
      'report.rfq': 'YÊU CẦU BÁO GIÁ',
      'report.purchaseOrder': 'ĐƠN MUA HÀNG',
      'report.number': 'Số',
      'report.date': 'Ngày',
      'report.vendor': 'Nhà cung cấp',
      'report.description': 'Mô tả',
      'report.quantity': 'Số lượng',
      'report.unitPrice': 'Đơn giá',
      'report.subtotal': 'Thành tiền',
      'report.untaxed': 'Trước thuế',
      'report.tax': 'Thuế',
      'report.total': 'Tổng cộng',
    },
    en: {
      'app.title': 'Purchase',
      'app.summary': 'Odoo 19 RFQs, purchase orders, receipts, and vendor bills.',
      'app.category': 'Purchase',
      'report.rfq': 'REQUEST FOR QUOTATION',
      'report.purchaseOrder': 'PURCHASE ORDER',
      'report.number': 'Number',
      'report.date': 'Date',
      'report.vendor': 'Vendor',
      'report.description': 'Description',
      'report.quantity': 'Quantity',
      'report.unitPrice': 'Unit price',
      'report.subtotal': 'Subtotal',
      'report.untaxed': 'Untaxed',
      'report.tax': 'Tax',
      'report.total': 'Total',
    },
  },
})

export { PURCHASE_STATES, INVOICE_STATUSES, PURCHASE_METHODS } from './functions.ts'
