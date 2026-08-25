import { defineModule } from '@ketvietlab/ketjs'
import { channelRoutes } from './channel-routes.ts'

export default defineModule({
  name: 'inventory_staff_channel',
  version: '0.1.0',
  depends: ['channel_api', 'company', 'product', 'product_media', 'stock', 'uom'],
  compatible: { channel_api: '^1' },
  title: 'Inventory Staff Channel',
  summary: 'Versioned inventory catalogue, lifecycle and stock-count operations for staff clients.',
  category: 'Inventory',
  routes: channelRoutes,
  messages: {
    vi: {
      'app.title': 'Kênh nhân viên tồn kho',
      'app.summary': 'Quản lý hàng hóa, vòng đời và điều chỉnh tồn kho cho ứng dụng nhân viên.',
      'app.category': 'Kho vận',
      'error.productNotFound': 'Không tìm thấy hàng hóa.',
      'error.versionConflict': 'Hàng hóa đã thay đổi. Vui lòng tải lại trước khi tiếp tục.',
      'error.stockVersionConflict': 'Vị trí tồn kho đã thay đổi. Vui lòng tải lại số lượng.',
      'error.conflict': 'Không thể áp dụng thao tác vì dữ liệu hoặc trạng thái đã thay đổi.',
      'error.invalidRequest': 'Dữ liệu quản lý hàng hóa không hợp lệ.',
      'error.invalidField': 'Giá trị trường không hợp lệ.',
    },
    en: {
      'app.title': 'Inventory staff channel',
      'app.summary': 'Versioned inventory catalogue, lifecycle and stock adjustments for staff applications.',
      'app.category': 'Inventory',
      'error.productNotFound': 'Inventory product not found.',
      'error.versionConflict': 'The inventory product changed. Refresh it before continuing.',
      'error.stockVersionConflict': 'The stock position changed. Refresh its quantity before continuing.',
      'error.conflict': 'The operation conflicts with the current data or lifecycle state.',
      'error.invalidRequest': 'The inventory management request is invalid.',
      'error.invalidField': 'The field value is invalid.',
    },
  },
})

export { channelRoutes }
