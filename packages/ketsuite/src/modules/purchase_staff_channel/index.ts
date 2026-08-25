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
  summary: 'Read-only purchasing vendor, product, order, and vendor-bill routes for staff clients.',
  category: 'Purchasing',
  routes: { ...channelRoutes, ...productRoutes, ...orderRoutes, ...vendorBillRoutes },
  messages: {
    vi: {
      'app.title': 'Kênh nhân viên mua hàng',
      'app.summary': 'Tra cứu nhà cung cấp, đơn mua và hóa đơn chỉ đọc cho ứng dụng nhân viên.',
      'app.category': 'Mua hàng',
      'error.vendorNotFound': 'Không tìm thấy nhà cung cấp.',
      'error.orderNotFound': 'Không tìm thấy đơn mua.',
      'error.vendorBillNotFound': 'Không tìm thấy hóa đơn nhà cung cấp.',
      'error.productNotFound': 'Không tìm thấy sản phẩm có thể mua.',
    },
    en: {
      'app.title': 'Purchasing staff channel',
      'app.summary': 'Read-only vendor, purchase-order, and vendor-bill lookup for staff applications.',
      'app.category': 'Purchasing',
      'error.vendorNotFound': 'Vendor not found.',
      'error.orderNotFound': 'Purchase order not found.',
      'error.vendorBillNotFound': 'Vendor bill not found.',
      'error.productNotFound': 'Purchasable product not found.',
    },
  },
})

export { channelRoutes, orderRoutes, productRoutes, vendorBillRoutes }
