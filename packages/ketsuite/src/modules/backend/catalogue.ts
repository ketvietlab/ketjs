import { html, each } from '@ketvietlab/ketjs-view'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { appsScreen, pagesScreen, settingsScreen } from './screens.tsx'
import {
  actionGroup,
  badge,
  breadcrumbs,
  button,
  cardGrid,
  code,
  contentCard,
  countBadge,
  datePicker,
  emptyState,
  errorState,
  framed,
  icon,
  iconButton,
  inline,
  kanbanCard,
  kanbanGrid,
  linkButton,
  loadingState,
  metric,
  mediaPanel,
  notice,
  person,
  recordForm,
  recordList,
  recordWorkspace,
  section,
  stack,
  surface,
  tabs,
  tag,
} from '../../ui/index.ts'
import type { AppRow, PageRow } from './screens.tsx'
import type { ListChrome, Viewer } from '../../ui/index.ts'
import { loginScreen } from '../user/login.ts'
import type { MenuNode, Translator } from '@ketvietlab/ketjs'

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
  name: 'website',
  title: 'Website',
  summary: 'Trang, section và điều hướng.',
  category: 'Website',
  state: 'available',
  depends: [],
  dependents: [],
  ...over,
})

const page = (over: Partial<PageRow> = {}): PageRow => ({
  id: 'p1',
  path: '/',
  title: 'Trang chủ',
  published: true,
  ...over,
})

const viewer = (over: Partial<Viewer> = {}): Viewer => ({
  name: 'Nguyễn Quản Trị',
  company: 'acme',
  companies: ['acme'],
  companyName: 'Công ty Kết Việt',
  branch: 'root:acme',
  branches: ['root:acme'],
  branchName: 'Trụ sở chính',
  contextPath: '/admin/context',
  ...over,
})

/**
 * A sidebar with something in it. The screens take the tree as data, so the
 * catalogue can show the real chrome with no server, no database and no session —
 * which is the whole point of the screens being pure functions.
 */
const node = (id: string, label: string, over: Partial<MenuNode> = {}): MenuNode => ({
  id,
  label,
  path: null,
  icon: null,
  active: false,
  children: [],
  ...over,
})

const MENU: MenuNode[] = [
  node('hospitality', 'Khách sạn', { icon: 'hotel', path: '/admin/hospitality' }),
  node('partner', 'Đối tác', { icon: 'users', path: '/admin/partners' }),
  node('pos', 'Điểm bán hàng', { icon: 'store', path: '/admin/pos' }),
  node('sale', 'Bán hàng', {
    icon: 'shopping-bag',
    children: [
      node('sale.orders', 'Đơn hàng', {
        icon: 'receipt-text',
        children: [
          node('sale.quotes', 'Báo giá', { path: '/quotes' }),
          node('sale.list', 'Đơn hàng', { path: '/orders' }),
        ],
      }),
    ],
  }),
  node('product', 'Sản phẩm', {
    icon: 'package',
    children: [
      node('product.catalogue', 'Danh mục', {
        icon: 'package',
        children: [node('product.templates', 'Mẫu sản phẩm', { path: '/admin/products' })],
      }),
    ],
  }),
  node('pricing', 'Bảng giá', { icon: 'tag', path: '/admin/pricing' }),
  node('purchase', 'Mua hàng', { icon: 'shopping-cart', path: '/admin/purchase' }),
  node('accounting', 'Kế toán', { icon: 'banknote', path: '/admin/accounting' }),
  node('stock', 'Kho', { icon: 'warehouse', path: '/admin/stock' }),
  node('admin', 'Quản trị', {
    icon: 'settings',
    active: true,
    children: [
      node('admin.apps', 'Ứng dụng', { icon: 'layout-grid', path: '/admin', active: true }),
      node('admin.content', 'Nội dung', {
        icon: 'file-text',
        children: [node('admin.pages', 'Trang', { path: '/admin/pages' })],
      }),
      node('admin.config', 'Cấu hình', {
        icon: 'settings',
        children: [node('admin.settings', 'Cài đặt', { path: '/admin/settings' })],
      }),
    ],
  }),
]

