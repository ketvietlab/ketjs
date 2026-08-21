import { defineModule } from '@ketvietlab/ketjs'
import { functions } from './functions.ts'
import { models } from './models.ts'
import { relations } from './relations.ts'

export default defineModule({
  name: 'pos',
  version: '0.1.0',
  depends: ['company', 'partner', 'user', 'product', 'uom', 'pricing', 'stock', 'account'],
  app: true,
  title: 'Điểm bán hàng',
  summary: 'Ca bán hàng, thanh toán, tồn kho và kế toán bán lẻ theo Odoo 19.',
  category: 'Bán hàng',
  models,
  extend: {
    'stock.Move': { posLineId: 'ref:pos.OrderLine?' },
    'account.MoveLine': { posLineId: 'ref:pos.OrderLine?' },
  },
  relations,
  functions,
  messages: {
    vi: {
      'app.title': 'Điểm bán hàng',
      'app.summary': 'Ca bán hàng, thanh toán, tồn kho và kế toán bán lẻ theo Odoo 19.',
      'app.category': 'Bán hàng',
    },
    en: {
      'app.title': 'Point of Sale',
      'app.summary': 'Odoo 19 retail sessions, payments, stock, and accounting.',
      'app.category': 'Sales',
    },
  },
})
export { POS_ORDER_STATES, POS_SESSION_STATES, POS_INVOICE_STATUSES } from './functions.ts'
