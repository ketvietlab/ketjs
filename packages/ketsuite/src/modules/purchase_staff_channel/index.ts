import { defineModule } from '@ketvietlab/ketjs'
import { channelRoutes } from './channel-routes.ts'
import { orderRoutes } from './order-routes.ts'
import { productRoutes } from './product-routes.ts'
import { vendorBillRoutes } from './vendor-bill-routes.ts'

export default defineModule({
  name: 'purchase_staff_channel',
  version: '0.1.0',
  depends: ['channel_api', 'purchase', 'partner', 'account', 'product', 'stock', 'uom'],
  compatible: { channel_api: '^1' },
  title: 'Purchasing Staff Channel',
  summary:
    'Versioned purchasing directories, RFQs, approvals, cancellation, and safe receipt for staff clients.',
  category: 'Purchasing',
  routes: { ...channelRoutes, ...productRoutes, ...orderRoutes, ...vendorBillRoutes },
  messages: {
    vi: {
      'app.title': 'Kênh nhân viên mua hàng',
      'app.summary': 'Tra cứu và xử lý vòng đời đơn mua có phiên bản cho ứng dụng nhân viên.',
      'app.category': 'Mua hàng',
      'error.vendorNotFound': 'Không tìm thấy nhà cung cấp.',
      'error.orderNotFound': 'Không tìm thấy đơn mua.',
      'error.vendorBillNotFound': 'Không tìm thấy hóa đơn nhà cung cấp.',
      'error.productNotFound': 'Không tìm thấy sản phẩm có thể mua.',
      'error.invalidRequest': 'Yêu cầu đơn mua không hợp lệ.',
      'error.invalidField': 'Giá trị trường không hợp lệ.',
      'error.conflict': 'Trạng thái đơn mua không cho phép thao tác này.',
      'error.versionConflict': 'Đơn mua đã thay đổi. Hãy tải lại trước khi tiếp tục.',
    },
    en: {
      'app.title': 'Purchasing staff channel',
      'app.summary':
        'Versioned vendor, RFQ, approval, cancellation, and receipt workflows for staff applications.',
      'app.category': 'Purchasing',
      'error.vendorNotFound': 'Vendor not found.',
      'error.orderNotFound': 'Purchase order not found.',
      'error.vendorBillNotFound': 'Vendor bill not found.',
      'error.productNotFound': 'Purchasable product not found.',
      'error.invalidRequest': 'The purchase-order request is invalid.',
      'error.invalidField': 'The field value is invalid.',
      'error.conflict': 'The purchase-order state does not allow this command.',
      'error.versionConflict': 'The purchase order changed. Refresh it before continuing.',
    },
  },
})

export { channelRoutes, orderRoutes, productRoutes, vendorBillRoutes }
