import { defineModule } from '@ketvietlab/ketjs'
import { channelRoutes } from './channel-routes.ts'

export default defineModule({
  name: 'flow_staff_channel',
  version: '0.1.0',
  depends: ['channel_api', 'flow'],
  compatible: { channel_api: '^1' },
  title: 'Flow Staff Channel',
  summary: 'Membership-scoped project work reads and commands for staff clients.',
  category: 'Productivity',
  routes: channelRoutes,
  messages: {
    vi: {
      'app.title': 'Kênh nhân viên Flow',
      'app.summary': 'Đọc và thao tác công việc dự án có kiểm soát cho ứng dụng nhân viên.',
      'app.category': 'Năng suất',
      'error.issueNotFound': 'Không tìm thấy công việc.',
      'error.invalidRequest': 'Không thể thực hiện thao tác này.',
    },
    en: {
      'app.title': 'Flow staff channel',
      'app.summary': 'Controlled project-work reads and commands for staff applications.',
      'app.category': 'Productivity',
      'error.issueNotFound': 'The issue was not found.',
      'error.invalidRequest': 'The command cannot be performed.',
    },
  },
})

export { channelRoutes }
