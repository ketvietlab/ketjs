import { defineModule } from 'ketjs'
import { functions } from './functions.ts'
import { models } from './models.ts'
import { relations } from './relations.ts'

export default defineModule({
  name: 'pricing',
  version: '0.1.0',
  depends: ['product'],
  app: true,
  title: 'Bảng giá',
  summary: 'Quy tắc giá theo Odoo 19 trong tiền tệ của company.',
  category: 'Bán hàng',
  models,
  relations,
  functions,
})

export { APPLIED_ON, COMPUTE_PRICE, PRICE_BASES } from './functions.ts'
