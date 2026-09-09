import { document, page, text, withHeaders } from '@ketvietlab/ketjs'
import { html } from '@ketvietlab/ketjs-view'
import type { JSXChild } from '@ketvietlab/ketjs-view'
import type { RouteResult } from '@ketvietlab/ketjs'
import { icon } from '@ketvietlab/ketsuite/ui'
import {
  ActionGroup,
  AppNavigation,
  AppShell,
  Avatar,
  Badge,
  Button,
  ContentCard,
  DataTable,
  Disclosure,
  EmptyState,
  Grid,
  Inline,
  LinkButton,
  ListChrome,
  ListPage,
  Menu,
  Metric,
  ModalSheet,
  Notice,
  Pipeline,
  Progress,
  RecordForm,
  RecordPage,
  Section,
  Stack,
  Surface,
  Tabs,
  Tag,
  WorkspacePage,
} from '@ketvietlab/design-system'
import type { FieldProps, Tone } from '@ketvietlab/design-system'
import type { IncomingMessage } from 'node:http'
import { readFileSync } from 'node:fs'
import { demoStyles } from './demo-styles.ts'

const stages = ['draft', 'confirmed', 'shipping', 'done'] as const
type Stage = (typeof stages)[number]
const stageLabel: Record<Stage, string> = {
  draft: 'Chờ xác nhận',
  confirmed: 'Đang chuẩn bị',
  shipping: 'Đang giao',
  done: 'Hoàn tất',
}
const tones: Record<Stage, Tone> = {
  draft: 'warning',
  confirmed: 'info',
  shipping: 'neutral',
  done: 'positive',
}
const products = [
  { id: 'CF-01', name: 'Cà phê Arabica Đà Lạt · 1 kg', price: 320000 },
  { id: 'CF-02', name: 'Cà phê Robusta Đắk Lắk · 1 kg', price: 195000 },
  { id: 'TE-01', name: 'Trà ô long Bảo Lộc · 500 g', price: 245000 },
]
type DemoModule = {
  id: string
  label: string
  icon: string
  group: 'workspace' | 'operations' | 'finance' | 'administration'
  sections: readonly [string, string, string, string, string]
  children: readonly [string, string, string]
}
const demoModules: readonly DemoModule[] = [
  {
    id: 'overview',
    label: 'Tổng quan',
    icon: 'layout-dashboard',
    group: 'workspace',
    sections: ['Hôm nay', 'Luồng xử lý', 'Đơn gần đây', 'Ưu tiên', 'Phân tích'],
    children: ['Hiệu suất tuần', 'So sánh chi nhánh', 'Cảnh báo vận hành'],
  },
  {
    id: 'crm',
    label: 'CRM',
    icon: 'users',
    group: 'workspace',
    sections: ['Khách hàng', 'Cơ hội', 'Lead', 'Hoạt động', 'Phân tích'],
    children: ['Phễu chuyển đổi', 'Nguồn khách hàng', 'Hiệu suất đội ngũ'],
  },
  {
    id: 'sales',
    label: 'Bán hàng',
    icon: 'shopping-bag',
    group: 'workspace',
    sections: ['Tất cả đơn', 'Chờ xác nhận', 'Đang chuẩn bị', 'Đang giao', 'Thêm'],
    children: ['Hoàn tất', 'Doanh số', 'Biên lợi nhuận'],
  },
  {
    id: 'purchase',
    label: 'Mua hàng',
    icon: 'shopping-cart',
    group: 'workspace',
    sections: ['Yêu cầu mua', 'Hỏi giá', 'Đơn mua', 'Nhận hàng', 'Báo cáo'],
    children: ['Chi tiêu theo kỳ', 'Hiệu suất nhà cung cấp', 'Chênh lệch giá'],
  },
  {
    id: 'products',
    label: 'Sản phẩm',
    icon: 'package',
    group: 'workspace',
    sections: ['Danh mục', 'Biến thể', 'Bảng giá', 'Combo', 'Phân tích'],
    children: ['Sản phẩm bán chạy', 'Lợi nhuận sản phẩm', 'Vòng đời danh mục'],
  },
  {
    id: 'inventory',
    label: 'Tồn kho',
    icon: 'warehouse',
    group: 'operations',
    sections: ['Tồn hiện tại', 'Dự báo', 'Kiểm kê', 'Bổ sung hàng', 'Báo cáo'],
    children: ['Tuổi tồn kho', 'Luân chuyển hàng', 'Chênh lệch kiểm kê'],
  },
  {
    id: 'warehouse',
    label: 'Kho vận',
    icon: 'warehouse',
    group: 'operations',
    sections: ['Kho hàng', 'Vị trí', 'Điều chuyển', 'Đóng gói', 'Báo cáo'],
    children: ['Năng suất kho', 'Công suất vị trí', 'Thời gian xử lý'],
  },
  {
    id: 'delivery',
    label: 'Giao hàng',
    icon: 'truck',
    group: 'operations',
    sections: ['Tất cả chuyến', 'Chờ xác nhận', 'Đang chuẩn bị', 'Đang giao', 'Thêm'],
    children: ['Hoàn tất', 'Đúng hạn', 'Chi phí giao hàng'],
  },
  {
    id: 'projects',
    label: 'Dự án',
    icon: 'layout-grid',
    group: 'operations',
    sections: ['Danh sách', 'Bảng công việc', 'Mốc tiến độ', 'Nguồn lực', 'Báo cáo'],
    children: ['Tiến độ dự án', 'Sử dụng nguồn lực', 'Lợi nhuận dự án'],
  },
  {
    id: 'support',
    label: 'Chăm sóc khách hàng',
    icon: 'check-circle',
    group: 'operations',
    sections: ['Yêu cầu mới', 'Đang xử lý', 'Chờ khách hàng', 'SLA', 'Báo cáo'],
    children: ['Thời gian phản hồi', 'Mức độ hài lòng', 'Chủ đề hỗ trợ'],
  },
  {
    id: 'accounting',
    label: 'Kế toán',
    icon: 'file-text',
    group: 'finance',
    sections: ['Bút toán', 'Sổ cái', 'Công nợ phải thu', 'Công nợ phải trả', 'Báo cáo'],
    children: ['Bảng cân đối', 'Kết quả kinh doanh', 'Lưu chuyển tiền tệ'],
  },
  {
    id: 'cashflow',
    label: 'Dòng tiền',
    icon: 'banknote',
    group: 'finance',
    sections: ['Tổng quan', 'Thu tiền', 'Chi tiền', 'Dự báo', 'Phân tích'],
    children: ['Dòng tiền theo ngày', 'Dự báo 13 tuần', 'Sai lệch kế hoạch'],
  },
  {
    id: 'expenses',
    label: 'Chi phí',
    icon: 'wallet',
    group: 'finance',
    sections: ['Đề nghị chi', 'Tạm ứng', 'Hoàn ứng', 'Phê duyệt', 'Báo cáo'],
    children: ['Chi phí theo bộ phận', 'Chi phí theo dự án', 'Vi phạm chính sách'],
  },
  {
    id: 'billing',
    label: 'Hóa đơn',
    icon: 'receipt-text',
    group: 'finance',
    sections: ['Hóa đơn bán', 'Hóa đơn mua', 'Điều chỉnh', 'Thuế', 'Báo cáo'],
    children: ['Doanh thu ghi nhận', 'Tuổi nợ', 'Tình trạng phát hành'],
  },
  {
    id: 'reports',
    label: 'Báo cáo',
    icon: 'file-text',
    group: 'finance',
    sections: ['Yêu thích', 'Vận hành', 'Bán hàng', 'Tài chính', 'Quản lý'],
    children: ['Báo cáo đã lưu', 'Lịch gửi báo cáo', 'Nguồn dữ liệu'],
  },
  {
    id: 'people',
    label: 'Nhân sự',
    icon: 'building-2',
    group: 'administration',
    sections: ['Nhân viên', 'Chấm công', 'Nghỉ phép', 'Lịch làm việc', 'Báo cáo'],
    children: ['Biến động nhân sự', 'Năng suất', 'Chi phí nhân sự'],
  },
  {
    id: 'marketing',
    label: 'Marketing',
    icon: 'globe',
    group: 'administration',
    sections: ['Chiến dịch', 'Tệp đối tượng', 'Nội dung', 'Tự động hóa', 'Phân tích'],
    children: ['Hiệu quả chiến dịch', 'Chi phí chuyển đổi', 'Đóng góp doanh thu'],
  },
  {
    id: 'settings',
    label: 'Thiết lập',
    icon: 'sliders-horizontal',
    group: 'administration',
    sections: ['Tổ chức', 'Người dùng', 'Vai trò', 'Tích hợp', 'Giám sát'],
    children: ['Trạng thái dịch vụ', 'Lịch sử thay đổi', 'Quyền truy cập'],
  },
]
const demoModuleGroups = [
  { id: 'workspace', label: 'Kinh doanh' },
  { id: 'operations', label: 'Vận hành' },
  { id: 'finance', label: 'Tài chính' },
  { id: 'administration', label: 'Quản trị' },
] as const
type Order = {
  id: string
  customer: string
  email: string
  phone: string
  address: string
  product: string
  quantity: number
  date: string
  stage: Stage
  owner: string
  payment: string
  priority: boolean
  note: string
  history: string[]
}
const customers = [
  'Mùa Hạ Riverside',
  'Công ty Ánh Dương',
  'The Local Coffee',
  'An Nhiên Retreat',
  'Khách sạn Sông Xanh',
  'Bếp Nhà',
  'Nắng Garden',
  'Hương Việt',
  'Lá Xanh Bistro',
  'Cộng Hưởng Studio',
  'Mộc Coffee',
  'Bình Minh Hotel',
]
const seed = (): Order[] =>
  customers.map((customer, i) => ({
    id: `SO-${1042 - i}`,
    customer,
    email: `order${i + 1}@example.com`,
    phone: '0901234567',
    address: `${24 + i * 3} Nguyễn Văn Hưởng, TP. Hồ Chí Minh`,
    product: products[i % 3].id,
    quantity: 12 + i * 3,
    date: `2026-09-${String(8 + (i % 4)).padStart(2, '0')}`,
    stage: stages[i % 4],
    owner: i % 2 ? 'Minh Anh' : 'Ngọc Linh',
    payment: i % 3 ? 'transfer' : 'cod',
    priority: i < 3,
    note: i === 0 ? 'Giao tại quầy lễ tân, gọi trước 30 phút.' : '',
    history: ['Đơn hàng được tạo từ bộ dữ liệu mẫu.'],
  }))
