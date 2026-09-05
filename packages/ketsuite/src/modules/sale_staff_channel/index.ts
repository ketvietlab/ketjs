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
  summary:
    'Versioned sales customer, product, draft, confirmation, and cancellation routes for staff clients.',
  category: 'Sales',
  routes: { ...channelRoutes, ...productRoutes, ...orderRoutes },
  messages: {
    vi: {
      'app.title': 'Kênh nhân viên bán hàng',
      'app.summary': 'Tra cứu và xử lý vòng đời đơn bán có phiên bản cho ứng dụng nhân viên.',
      'app.category': 'Bán hàng',
      'error.customerNotFound': 'Không tìm thấy khách hàng.',
      'error.orderNotFound': 'Không tìm thấy đơn bán.',
      'error.productNotFound': 'Không tìm thấy sản phẩm có thể bán.',
      'error.invalidRequest': 'Yêu cầu đơn bán không hợp lệ.',
      'error.invalidField': 'Giá trị trường không hợp lệ.',
      'error.conflict': 'Trạng thái đơn bán không cho phép thao tác này.',
      'error.versionConflict': 'Đơn bán đã thay đổi. Hãy tải lại trước khi tiếp tục.',
      'error.availabilityChanged': 'Tồn kho đã thay đổi. Hãy kiểm tra lại trước khi xác nhận.',
    },
    en: {
      'app.title': 'Sales staff channel',
      'app.summary':
        'Versioned customer, product, draft, confirmation, and cancellation workflows for staff applications.',
      'app.category': 'Sales',
      'error.customerNotFound': 'Customer not found.',
      'error.orderNotFound': 'Sales order not found.',
      'error.productNotFound': 'Sellable product not found.',
      'error.invalidRequest': 'The sales-order request is invalid.',
      'error.invalidField': 'The field value is invalid.',
      'error.conflict': 'The sales-order state does not allow this command.',
      'error.versionConflict': 'The sales order changed. Refresh it before continuing.',
      'error.availabilityChanged': 'Availability changed. Review it before confirming.',
    },
  },
})

export { channelRoutes, orderRoutes, productRoutes }
