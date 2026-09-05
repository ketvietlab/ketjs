import { defineModule } from '@ketvietlab/ketjs'
import { catalogFunctions, catalogRoutes } from './catalog.ts'
import { operationRoutes } from './operations.ts'
import { syncFunctions, syncModels, syncRoutes } from './sync.ts'

export default defineModule({
  name: 'pos_channel',
  version: '0.1.0',
  depends: ['channel_api', 'pos', 'product', 'uom', 'pricing', 'account'],
  compatible: { channel_api: '^1' },
  title: 'POS Channel API',
  summary: 'Typed POS contracts for catalog, shifts, orders and tenders.',
  category: 'Bán hàng',
  models: syncModels,
  functions: { ...catalogFunctions, ...syncFunctions },
  routes: { ...catalogRoutes, ...operationRoutes, ...syncRoutes },
  messages: {
    vi: {
      'app.title': 'POS Channel API',
      'app.summary': 'Hợp đồng POS cho danh mục, ca, đơn hàng và thanh toán.',
      'error.catalogUnavailable': 'Bảng giá của quầy không khả dụng.',
      'error.catalogCursorInvalid': 'Con trỏ danh mục không hợp lệ.',
      'error.catalogRevisionMismatch': 'Bảng giá đã thay đổi; cần tải lại từ trang đầu.',
      'error.commandConflict': 'Dữ liệu đã thay đổi; hãy tải lại trước khi tiếp tục.',
      'error.commandInvalid': 'Thao tác POS không hợp lệ.',
      'error.invalidField': 'Giá trị không hợp lệ.',
      'error.notFound': 'Không tìm thấy dữ liệu POS trong phạm vi thiết bị này.',
      'error.syncUnavailable': 'Đồng bộ POS chưa khả dụng cho cấu hình hiện tại.',
      'error.syncCommandInvalid': 'Lệnh đồng bộ POS không đúng hợp đồng.',
      'error.syncCommandDuplicate': 'Batch đồng bộ chứa command hoặc sequence trùng.',
      'error.syncCursorInvalid': 'Con trỏ đồng bộ POS không hợp lệ.',
      'error.syncCursorExpired': 'Con trỏ đồng bộ POS đã hết thời hạn lưu giữ.',
      'error.syncLeaseUnavailable': 'Máy chủ chưa cấu hình xác minh quyền offline POS.',
      'error.syncLeaseInvalid': 'Quyền offline hoặc chữ ký lệnh POS không hợp lệ.',
      'error.syncLeaseScope': 'Lệnh nằm ngoài phạm vi hoặc sequence của quyền offline.',
    },
    en: {
      'app.title': 'POS Channel API',
      'app.summary': 'POS contracts for catalog, shifts, orders and tenders.',
      'error.catalogUnavailable': 'The register price book is unavailable.',
      'error.catalogCursorInvalid': 'The catalog cursor is invalid.',
      'error.catalogRevisionMismatch': 'The price book changed; reload it from the first page.',
      'error.commandConflict': 'The record changed; reload it before continuing.',
      'error.commandInvalid': 'The POS command is invalid.',
      'error.invalidField': 'The value is invalid.',
      'error.notFound': 'The POS record is not available to this device.',
      'error.syncUnavailable': 'POS sync is unavailable for the current configuration.',
      'error.syncCommandInvalid': 'The POS sync command does not match the contract.',
      'error.syncCommandDuplicate': 'The sync batch contains a duplicate command or sequence.',
      'error.syncCursorInvalid': 'The POS sync cursor is invalid.',
      'error.syncCursorExpired': 'The POS sync cursor is outside the retention window.',
      'error.syncLeaseUnavailable': 'The server has no POS offline lease verifier configured.',
      'error.syncLeaseInvalid': 'The POS offline lease or command signature is invalid.',
      'error.syncLeaseScope': 'The command is outside the offline lease scope or sequence window.',
    },
  },
})

export { catalogFunctions, catalogRoutes } from './catalog.ts'
export { operationRoutes } from './operations.ts'
export { OFFLINE_OPERATIONS, syncFunctions, syncModels, syncRoutes } from './sync.ts'
export {
  posOfflineCommandDigest,
  registerPosOfflineLeaseProvider,
  type PosOfflineCommandEvidence,
  type PosOfflineLease,
  type PosOfflineLeaseClaims,
  type PosOfflineLeaseProvider,
} from './offline.ts'
