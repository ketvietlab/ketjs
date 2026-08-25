import { defineModule } from '@ketvietlab/ketjs'
import { channelRoutes } from './channel-routes.ts'

export default defineModule({
  name: 'account_staff_channel',
  version: '0.1.0',
  depends: ['channel_api', 'account', 'partner'],
  compatible: { channel_api: '^1' },
  title: 'Accounting Staff Channel',
  summary: 'Audience-scoped customer-invoice reads for staff clients.',
  category: 'Accounting',
  routes: channelRoutes,
  messages: {
    vi: {
      'app.title': 'Kênh nhân viên kế toán',
      'app.summary': 'Tra cứu hóa đơn khách hàng cho ứng dụng nhân viên.',
      'app.category': 'Kế toán',
      'error.invoiceNotFound': 'Không tìm thấy hóa đơn khách hàng.',
    },
    en: {
      'app.title': 'Accounting staff channel',
      'app.summary': 'Customer-invoice reads for staff applications.',
      'app.category': 'Accounting',
      'error.invoiceNotFound': 'Customer invoice not found.',
    },
  },
})

export { channelRoutes }
