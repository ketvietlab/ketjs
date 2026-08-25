import { defineModule } from '@ketvietlab/ketjs'
import { channelRoutes } from './channel-routes.ts'
import { orderRoutes } from './order-routes.ts'
import { productRoutes } from './product-routes.ts'

export default defineModule({
  name: 'sale_staff_channel',
  version: '0.1.0',
  depends: ['channel_api', 'sale', 'partner', 'product', 'stock', 'uom'],
  compatible: { channel_api: '^1' },
  title: 'Sales Staff Channel',
  summary: 'Read-only sales customer, product, and order routes for staff clients.',
  category: 'Sales',
  routes: { ...channelRoutes, ...productRoutes, ...orderRoutes },
  messages: {
    vi: {
      'app.title': 'Kênh nhân viên bán hàng',
      'app.summary': 'Tra cứu khách hàng, sản phẩm và đơn bán chỉ đọc cho ứng dụng nhân viên.',
      'app.category': 'Bán hàng',
      'error.customerNotFound': 'Không tìm thấy khách hàng.',
      'error.orderNotFound': 'Không tìm thấy đơn bán.',
      'error.productNotFound': 'Không tìm thấy sản phẩm có thể bán.',
    },
    en: {
      'app.title': 'Sales staff channel',
      'app.summary': 'Read-only customer, product, and sales-order lookup for staff applications.',
      'app.category': 'Sales',
      'error.customerNotFound': 'Customer not found.',
      'error.orderNotFound': 'Sales order not found.',
      'error.productNotFound': 'Sellable product not found.',
    },
  },
})

export { channelRoutes, orderRoutes, productRoutes }