const productOf = (order: Order) => products.find((product) => product.id === order.product)!
const total = (order: Order) => productOf(order).price * order.quantity
const money = (value: number) => `${new Intl.NumberFormat('vi-VN').format(value)} ₫`
const redirect = (href: string) => withHeaders(text('', { status: 303 }), { location: href })

type DemoBasePath = '/demo' | '/demo2'
type DemoRouteOptions<Base extends DemoBasePath> = {
  basePath?: Base
  context?: 'identity' | 'submenu'
}

type DemoRoutes<Base extends DemoBasePath> = {
  [Path in Base]: (url: URL) => RouteResult
} & {
  [Path in `${Base}/styles.css` | `${Base}/client.js` | `${Base}/export`]: (url?: URL) => RouteResult
} & {
  [Path in `${Base}/action`]: (url: URL, request: IncomingMessage) => Promise<RouteResult>
}

export function createDemoRoutes<Base extends DemoBasePath = '/demo'>(
  options: DemoRouteOptions<Base> = {},
): DemoRoutes<Base> {
  const basePath = (options.basePath ?? '/demo') as Base
  const contextMode = options.context ?? 'identity'
  const orders = seed()
  let nextId = 1043

  const render = (url: URL, formErrors: Record<string, string> = {}, submitted?: URLSearchParams) => {
    const q = url.searchParams
    const theme = q.get('theme') === 'dark' ? 'dark' : 'light'
    const view = ['orders', 'record', 'board'].includes(q.get('view') ?? '') ? q.get('view')! : 'overview'
    const selected = orders.find((order) => order.id === q.get('id')) ?? orders[0]
    const tab = ['activity', 'documents'].includes(q.get('tab') ?? '') ? q.get('tab')! : 'details'
    const href = (values: Record<string, string> = {}) =>
      `${basePath}?${new URLSearchParams({ theme, ...values })}`
    const current = Object.fromEntries(q)
    const here = href(current)
    const returnTo = href({ ...current, modal: '' })
    const modal = q.get('modal')
    const createHref = href({ ...current, modal: 'create' })
    const recordHref = (order: Order) => href({ view: 'record', id: order.id })
    const stateBadge = (order: Order) => <Badge label={stageLabel[order.stage]} tone={tones[order.stage]} />
    const status = stages.includes(q.get('status') as Stage) ? (q.get('status') as Stage) : null
    const requestedModule = demoModules.find((module) => module.id === q.get('module')) ?? demoModules[0]
    const activeModule =
      contextMode === 'submenu'
        ? view === 'orders' || view === 'record'
          ? demoModules.find((module) => module.id === 'sales')!
          : view === 'board'
            ? demoModules.find((module) => module.id === 'delivery')!
            : requestedModule
        : demoModules[0]
    const overviewTargets = ['today', 'workflow', 'recent', 'priority', 'updates'] as const
    const overviewFocus = overviewTargets.includes(q.get('focus') as (typeof overviewTargets)[number])
      ? q.get('focus')!
      : 'today'
    const selectedSection = Math.max(0, Math.min(3, Number(q.get('section')) || 0))
    const moduleValues: Record<string, string> =
      activeModule.id === 'sales'
        ? { view: 'orders' }
        : activeModule.id === 'delivery'
          ? { view: 'board' }
          : activeModule.id === 'overview'
            ? {}
            : { module: activeModule.id }
    const submenuItems = activeModule.sections.slice(0, 4).map((label, index) => {
      if (activeModule.id === 'overview') {
        const target = overviewTargets[index]
        return {
          id: target,
          label,
          href: `${href(target === 'today' ? {} : { focus: target })}#${target}`,
          active: overviewFocus === target && !q.has('child'),
        }
      }
      if (activeModule.id === 'sales' || activeModule.id === 'delivery') {
        const stage = index === 0 ? null : stages[index - 1]
        return {
          id: stage ?? 'all',
          label,
          count: stage ? orders.filter((order) => order.stage === stage).length : orders.length,
          href: href({ ...moduleValues, ...(stage ? { status: stage } : {}) }),
          active: status === stage && !q.has('child'),
        }
      }
      return {
        id: `${activeModule.id}-${index}`,
        label,
        href: href({ module: activeModule.id, section: String(index) }),
        active: selectedSection === index && !q.has('child'),
      }
    })
    const submenuDropdownActive =
      q.has('child') || ((activeModule.id === 'sales' || activeModule.id === 'delivery') && status === 'done')
    const submenuExtension = (
      <div data-demo-submenu-more data-active={submenuDropdownActive ? 'true' : null}>
        <Menu
          id={`${activeModule.id}-insights`}
          label={`${activeModule.sections[4]} ${activeModule.label}`}
          align="end"
          trigger={
            <span class="demo-submenu-trigger">
              {activeModule.sections[4]} {icon('chevron-down')}
            </span>
          }
          items={activeModule.children.map((label, index) => ({
            id: `${activeModule.id}-child-${index}`,
            label,
            href:
              (activeModule.id === 'sales' || activeModule.id === 'delivery') && index === 0
                ? href({ ...moduleValues, status: 'done' })
                : href({ ...moduleValues, child: String(index) }),
          }))}
        />
      </div>
    )
    const context =
      contextMode === 'submenu' ? (
        <div data-demo-submenu>
          <Tabs label={`Điều hướng ${activeModule.label}`} items={submenuItems} />
          {submenuExtension}
        </div>
      ) : (
        <Inline
          items={[
            'An Việt Trading',
            <span class="demo-muted">Chi nhánh Thảo Điền</span>,
            <Badge label="Dữ liệu mẫu" />,
          ]}
        />
      )
    const create = (
      <LinkButton label="Tạo đơn hàng" href={createHref} variant="primary" leading={icon('plus')} />
    )
    const actions = (
      <ActionGroup
        actions={[
          <LinkButton
            label="Xuất CSV"
            href={`${basePath}/export?theme=${theme}`}
            leading={icon('download')}
          />,
          create,
        ]}
      />
    )
    const table = (rows: Order[], selection = false, title = 'Danh sách đơn hàng', actions?: JSXChild) => (
      <DataTable
        title={title}
        actions={actions}
        rows={rows}
        id={(order) => order.id}
        rowHref={recordHref}
        responsive="stack"
        selection={selection ? { form: 'bulk-form' } : undefined}
        emptyTitle="Không tìm thấy đơn hàng"
        emptyMessage="Không có đơn nào khớp với điều kiện hiện tại."
        emptyActions={<LinkButton label="Xóa bộ lọc" href={href({ view: 'orders' })} />}
        labels={{ selectAll: 'Chọn tất cả', selectRow: (order) => `Chọn ${order.id}` }}
        columns={[
          {
            key: 'id',
            label: 'Đơn hàng',
            kind: 'identifier',
            cell: (order) => order.id,
            sort: selection
              ? {
                  href: href({ ...current, sort: q.get('sort') === 'asc' ? 'desc' : 'asc' }),
                  direction: q.get('sort') === 'asc' ? 'ascending' : 'descending',
                }
              : undefined,
          },
          { key: 'customer', label: 'Khách hàng', priority: 'primary', cell: (order) => order.customer },
          {
            key: 'date',
            label: 'Ngày giao',
            kind: 'date',
            cell: (order) => order.date.split('-').reverse().join('/'),
          },
          {
            key: 'total',
            label: 'Giá trị',
            kind: 'currency',
            align: 'end',
            cell: (order) => money(total(order)),
          },
          { key: 'status', label: 'Trạng thái', kind: 'status', cell: stateBadge },
        ]}
      />
    )
    const flash = q.get('saved') ? (
      <Notice
        tone="positive"
        title="Đã lưu thay đổi"
        message="Thông tin đơn hàng và các chỉ số đã được cập nhật."
      />
    ) : null
    const fields = (order?: Order): FieldProps[] => {
      const value = (key: keyof Order, fallback = '') =>
        submitted?.get(key) ?? String(order?.[key] ?? fallback)
      return [
        {
          id: 'customer',
          name: 'customer',
          label: 'Khách hàng',
          value: value('customer'),
          required: true,
          error: formErrors.customer,
        },
        {
          id: 'email',
          name: 'email',
          label: 'Email',
          type: 'email',
          value: value('email'),
          error: formErrors.email,
        },
        { id: 'phone', name: 'phone', label: 'Điện thoại', type: 'tel', value: value('phone') },
        {
          id: 'date',
          name: 'date',
          label: 'Ngày giao',
          type: 'date',
          value: value('date', '2026-09-09'),
          required: true,
          error: formErrors.date,
        },
        {
          id: 'address',
          name: 'address',
          label: 'Địa chỉ giao',
          value: value('address'),
          span: 'full',
          required: true,
          error: formErrors.address,
        },
        {
          id: 'product',
          name: 'product',
          label: 'Sản phẩm',
          type: 'select',
          value: value('product', products[0].id),
          options: products.map((p) => ({ value: p.id, label: p.name })),
          span: 'full',
        },
        {
          id: 'quantity',
          name: 'quantity',
          label: 'Số lượng',
          type: 'number',
          min: 1,
          max: 999,
          step: '1',
          value: value('quantity', '12'),
          required: true,
          help: 'Đơn vị: gói. Giá theo bảng giá hiện hành.',
          error: formErrors.quantity,
        },
        {
          id: 'owner',
          name: 'owner',
          label: 'Phụ trách',
          type: 'select',
          value: value('owner', 'Ngọc Linh'),
          options: ['Ngọc Linh', 'Minh Anh'].map((name) => ({ value: name, label: name })),
        },
        {
          id: 'payment',
          name: 'payment',
          label: 'Thanh toán',
          type: 'radio',
          value: value('payment', 'transfer'),
          span: 'full',
          options: [
            { value: 'transfer', label: 'Chuyển khoản' },
            { value: 'cod', label: 'Khi nhận hàng' },
          ],
        },
        {
          id: 'priority',
          name: 'priority',
          label: 'Giao ưu tiên',
          type: 'checkbox',
          value: submitted ? submitted.has('priority') : (order?.priority ?? false),
        },
        { id: 'note', name: 'note', label: 'Ghi chú', type: 'textarea', value: value('note'), span: 'full' },
      ]
    }
    const orderForm = (order?: Order) => (
      <RecordForm
        id="order-form"
        action={`${basePath}/action`}
        fields={fields(order)}
        submitLabel={order ? 'Lưu thay đổi' : 'Tạo đơn hàng'}
        cancelHref={returnTo}
        cancelLabel="Hủy"
        errors={Object.values(formErrors)}
        hidden={{ intent: order ? 'save' : 'create', id: order?.id ?? '', return: returnTo, theme }}
      />
    )
    const activity = (order: Order) => (
      <ol class="demo-timeline">
        {[...order.history].reverse().map((event, index) => (
          <li>
            <Avatar name={index ? 'Minh Anh' : order.owner} size="small" />
            <div>
              <strong>{index ? 'Minh Anh' : order.owner}</strong>
              <p>{event}</p>
            </div>
          </li>
        ))}
      </ol>
    )
    let main: JSXChild
    if (view === 'orders') {
      const search = (q.get('q') ?? '').trim().toLocaleLowerCase('vi')
      const filter = stages.includes(q.get('status') as Stage) ? q.get('status')! : ''
      const sort = q.get('sort') === 'asc' ? 'asc' : ''
      const collectionQuery = {
        view,
        ...(q.get('q') ? { q: q.get('q')! } : {}),
        ...(sort ? { sort } : {}),
      }
      const matching = orders
        .filter(
          (order) =>
            (!filter || order.stage === filter) &&
            `${order.id} ${order.customer}`.toLocaleLowerCase('vi').includes(search),
        )
        .sort((a, b) => (sort === 'asc' ? a.id.localeCompare(b.id) : b.id.localeCompare(a.id)))
      const pageCount = Math.max(1, Math.ceil(matching.length / 8))
      const pageNumber = Math.max(1, Math.min(pageCount, Number(q.get('page')) || 1))
      const visible = matching.slice((pageNumber - 1) * 8, pageNumber * 8)
      main = (
        <ListPage
          title="Đơn hàng"
          context={context}
          variant="operational"
          description={`${orders.length} đơn hàng · Kho Thảo Điền`}
          actions={actions}
          controls={
            <ListChrome
              search={{
                action: basePath,
                label: 'Tìm đơn hàng',
                placeholder: 'Mã đơn hoặc tên khách hàng',
                submitLabel: 'Tìm kiếm',
                value: search,
                hidden: { view, theme, status: filter, ...(sort ? { sort } : {}) },
              }}
              filtersLabel="Trạng thái đơn hàng"
              facets={[
                {
                  id: 'all',
                  label: 'Tất cả',
                  href: href(collectionQuery),
                  active: !filter,
                  count: orders.length,
                },
                ...stages.map((stage) => ({
                  id: stage,
                  label: stageLabel[stage],
                  href: href({ ...collectionQuery, status: stage }),
                  active: filter === stage,
                  count: orders.filter((order) => order.stage === stage).length,
                })),
              ]}
              bulk={{
                form: 'bulk-form',
                selectedCount: 0,
                summary: <span id="selection-summary">0 đơn được chọn</span>,
                actions: [{ id: 'advance', name: 'intent', value: 'bulk', label: 'Chuyển bước tiếp theo' }],
              }}
              pager={{
                label: 'Trang đơn hàng',
                summary: `${matching.length ? (pageNumber - 1) * 8 + 1 : 0}–${Math.min(pageNumber * 8, matching.length)} / ${matching.length} đơn hàng`,
                previousLabel: 'Trang trước',
                nextLabel: 'Trang sau',
                previousHref: pageNumber > 1 ? href({ ...current, page: String(pageNumber - 1) }) : null,
                nextHref: pageNumber < pageCount ? href({ ...current, page: String(pageNumber + 1) }) : null,
              }}
            />
          }
          body={
            <Stack
              items={[
                <form id="bulk-form" action={`${basePath}/action`} method="post">
                  <input type="hidden" name="return" value={here} />
                </form>,
                ...(flash ? [flash] : []),
                table(visible, true),
              ]}
            />
          }
        />
      )
    } else if (view === 'record') {
      main = (
        <RecordPage
          title={selected.id}
          description={selected.customer}
          context={context}
          variant="operational"
          status={stateBadge(selected)}
          actions={
            <ActionGroup
              actions={[
                <LinkButton
                  label="Danh sách"
                  href={href({ view: 'orders' })}
                  leading={icon('chevron-left')}
                />,
                <LinkButton
                  label="Chuyển trạng thái"
                  href={href({ ...current, modal: 'advance' })}
                  variant="primary"
                  disabled={selected.stage === 'done'}
                  leading={icon('check')}
                />,
              ]}
            />
          }
          navigation={
            <Tabs
              label="Chi tiết đơn hàng"
              items={[
                { id: 'details', label: 'Thông tin', href: recordHref(selected), active: tab === 'details' },
                {
                  id: 'activity',
                  label: 'Hoạt động',
                  count: selected.history.length,
                  href: href({ view, id: selected.id, tab: 'activity' }),
                  active: tab === 'activity',
                },
                {
                  id: 'documents',
                  label: 'Chứng từ',
                  count: 0,
                  href: href({ view, id: selected.id, tab: 'documents' }),
                  active: tab === 'documents',
                },
              ]}
            />
          }
          body={
            <Stack
              gap="loose"
              items={[
                ...(flash ? [flash] : []),
                ...(tab === 'details'
                  ? [
                      <Surface title="Thông tin đơn hàng" body={orderForm(selected)} />,
                      <DataTable
                        title="Hàng hóa"
                        rows={[selected]}
                        id={(order) => order.id}
                        responsive="stack"
                        columns={[
                          { key: 'product', label: 'Sản phẩm', cell: (order) => productOf(order).name },
                          {
                            key: 'qty',
                            label: 'Số lượng',
                            align: 'end',
                            cell: (order) => String(order.quantity),
                          },
                          {
                            key: 'price',
                            label: 'Đơn giá',
                            align: 'end',
                            cell: (order) => money(productOf(order).price),
                          },
                          {
                            key: 'total',
                            label: 'Thành tiền',
                            align: 'end',
                            cell: (order) => money(total(order)),
                          },
                        ]}
                      />,
                      <Disclosure
                        summary="Điều khoản giao nhận"
                        body="Đối chiếu số lượng khi nhận hàng. Giá chưa bao gồm phí vận chuyển và thuế. Đơn hàng cần được xác nhận trước khi xuất kho."
                      />,
                    ]
                  : tab === 'activity'
                    ? [
                        <Surface title="Lịch sử xử lý" body={activity(selected)} />,
                        <Surface
                          title="Ghi nhận trao đổi"
                          body={
                            <RecordForm
                              action={`${basePath}/action`}
                              fields={[
                                {
                                  id: 'message',
                                  name: 'message',
                                  label: 'Nội dung',
                                  type: 'textarea',
                                  required: true,
                                  span: 'full',
                                },
                              ]}
                              hidden={{ intent: 'note', id: selected.id, return: here }}
                              submitLabel="Thêm ghi nhận"
                            />
                          }
                        />,
                      ]
                    : [
                        <EmptyState
                          title="Chưa có chứng từ"
                          message="Xuất bảng kê đơn hàng để chuyển cho bộ phận kế toán."
                          actions={
                            <LinkButton
                              label="Xuất bảng kê"
                              href={`${basePath}/export?id=${selected.id}`}
                              leading={icon('download')}
                            />
                          }
                        />,
                      ]),
              ]}
            />
          }
          asideLabel="Thông tin liên quan"
          aside={
            <Stack
              gap="loose"
              items={[
                <Metric
                  label="Giá trị hàng hóa"
                  value={money(total(selected))}
                  detail="Chưa gồm thuế và vận chuyển"
                />,
                <Section
                  title="Tiến độ giao hàng"
                  body={
                    <Stack
                      items={[
                        stateBadge(selected),
                        <Progress label="Hoàn thành" value={(stages.indexOf(selected.stage) / 3) * 100} />,
                      ]}
                    />
                  }
                />,
                <Section
                  title="Người phụ trách"
                  body={<Inline items={[<Avatar name={selected.owner} />, selected.owner]} />}
                />,
                <Section
                  title="Phân loại"
                  body={
                    <Inline
                      items={[
                        <Tag label="Khách doanh nghiệp" />,
                        <Tag label={selected.priority ? 'Ưu tiên' : 'Tiêu chuẩn'} />,
                      ]}
                    />
                  }
                />,
                <Section
                  title="Ghi nhận gần nhất"
                  body={activity({ ...selected, history: selected.history.slice(-2) })}
                />,
              ]}
            />
          }
        />
      )
    } else if (view === 'board') {
      const boardStages = status ? [status] : stages
      const visibleOrders = status ? orders.filter((order) => order.stage === status) : orders
      main = (
        <WorkspacePage
          title="Bảng giao hàng"
          description="Theo dõi đơn hàng từ xác nhận đến bàn giao."
          context={context}
          variant="operational"
          layout="canvas"
          actions={create}
          controls={
            <Inline
              items={[
                <Badge
                  label={`${visibleOrders.filter((order) => order.stage !== 'done').length} đơn đang xử lý`}
                  tone="info"
                />,
                <LinkButton label="Xem danh sách" href={href({ view: 'orders' })} leading={icon('list')} />,
              ]}
            />
          }
          body={
            <div data-demo-board data-filtered={status ? 'true' : null}>
              <Grid
                columns={status ? 2 : 4}
                items={boardStages.map((stage) => (
                  <Section
                    title={stageLabel[stage]}
                    actions={
                      <Badge
                        label={String(orders.filter((order) => order.stage === stage).length)}
                        tone={tones[stage]}
                      />
                    }
                    body={
                      <Stack
                        items={orders
                          .filter((order) => order.stage === stage)
                          .map((order) => (
                            <ContentCard
                              title={order.id}
                              summary={order.customer}
                              href={recordHref(order)}
                              body={
                                <Stack
                                  gap="compact"
                                  items={[
                                    <strong>{money(total(order))}</strong>,
                                    productOf(order).name,
                                    <Inline
                                      items={[<Avatar name={order.owner} size="small" />, order.owner]}
                                    />,
                                  ]}
                                />
                              }
                              meta={
                                <Inline
                                  items={[
                                    order.date.split('-').reverse().join('/'),
                                    ...(order.priority ? [<Badge label="Ưu tiên" tone="warning" />] : []),
                                  ]}
                                />
                              }
                            />
                          ))}
                      />
                    }
                  />
                ))}
              />
            </div>
          }
        />
      )
    } else if (contextMode === 'submenu' && activeModule.id !== 'overview') {
      const childIndex = Math.max(0, Math.min(2, Number(q.get('child')) || 0))
      const sectionLabel = q.has('child')
        ? activeModule.children[childIndex]
        : activeModule.sections[selectedSection]
      main = (
        <WorkspacePage
          title={activeModule.label}
          description={`Điều hành ${activeModule.label.toLocaleLowerCase('vi')} tại tất cả chi nhánh.`}
          context={context}
          variant="operational"
          actions={
            <ActionGroup
              actions={[
                <LinkButton label="Xuất dữ liệu" href={`${basePath}/export`} leading={icon('download')} />,
                <LinkButton label="Tạo mới" href={createHref} variant="primary" leading={icon('plus')} />,
              ]}
            />
          }
          body={
            <Stack
              gap="loose"
              items={[
                <Grid
                  columns={4}
                  items={[
                    <Metric label="Cần xử lý" value="18" detail="5 mục đã quá hạn" tone="warning" />,
                    <Metric label="Đang thực hiện" value="42" detail="Tại 3 chi nhánh" tone="info" />,
                    <Metric
                      label="Hoàn tất hôm nay"
                      value="27"
                      detail="Tăng 12% so với hôm qua"
                      tone="positive"
                    />,
                    <Metric label="Tổng giá trị" value="286,4 tr ₫" detail="Trong kỳ hiện tại" />,
                  ]}
                />,
                <Notice
                  title={`${sectionLabel}: 5 mục cần chú ý`}
                  message={`Đây là không gian mẫu cho submenu “${sectionLabel}” thuộc phân hệ ${activeModule.label}.`}
                  tone="info"
                />,
                <Surface
                  title={sectionLabel}
                  actions={
                    <LinkButton label="Xem tất cả" href={href({ ...moduleValues })} variant="tertiary" />
                  }
                  body={
                    <Grid
                      columns={3}
                      items={[
                        <ContentCard
                          title="Việc cần xử lý"
                          summary="Các hồ sơ đang chờ xác nhận hoặc phê duyệt."
                          meta={<Badge label="8 mục" tone="warning" />}
                        />,
                        <ContentCard
                          title="Hoạt động gần đây"
                          summary="Thay đổi mới nhất từ đội ngũ vận hành."
                          meta={<Badge label="24 cập nhật" tone="info" />}
                        />,
                        <ContentCard
                          title="Kế hoạch tuần"
                          summary="Khối lượng dự kiến và các mốc cần hoàn thành."
                          meta={<Badge label="Đúng tiến độ" tone="positive" />}
                        />,
                      ]}
                    />
                  }
                />,
              ]}
            />
          }
        />
      )
    } else {
      const pending = orders.filter((order) => order.stage === 'draft')
      const sums = stages.map((stage) =>
        orders.filter((order) => order.stage === stage).reduce((sum, order) => sum + total(order), 0),
      )
      const max = Math.max(...sums, 1)
      main = (
        <WorkspacePage
          title="Tổng quan bán hàng"
          description="Thứ Ba, 08 tháng 09 năm 2026"
          context={context}
          variant="operational"
          actions={actions}
          body={
            <Stack
              gap="loose"
              items={[
                ...(flash ? [flash] : []),
                <div id="today">
                  <Grid
                    columns={4}
                    items={[
                      <Metric
                        label="Giá trị đơn hàng"
                        value={money(orders.reduce((sum, order) => sum + total(order), 0))}
                        detail={`${orders.length} đơn hàng`}
                        href={href({ view: 'orders' })}
                      />,
                      <Metric
                        label="Chờ xác nhận"
                        value={pending.length}
                        detail="Cần kiểm tra trước khi xuất kho"
                        tone="warning"
                        href={href({ view: 'orders', status: 'draft' })}
                      />,
                      <Metric
                        label="Đang giao"
                        value={orders.filter((order) => order.stage === 'shipping').length}
                        detail="Theo dõi bàn giao cho khách"
                        tone="info"
                        href={href({ view: 'orders', status: 'shipping' })}
                      />,
                      <Metric
                        label="Hoàn tất"
                        value={orders.filter((order) => order.stage === 'done').length}
                        detail="Đã hoàn thành giao hàng"
                        tone="positive"
                        href={href({ view: 'orders', status: 'done' })}
                      />,
                    ]}
                  />
                </div>,
                <Notice
                  title={`${pending.length} đơn đang chờ xác nhận`}
                  message="Kiểm tra địa chỉ nhận hàng và lịch giao trước khi chuyển sang chuẩn bị."
                  tone="warning"
                  actions={
                    <LinkButton
                      label="Kiểm tra đơn"
                      href={href({ view: 'orders', status: 'draft' })}
                      variant="tertiary"
                    />
                  }
                />,
                <div class="demo-overview-grid" id="workflow">
                  <Surface
                    title="Luồng xử lý"
                    body={
                      <Pipeline
                        label="Luồng đơn hàng"
                        steps={stages.map((stage) => ({
                          id: stage,
                          label: stageLabel[stage],
                          value: orders.filter((order) => order.stage === stage).length,
                          tone: tones[stage],
                          href: href({ view: 'orders', status: stage }),
                        }))}
                      />
                    }
                  />
                  <Surface
                    title="Giá trị theo trạng thái"
                    body={
                      <div
                        class="demo-bars"
                        role="img"
                        aria-label={stages
                          .map((stage, i) => `${stageLabel[stage]}: ${money(sums[i])}`)
                          .join('; ')}
                      >
                        {stages.map((stage, i) => (
                          <div class="demo-bar-row">
                            <span>{stageLabel[stage]}</span>
                            <strong>{money(sums[i])}</strong>
                            <div class="demo-bar-track">
                              <div data-tone={stage} style={`width:${(sums[i] / max) * 100}%`} />
                            </div>
                          </div>
                        ))}
                      </div>
                    }
                  />
                </div>,
                <div id="recent">
                  {table(
                    orders.slice(0, 5),
                    false,
                    'Đơn hàng gần đây',
                    <LinkButton
                      label="Tất cả đơn hàng"
                      href={href({ view: 'orders' })}
                      variant="tertiary"
                      leading={icon('chevron-right')}
                    />,
                  )}
                </div>,
                <div id="priority">
                  <Grid
                    columns={2}
                    items={[
                      <Surface
                        title="Ưu tiên hôm nay"
                        body={
                          <Stack
                            items={orders
                              .filter((order) => order.priority && order.stage !== 'done')
                              .map((order) => (
                                <ContentCard
                                  title={`${order.id} · ${order.customer}`}
                                  summary={
                                    order.note ||
                                    `Chuẩn bị ${order.quantity} gói cho lịch giao ${order.date.split('-').reverse().join('/')}`
                                  }
                                  href={recordHref(order)}
                                  meta={stateBadge(order)}
                                />
                              ))}
                          />
                        }
                      />,
                      <div id="updates" class="demo-surface-fill">
                        <Surface
                          title="Cập nhật vận hành"
                          body={
                            <Stack
                              gap="loose"
                              items={[
                                activity(selected),
                                <Progress
                                  label="Tiến độ hoàn tất đơn hàng"
                                  value={
                                    (orders.filter((order) => order.stage === 'done').length /
                                      orders.length) *
                                    100
                                  }
                                />,
                                <Disclosure
                                  summary="Lịch vận hành kho"
                                  body="Nhận đơn: 08:00–17:00. Chuyến giao sáng: 09:00. Chuyến giao chiều: 14:00. Kho Thảo Điền làm việc từ thứ Hai đến thứ Bảy."
                                />,
                              ]}
                            />
                          }
                        />
                      </div>,
                    ]}
                  />
                </div>,
              ]}
            />
          }
        />
      )
    }
    let overlay: JSXChild = null
    if (modal === 'create')
      overlay = (
        <ModalSheet
          id="create-order"
          title="Tạo đơn hàng"
          closeHref={returnTo}
          closeLabel="Đóng"
          body={orderForm()}
        />
      )
    if (modal === 'advance')
      overlay = (
        <ModalSheet
          id="advance-order"
          title="Chuyển trạng thái đơn hàng"
          closeHref={returnTo}
          closeLabel="Đóng"
          presentation="dialog"
          body={
            <Stack
              items={[
                <p>
                  {selected.id} · {selected.customer}
                </p>,
                <Inline
                  items={[
                    stateBadge(selected),
                    icon('chevron-right'),
                    <Badge
                      label={stageLabel[stages[Math.min(3, stages.indexOf(selected.stage) + 1)]]}
                      tone="positive"
                    />,
                  ]}
                />,
              ]}
            />
          }
          actions={
            <form action={`${basePath}/action`} method="post">
              <input type="hidden" name="intent" value="advance" />
              <input type="hidden" name="id" value={selected.id} />
              <input type="hidden" name="return" value={returnTo} />
              <ActionGroup
                actions={[
                  <LinkButton label="Hủy" href={returnTo} />,
                  <Button
                    label="Xác nhận"
                    variant="primary"
                    type="submit"
                    disabled={selected.stage === 'done'}
                  />,
                ]}
              />
            </form>
          }
        />
      )
    return page({
      status: Object.keys(formErrors).length ? 422 : 200,
      body: document({
        lang: 'vi',
        title: 'An Việt · Bán hàng',
        head: html`<link rel="stylesheet" href="/design-system/styles.css"><link rel="stylesheet" href=${`${basePath}/styles.css`}><script type="module" src="/design-system/runtime/auto.js"></script><script type="module" src=${`${basePath}/client.js`}></script>`,
        body: (
          <div data-kv-design-system data-theme={theme} data-presentation="grouped" data-demo-app>
            <AppShell
              sidebar={
                <AppNavigation
                  id={contextMode === 'submenu' ? 'enterprise-navigation' : 'sales-navigation'}
                  label="Điều hướng ứng dụng"
                  menuLabel="Mở điều hướng"
                  closeLabel="Đóng điều hướng"
                  identity="An Việt"
                  context={
                    contextMode === 'submenu' ? '18 phân hệ · Thảo Điền' : 'Sales workspace · Thảo Điền'
                  }
                  groups={
                    contextMode === 'submenu'
                      ? demoModuleGroups.map((group) => ({
                          ...group,
                          items: demoModules
                            .filter((module) => module.group === group.id)
                            .map((module) => ({
                              id: module.id,
                              label: module.label,
                              href:
                                module.id === 'overview'
                                  ? href()
                                  : module.id === 'sales'
                                    ? href({ view: 'orders' })
                                    : module.id === 'delivery'
                                      ? href({ view: 'board' })
                                      : href({ module: module.id }),
                              active: activeModule.id === module.id,
                              leading: icon(module.icon),
                              ...(module.id === 'sales' ? { count: orders.length } : {}),
                            })),
                        }))
                      : [
                          {
                            id: 'workspace',
                            label: 'Không gian làm việc',
                            items: [
                              {
                                id: 'overview',
                                label: 'Tổng quan',
                                href: href(),
                                active: view === 'overview',
                                leading: icon('layout-dashboard'),
                              },
                              {
                                id: 'orders',
                                label: 'Đơn hàng',
                                href: href({ view: 'orders' }),
                                active: view === 'orders' || view === 'record',
                                leading: icon('shopping-cart'),
                                count: orders.length,
                              },
                              {
                                id: 'delivery-board',
                                label: 'Bảng giao hàng',
                                href: href({ view: 'board' }),
                                active: view === 'board',
                                leading: icon('layout-grid'),
                              },
                            ],
                          },
                          {
                            id: 'reference',
                            label: 'Tham khảo',
                            items: [
                              {
                                id: 'design-system',
                                label: 'Design system',
                                href: '/',
                                leading: icon('package'),
                              },
                            ],
                          },
                        ]
                  }
                  footer={
                    <div class="demo-navigation-footer">
                      <LinkButton
                        label={theme === 'light' ? 'Giao diện tối' : 'Giao diện sáng'}
                        href={href({ ...current, theme: theme === 'light' ? 'dark' : 'light' })}
                        variant="tertiary"
                        leading={icon(theme === 'light' ? 'moon' : 'sun')}
                      />
                      <Inline
                        items={[
                          <Avatar name="Ngọc Linh" size="small" />,
                          <div>
                            <strong>Ngọc Linh</strong>
                            <div class="demo-muted">Quản lý bán hàng</div>
                          </div>,
                        ]}
                      />
                    </div>
                  }
                />
              }
              main={main}
            />
            {overlay}
          </div>
        ),
      }),
    })
  }

  return {
    [basePath]: (url: URL) => render(url),
    [`${basePath}/styles.css`]: () => text(demoStyles, { type: 'text/css' }),
    [`${basePath}/client.js`]: () =>
      text(readFileSync(new URL('./demo-client.js', import.meta.url), 'utf8'), { type: 'text/javascript' }),
    [`${basePath}/export`]: (url: URL) => {
      const rows = orders.filter(
        (order) => !url.searchParams.has('id') || order.id === url.searchParams.get('id'),
      )
      const cell = (value: string) =>
        `"${(/^[=+\-@\t\r]/.test(value) ? `'${value}` : value).replaceAll('"', '""')}"`
      return withHeaders(
        text(
          '\uFEFF' +
            [
              ['Mã đơn', 'Khách hàng', 'Giá trị', 'Trạng thái'],
              ...rows.map((order) => [
                order.id,
                order.customer,
                String(total(order)),
                stageLabel[order.stage],
              ]),
            ]
              .map((row) => row.map(cell).join(','))
              .join('\r\n'),
          { type: 'text/csv' },
        ),
        { 'content-disposition': 'attachment; filename="orders.csv"' },
      )
    },
    [`${basePath}/action`]: async (url: URL, req: IncomingMessage) => {
      if (req.method !== 'POST') return text('Method not allowed', { status: 405 })
      if (req.headers.origin && req.headers.origin !== url.origin) return text('Forbidden', { status: 403 })
      let body = ''
      for await (const chunk of req) {
        body += chunk.toString()
        if (body.length > 32768) return text('Request too large', { status: 413 })
      }
      const data = new URLSearchParams(body)
      const target = new URL(data.get('return') ?? basePath, url)
      if (target.origin !== url.origin || target.pathname !== basePath)
        return text('Invalid return URL', { status: 400 })
      target.searchParams.delete('modal')
      const intent = data.get('intent')
      const order = orders.find((item) => item.id === data.get('id'))
      if (intent === 'save' || intent === 'create') {
        if (intent === 'save' && !order) return text('Order not found', { status: 404 })
        const errors: Record<string, string> = {}
        for (const [key, label] of [
          ['customer', 'khách hàng'],
          ['address', 'địa chỉ giao'],
        ])
          if (!data.get(key)?.trim()) errors[key] = `Vui lòng nhập ${label}.`
        if (data.get('email') && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.get('email')!))
          errors.email = 'Email chưa hợp lệ.'
        const quantity = Number(data.get('quantity'))
        if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999)
          errors.quantity = 'Số lượng phải từ 1 đến 999.'
        if (
          !/^\d{4}-\d{2}-\d{2}$/.test(data.get('date') ?? '') ||
          Number.isNaN(Date.parse(data.get('date')!))
        )
          errors.date = 'Vui lòng chọn ngày giao hợp lệ.'
        if (!products.some((product) => product.id === data.get('product')))
          return text('Invalid product', { status: 400 })
        if (Object.keys(errors).length) {
          if (intent === 'create') target.searchParams.set('modal', 'create')
          else {
            target.searchParams.set('view', 'record')
            target.searchParams.set('id', order!.id)
          }
          return render(target, errors, data)
        }
        const saved: Order = {
          id: order?.id ?? `SO-${nextId++}`,
          customer: data.get('customer')!.trim().slice(0, 200),
          address: data.get('address')!.trim().slice(0, 400),
          email: (data.get('email') ?? '').slice(0, 200),
          phone: (data.get('phone') ?? '').slice(0, 40),
          product: data.get('product')!,
          quantity,
          date: data.get('date')!,
          stage: order?.stage ?? 'draft',
          owner: data.get('owner') === 'Minh Anh' ? 'Minh Anh' : 'Ngọc Linh',
          payment: data.get('payment') === 'cod' ? 'cod' : 'transfer',
          priority: data.has('priority'),
          note: (data.get('note') ?? '').slice(0, 2000),
          history: [
            ...(order?.history ?? []),
            order ? 'Đã cập nhật thông tin đơn hàng.' : 'Đã tạo đơn hàng.',
          ],
        }
        if (order) Object.assign(order, saved)
        else orders.unshift(saved)
        target.searchParams.set('view', 'record')
        target.searchParams.set('id', saved.id)
      } else if (intent === 'note' && order) {
        const message = data.get('message')?.trim()
        if (!message) return text('Message required', { status: 422 })
        order.history.push(message.slice(0, 2000))
      } else if (intent === 'advance' || intent === 'bulk') {
        const ids = intent === 'bulk' ? data.getAll('ids') : [order?.id]
        for (const item of orders.filter((item) => ids.includes(item.id) && item.stage !== 'done')) {
          item.stage = stages[stages.indexOf(item.stage) + 1]
          item.history.push(`Đã chuyển sang: ${stageLabel[item.stage]}.`)
        }
      } else return text('Unsupported action', { status: 400 })
      target.searchParams.set('saved', '1')
      return redirect(target.pathname + target.search)
    },
  } as DemoRoutes<Base>
}

export const createDemo2Routes = () => createDemoRoutes({ basePath: '/demo2', context: 'submenu' })
