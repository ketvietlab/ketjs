/** Shared runtime copy for context responses and the attribute island before its read completes. */
export const ATTRIBUTE_RECORD_MODAL_LABELS: Record<'vi' | 'en', Record<string, string>> = {
  vi: {
    'recordModal.close': 'Đóng',
    'recordModal.loading': 'Đang tải…',
    'recordModal.loadFailed': 'Không đọc được thuộc tính sản phẩm.',
    'recordModal.notFound': 'Thuộc tính không còn tồn tại hoặc bạn không có quyền xem.',
    'recordModal.retry': 'Thử lại',
    'recordModal.errorTitle': 'Chưa lưu được',
    'recordModal.saveFailed': 'Thao tác không thành công. Hãy thử lại.',
    'recordModal.savedTitle': 'Đã lưu',
    'recordModal.saved': 'Thay đổi đã được ghi nhận.',
    'recordModal.unsaved': 'Bỏ các thay đổi chưa lưu?',
    'recordModal.uploadFailed': 'Không tải được tệp lên. Hãy thử lại.',
  },
  en: {
    'recordModal.close': 'Close',
    'recordModal.loading': 'Loading…',
    'recordModal.loadFailed': 'The product attribute could not be read.',
    'recordModal.notFound': 'The attribute is gone or you cannot see it.',
    'recordModal.retry': 'Retry',
    'recordModal.errorTitle': 'Not saved',
    'recordModal.saveFailed': 'That did not work. Try again.',
    'recordModal.savedTitle': 'Saved',
    'recordModal.saved': 'The changes have been saved.',
    'recordModal.unsaved': 'Discard unsaved changes?',
    'recordModal.uploadFailed': 'The file could not be uploaded. Try again.',
  },
}
