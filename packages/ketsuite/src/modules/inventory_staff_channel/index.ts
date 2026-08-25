import { defineModule } from '@ketvietlab/ketjs'
import { channelRoutes } from './channel-routes.ts'

export default defineModule({
  name: 'inventory_staff_channel',
  version: '0.1.0',
  depends: ['channel_api', 'product', 'product_media', 'stock', 'uom'],
  compatible: { channel_api: '^1' },
  title: 'Inventory Staff Channel',
  summary: 'Audience-scoped inventory catalogue and stock-position reads for staff clients.',
  category: 'Inventory',
  routes: channelRoutes,
  messages: {
    vi: {
      'app.title': 'Kênh nhân viên tồn kho',
      'app.summary': 'Tra cứu hàng hóa và vị trí tồn kho cho ứng dụng nhân viên.',
      'app.category': 'Kho vận',
      'error.productNotFound': 'Không tìm thấy hàng hóa.',
    },
    en: {
      'app.title': 'Inventory staff channel',
      'app.summary': 'Inventory catalogue and stock-position reads for staff applications.',
      'app.category': 'Inventory',
      'error.productNotFound': 'Inventory product not found.',
    },
  },
})

export { channelRoutes }
