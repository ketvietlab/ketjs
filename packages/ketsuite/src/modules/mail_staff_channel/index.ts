import { defineModule } from '@ketvietlab/ketjs'
import { channelRoutes } from './channel-routes.ts'

export default defineModule({
  name: 'mail_staff_channel',
  version: '0.1.0',
  depends: ['channel_api', 'mail'],
  compatible: { channel_api: '^1' },
  title: 'Notification Staff Channel',
  summary: 'Actor-owned notification inbox reads and read markers for staff clients.',
  category: 'Productivity',
  routes: channelRoutes,
  messages: {
    vi: {
      'app.title': 'Kênh thông báo nhân viên',
      'app.summary': 'Đọc và đánh dấu hộp thư thông báo của nhân viên hiện tại.',
      'app.category': 'Năng suất',
      'error.notificationNotFound': 'Không tìm thấy thông báo.',
    },
    en: {
      'app.title': 'Staff notifications',
      'app.summary': 'Read and mark the signed-in staff member’s notification inbox.',
      'app.category': 'Productivity',
      'error.notificationNotFound': 'Notification not found.',
    },
  },
})

export { channelRoutes }
