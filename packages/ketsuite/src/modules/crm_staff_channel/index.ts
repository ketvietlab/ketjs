import { defineModule } from '@ketvietlab/ketjs'
import { channelRoutes } from './channel-routes.ts'

export default defineModule({
  name: 'crm_staff_channel',
  version: '0.1.0',
  depends: ['channel_api', 'crm', 'activity'],
  compatible: { channel_api: '^1' },
  title: 'CRM Staff Channel',
  summary: 'Audience-scoped CRM pipeline reads and commands for staff clients.',
  category: 'Sales',
  routes: channelRoutes,
  messages: {
    vi: {
      'app.title': 'Kênh nhân viên CRM',
      'app.summary': 'Tra cứu và thao tác pipeline CRM có kiểm soát cho ứng dụng nhân viên.',
      'app.category': 'Bán hàng',
      'error.leadNotFound': 'Không tìm thấy hồ sơ CRM.',
      'error.invalidRequest': 'Không thể thực hiện thao tác CRM này.',
    },
    en: {
      'app.title': 'CRM staff channel',
      'app.summary': 'Controlled CRM pipeline reads and commands for staff applications.',
      'app.category': 'Sales',
      'error.leadNotFound': 'CRM record not found.',
      'error.invalidRequest': 'The CRM command cannot be performed.',
    },
  },
})

export { channelRoutes }
