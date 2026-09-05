import { defineModule } from '@ketvietlab/ketjs'
import { channelRoutes } from './channel-routes.ts'

export default defineModule({
  name: 'hospitality_staff_channel',
  version: '0.1.0',
  depends: ['channel_api', 'hospitality_core', 'hospitality_billing', 'account', 'partner', 'user'],
  compatible: { channel_api: '^1' },
  title: 'Hospitality Staff Channel',
  summary: 'Front-desk, stay, folio and housekeeping operations for staff clients.',
  category: 'Hospitality',
  routes: channelRoutes,
  messages: {
    vi: {
      'app.title': 'Kênh nhân viên lưu trú',
      'app.summary': 'Vận hành lễ tân, lưu trú, folio và buồng phòng cho ứng dụng nhân viên.',
      'app.category': 'Lưu trú',
      'error.notFound': 'Không tìm thấy hồ sơ lưu trú.',
      'error.invalidRequest': 'Yêu cầu vận hành lưu trú không hợp lệ.',
      'error.versionConflict': 'Hồ sơ đã thay đổi. Hãy tải lại trước khi tiếp tục.',
      'error.unsupportedOperation': 'Nghiệp vụ này chưa có domain implementation an toàn.',
    },
    en: {
      'app.title': 'Hospitality staff channel',
      'app.summary': 'Front-desk, stay, folio and housekeeping operations for staff applications.',
      'app.category': 'Hospitality',
      'error.notFound': 'The hospitality record was not found.',
      'error.invalidRequest': 'The hospitality operation request is invalid.',
      'error.versionConflict': 'The record changed. Refresh it before continuing.',
      'error.unsupportedOperation': 'This operation does not yet have a safe domain implementation.',
    },
  },
})

export { channelRoutes }
