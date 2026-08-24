import { defineModule } from '@ketvietlab/ketjs'
import { channelRoutes } from './channel-routes.ts'
import { orderRoutes } from './order-routes.ts'

export default defineModule({
  name: 'sale_staff_channel',
  version: '0.1.0',
  depends: ['channel_api', 'sale', 'partner'],
  compatible: { channel_api: '^1' },
  title: 'Sales Staff Channel',
  summary: 'Read-only sales customer and order routes for staff clients.',
  category: 'Sales',
  routes: { ...channelRoutes, ...orderRoutes },
  messages: {
    vi: {
      'app.title': 'Kênh nhân viên bán hàng',
      'app.summary': 'Tra cứu khách hàng và đơn bán chỉ đọc cho ứng dụng nhân viên.',
      'app.category': 'Bán hàng',
      'error.customerNotFound': 'Không tìm thấy khách hàng.',
      'error.orderNotFound': 'Không tìm thấy đơn bán.',
    },
    en: {
      'app.title': 'Sales staff channel',
      'app.summary': 'Read-only customer and sales-order lookup for staff applications.',
      'app.category': 'Sales',
      'error.customerNotFound': 'Customer not found.',
      'error.orderNotFound': 'Sales order not found.',
    },
  },
})

export { channelRoutes, orderRoutes }
