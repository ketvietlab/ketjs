import { defineModule } from '@ketvietlab/ketjs'
import { models } from './models.ts'
import { relations } from './relations.ts'
import { functions } from './functions.ts'
import { messages } from './messages.ts'

export default defineModule({
  name: 'uom',
  version: '0.1.0',
  app: true,
  title: 'Đơn vị tính',
  summary: 'Cây đơn vị tương đối và quy đổi.',
  category: 'Bán hàng',
  models,
  relations,
  functions,
  messages,
})

export { convertQty, roundTo, compareQty, isZero, UomError } from './convert.ts'
export type { Unit } from './convert.ts'
