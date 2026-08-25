import { defineModule } from '@ketvietlab/ketjs'
import { channelRoutes } from './channel-routes.ts'

export default defineModule({
  name: 'stock_staff_channel',
  version: '0.1.0',
  depends: ['channel_api', 'stock', 'company', 'product', 'uom'],
  compatible: { channel_api: '^1' },
  title: 'Warehouse Staff Channel',
  summary: 'Audience-scoped warehouse transfer reads for staff clients.',
  category: 'Inventory',
  routes: channelRoutes,
  messages: {
    vi: {
      'app.title': 'Kênh nhân viên kho',
      'app.summary': 'Tra cứu phiếu kho có kiểm soát cho ứng dụng nhân viên.',
      'app.category': 'Kho vận',
      'error.pickingNotFound': 'Không tìm thấy phiếu kho.',
    },
    en: {
      'app.title': 'Warehouse staff channel',
      'app.summary': 'Controlled warehouse transfer reads for staff applications.',
      'app.category': 'Inventory',
      'error.pickingNotFound': 'Warehouse transfer not found.',
    },
  },
})

export { channelRoutes }
