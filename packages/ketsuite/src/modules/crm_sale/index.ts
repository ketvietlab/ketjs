import { defineModule } from '@ketvietlab/ketjs'
import { messages } from './messages.ts'
import { models } from './models.ts'
import { saleFunctionsPublic } from './sale-functions.ts'

export default defineModule({
  name: 'crm_sale',
  version: '0.1.0',
  depends: ['crm', 'sale', 'stock', 'pricing', 'account', 'product', 'uom'],
  title: 'CRM · Sales',
  summary: 'Quotations written from an opportunity.',
  category: 'Sales',
  models,
  functions: saleFunctionsPublic,
  messages,
})

export { createQuotationForCase, quotationEffects, saleFunctionsPublic } from './sale-functions.ts'
