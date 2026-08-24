import { defineModule } from '@ketvietlab/ketjs'
import { functions } from './functions.ts'
import { models } from './models.ts'
import { relations } from './relations.ts'
import { routingFunctions } from './routing.ts'
import { reportFunctions, reports } from './reports.ts'

export default defineModule({
  name: 'stock',
  group: 'commerce',
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
  functions: { ...functions, ...routingFunctions, ...reportFunctions },
  reports,
  messages: {
    vi: {
      'app.title': 'Kho',
      'app.summary': 'Tồn kho, dịch chuyển và bổ sung hàng.',
      'app.category': 'Kho vận',
      'report.receipt': 'PHIẾU NHẬP KHO',
      'report.delivery': 'PHIẾU XUẤT KHO',
      'report.internalTransfer': 'PHIẾU CHUYỂN KHO',
      'report.number': 'Số',
      'report.date': 'Ngày',
      'report.from': 'Từ',
      'report.to': 'Đến',
      'report.product': 'Sản phẩm',
      'report.demand': 'Nhu cầu',
      'report.done': 'Đã xử lý',
    },
    en: {
      'app.title': 'Inventory',
      'app.summary': 'Stock, transfers, and replenishment.',
      'app.category': 'Inventory',
      'report.receipt': 'RECEIPT',
      'report.delivery': 'DELIVERY SLIP',
      'report.internalTransfer': 'INTERNAL TRANSFER',
      'report.number': 'Number',
      'report.date': 'Date',
      'report.from': 'From',
      'report.to': 'To',
      'report.product': 'Product',
      'report.demand': 'Demand',
      'report.done': 'Done',
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
