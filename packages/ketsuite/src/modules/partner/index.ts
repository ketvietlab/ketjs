// Assembly only — each concern lives in its own file.

import { defineModule } from 'ketjs'
import { models } from './models.ts'
import { relations } from './relations.ts'
import { views } from './views.ts'
import { functions } from './functions.ts'
import { messages } from './messages.ts'

export default defineModule({
  name: 'partner',
  version: '0.1.0',
  app: true,
  title: 'Đối tác',
  summary: 'Khách hàng, nhà cung cấp, liên hệ và địa chỉ — dùng chung toàn hệ thống.',
  category: 'Bán hàng',
  models,
  relations,
  views,
  functions,
  messages,
})

export { PARTNER_KINDS, PARTNER_ROLES, ADDRESS_USES } from './types.ts'
export type { PartnerKind, PartnerRole, AddressUse } from './types.ts'
