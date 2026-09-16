/**
 * Labels the KetSuite record-modal runtime shows for the CRM configuration modals.
 *
 * Shared by the context reads, which ship them in `messages`, and the client
 * islands, which need them before a read answers: a loading modal otherwise has
 * no words in the reader's language.
 */
export const CRM_RECORD_MODAL_LABELS: Record<'vi' | 'en', Record<string, string>> = {
  vi: {
    'recordModal.close': 'Đóng',
    'recordModal.loading': 'Đang tải…',
    'recordModal.loadFailed': 'Không đọc được mục cấu hình.',
    'recordModal.notFound': 'Mục cấu hình không còn tồn tại hoặc bạn không có quyền xem.',
    'recordModal.retry': 'Thử lại',
    'recordModal.errorTitle': 'Chưa lưu được',
    'recordModal.saveFailed': 'Thao tác không thành công. Hãy thử lại.',
    'recordModal.savedTitle': 'Đã lưu',
    'recordModal.saved': 'Thay đổi đã được ghi nhận.',
    'recordModal.unsaved': 'Bỏ nội dung vừa nhập?',
    'recordModal.uploadFailed': 'Không tải được tệp lên. Hãy thử lại.',
  },
  en: {
    'recordModal.close': 'Close',
    'recordModal.loading': 'Loading…',
    'recordModal.loadFailed': 'The configuration entry could not be read.',
    'recordModal.notFound': 'The configuration entry is gone or you cannot see it.',
    'recordModal.retry': 'Retry',
    'recordModal.errorTitle': 'Not saved',
    'recordModal.saveFailed': 'That did not work. Try again.',
    'recordModal.savedTitle': 'Saved',
    'recordModal.saved': 'The change is in.',
    'recordModal.unsaved': 'Discard what you typed?',
    'recordModal.uploadFailed': 'The file could not be uploaded. Try again.',
  },
}
