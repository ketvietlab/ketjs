import { defineModule } from '@ketvietlab/ketjs'
import { catalogFunctions, catalogRoutes } from './catalog.ts'

export default defineModule({
  name: 'pos_channel',
  version: '0.1.0',
  depends: ['channel_api', 'pos', 'product', 'uom', 'pricing'],
  compatible: { channel_api: '^1' },
  title: 'POS Channel API',
  summary: 'Typed POS contracts for catalog, shifts, orders and tenders.',
  category: 'Bán hàng',
  functions: catalogFunctions,
  routes: catalogRoutes,
  messages: {
    vi: {
      'app.title': 'POS Channel API',
      'app.summary': 'Hợp đồng POS cho danh mục, ca, đơn hàng và thanh toán.',
      'error.catalogUnavailable': 'Bảng giá của quầy không khả dụng.',
      'error.catalogCursorInvalid': 'Con trỏ danh mục không hợp lệ.',
      'error.catalogRevisionMismatch': 'Bảng giá đã thay đổi; cần tải lại từ trang đầu.',
    },
    en: {
      'app.title': 'POS Channel API',
      'app.summary': 'POS contracts for catalog, shifts, orders and tenders.',
      'error.catalogUnavailable': 'The register price book is unavailable.',
      'error.catalogCursorInvalid': 'The catalog cursor is invalid.',
      'error.catalogRevisionMismatch': 'The price book changed; reload it from the first page.',
    },
  },
})

export { catalogFunctions, catalogRoutes } from './catalog.ts'
