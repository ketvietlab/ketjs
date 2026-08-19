import type { Message } from 'ketjs'

/**
 * Every string the backend shows. Keys are prefixed with the module name by the
 * composer, so these become `backend.nav.apps` and so on.
 *
 * Vietnamese is the source language: it is what the team writes and reviews. The
 * English is a real translation, not a placeholder, because a second locale that
 * is fake proves nothing about whether the layout survives one.
 */
export const messages: Record<string, Record<string, Message>> = {
  vi: {
    'signOut': 'Đăng xuất',
    'app.title': 'Quản trị',
    'app.summary': 'Màn hình quản lý ứng dụng, trang và cài đặt.',
    'app.category': 'Hệ thống',

    'nav.apps': 'Ứng dụng',
    'nav.search': 'Tìm ứng dụng, menu…',
    'nav.noMatch': 'Không có ứng dụng hoặc menu nào khớp.',
    'nav.pages': 'Trang',
    'nav.settings': 'Cài đặt',
    'brand': 'KetSuite',

    'table.columns': 'Chọn cột',
    'table.id': 'Mã',

    'chrome.breadcrumb': 'Đường dẫn',
    'chrome.removeFilter': 'Bỏ bộ lọc',
    'chrome.previous': 'Trang trước',
    'chrome.next': 'Trang sau',
    'chrome.views': 'Kiểu xem',
    'chrome.view.list': 'Danh sách',
    'chrome.view.kanban': 'Thẻ',
    'chrome.searchFacet': 'Tìm',
    'chrome.searchPages': 'Tìm trang…',

    'menu.admin': 'Quản trị',
    'menu.apps': 'Ứng dụng',
    'menu.content': 'Nội dung',
    'menu.pages': 'Trang',
    'menu.config': 'Cấu hình',
    'menu.settings': 'Cài đặt',

    'apps.title': 'Ứng dụng',
    'apps.depends': 'Phụ thuộc',
    'apps.dependents': 'Đang được dùng bởi',
    'apps.install': 'Cài đặt',
    'apps.uninstall': 'Gỡ',
    'apps.none': '—',
    'apps.empty.message': 'Bản triển khai này chưa có ứng dụng nào.',
    'apps.empty.hint': 'Ứng dụng phải được đưa vào lúc build trước khi cài được.',

    'pages.title': 'Trang',
    'pages.col.path': 'Đường dẫn',
    'pages.col.title': 'Tiêu đề',
    'pages.col.state': 'Trạng thái',
    'pages.published': 'Đã đăng',
    'pages.draft': 'Nháp',
    'pages.empty.message': 'Chưa có trang nào.',
    'pages.empty.hint': 'Tạo trang đầu tiên để bắt đầu.',
    'pages.count': { one: '{count} trang', other: '{count} trang' },

    'settings.title': 'Cài đặt',
    'settings.tokens': 'Design token đang áp dụng',
  },
  en: {
    'signOut': 'Sign out',
    'app.title': 'Administration',
    'app.summary': 'Manage apps, pages and settings.',
    'app.category': 'System',

    'nav.apps': 'Apps',
    'nav.search': 'Search apps and menus…',
    'nav.noMatch': 'No app or menu matches.',
    'nav.pages': 'Pages',
    'nav.settings': 'Settings',
    'brand': 'KetSuite',

    'table.columns': 'Columns',
    'table.id': 'Id',

    'chrome.breadcrumb': 'Breadcrumb',
    'chrome.removeFilter': 'Remove filter',
    'chrome.previous': 'Previous page',
    'chrome.next': 'Next page',
    'chrome.views': 'Views',
    'chrome.view.list': 'List',
    'chrome.view.kanban': 'Cards',
    'chrome.searchFacet': 'Search',
    'chrome.searchPages': 'Search pages…',

    'menu.admin': 'Administration',
    'menu.apps': 'Apps',
    'menu.content': 'Content',
    'menu.pages': 'Pages',
    'menu.config': 'Configuration',
    'menu.settings': 'Settings',

    'apps.title': 'Apps',
    'apps.depends': 'Requires',
    'apps.dependents': 'Required by',
    'apps.install': 'Install',
    'apps.uninstall': 'Remove',
    'apps.none': '—',
    'apps.empty.message': 'This deployment ships no apps.',
    'apps.empty.hint': 'An app has to be built in before it can be installed.',

    'pages.title': 'Pages',
    'pages.col.path': 'Path',
    'pages.col.title': 'Title',
    'pages.col.state': 'Status',
    'pages.published': 'Published',
    'pages.draft': 'Draft',
    'pages.empty.message': 'No pages yet.',
    'pages.empty.hint': 'Create your first page to get started.',
    'pages.count': { one: '{count} page', other: '{count} pages' },

    'settings.title': 'Settings',
    'settings.tokens': 'Design tokens in effect',
  },
}
