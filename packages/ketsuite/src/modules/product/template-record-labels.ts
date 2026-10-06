/** Shared runtime copy for template context responses and the template page before its read completes. */
export const TEMPLATE_RECORD_LABELS: Record<'vi' | 'en', Record<string, string>> = {
  vi: {
    'recordModal.close': 'Về danh sách',
    'recordModal.loading': 'Đang tải…',
    'recordModal.loadFailed': 'Không đọc được sản phẩm.',
    'recordModal.notFound': 'Sản phẩm không còn tồn tại hoặc bạn không có quyền xem.',
    'recordModal.retry': 'Thử lại',
    'recordModal.errorTitle': 'Chưa lưu được',
    'recordModal.saveFailed': 'Thao tác không thành công. Hãy thử lại.',
    'recordModal.savedTitle': 'Đã lưu',
    'recordModal.saved': 'Thay đổi đã được ghi nhận.',
    'recordModal.unsaved': 'Bỏ các thay đổi chưa lưu?',
    'recordModal.uploadFailed': 'Không tải được tệp lên. Hãy thử lại.',
  },
  en: {
    'recordModal.close': 'Back to list',
    'recordModal.loading': 'Loading…',
    'recordModal.loadFailed': 'The product could not be read.',
    'recordModal.notFound': 'The product is gone or you cannot see it.',
    'recordModal.retry': 'Retry',
    'recordModal.errorTitle': 'Not saved',
    'recordModal.saveFailed': 'That did not work. Try again.',
    'recordModal.savedTitle': 'Saved',
    'recordModal.saved': 'The changes have been saved.',
    'recordModal.unsaved': 'Discard unsaved changes?',
    'recordModal.uploadFailed': 'The file could not be uploaded. Try again.',
  },
}
