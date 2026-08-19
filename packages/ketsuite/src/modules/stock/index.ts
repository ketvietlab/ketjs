// Assembly only — each concern lives in its own file.

import { defineModule } from 'ketjs'
import { models } from './models.ts'
import { relations } from './relations.ts'
import { functions } from './functions.ts'
import { messages } from './messages.ts'

export default defineModule({
  name: 'stock',
  version: '0.1.0',
  depends: ['product', 'uom'],
  app: true,
  title: 'Kho',
  summary: 'Địa điểm, tồn kho và luân chuyển — bút toán kép như Odoo.',
  category: 'Kho vận',
  models, relations, functions, messages,
})

export { LOCATION_USAGES, REAL_USAGES, MOVE_STATES } from './types.ts'
export type { LocationUsage, MoveState } from './types.ts'
