import { defineModule } from '@ketvietlab/ketjs'
import { functions } from './functions.ts'
import { models } from './models.ts'
import { relations } from './relations.ts'

export default defineModule({
  name: 'pricing',
  version: '0.1.0',
  depends: ['product', 'company', 'uom'],
  app: true,
  title: 'Bảng giá',
  summary: 'Quy tắc giá theo Odoo 19 trong tiền tệ của company.',
  category: 'Bán hàng',
  models,
  relations,
  functions,
  messages: {
    vi: {
      'app.title': 'Bảng giá',
      'app.summary': 'Quy tắc giá theo Odoo 19 dùng tiền tệ của công ty.',
      'app.category': 'Bán hàng',
    },
    en: {
      'app.title': 'Pricing',
      'app.summary': 'Odoo 19 pricing rules in the company currency.',
      'app.category': 'Sales',
    },
  },
})

export { APPLIED_ON, COMPUTE_PRICE, PRICE_BASES } from './functions.ts'
