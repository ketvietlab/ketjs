import { defineModule } from '@ketvietlab/ketjs'
import { channelRoutes } from './channel-routes.ts'

export default defineModule({
  name: 'crm_staff_channel',
  version: '0.1.0',
  depends: ['channel_api', 'crm', 'activity'],
  compatible: { channel_api: '^1' },
  title: 'CRM Staff Channel',
  summary: 'Read-only CRM pipeline routes for staff clients.',
  category: 'Sales',
  routes: channelRoutes,
  messages: {
    vi: {
      'app.title': 'Kênh nhân viên CRM',
      'app.summary': 'Tra cứu pipeline CRM chỉ đọc cho ứng dụng nhân viên.',
      'app.category': 'Bán hàng',
      'error.leadNotFound': 'Không tìm thấy hồ sơ CRM.',
    },
    en: {
      'app.title': 'CRM staff channel',
      'app.summary': 'Read-only CRM pipeline lookup for staff applications.',
      'app.category': 'Sales',
      'error.leadNotFound': 'CRM record not found.',
    },
  },
})

export { channelRoutes }
