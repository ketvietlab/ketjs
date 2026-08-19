// Assembly only — each concern lives in its own file.

import { defineModule } from 'ketjs'
import { models } from './models.ts'
import { relations } from './relations.ts'
import { functions } from './functions.ts'
import { messages } from './messages.ts'

export default defineModule({
  name: 'company',
  version: '0.1.0',
  depends: ['partner'],
  app: true,
  title: 'Công ty',
  summary: 'Pháp nhân và chi nhánh hạch toán độc lập.',
  category: 'Hệ thống',
  // Removing the register of legal entities would leave every company-scoped row
  // pointing at nothing nameable.
  removable: false,
  models, relations, functions, messages,
})
