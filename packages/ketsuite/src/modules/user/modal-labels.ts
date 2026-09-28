/** Runtime copy for the user, role and access-policy modals, also used before their read completes. */
export const USER_RECORD_MODAL_LABELS: Record<'vi' | 'en', Record<string, string>> = {
  vi: {
    'recordModal.close': 'Đóng',
    'recordModal.loading': 'Đang tải…',
    'recordModal.loadFailed': 'Không đọc được dữ liệu. Hãy thử lại.',
    'recordModal.notFound': 'Mục này không còn tồn tại hoặc bạn không có quyền xem.',
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
    'recordModal.loadFailed': 'The record could not be read. Try again.',
    'recordModal.notFound': 'The record is gone or you cannot see it.',
    'recordModal.retry': 'Retry',
    'recordModal.errorTitle': 'Not saved',
    'recordModal.saveFailed': 'That did not work. Try again.',
    'recordModal.savedTitle': 'Saved',
    'recordModal.saved': 'The changes have been saved.',
    'recordModal.unsaved': 'Discard unsaved changes?',
    'recordModal.uploadFailed': 'The file could not be uploaded. Try again.',
  },
}
