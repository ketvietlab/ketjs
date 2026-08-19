import { defineModule } from 'ketjs'
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
  summary: 'Tồn kho, dịch chuyển và bổ sung hàng theo Odoo 19.',
  category: 'Kho vận',
  models,
  extend: {
    'product.Template': { isStorable: 'bool?', tracking: 'text?' },
  },
  relations,
  functions: { ...functions, ...routingFunctions },
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
