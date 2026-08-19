import { defineModule } from 'ketjs'
import { functions } from './functions.ts'
import { models } from './models.ts'
import { relations } from './relations.ts'

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
  functions,
  messages: {
    vi: { 'app.title': 'Mua hàng', 'app.summary': 'RFQ, đơn mua, nhập hàng và hoá đơn nhà cung cấp theo Odoo 19.', 'app.category': 'Mua hàng' },
    en: { 'app.title': 'Purchase', 'app.summary': 'Odoo 19 RFQs, purchase orders, receipts, and vendor bills.', 'app.category': 'Purchase' },
  },
})

export { PURCHASE_STATES, INVOICE_STATUSES, PURCHASE_METHODS } from './functions.ts'
