import { defineModule } from '@ketvietlab/ketjs'
import { channelRoutes } from './channel-routes.ts'

export default defineModule({
  name: 'purchase_staff_channel',
  version: '0.1.0',
  depends: ['channel_api', 'purchase', 'partner'],
  compatible: { channel_api: '^1' },
  title: 'Purchasing Staff Channel',
  summary: 'Read-only purchasing vendor lookup routes for staff clients.',
  category: 'Purchasing',
  routes: channelRoutes,
  messages: {
    vi: {
      'app.title': 'Kênh nhân viên mua hàng',
      'app.summary': 'Tra cứu nhà cung cấp chỉ đọc cho ứng dụng nhân viên.',
      'app.category': 'Mua hàng',
      'error.vendorNotFound': 'Không tìm thấy nhà cung cấp.',
    },
    en: {
      'app.title': 'Purchasing staff channel',
      'app.summary': 'Read-only vendor lookup for staff applications.',
      'app.category': 'Purchasing',
      'error.vendorNotFound': 'Vendor not found.',
    },
  },
})

export { channelRoutes }
