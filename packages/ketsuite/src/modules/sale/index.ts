import { defineModule } from '@ketvietlab/ketjs'
import { functions } from './functions.ts'
import { models } from './models.ts'
import { relations } from './relations.ts'
import { reportFunctions, reports } from './reports.ts'

export default defineModule({
  name: 'sale',
  version: '0.1.0',
  depends: ['company', 'partner', 'product', 'uom', 'pricing', 'stock', 'account'],
  app: true,
  title: 'Bán hàng',
  summary: 'Báo giá, đơn bán, giao hàng và hoá đơn khách hàng.',
  category: 'Bán hàng',
  models,
  extend: {
    'product.Template': { invoicePolicy: 'text?' },
    'stock.Move': { saleLineId: 'ref:sale.OrderLine?' },
    'account.MoveLine': { saleLineId: 'ref:sale.OrderLine?' },
  },
  relations,
  functions: { ...functions, ...reportFunctions },
  reports,
  messages: {
    vi: {
      'app.title': 'Bán hàng',
      'app.summary': 'Báo giá, đơn bán, giao hàng và hoá đơn khách hàng.',
      'app.category': 'Bán hàng',
      'report.quotation': 'BÁO GIÁ',
      'report.salesOrder': 'ĐƠN BÁN HÀNG',
      'report.number': 'Số',
      'report.date': 'Ngày',
      'report.customer': 'Khách hàng',
      'report.description': 'Mô tả',
      'report.quantity': 'Số lượng',
      'report.unitPrice': 'Đơn giá',
      'report.subtotal': 'Thành tiền',
      'report.untaxed': 'Trước thuế',
      'report.tax': 'Thuế',
      'report.total': 'Tổng cộng',
    },
    en: {
      'app.title': 'Sales',
      'app.summary': 'Quotations, sales orders, deliveries, and customer invoices.',
      'app.category': 'Sales',
      'report.quotation': 'QUOTATION',
      'report.salesOrder': 'SALES ORDER',
      'report.number': 'Number',
      'report.date': 'Date',
      'report.customer': 'Customer',
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
export { SALE_STATES, SALE_INVOICE_STATUSES, INVOICE_POLICIES } from './functions.ts'