/** A bar with every control on, so the design team sees the crowded case. */
const CHROME: ListChrome = {
  search: {
    name: 'q',
    value: 'gioi',
    placeholder: 'Tìm trang…',
    facets: [{ label: 'Tìm: gioi', without: '/admin/pages' }],
  },
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

export const CASES: Array<{
  id: string
  label: string
  note: string
  render: (t: Translator) => TemplateResult
}> = [
  {
    id: 'login',
    label: 'Đăng nhập — trống',
    note: 'Trang đầu tiên ai cũng thấy, và là trang duy nhất chạy không cần JavaScript. Chưa có CSS.',
    render: (_) => loginScreen(_, { locales: ['vi', 'en'], locale: 'vi' }),
  },
  {
    id: 'login-failed',
    label: 'Đăng nhập — sai mật khẩu',
    note: 'Thông báo lỗi có role="alert". Sai mật khẩu và sai tên đăng nhập cho cùng một câu — đừng tách ra.',
    render: (_) => loginScreen(_, { failed: true, locales: ['vi', 'en'], locale: 'vi' }),
  },
  {
    id: 'login-next',
    label: 'Đăng nhập — quay lại nơi đang tới',
    note: 'Có ô ẩn "next". Vào /admin/pages khi chưa đăng nhập thì sau khi vào phải quay lại đúng đó.',
    render: (_) => loginScreen(_, { next: '/admin/pages', locales: ['vi', 'en'], locale: 'vi' }),
  },
  {
    id: 'viewer-one',
    label: 'Footer sidebar — một công ty',
    note: 'Systray KétViệt: counters, công ty, avatar; menu tài khoản native giữ đăng xuất.',
    render: (_) =>
      appsScreen(_, [app({ state: 'installed' })], { viewer: viewer(), menu: MENU, indicators: INDICATORS }),
  },
  {
    id: 'viewer-many',
    label: 'Footer sidebar — nhiều công ty',
    note: 'Icon công ty có accessible label; tên công ty/chi nhánh hiện trong menu và thanh trên vẫn đổi được ngữ cảnh.',
    render: (_) =>
      appsScreen(_, [app({ state: 'installed' })], {
        viewer: viewer({ companies: ['acme', 'globex', 'initech'] }),
        menu: MENU,
      }),
  },
  {
    id: 'viewer-long',
    label: 'Footer sidebar — tên dài',
    note: 'Kiểm tra popover tài khoản không vỡ khi tên người và tên công ty đều dài.',
    render: (_) =>
      appsScreen(_, [app({ state: 'installed' })], {
        viewer: viewer({
          name: 'Nguyễn Thị Hoàng Yến Vy Khánh Linh',
          company: 'cong-ty-co-phan-thuong-mai-dich-vu',
          companies: ['a', 'b'],
        }),
        menu: MENU,
      }),
  },
  {
    id: 'apps-typical',
    label: 'Ứng dụng — thường gặp',
    note: 'Hai nhóm, có cái đã cài có cái chưa.',
    render: (_) =>
      appsScreen(
        _,
        [
          app({ name: 'website', state: 'installed' }),
          app({
            name: 'website_menu',
            title: 'Menu điều hướng',
            summary: 'Thanh menu cho website.',
            depends: ['website'],
          }),
          app({
            name: 'website_seo',
            title: 'SEO',
            summary: 'Thẻ mô tả và canonical.',
            state: 'installed',
            depends: ['website'],
          }),
          app({
            name: 'theme_paper',
            title: 'Theme Paper',
            summary: 'Giao diện mặc định.',
            category: 'Giao diện',
            state: 'installed',
          }),
        ],
        { menu: MENU },
      ),
  },
  {
    id: 'apps-blocked',
    label: 'Ứng dụng — không gỡ được',
    note: 'Nút Gỡ bị vô hiệu vì app khác đang phụ thuộc. Cần cho người dùng hiểu vì sao.',
    render: (_) =>
      appsScreen(_, [app({ state: 'installed', dependents: ['website_menu', 'website_seo'] })], {
        menu: MENU,
      }),
  },
  {
    id: 'apps-long',
    label: 'Ứng dụng — danh sách dài',
    note: 'Kiểm tra lưới khi có nhiều thẻ và tên dài.',
    render: (_) =>
      appsScreen(
        _,
        Array.from({ length: 14 }, (_, i) =>
          app({
            name: `app_${i}`,
            title: i % 4 === 0 ? `Ứng dụng có tên rất dài số ${i}` : `Ứng dụng ${i}`,
            summary:
              i % 3 === 0
                ? 'Mô tả dài hơn bình thường để xem thẻ có bị vỡ hay không khi chữ tràn sang dòng thứ hai.'
                : 'Mô tả ngắn.',
            category: i % 2 ? 'Website' : 'Thương mại',
            state: i % 3 === 0 ? 'installed' : 'available',
          }),
        ),
        { menu: MENU },
      ),
  },
  {
    id: 'apps-empty',
    label: 'Ứng dụng — trống',
    note: 'Bản triển khai chưa build app nào vào.',
    render: (_) => appsScreen(_, [], { menu: MENU }),
  },
  {
    id: 'pages-typical',
    label: 'Trang — thường gặp',
    note: 'Có bản nháp lẫn bản đã đăng.',
    render: (_) =>
      pagesScreen(
        _,
        [
          page(),
          page({ id: 'p2', path: '/gioi-thieu', title: 'Giới thiệu', published: false }),
          page({ id: 'p3', path: '/lien-he', title: 'Liên hệ' }),
        ],
        { menu: MENU, chrome: CHROME },
      ),
  },
  {
    id: 'pages-long',
    label: 'Trang — danh sách dài',
    note: 'Đường dẫn dài, tiêu đề dài, 40 dòng.',
    render: (_) =>
      pagesScreen(
        _,
        Array.from({ length: 40 }, (_, i) =>
          page({
            id: `p${i}`,
            path: i % 5 === 0 ? `/danh-muc/con-rat-sau/duong-dan-dai-${i}` : `/trang-${i}`,
            title: i % 4 === 0 ? `Tiêu đề dài bất thường dùng để kiểm tra tràn dòng số ${i}` : `Trang ${i}`,
            published: i % 3 !== 0,
          }),
        ),
        { menu: MENU },
      ),
  },
  {
    id: 'pages-empty',
    label: 'Trang — trống',
    note: 'Chưa có trang nào.',
    render: (_) => pagesScreen(_, [], { menu: MENU }),
  },
  {
    id: 'pages-columns',
    label: 'Bảng — chọn cột',
    note: 'Menu chọn cột đang mở. Cột tuỳ chọn không có trong HTML khi tắt, không phải ẩn bằng CSS.',
    render: (_) =>
      pagesScreen(
        _,
        [page(), page({ id: 'p2', path: '/gioi-thieu', title: 'Giới thiệu', published: false })],
        { menu: MENU, chrome: { ...CHROME, pager: null } },
        { shown: ['id'], colsHref: (keys) => `?cols=${keys.join(',')}` },
      ),
  },
  {
    id: 'record-workspace',
    label: 'Workspace — không lồng layout',
    note: 'Màn hình đã có identity riêng giữ đúng một sheet khi đi qua framed layout dùng chung.',
    render: (_) =>
      framed(
        _,
        'Chi tiết sản phẩm',
        { menu: MENU },
        recordWorkspace({
          kicker: 'Danh mục sản phẩm',
          title: 'Bàn làm việc tiêu chuẩn',
          subtitle: 'SKU-2026-001 · Nội thất',
          imageFallback: icon('package'),
          summary: [
            { id: 'price', label: 'Giá bán', value: '4.500.000 ₫' },
            { id: 'variants', label: 'Biến thể', value: 3 },
          ],
          body: section({
            title: 'Thông tin chung',
            body: surface({ body: 'Nội dung nghiệp vụ giữ nguyên padding và hierarchy.' }),
          }),
        }),
      ),
  },
  {
    id: 'people',
    label: 'Người — tên và chữ đầu',
    note: 'Chữ đầu lấy từ tên gọi (tiếng Việt đặt ở cuối). Chưa có ảnh thật, và đây vẫn là bản dự phòng khi có.',
    render: () => html`<div data-ui="tokens">
      ${each(
        ['Nguyễn Quản Trị', 'Trần Thị Hoàng Yến Vy', 'Admin'],
        (n) => n,
        (n) => html`<div data-ui="token">${person(n)}</div>`,
      )}
    </div>`,
  },
  {
    id: 'kit-actions',
    label: 'Component — hành động và nhãn',
    note: 'Đủ hierarchy, kích thước, disabled, loading, icon-only, status, tag và count. Mỗi cụm chỉ có một primary.',
    render: () =>
      surface({
        body: stack(
          [
            actionGroup({
              label: 'Hành động bản ghi',
              actions: [
                button({ label: 'Lưu thay đổi', variant: 'primary', type: 'submit', icon: 'check' }),
                linkButton({ label: 'Quay lại', href: '#kit-actions' }),
                button({ label: 'Xóa bản ghi', variant: 'destructive' }),
                iconButton({ label: 'Thông báo', icon: 'bell', type: 'button' }),
              ],
            }),
            actionGroup({
              label: 'Trạng thái control',
              actions: [
                button({ label: 'Đang lưu', variant: 'primary', loading: true }),
                button({ label: 'Không khả dụng', disabled: true }),
                linkButton({
                  label: 'Hành động lớn',
                  href: '#kit-actions',
                  size: 'prominent',
                  variant: 'primary',
                }),
              ],
            }),
            inline([
              badge('Đang hoạt động', 'positive', 'active'),
              badge('Chờ duyệt', 'warning', 'pending'),
              badge('Bản nháp', 'neutral', 'draft'),
              tag({ label: 'Kho: Nguyễn Huệ', removeHref: '#kit-actions' }),
              countBadge(12, '12 thông báo'),
              code('SO-2026-001', 'identifier'),
              person('Nguyễn Quản Trị'),
            ]),
          ],
          'loose',
        ),
        padding: 'default',
      }),
  },
  {
    id: 'kit-surfaces',
    label: 'Component — hierarchy và surface',
    note: 'Section, metric và card dùng cùng spacing/radius canonical; chỉ card có destination mới lift khi hover.',
    render: () =>
      section({
        eyebrow: 'Vận hành hôm nay',
        title: 'Tổng quan cửa hàng',
        description: 'Các số liệu giúp ra quyết định, không phải app launcher được dùng lại như KPI.',
        actions: linkButton({ label: 'Xem báo cáo', href: '#kit-surfaces', size: 'compact' }),
        body: stack(
          [
            cardGrid({
              items: [
                {
                  id: 'revenue',
                  label: 'Doanh thu thuần',
                  value: '48,6 tr₫',
                  detail: 'Tăng 12,4% so với thứ Sáu trước',
                },
                { id: 'orders', label: 'Đơn cần xử lý', value: '7', detail: '2 đơn đã quá hạn' },
                { id: 'stock', label: 'Cảnh báo tồn kho', value: '3', detail: 'Cần đặt lại trong hôm nay' },
              ],
              id: (item) => item.id,
              card: (item) => metric(item),
            }),
            cardGrid({
              items: [
                {
                  id: 'customer',
                  title: 'Công ty Minh Phát',
                  summary: 'Khách hàng · Hà Nội',
                  selected: true,
                },
                {
                  id: 'supplier',
                  title: 'Nhà cung cấp An Khang',
                  summary: 'Nhà cung cấp · Đà Nẵng',
                  selected: false,
                },
              ],
              id: (item) => item.id,
              card: (item) =>
                contentCard({
                  ...item,
                  href: `#${item.id}`,
                  body: 'Công nợ và hoạt động gần nhất được giữ trong đúng context.',
                  actions: linkButton({ label: 'Mở hồ sơ', href: `#${item.id}`, size: 'compact' }),
                }),
            }),
          ],
          'loose',
        ),
      }),
  },
  {
    id: 'kit-navigation',
    label: 'Component — navigation sâu',
    note: 'List screen hiện không dùng breadcrumb; component vẫn có cho hồ sơ nhiều cấp. Tab active nhận ra bằng indicator và weight.',
    render: () =>
      surface({
        body: stack([
          breadcrumbs({
            label: 'Đường dẫn hồ sơ',
            items: [
              { label: 'Bán hàng', href: '#kit-navigation' },
              { label: 'Đơn hàng', href: '#kit-navigation' },
              { label: 'SO-2026-001' },
            ],
          }),
          tabs({
            label: 'Hồ sơ đơn hàng',
            items: [
              { id: 'summary', label: 'Tổng quan', href: '#kit-navigation', active: true },
              { id: 'lines', label: 'Dòng hàng', href: '#kit-navigation', count: 8 },
              { id: 'activity', label: 'Hoạt động', href: '#kit-navigation', count: 3 },
            ],
          }),
        ]),
        padding: 'default',
      }),
  },
  {
    id: 'kit-data-feedback',
    label: 'Component — data và feedback',
    note: 'Operational list, kanban, notice và loading cùng có semantic state; mobile không phải desktop bị ép nhỏ.',
    render: () =>
      stack(
        [
          notice({
            tone: 'warning',
            title: 'Ba mặt hàng sắp hết',
            message: 'Kiểm tra đề xuất nhập kho trước 17:00.',
            icon: icon('alert-triangle'),
          }),
          recordList({
            rows: [
              { id: 'SO-001', customer: 'Minh Phát', value: '4.650.000₫', state: 'Chờ giao' },
              { id: 'SO-002', customer: 'An Khang', value: '1.280.000₫', state: 'Hoàn tất' },
            ],
            id: (row) => row.id,
            title: (row) => row.id,
            summary: (row) => `${row.customer} · ${row.state}`,
            value: (row) => row.value,
            href: (row) => `#${row.id}`,
          }),
          kanbanGrid({
            rows: [
              { id: 'p1', title: 'Xoài cát Hòa Lộc', state: 'Hàng hóa' },
              { id: 'p2', title: 'Giao hàng nội thành', state: 'Dịch vụ' },
            ],
            id: (row) => row.id,
            card: (row) =>
              kanbanCard({
                key: row.id,
                title: row.title,
                meta: badge(row.state, 'info'),
                note: '1 biến thể',
              }),
          }),
          loadingState('Đang tải hoạt động gần nhất', 4),
        ],
        'loose',
      ),
  },
  {
    id: 'kit-date-picker',
    label: 'Component — chọn khoảng ngày',
    note: 'Native date control giữ locale, bàn phím và mobile picker của trình duyệt; form GET giữ bộ lọc trong URL.',
    render: () =>
      surface({
        body: datePicker({
          action: '#kit-date-picker',
          label: 'Khoảng lưu trú',
          submit: 'Xem lịch',
          clearHref: '#kit-date-picker',
          clearLabel: 'Xóa',
          hidden: { property: 'hotel-hn' },
          fields: [
            {
              name: 'from',
              label: 'Từ ngày',
              value: '2026-08-20',
              min: '2026-01-01',
              required: true,
              help: 'Theo múi giờ của cơ sở.',
            },
            {
              name: 'to',
              label: 'Đến ngày',
              value: '2026-08-18',
              min: '2026-08-20',
              required: true,
              error: 'Ngày kết thúc phải sau ngày bắt đầu.',
            },
          ],
        }),
      }),
  },
  {
    id: 'kit-form',
    label: 'Component — biểu mẫu nghiệp vụ',
    note: 'Required, helper, lỗi tại field, lỗi tổng hợp, checkbox và disabled đều có hierarchy và liên kết semantic.',
    render: () =>
      surface({
        body: recordForm({
          action: '#kit-form',
          submit: 'Lưu sản phẩm',
          submitVariant: 'primary',
          cancelHref: '#kit-form',
          cancelLabel: 'Hủy',
          errors: ['Tên sản phẩm cần ít nhất 3 ký tự.'],
          fields: [
            {
              name: 'name',
              label: 'Tên sản phẩm',
              value: 'X',
              required: true,
              help: 'Tên hiển thị trên đơn hàng và chứng từ.',
              error: 'Nhập ít nhất 3 ký tự.',
            },
            {
              name: 'type',
              label: 'Loại sản phẩm',
              type: 'select',
              value: 'goods',
              options: [
                { value: 'goods', label: 'Hàng hóa' },
                { value: 'service', label: 'Dịch vụ' },
              ],
            },
            {
              name: 'saleOk',
              label: 'Có thể bán',
              type: 'checkbox',
              value: true,
              help: 'Cho phép chọn sản phẩm trên báo giá và đơn hàng.',
            },
            {
              name: 'reference',
              label: 'Mã nội bộ',
              value: 'SKU-2026-001',
              disabled: true,
              help: 'Mã do hệ thống quản lý.',
            },
            {
              name: 'description',
              label: 'Mô tả bán hàng',
              type: 'textarea',
              span: 'full',
              placeholder: 'Thông tin cần xuất hiện trên báo giá…',
            },
          ],
        }),
      }),
  },
  {
    id: 'product-media-scaffold',
    label: 'Sản phẩm — hình ảnh chưa kết nối',
    note: 'Không có request hay broken image; các thao tác bị vô hiệu cho tới khi backend media cung cấp adapter.',
    render: () =>
      mediaPanel({
        status: 'unavailable',
        labels: { unavailable: 'Chưa kết nối dịch vụ hình ảnh.', add: 'Thêm ảnh' },
      }),
  },
  {
    id: 'product-media-ready',
    label: 'Sản phẩm — thư viện hình ảnh',
    note: 'Upload, chọn ảnh chính, sắp xếp và xóa dùng form native; adapter storage vẫn nằm ngoài component.',
    render: () =>
      mediaPanel({
        status: 'ready',
        uploadAction: '/fixture/media',
        labels: {
          primary: 'Ảnh chính',
          makePrimary: 'Đặt làm ảnh chính',
          moveUp: 'Dịch lên',
          moveDown: 'Dịch xuống',
          remove: 'Xóa ảnh',
          choose: 'Chọn ảnh',
          add: 'Thêm ảnh',
        },
        images: [
          {
            id: 'front',
            src: '/design/fixtures/product-front.svg',
            alt: 'Mặt trước',
            primary: true,
            actions: { remove: '/fixture/media/front/remove', moveDown: '/fixture/media/front/down' },
          },
          {
            id: 'back',
            src: '/design/fixtures/product-back.svg',
            alt: 'Mặt sau',
            actions: {
              primary: '/fixture/media/back/primary',
              remove: '/fixture/media/back/remove',
              moveUp: '/fixture/media/back/up',
            },
          },
        ],
      }),
  },
  {
    id: 'settings',
    label: 'Cài đặt — token',
    note: 'Danh sách token đang áp dụng.',
    render: (_) =>
      settingsScreen(
        _,
        {
          'color-accent': 'oklch(0.55 0.18 268)',
          radius: '0.75rem',
          'page-max-width': '68rem',
          'section-gap': '4rem',
        },
        { menu: MENU },
      ),
  },
  {
    id: 'state-empty',
    label: 'Trạng thái rỗng',
    note: 'Dùng ở mọi màn hình.',
    render: () => emptyState('Chưa có gì ở đây.', 'Tạo mục đầu tiên để bắt đầu.'),
  },
  {
    id: 'state-error',
    label: 'Trạng thái lỗi',
    note: 'Mọi lỗi của framework đều có mã, câu mô tả, và gợi ý sửa. Cả ba đều cần chỗ hiển thị.',
    render: () =>
      errorState(
        'E_APP_IN_USE',
        '"website" không gỡ được khi website_menu đang cài.',
        'Gỡ website_menu trước, hoặc để website ở nguyên.',
      ),
  },
]

export const cataloguePage = (_: Translator): TemplateResult => {
  const body = html`<div data-ui="catalogue">
    <nav data-ui="catalogue-nav">${each(
      CASES,
      (c) => c.id,
      (c) => html`<a href=${`#${c.id}`}>${c.label}</a>`,
    )}</nav>
    ${each(
      CASES,
      (c) => c.id,
      (c) => html`
      <section data-ui="catalogue-case" id=${c.id}>
        <header data-ui="catalogue-head">
          <h2>${c.label}</h2>
          <p>${c.note}</p>
        </header>
        <div data-ui="catalogue-frame">${c.render(_)}</div>
      </section>`,
    )}
  </div>`
  return body
}
