import { defineModule } from '@ketvietlab/ketjs'
import { channelRoutes } from './channel-routes.ts'
import { functions } from './functions.ts'
import { models } from './models.ts'

export default defineModule({
  name: 'account_staff_channel',
  version: '0.1.0',
  depends: ['channel_api', 'account', 'partner'],
  compatible: { channel_api: '^1' },
  title: 'Accounting Staff Channel',
  summary: 'Audience-scoped customer-invoice reads and guarded commands for staff clients.',
  category: 'Accounting',
  models,
  functions,
  routes: channelRoutes,
  messages: {
    vi: {
      'app.title': 'Kênh nhân viên kế toán',
      'app.summary': 'Tra cứu và thực hiện lệnh hóa đơn khách hàng cho ứng dụng nhân viên.',
      'app.category': 'Kế toán',
      'error.invoiceNotFound': 'Không tìm thấy hóa đơn khách hàng.',
      'error.commandNotFound': 'Không tìm thấy lệnh kế toán.',
      'error.commandInProgress': 'Lệnh kế toán vẫn đang được xử lý.',
      'error.commandConflict': 'Khóa lệnh đã được dùng cho một yêu cầu khác.',
      'error.invalidRequest': 'Không thể thực hiện lệnh kế toán này.',
      'error.versionConflict': 'Hóa đơn đã thay đổi; hãy tải lại trước khi tiếp tục.',
    },
    en: {
      'app.title': 'Accounting staff channel',
      'app.summary': 'Customer-invoice reads and guarded commands for staff applications.',
      'app.category': 'Accounting',
      'error.invoiceNotFound': 'Customer invoice not found.',
      'error.commandNotFound': 'Accounting command not found.',
      'error.commandInProgress': 'The accounting command is still processing.',
      'error.commandConflict': 'The command key was used for another request.',
      'error.invalidRequest': 'The accounting command cannot be performed.',
      'error.versionConflict': 'The invoice changed; refresh it before continuing.',
    },
  },
})

export { channelRoutes }
