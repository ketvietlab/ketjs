import { defineModule } from '@ketvietlab/ketjs'
import { messages } from './messages.ts'
import { models } from './models.ts'
import { saleFunctionsPublic } from './sale-functions.ts'

export default defineModule({
  name: 'crm_sale',
  version: '0.1.0',
  depends: ['crm', 'sale', 'stock', 'pricing', 'account', 'product', 'uom'],
  app: true,
  title: 'CRM · Bán hàng',
  summary: 'Tạo báo giá từ cơ hội bán hàng.',
  category: 'Bán hàng',
  models,
  functions: saleFunctionsPublic,
  messages,
})

export { createQuotationForCase, quotationEffects, saleFunctionsPublic } from './sale-functions.ts'
