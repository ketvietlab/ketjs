// Assembly only — each concern lives in its own file.

import { defineModule } from '@ketvietlab/ketjs'
import { models } from './models.ts'
import { relations } from './relations.ts'
import { functions } from './functions.ts'
import { messages } from './messages.ts'

export default defineModule({
  name: 'company',
  // 0.2.0 lets an installed accounting module freeze the legal entity's book
  // currency without making this foundational module depend on Accounting.
  version: '0.2.0',
  depends: ['partner'],
  title: 'Công ty',
  summary: 'Pháp nhân và chi nhánh hạch toán độc lập.',
  category: 'Hệ thống',
  // Removing the register of legal entities would leave every company-scoped row
  // pointing at nothing nameable.
  models,
  relations,
  functions,
  messages,
})
