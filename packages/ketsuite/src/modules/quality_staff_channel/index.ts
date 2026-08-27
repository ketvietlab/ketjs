import { defineModule } from '@ketvietlab/ketjs'
import { channelRoutes } from './channel-routes.ts'

export default defineModule({
  name: 'quality_staff_channel',
  version: '0.1.0',
  depends: ['channel_api', 'quality'],
  compatible: { channel_api: '^1' },
  title: 'Quality Staff Channel',
  summary: 'Versioned quality inspection reads, photo evidence and submissions for staff clients.',
  category: 'Inventory',
  routes: channelRoutes,
  messages: {
    vi: {
      'app.title': 'Kênh nhân viên chất lượng',
      'app.summary': 'Kiểm tra, ảnh bằng chứng và kết quả chất lượng cho ứng dụng nhân viên.',
      'error.notFound': 'Không tìm thấy yêu cầu kiểm tra chất lượng.',
      'error.versionConflict': 'Yêu cầu kiểm tra đã thay đổi. Vui lòng tải lại.',
      'error.invalidRequest': 'Dữ liệu kiểm tra chất lượng không hợp lệ.',
    },
    en: {
      'app.title': 'Quality staff channel',
      'app.summary': 'Quality checks, photo evidence and decisions for staff applications.',
      'error.notFound': 'Quality requirement not found.',
      'error.versionConflict': 'The quality requirement changed. Refresh it before continuing.',
      'error.invalidRequest': 'The quality inspection request is invalid.',
    },
  },
})

export { channelRoutes }
