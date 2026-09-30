import { inventoryPreviewFunctions } from './functions/inventory-preview.ts'
import { defineModule } from '@ketvietlab/ketjs'
import { functions } from './functions.ts'
import { models } from './models.ts'
import { relations } from './relations.ts'
import { routingFunctions } from './routing.ts'
import { reportFunctions, reports } from './reports.ts'

export default defineModule({
  name: 'stock',
  version: '0.1.0',
  depends: ['product', 'uom'],
  title: 'Kho',
  summary: 'Tồn kho, dịch chuyển và bổ sung hàng.',
  category: 'Kho vận',
  models,
  extend: {
    'product.Template': { isStorable: 'bool?', tracking: 'text?', inventoryRevision: 'int?' },
  },
  relations,
  functions: { ...functions, ...routingFunctions, ...reportFunctions, ...inventoryPreviewFunctions },
  reports,
  messages: {
    vi: {
      'error.countStorable': 'Chọn sản phẩm lưu kho.',
      'error.countLocation': 'Chọn vị trí nội bộ hoặc trung chuyển.',
      'error.countPositive': 'Số đếm không được âm.',
      'error.countLot': 'Chọn lô hoặc số sê-ri đúng sản phẩm.',
      'error.countSerial': 'Số đếm mỗi sê-ri chỉ được là 0 hoặc 1.',
      'error.countReserved': 'Số đếm thấp hơn hàng đang giữ. Xử lý phiếu giữ hàng trước khi kiểm kê.',
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
      'error.countStorable': 'Choose a storable product.',
      'error.countLocation': 'Choose an internal or transit location.',
      'error.countPositive': 'Count cannot be negative.',
      'error.countLot': 'Choose a lot or serial belonging to this product.',
      'error.countSerial': 'Count per serial must be zero or one.',
      'error.countReserved':
        'Count is below reserved stock. Resolve the reservations before adjusting inventory.',
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
/** Stable extension boundary for private modules that compose stock commands. */
export { functions as stockFunctionSpecs } from './functions.ts'
