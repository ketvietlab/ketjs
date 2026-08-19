import { html, each } from 'ketjs-view'
import type { TemplateResult } from 'ketjs-view'
import { appsScreen, pagesScreen, settingsScreen, emptyState, errorState } from './screens.ts'
import type { AppRow, PageRow, Viewer } from './screens.ts'
import { loginScreen } from '../user/login.ts'
import { person } from './table.ts'
import type { ListChrome } from './screens.ts'
import type { MenuNode, Translator } from 'ketjs'

/**
 * Every screen in every state, on one page.
 *
 * A design that only covers the happy path is a design that will be finished twice.
 * These are the states the real screens actually produce — empty, full, long, error,
 * and the awkward ones like an app that cannot be removed because something depends
 * on it. If a state is missing here, say so and it will be added rather than
 * discovered later.
 */

const app = (over: Partial<AppRow> = {}): AppRow => ({
  name: 'website', title: 'Website', summary: 'Trang, section và điều hướng.',
  category: 'Website', state: 'available', depends: [], dependents: [], ...over,
})

const page = (over: Partial<PageRow> = {}): PageRow =>
  ({ id: 'p1', path: '/', title: 'Trang chủ', published: true, ...over })

const viewer = (over: Partial<Viewer> = {}): Viewer =>
  ({ name: 'Nguyễn Quản Trị', company: 'acme', companies: ['acme'], ...over })

/**
 * A sidebar with something in it. The screens take the tree as data, so the
 * catalogue can show the real chrome with no server, no database and no session —
 * which is the whole point of the screens being pure functions.
 */
const node = (id: string, label: string, over: Partial<MenuNode> = {}): MenuNode =>
  ({ id, label, path: null, icon: null, active: false, children: [], ...over })

const MENU: MenuNode[] = [
  node('sales', 'Bán hàng', { icon: 'shopping-cart', children: [
    node('sales.orders', 'Đơn hàng', { children: [
      node('sales.quotes', 'Báo giá', { path: '/quotes' }),
      node('sales.list', 'Đơn hàng', { path: '/orders' }),
    ] }),
  ] }),
  node('product', 'Sản phẩm', { icon: 'package', children: [
    node('product.catalogue', 'Danh mục', { children: [node('product.templates', 'Mẫu sản phẩm', { path: '/admin/products' })] }),
  ] }),
  node('admin', 'Quản trị', { icon: 'settings', active: true, children: [
    node('admin.apps', 'Ứng dụng', { path: '/admin', active: true }),
    node('admin.content', 'Nội dung', { children: [node('admin.pages', 'Trang', { path: '/admin/pages' })] }),
    node('admin.config', 'Cấu hình', { children: [node('admin.settings', 'Cài đặt', { path: '/admin/settings' })] }),
  ] }),
]

/** A bar with every control on, so the design team sees the crowded case. */
const CHROME: ListChrome = {
  search: { name: 'q', value: 'gioi', placeholder: 'Tìm trang…', facets: [{ label: 'Tìm: gioi', without: '/admin/pages' }] },
  pager: { from: 1, to: 30, total: 84, prev: null, next: '/admin/pages?page=2' },
  views: [
    { id: 'list', label: 'Danh sách', icon: 'list', path: '?view=list', active: true },
    { id: 'kanban', label: 'Thẻ', icon: 'layout-grid', path: '?view=kanban', active: false },
  ],
}

/**
 * Counters at the foot of the sidebar. No live screen sets these yet — nothing in
 * the product has a queue to count — so this is where the design for them lives
 * until something does.
 */
const INDICATORS = [
  { id: 'activity', icon: 'bell', label: 'Việc cần làm', count: 3, path: '/admin/activities' },
  { id: 'message', icon: 'mail', label: 'Thông báo', count: 12, path: '/admin/messages' },
]

