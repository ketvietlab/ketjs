import { defineModule } from '@ketvietlab/ketjs'
import { channelRoutes } from './channel-routes.ts'
import { functions } from './functions.ts'
import { models } from './models.ts'
import { operationRoutes } from './operation-routes.ts'

export default defineModule({
  name: 'stock_staff_channel',
  version: '0.1.0',
  depends: ['channel_api', 'stock', 'company', 'product', 'uom', 'user'],
  compatible: { channel_api: '^1' },
  title: 'Warehouse Staff Channel',
  summary: 'Audience-scoped warehouse execution, scanning, and inventory counts for staff clients.',
  category: 'Inventory',
  models,
  functions,
  routes: { ...channelRoutes, ...operationRoutes },
  messages: {
    vi: {
      'app.title': 'Kênh nhân viên kho',
      'app.summary': 'Tra cứu phiếu kho có kiểm soát cho ứng dụng nhân viên.',
      'app.category': 'Kho vận',
      'error.pickingNotFound': 'Không tìm thấy phiếu kho.',
      'error.conflict': 'Dữ liệu kho đã thay đổi. Hãy tải lại trước khi tiếp tục.',
      'error.invalid': 'Không thể thực hiện thao tác kho với dữ liệu hiện tại.',
    },
    en: {
      'app.title': 'Warehouse staff channel',
      'app.summary': 'Controlled warehouse transfer reads for staff applications.',
      'app.category': 'Inventory',
      'error.pickingNotFound': 'Warehouse transfer not found.',
      'error.conflict': 'Warehouse data changed. Refresh before continuing.',
      'error.invalid': 'The warehouse operation cannot be completed with the current data.',
    },
  },
})

export { channelRoutes, functions, models, operationRoutes }
