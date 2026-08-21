import { defineModule } from '@ketvietlab/ketjs'
import { functions } from './functions.ts'
import { models } from './models.ts'
import { relations } from './relations.ts'

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
  functions,
  messages: {
    vi: {
      'app.title': 'Bán hàng',
      'app.summary': 'Báo giá, đơn bán, giao hàng và hoá đơn khách hàng.',
      'app.category': 'Bán hàng',
    },
    en: {
      'app.title': 'Sales',
      'app.summary': 'Quotations, sales orders, deliveries, and customer invoices.',
      'app.category': 'Sales',
    },
  },
})
export { SALE_STATES, SALE_INVOICE_STATUSES, INVOICE_POLICIES } from './functions.ts'