export const CASES: Array<{ id: string; label: string; note: string; render: (t: Translator) => TemplateResult }> = [
  {
    id: 'login', label: 'Đăng nhập — trống', note: 'Trang đầu tiên ai cũng thấy, và là trang duy nhất chạy không cần JavaScript. Chưa có CSS.',
    render: (_) => loginScreen(_, { locales: ['vi', 'en'], locale: 'vi' }),
  },
  {
    id: 'login-failed', label: 'Đăng nhập — sai mật khẩu', note: 'Thông báo lỗi có role="alert". Sai mật khẩu và sai tên đăng nhập cho cùng một câu — đừng tách ra.',
    render: (_) => loginScreen(_, { failed: true, locales: ['vi', 'en'], locale: 'vi' }),
  },
  {
    id: 'login-next', label: 'Đăng nhập — quay lại nơi đang tới', note: 'Có ô ẩn "next". Vào /admin/pages khi chưa đăng nhập thì sau khi vào phải quay lại đúng đó.',
    render: (_) => loginScreen(_, { next: '/admin/pages', locales: ['vi', 'en'], locale: 'vi' }),
  },
  {
    id: 'viewer-one', label: 'Thanh trên — một công ty', note: 'Chỉ tên và nút đăng xuất. Tên công ty cố tình ẩn khi tài khoản chỉ thuộc một.',
    render: (_) => appsScreen(_, [app({ state: 'installed' })], { viewer: viewer(), menu: MENU, indicators: INDICATORS }),
  },
  {
    id: 'viewer-many', label: 'Thanh trên — nhiều công ty', note: 'Có tên công ty đang chọn. Chưa có cách đổi công ty — chỗ này sẽ cần một điều khiển.',
    render: (_) => appsScreen(_, [app({ state: 'installed' })], { viewer: viewer({ companies: ['acme', 'globex', 'initech'] }), menu: MENU }),
  },
  {
    id: 'viewer-long', label: 'Thanh trên — tên dài', note: 'Kiểm tra thanh trên không vỡ khi tên người và tên công ty đều dài.',
    render: (_) => appsScreen(_, [app({ state: 'installed' })],
      { viewer: viewer({ name: 'Nguyễn Thị Hoàng Yến Vy Khánh Linh', company: 'cong-ty-co-phan-thuong-mai-dich-vu', companies: ['a', 'b'] }), menu: MENU }),
  },
  {
    id: 'apps-typical', label: 'Ứng dụng — thường gặp', note: 'Hai nhóm, có cái đã cài có cái chưa.',
    render: (_) => appsScreen(_, [
      app({ name: 'website', state: 'installed' }),
      app({ name: 'website_menu', title: 'Menu điều hướng', summary: 'Thanh menu cho website.', depends: ['website'] }),
      app({ name: 'website_seo', title: 'SEO', summary: 'Thẻ mô tả và canonical.', state: 'installed', depends: ['website'] }),
      app({ name: 'theme_paper', title: 'Theme Paper', summary: 'Giao diện mặc định.', category: 'Giao diện', state: 'installed' }),
    ], { menu: MENU }),
  },
  {
    id: 'apps-blocked', label: 'Ứng dụng — không gỡ được', note: 'Nút Gỡ bị vô hiệu vì app khác đang phụ thuộc. Cần cho người dùng hiểu vì sao.',
    render: (_) => appsScreen(_, [app({ state: 'installed', dependents: ['website_menu', 'website_seo'] })], { menu: MENU }),
  },
  {
    id: 'apps-long', label: 'Ứng dụng — danh sách dài', note: 'Kiểm tra lưới khi có nhiều thẻ và tên dài.',
    render: (_) => appsScreen(_, Array.from({ length: 14 }, (_, i) => app({
      name: `app_${i}`, title: i % 4 === 0 ? `Ứng dụng có tên rất dài số ${i}` : `Ứng dụng ${i}`,
      summary: i % 3 === 0 ? 'Mô tả dài hơn bình thường để xem thẻ có bị vỡ hay không khi chữ tràn sang dòng thứ hai.' : 'Mô tả ngắn.',
      category: i % 2 ? 'Website' : 'Thương mại', state: i % 3 === 0 ? 'installed' : 'available',
    })), { menu: MENU }),
  },
  { id: 'apps-empty', label: 'Ứng dụng — trống', note: 'Bản triển khai chưa build app nào vào.', render: (_) => appsScreen(_, [], { menu: MENU }) },
  {
    id: 'pages-typical', label: 'Trang — thường gặp', note: 'Có bản nháp lẫn bản đã đăng.',
    render: (_) => pagesScreen(_, [
      page(), page({ id: 'p2', path: '/gioi-thieu', title: 'Giới thiệu', published: false }),
      page({ id: 'p3', path: '/lien-he', title: 'Liên hệ' }),
    ], { menu: MENU, chrome: CHROME }),
  },
  {
    id: 'pages-long', label: 'Trang — danh sách dài', note: 'Đường dẫn dài, tiêu đề dài, 40 dòng.',
    render: (_) => pagesScreen(_, Array.from({ length: 40 }, (_, i) => page({
      id: `p${i}`, path: i % 5 === 0 ? `/danh-muc/con-rat-sau/duong-dan-dai-${i}` : `/trang-${i}`,
      title: i % 4 === 0 ? `Tiêu đề dài bất thường dùng để kiểm tra tràn dòng số ${i}` : `Trang ${i}`,
      published: i % 3 !== 0,
    })), { menu: MENU }),
  },
  { id: 'pages-empty', label: 'Trang — trống', note: 'Chưa có trang nào.', render: (_) => pagesScreen(_, [], { menu: MENU }) },
  {
    id: 'pages-columns', label: 'Bảng — chọn cột',
    note: 'Menu chọn cột đang mở. Cột tuỳ chọn không có trong HTML khi tắt, không phải ẩn bằng CSS.',
    render: (_) => pagesScreen(_, [page(), page({ id: 'p2', path: '/gioi-thieu', title: 'Giới thiệu', published: false })],
      { menu: MENU, chrome: { ...CHROME, pager: null } },
      { shown: ['id'], colsHref: (keys) => `?cols=${keys.join(',')}` }),
  },
  {
    id: 'people', label: 'Người — tên và chữ đầu',
    note: 'Chữ đầu lấy từ tên gọi (tiếng Việt đặt ở cuối). Chưa có ảnh thật, và đây vẫn là bản dự phòng khi có.',
    render: () => html`<div data-ui="tokens">
      ${each(['Nguyễn Quản Trị', 'Trần Thị Hoàng Yến Vy', 'Admin'], n => n, n => html`<div data-ui="token">${person(n)}</div>`)}
    </div>`,
  },
  {
    id: 'settings', label: 'Cài đặt — token', note: 'Danh sách token đang áp dụng.',
    render: (_) => settingsScreen(_, { 'color-accent': 'oklch(0.55 0.18 268)', 'radius': '0.75rem', 'page-max-width': '68rem', 'section-gap': '4rem' }, { menu: MENU }),
  },
  {
    id: 'state-empty', label: 'Trạng thái rỗng', note: 'Dùng ở mọi màn hình.',
    render: () => emptyState('Chưa có gì ở đây.', 'Tạo mục đầu tiên để bắt đầu.'),
  },
  {
    id: 'state-error', label: 'Trạng thái lỗi', note: 'Mọi lỗi của framework đều có mã, câu mô tả, và gợi ý sửa. Cả ba đều cần chỗ hiển thị.',
    render: () => errorState('E_APP_IN_USE', '"website" không gỡ được khi website_menu đang cài.',
      'Gỡ website_menu trước, hoặc để website ở nguyên.'),
  },
]

export const cataloguePage = (_: Translator): TemplateResult => {
  const body = html`<div data-ui="catalogue">
    <nav data-ui="catalogue-nav">${each(CASES, c => c.id, c => html`<a href="#${c.id}">${c.label}</a>`)}</nav>
    ${each(CASES, c => c.id, c => html`
      <section data-ui="catalogue-case" id=${c.id}>
        <header data-ui="catalogue-head">
          <h2>${c.label}</h2>
          <p>${c.note}</p>
        </header>
        <div data-ui="catalogue-frame">${c.render(_)}</div>
      </section>`)}
  </div>`
  return body
}
