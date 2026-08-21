import { defineModule } from '@ketvietlab/ketjs'
import { functions } from './functions.ts'
import { messages } from './messages.ts'
import { models } from './models.ts'
import { routes } from './routes.ts'

export default defineModule({
  name: 'crm_website',
  version: '0.1.0',
  depends: ['crm', 'website', 'user'],
  app: true,
  title: 'CRM Website',
  summary: 'Thu thập tiềm năng từ website.',
  category: 'Website',
  models,
  functions,
  routes,
  messages,
})
