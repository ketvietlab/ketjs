import { defineModule } from '@ketvietlab/ketjs'
import { functions } from './functions.ts'
import { models } from './models.ts'
import { relations } from './relations.ts'

export default defineModule({
  name: 'manufacturing',
  version: '0.1.0',
  depends: ['product', 'uom', 'stock'],
  title: 'Sản xuất',
  summary: 'Định mức, công đoạn và lệnh sản xuất kết nối tồn kho.',
  category: 'Sản xuất',
  models,
  relations,
  functions,
  messages: {
    vi: {
      'app.title': 'Sản xuất',
      'app.summary': 'Định mức, công đoạn và lệnh sản xuất kết nối tồn kho.',
      'app.category': 'Sản xuất',
      'error.required': 'Trường bắt buộc còn thiếu.',
      'error.invalid': 'Dữ liệu sản xuất không hợp lệ.',
      'error.missing': 'Bản ghi không tồn tại.',
      'error.version': 'Dữ liệu đã thay đổi; hãy tải lại trước khi thao tác.',
      'error.state': 'Trạng thái hiện tại không cho phép thao tác này.',
      'error.stockShortage': 'Chưa cấp đủ nguyên liệu để hoàn tất lệnh sản xuất.',
    },
    en: {
      'app.title': 'Manufacturing',
      'app.summary': 'Bills of materials, operations, and stock-backed production orders.',
      'app.category': 'Manufacturing',
      'error.required': 'A required field is missing.',
      'error.invalid': 'The manufacturing data is invalid.',
      'error.missing': 'The record does not exist.',
      'error.version': 'The record changed; reload it before acting.',
      'error.state': 'The current state does not allow this action.',
      'error.stockShortage': 'All components must be allocated before production can finish.',
    },
  },
})

export { functions as manufacturingFunctionSpecs } from './functions.ts'
export { BOM_TYPES, PRODUCTION_STATES, WORK_ORDER_STATES } from './types.ts'
export type { BomType, ProductionState, WorkOrderState } from './types.ts'
