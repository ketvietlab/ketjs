import { defineModule } from '@ketvietlab/ketjs'
import { functions } from './functions.ts'
import { models } from './models.ts'
import { relations } from './relations.ts'
import { routingFunctions } from './routing.ts'

export default defineModule({
  name: 'stock',
  version: '0.1.0',
  depends: ['product', 'uom'],
  app: true,
  title: 'Kho',
  summary: 'Tồn kho, dịch chuyển và bổ sung hàng.',
  category: 'Kho vận',
  models,
  extend: {
    'product.Template': { isStorable: 'bool?', tracking: 'text?' },
  },
  relations,
  functions: { ...functions, ...routingFunctions },
  messages: {
    vi: {
      'app.title': 'Kho',
      'app.summary': 'Tồn kho, dịch chuyển và bổ sung hàng.',
      'app.category': 'Kho vận',
    },
    en: {
      'app.title': 'Inventory',
      'app.summary': 'Stock, transfers, and replenishment.',
      'app.category': 'Inventory',
    },
  },
})

export {
  RECEPTION_STEPS,
  DELIVERY_STEPS,
  PICKING_TYPE_CODES,
  LOCATION_USAGES,
  MOVE_STATES,
  PICKING_STATES,
  TRACKING,
} from './functions.ts'
export { RULE_ACTIONS, PROCUREMENT_METHODS } from './routing.ts'
