import { html, each, createRoot, domHost } from '@ketvietlab/ketjs-view'
import {
  FlowIcon,
  FlowButton,
  FlowLiveDoc,
  FlowInput,
  FlowSearch,
  FlowSelect,
  FlowCheckbox,
  FlowStatus,
  FlowPriority,
  FlowAvatar,
  FlowTag,
  FlowSegmented,
  FlowProgress,
  FlowEmpty,
  FlowDialog,
  FlowTaskRow,
  FlowTaskCard,
  FlowShell,
  FLOW_STATUSES,
} from '../src/index.mjs'
import {
  FlowCatalogEditor,
  FlowDateField,
  FlowUserPicker,
  FlowChoiceField,
  FlowFileDropzone,
  FlowDisclosure,
  FlowList,
  FlowListItem,
  FlowHint,
  FlowCalendarEvent,
  FlowRecordLayout,
  FlowRecordAsideTrigger,
  FlowScopeTabs,
  FlowSearchTrigger,
  FlowCheckboxField,
  FlowContextPicker,
  FlowAccessList,
  FlowProjectDirectory,
  FlowBrand,
  FlowScopeMenu,
  FlowUserMenu,
  FlowSpotlight,
  FlowFormGrid,
  FlowSetupForm,
  FlowTimeline,
  FlowTagPicker,
  FlowMetrics,
  FlowNotice,
  FlowToast,
  FlowSection,
  FlowProjectViews,
  FlowPropertyFields,
  FlowSelectField,
  FlowStack,
  FlowInline,
  FlowTextarea,
  FlowAtlasViewport,
  FlowAtlasWelcome,
} from '../src/workspace.mjs'
import { FlowDocTree } from '../src/documents.mjs'
import { attachFlowUI } from '../src/runtime.mjs'
import { initialTasks } from './fixtures.mjs'

const container = document.querySelector('#flow-demo')
const root = createRoot(domHost(), container)
const runtime = attachFlowUI(container)
const storageKey = 'flow-ui-demo:v1'
let tasks = structuredClone(initialTasks)
let demoFiles = []
let demoCatalog = [
  { id: 'todo', title: 'Chờ nhận', kind: 'todo', color: 'neutral' },
  { id: 'progress', title: 'Đang thực hiện', kind: 'progress', color: 'blue' },
  { id: 'done', title: 'Hoàn thành', kind: 'done', color: 'green' },
]
let demoDueDate = '2026-09-24'
let demoUsers = ['mai', 'bao', 'ha']
const demoUserOptions = [
  { id: 'mai', name: 'Mai Anh', email: 'mai@example.test' },
  { id: 'bao', name: 'Trần Quốc Bảo', email: 'bao@example.test' },
  { id: 'ha', name: 'Lê Thu Hà', email: 'ha@example.test' },
  { id: 'linh', name: 'Nguyễn Thị Phương Linh', email: 'linh@example.test' },
  { id: 'minh', name: 'Đặng Hoàng Minh', email: 'minh@example.test' },
]
let demoChoiceStatus = 'review',
  demoChoicePriority = 'high'
let demoTags = ['design']
try {
  const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null')
  if (
    Array.isArray(saved) &&
    saved.length &&
    saved.every(
      (t) =>
        typeof t.id === 'string' &&
        typeof t.title === 'string' &&
        typeof t.assignee === 'string' &&
        typeof t.project === 'string' &&
        typeof t.due === 'string' &&
        Object.hasOwn(FLOW_STATUSES, t.status) &&
        ['normal', 'high', 'urgent'].includes(t.priority),
    )
  )
    tasks = saved
} catch {
  /* The demo also works with storage disabled. */
}
let page = location.hash === '#workspace' ? 'workspace' : 'library'
let theme = 'light',
  density = 'compact',
  layout = 'list',
  query = '',
  status = 'all'
let selected = new Set(),
  detailId = tasks[0].id,
  toast = '',
  toastTone = 'success',
  toastTimer
let sampleDocs = [
  { id: 'root', title: 'Tài liệu dự án', parentId: null },
  { id: 'a', title: 'Hướng dẫn', parentId: 'root' },
  { id: 'b', title: 'Checklist', parentId: 'root' },
]
let sampleChecked = true,
  sampleView = 'list',
  sampleQuery = ''
const renderList = (items, render) => each(items, (item, index) => item.id ?? item.value ?? index, render)
const statusOptions = Object.entries(FLOW_STATUSES).map(([value, label]) => ({ value, label }))
const priorityOptions = [
  { value: 'normal', label: 'Bình thường' },
  { value: 'high', label: 'Cao' },
  { value: 'urgent', label: 'Khẩn cấp' },
]
const peopleOptions = ['Minh Anh', 'Thu Hà', 'Quang Huy'].map((value) => ({ value, label: value }))
const normalize = (value) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .toLowerCase()
const visibleTasks = () =>
  tasks.filter(
    (t) =>
      (status === 'all' || t.status === status) &&
      normalize(`${t.id} ${t.title} ${t.assignee}`).includes(normalize(query)),
  )

function dismissToast() {
  clearTimeout(toastTimer)
  toast = ''
  paint()
}
function resumeToast() {
  clearTimeout(toastTimer)
  if (toastTone === 'success') toastTimer = setTimeout(dismissToast, 4000)
}
function notify(message, tone = 'success') {
  toast = message
  toastTone = tone
  paint()
  resumeToast()
}
function persist() {
  try {
    localStorage.setItem(storageKey, JSON.stringify(tasks))
  } catch {
    notify('Trình duyệt không cho phép lưu; thay đổi chỉ giữ trong phiên này.')
  }
}
function navigate(next, anchor) {
  page = next
  selected.clear()
  location.hash = next === 'workspace' ? 'workspace' : (anchor ?? 'library')
  paint()
  if (anchor)
    requestAnimationFrame(() => document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth' }))
  else document.getElementById('demo-page-start')?.scrollIntoView()
}
function openTask(task) {
  detailId = task.id
  paint()
  document.querySelector('#flow-detail form').reset()
  runtime.open('flow-detail')
}
function completeSelected() {
  const count = selected.size
  tasks = tasks.map((t) => (selected.has(t.id) ? { ...t, status: 'done' } : t))
  selected.clear()
  persist()
  notify(`Đã hoàn tất ${count} công việc.`)
}
function filterChanged() {
  selected.clear()
  paint()
}
function submitTask(event) {
  event.preventDefault()
  const form = event.currentTarget
  const data = new FormData(form)
  const title = String(data.get('task-title') ?? '').trim()
  const titleInput = form.elements.namedItem('task-title')
  if (!title || title.length > 180) {
    titleInput.setCustomValidity('Nhập tên công việc từ 1 đến 180 ký tự.')
    titleInput.reportValidity()
    return
  }
  tasks.push({
    id: `FLW-${Math.max(...tasks.map((t) => Number(t.id.split('-')[1]) || 0)) + 1}`,
    title,
    project: 'Flow · Trải nghiệm sản phẩm',
    status: 'todo',
    priority: form.querySelector('[aria-label="Độ ưu tiên mới"]').value,
    assignee: form.querySelector('[aria-label="Người phụ trách mới"]').value,
    due: 'Chưa đặt',
  })
  persist()
  document.getElementById('flow-create').close()
  form.reset()
  status = 'all'
  query = ''
  page = 'workspace'
  notify('Đã tạo công việc mới.')
}
const navButton = (label, icon, next, active, number) =>
  html`<button type="button" aria-current=${active ? 'page' : null} on:click=${next}>
    ${FlowIcon(icon)}${label}${number ? html`<small>${number}</small>` : null}
  </button>`
const specimen = (title, api, body, wide = false) =>
  html`<section class=${`demo-specimen ${wide ? 'demo-wide' : ''}`}>
    <div class="demo-specimen-head"><strong>${title}</strong><span>${api}</span></div>
    <div class="demo-specimen-body">${body}</div>
  </section>`
const sectionHeading = (id, title, detail) =>
  html`<div class="demo-section-heading" id=${id}>
    <h2>${title}</h2>
    <span>${detail}</span>
  </div>`
const table = (rows, interactive = true) =>
  html`<div class="demo-table-wrap">
    <table class="demo-table" aria-label="Danh sách công việc">
      <thead>
        <tr>
          <th>
            ${
              interactive
                ? FlowCheckbox({
                    label: 'Chọn tất cả công việc đang hiển thị',
                    checked: rows.length > 0 && rows.every((t) => selected.has(t.id)),
                    onChange: () => {
                      selected = rows.every((t) => selected.has(t.id))
                        ? new Set()
                        : new Set(rows.map((t) => t.id))
                      paint()
                    },
                  })
                : null
            }
          </th>
          <th>Công việc</th>
          <th>Trạng thái</th>
          <th>Ưu tiên</th>
          <th>Phụ trách</th>
          <th>Hạn</th>
        </tr>
      </thead>
      <tbody>
        ${renderList(rows, (task) =>
          FlowTaskRow({
            task,
            selected: selected.has(task.id),
            dragCount: selected.has(task.id) ? rows.filter((t) => selected.has(t.id)).length : 1,
            onSelect: () => {
              selected.has(task.id) ? selected.delete(task.id) : selected.add(task.id)
              paint()
            },
            onDropTask: (id, position) => {
              const ids = selected.has(id)
                ? new Set(rows.filter((t) => selected.has(t.id)).map((t) => t.id))
                : new Set([id])
              const moving = tasks.filter((t) => ids.has(t.id))
              if (!moving.length || ids.has(task.id)) return
              tasks = tasks.filter((t) => !ids.has(t.id))
              tasks.splice(
                tasks.findIndex((t) => t.id === task.id) + (position === 'after' ? 1 : 0),
                0,
                ...moving,
              )
              localStorage.setItem(storageKey, JSON.stringify(tasks))
              paint()
            },
            onOpen: () => openTask(task),
          }),
        )}
      </tbody>
    </table>
  </div>`

let scopeDemoTab = 'overview'
let spotlightOpen = false,
  spotlightQuery = '',
  spotlightActive = ''
function library() {
  return html` <div class="demo-hero">
      <div>
        <div class="demo-label">Flow UI / Thư viện giao diện</div>
        <h2>Gọn hơn. <em>Rõ việc hơn.</em></h2>
        <p>
          Một bộ giao diện dành riêng cho nhịp làm việc của Flow.<br />Nhẹ về hình thức, đủ chỗ cho
          những điều quan trọng.
        </p>
        <div class="demo-meta">
          ${FlowTag({ label: 'Phiên bản 0.1', tone: 'green' })}${FlowTag({ label: '17 component' })}<span
            class="demo-caption"
            >Thiết kế cho không gian làm việc dày thông tin</span
          >
        </div>
      </div>
      <div class="demo-hero-right">
        ${FlowButton({ label: 'Mở không gian mẫu', variant: 'primary', icon: 'arrow', onClick: () => navigate('workspace') })}
      </div>
    </div>
    <div class="demo-principles">
      <div class="demo-principle">
        <strong>14</strong><span>px · Cỡ chữ cơ sở<br />Đọc rõ, ít chiếm chỗ</span>
      </div>
      <div class="demo-principle">
        <strong>28</strong><span>px · Nút nhỏ<br />Vừa vặn trên thanh công cụ</span>
      </div>
      <div class="demo-principle">
        <strong>36</strong><span>px · Hàng gọn<br />Nhiều việc trong một tầm nhìn</span>
      </div>
      <div class="demo-principle">
        <strong>44</strong><span>px · Vùng chạm<br />Thoải mái trên điện thoại</span>
      </div>
    </div>
    ${FlowSection({
      title: 'Tổ chức → Workspace → Project',
      children: html`${FlowCheckboxField({ label: 'Giữ quyền khi chuyển Workspace', checked: true, onChange: () => {} })}${FlowContextPicker({ companyId: 'demo', workspaceId: 'product', companies: [{ id: 'demo', name: 'Két Việt' }], workspaces: [{ id: 'product', title: 'Sản phẩm' }], onManage: () => {}, onWorkspace: () => {} })}${FlowUserMenu(
        {
          name: 'Mai Anh',
          companyId: 'demo',
          companies: [
            { id: 'demo', name: 'Két Việt' },
            { id: 'north', name: 'Northstar Studio' },
          ],
          onCompany: () => {},
          items: [
            { label: 'Cài đặt cá nhân', onClick: () => {} },
            { label: 'Tổ chức · Két Việt', onClick: () => {} },
          ],
        },
      )}${FlowAccessList({
        rows: [
          {
            id: 'bao',
            name: 'Trần Quốc Bảo',
            role: 'Chỉnh sửa',
            sources: 'Team Engineering → Workspace Sản phẩm',
            status: 'Đang hoạt động',
          },
          {
            id: 'guest',
            name: 'An · Khách hàng',
            role: 'Chỉ xem',
            sources: 'Cấp trực tiếp · Project Tài liệu khách hàng',
          },
        ],
      })}${FlowProjectDirectory({ projects: [{ id: 'core', title: 'KetSuite Core', favorite: true, href: '#workspace', onOpen: () => navigate('workspace') }] })}`,
    })}
    ${FlowScopeTabs({
      label: 'Quản lý Workspace mẫu',
      value: scopeDemoTab,
      options: [
        { value: 'overview', label: 'Tổng quan', icon: 'grid', href: '#overview' },
        { value: 'quality', label: 'Bàn giao & chất lượng', icon: 'check', href: '#quality' },
        { value: 'members', label: 'Thành viên', icon: 'list', href: '#members' },
        { value: 'settings', label: 'Cài đặt', icon: 'settings', href: '#settings' },
      ],
      onChange: (value) => {
        scopeDemoTab = value
        paint()
      },
    })}
    ${FlowSection({ title: 'Bố cục lồng nhau', description: 'Mô tả thuộc tiêu đề; section ngoài sở hữu lề trang.', children: html`${FlowListItem({ title: 'Thông tin độc lập', description: 'Cùng lề tiêu đề, không tự thêm padding hoặc đường phân cách.', actions: FlowButton({ label: 'Xem chi tiết', size: 'sm' }) })}${FlowSection({ inset: 'none', title: 'Danh sách có container', actions: FlowButton({ label: 'Thêm mục', size: 'sm' }), children: FlowList({ children: html`${FlowListItem({ title: 'Mục thứ nhất', description: 'Container danh sách sở hữu padding và đường phân cách.' })}${FlowListItem({ title: 'Mục thứ hai', description: 'Dùng cùng component dòng; không cần tự đặt khoảng cách.' })}` }) })}` })}
    ${sectionHeading('foundations', '01 — Nền tảng', 'Bình tĩnh, rõ ràng, nhất quán')}
    <div class="demo-grid">
      ${specimen(
        'Bảng màu',
        'KétJS · tokens.css',
        html`<div class="demo-colors">
          ${renderList(
            [
              ['Chủ đạo', '--kv-accent'],
              ['Chữ', '--kv-text-main'],
              ['Nền phụ', '--kv-panel-bg-subtle'],
              ['Chờ duyệt', '--kv-warning'],
              ['Cảnh báo', '--kv-danger'],
            ],
            ([name, token]) =>
              html`<div>
                <div class="demo-swatch" style=${`background:var(${token})`}></div>
                <span class="demo-color-name">${name}</span
                ><span class="demo-color-value" title=${token}>${token}</span>
              </div>`,
          )}
        </div>`,
      )}
      ${specimen(
        'Trạng thái công việc',
        'FlowStatus',
        html`<div class="demo-statuses">
            ${renderList(Object.keys(FLOW_STATUSES), (status) => FlowStatus({ status }))}${FlowStatus({ status: 'review', label: 'Kiểm chứng · màu dự án', color: 'red' })}
          </div>
          <p class="demo-caption">
            Màu sắc đi cùng ký hiệu và nhãn, dễ nhận biết ở mọi trạng thái.
          </p>`,
      )}
    </div>
    ${sectionHeading('controls', '02 — Thao tác & nhập liệu', 'Nhỏ vừa đủ. Tương tác đầy đủ.')}
    <div class="demo-grid">
      ${specimen(
        'Nút thao tác',
        'FlowButton',
        html`<div class="demo-row">
            ${FlowButton({ label: 'Tạo công việc', variant: 'primary', icon: 'plus', onClick: () => runtime.open('flow-create') })}${FlowButton({ label: 'Chỉnh sửa', onClick: () => openTask(tasks[0]) })}${FlowButton({ label: 'Xem tất cả', variant: 'ghost', icon: 'arrow', onClick: () => navigate('workspace') })}
          </div>
          <div class="demo-row">
            ${FlowButton({ label: 'Nút nhỏ', size: 'sm', onClick: () => notify('Nút nhỏ · cao 28px ở mật độ gọn.') })}${FlowButton({ label: 'Đang lưu', loading: true, size: 'sm' })}${FlowButton({ label: 'Chưa khả dụng', disabled: true, size: 'sm' })}${FlowButton({ label: 'Xóa mẫu', variant: 'danger', size: 'sm', onClick: () => runtime.open('flow-reset') })}
          </div>`,
      )}
      ${specimen(
        'Thao tác cuối biểu mẫu',
        'FlowStack · FlowInline align=end',
        FlowStack({
          children: html`${FlowTextarea({ id: 'sample-comment', label: 'Bình luận', placeholder: 'Viết phản hồi…' })}${FlowButton({ label: 'Gửi bình luận', variant: 'primary', onClick: () => notify('Đã gửi bình luận mẫu.') })}${FlowInline({ align: 'end', children: html`${FlowButton({ label: 'Hủy', onClick: () => notify('Đã hủy thao tác mẫu.') })}${FlowButton({ label: 'Lưu thay đổi', variant: 'primary', onClick: () => notify('Đã lưu thay đổi mẫu.') })}` })}`,
        }),
      )}
      ${specimen(
        'Thuộc tính sidebar của task',
        'FlowPropertyFields · nhãn 13px / giá trị 14px',
        FlowPropertyFields({
          children: html`${FlowSelectField({
            name: 'sample-property-assignee',
            label: 'Người phụ trách',
            icon: 'user',
            value: 'mai',
            options: [
              { value: 'mai', label: 'Mai Anh' },
              { value: 'bao', label: 'Trần Quốc Bảo' },
            ],
          })}${FlowSelectField({
            name: 'sample-property-priority',
            label: 'Ưu tiên',
            icon: 'flag',
            value: 'high',
            options: [
              { value: 'normal', label: 'Bình thường' },
              { value: 'high', label: 'Cao' },
            ],
          })}${FlowInput({ id: 'sample-property-date', label: 'Hạn hoàn thành', icon: 'calendar', type: 'date', value: '2026-09-24' })}`,
        }),
      )}
      ${specimen(
        'Lịch trình có cuộn ngang',
        'FlowTimeline · Tuần',
        FlowTimeline({
          label: 'Lịch trình mẫu',
          mode: 'week',
          focusKey: 'demo-week',
          focusIndex: 20,
          days: Array.from({ length: 40 }, (_, i) => ({
            id: `demo-day-${i}`,
            label: String((i % 30) + 1),
            today: i === 20,
            focused: i === 20,
          })),
          groups: [
            { id: 'sample-month', label: 'Tháng 9 · 2026', start: 1, span: 30 },
            { id: 'sample-next', label: 'Tháng 10 · 2026', start: 31, span: 10 },
          ],
          rows: [
            {
              id: 'FLW-142',
              title: 'Hoàn thiện trải nghiệm Flow',
              start: 19,
              span: 7,
              dateLabel: '19/09 → 25/09',
              onSchedule: ({ mode, days }) => notify(`Lịch mẫu: ${mode} ${days} ngày`),
              onOpen: () => openTask(tasks[0]),
            },
          ],
        }),
      )}
      ${specimen(
        'Menu theo phạm vi',
        'FlowScopeMenu',
        FlowScopeMenu({
          label: 'Công cụ dự án',
          items: [
            { label: 'Tự động hóa', onClick: () => notify('Tự động hóa của dự án hiện tại') },
            { label: 'Biểu mẫu tiếp nhận', onClick: () => notify('Biểu mẫu của dự án hiện tại') },
          ],
        }),
      )}
      ${specimen(
        'View dự án',
        'FlowProjectViews',
        FlowProjectViews({
          value: 'project-issues',
          options: [
            { value: 'board', label: 'Bảng', icon: 'board' },
            { value: 'project-issues', label: 'Danh sách', icon: 'list' },
          ],
          views: [{ id: 'week', title: 'Cần chú ý trong tuần' }],
          canSave: true,
          onChange: () => notify('Chuyển view mẫu.'),
          onView: () => notify('Mở view đã lưu mẫu.'),
          onSave: () => notify('Form lưu view mở trong modal của ứng dụng.'),
        }),
      )}
      ${specimen(
        'LiveDoc',
        'Tài liệu và mô tả công việc · editor dùng chung',
        FlowLiveDoc({
          id: 'demo-live-doc',
          label: 'Nội dung',
          blocks: [
            { id: 'hello', type: 'heading', text: 'LiveDoc' },
            { id: 'body', type: 'paragraph', text: 'Soạn thảo ngay tại đây.' },
            {
              id: 'table',
              type: 'table',
              rows: [
                ['Hạng mục', 'Kết quả'],
                ['Editor', 'LiveDoc'],
              ],
            },
          ],
          onChange: () => {},
        }),
      )}
      ${specimen(
        'Cấu trúc tài liệu',
        'FlowDocTree · kéo giữa các mục cùng cấp',
        FlowDocTree({
          onCreate: () => notify('Tạo tài liệu mẫu.'),
          onAddChild: () => notify('Tạo tài liệu con mẫu.'),
          items: sampleDocs,
          active: 'a',
          collapsed: [],
          onOpen: () => notify('Mở tài liệu mẫu.'),
          onToggle: () => {},
          onReorder: (id, targetId, position) => {
            const item = sampleDocs.find((p) => p.id === id)
            sampleDocs = sampleDocs.filter((p) => p.id !== id)
            sampleDocs.splice(
              sampleDocs.findIndex((p) => p.id === targetId) + (position === 'after' ? 1 : 0),
              0,
              item,
            )
            paint()
          },
        }),
      )}
      ${specimen(
        'Spotlight',
        'FlowSpotlight · tìm kiếm và bàn phím',
        FlowButton({
          label: 'Mở Spotlight',
          onClick: () => {
            spotlightOpen = true
            spotlightQuery = ''
            spotlightActive = ''
            paint()
          },
        }),
      )}
      ${specimen('Thuộc tính task trên tablet', 'FlowRecordLayout · popover dưới 1200px', FlowButton({ label: 'Mở modal task responsive', onClick: () => runtime.open('flow-responsive-task') }))}
      ${specimen('Khối thông báo canh giữa', 'FlowSection · width=reading', FlowSection({ title: 'Cập nhật dành cho bạn', width: 'reading', children: FlowNotice({ title: 'Bạn được giao công việc mới', message: 'Rà soát nội dung phát hành.', tone: 'yellow', action: FlowButton({ label: 'Mở', onClick: () => notify('Mở thông báo mẫu.') }) }) }))}
      ${specimen(
        'Tìm kiếm & lựa chọn',
        'FlowSearchTrigger · FlowSearch · FlowSegmented',
        html`${FlowSearchTrigger({ onClick: () => notify('Mở tìm kiếm Flow') })}<div class="demo-row">
            ${FlowSearch({
              label: 'Tìm component',
              placeholder: 'Tìm component…',
              value: sampleQuery,
              onInput: (e) => {
                sampleQuery = e.target.value
                paint()
              },
            })}
          </div>
          <div class="demo-row">
            ${FlowSegmented({
              label: 'Chế độ xem mẫu',
              value: sampleView,
              options: [
                { value: 'list', label: 'Danh sách', icon: 'list' },
                { value: 'board', label: 'Bảng', icon: 'board' },
              ],
              onChange: (value) => {
                sampleView = value
                paint()
              },
            })}${FlowCheckbox({
              label: 'Thông báo khi có cập nhật',
              checked: sampleChecked,
              onChange: () => {
                sampleChecked = !sampleChecked
                paint()
              },
            })}<span class="demo-caption">Thông báo cập nhật</span>${FlowCheckbox({ label: 'Chọn tất cả · chọn một phần', checked: false, indeterminate: true })}
          </div>
          <p class="demo-caption">
            ${sampleQuery ? `Từ khóa: ${sampleQuery}` : `Đã chọn chế độ ${sampleView === 'list' ? 'danh sách' : 'bảng'}.`}
          </p>`,
      )}
      ${specimen('Trường nhập & phản hồi', 'FlowInput', html`<div class="demo-form-row">${FlowInput({ id: 'sample-name', label: 'Tên dự án', placeholder: 'Ví dụ: Flow 1.0' })}${FlowInput({ id: 'sample-error', label: 'Mã dự án', value: 'FLOW SPACE', error: 'Chỉ dùng chữ và số.' })}</div>`)}
      ${specimen(
        'Thành viên & độ ưu tiên',
        'FlowAvatar · FlowPriority',
        html`<div class="demo-row">
            ${renderList(peopleOptions, (p) => FlowAvatar({ name: p.value, size: 'md' }))}<span
              class="demo-caption"
              >Một nhóm, cùng tiến độ</span
            >
          </div>
          <div class="demo-row">
            ${renderList(['normal', 'high', 'urgent'], (priority) => FlowPriority({ priority }))}
          </div>`,
      )}
    </div>
    ${sectionHeading('work', '03 — Thành phần công việc', 'Bấm vào công việc để xem và chỉnh sửa')}
    <section class="demo-specimen">
      <div class="demo-specimen-head">
        <strong>Danh sách công việc</strong><span>FlowTaskRow</span>
      </div>
      ${table(tasks.slice(0, 4))}
      <div class="demo-table-footer">
        <span
          >${selected.size ? `${selected.size} công việc đã chọn` : '4 công việc mẫu · thao tác trực tiếp trên từng hàng'}</span
        ><span>Compact / 36px</span>
      </div>
    </section>
    <div class="demo-grid" style="margin-top:var(--kv-space-5)">
      ${specimen('Thẻ công việc', 'FlowTaskCard', FlowTaskCard({ task: tasks[0], onOpen: () => openTask(tasks[0]) }))}
      ${specimen(
        'Nhãn & tiến độ',
        'FlowTag · FlowTagPicker · FlowProgress',
        html`${FlowTagPicker({
          id: 'demo-tags',
          value: demoTags,
          options: [
            { id: 'design', title: 'Thiết kế', color: 'blue' },
            { id: 'release', title: 'Phát hành', color: 'green' },
            { id: 'risk', title: 'Rủi ro', color: 'red' },
          ],
          onChange: (ids) => {
            demoTags = ids
            paint()
          },
        })}<div class="demo-row">
            ${FlowTag({ label: 'Thiết kế', tone: 'green' })}${FlowTag({ label: 'Cần phản hồi', tone: 'yellow' })}${FlowTag({ label: 'Đang bị chặn', tone: 'red' })}${FlowTag({ label: 'Sprint 12' })}
          </div>
          <div>
            <div
              class="demo-row"
              style="justify-content:space-between;margin-bottom:var(--kv-space-2-5)"
            >
              <span class="demo-caption">Tiến độ công việc mẫu</span
              ><span class="demo-caption"
                >${tasks.filter((t) => t.status === 'done').length}/${tasks.length}</span
              >
            </div>
            ${FlowProgress({ value: tasks.filter((t) => t.status === 'done').length, total: tasks.length, label: 'Tiến độ công việc mẫu' })}
          </div>`,
      )}
    </div>
    ${specimen(
      'Card thống kê & thông báo',
      'FlowMetrics · FlowNotice',
      FlowStack({
        children: html`${FlowMetrics({
          items: [
            { label: 'Hoàn thành', value: 3, tone: 'green' },
            { label: 'Quá hạn', value: 2, tone: 'red' },
          ],
        })}${FlowNotice({ title: 'Cần chú ý trong tuần', message: 'Ưu tiên cao · chưa hoàn thành', action: FlowButton({ label: 'Mở view', onClick: () => navigate('workspace') }) })}${FlowNotice({ title: 'Bạn được giao KV-142', message: 'Đồng bộ tồn phòng giữa hai nguồn', tone: 'yellow' })}`,
      }),
    )}
    ${specimen('Nội dung theo tác vụ', 'FlowDisclosure · FlowList · FlowHint · FlowCalendarEvent', html`${FlowList({ children: FlowListItem({ title: 'KV-142 · Đầu ra bàn giao', description: 'Mai Anh · hôm nay', unread: true, meta: FlowTag({ label: 'Chờ nghiệm thu' }) }) })}${FlowDisclosure({ title: 'Căn cứ và nguồn dữ liệu', children: FlowHint({ children: 'Mở phần chi tiết khi cần; danh sách giữ ngắn và dễ quét.' }) })}${FlowCalendarEvent({ label: 'Mốc phát hành', title: 'Bàn giao phiên bản', meta: 'Mai Anh', onClick: () => {} })}`)}
    ${specimen(
      'Tùy chỉnh trạng thái gọn',
      'FlowCatalogEditor · FlowColorPicker',
      FlowCatalogEditor({
        id: 'demo-catalog',
        items: demoCatalog,
        status: true,
        kindOptions: [
          { value: 'todo', label: 'Chưa bắt đầu' },
          { value: 'progress', label: 'Đang thực hiện' },
          { value: 'done', label: 'Hoàn thành' },
        ],
        onChange: (items) => {
          demoCatalog = items
          paint()
        },
      }),
    )}
    ${specimen('Thông tin phạm vi không viền', 'FlowListItem · plain', FlowListItem({ variant: 'plain', title: 'Vận hành', description: 'Quản lý thông tin, thành viên và Team của Workspace.', actions: FlowInline({ children: html`${FlowButton({ label: 'Thông tin Workspace', icon: 'settings', variant: 'ghost', size: 'sm' })}${FlowButton({ label: 'Thành viên', icon: 'user', variant: 'ghost', size: 'sm' })}` }) }))}
    ${specimen('Phản hồi thao tác', 'FlowToast', FlowInline({ children: html`${FlowButton({ label: 'Thành công', onClick: () => notify('Đã lưu thay đổi.') })}${FlowButton({ label: 'Lỗi có thể thử lại', onClick: () => notify('Kết nối gián đoạn. Thay đổi chưa được lưu.', 'error') })}${FlowButton({ label: 'Cảnh báo', onClick: () => notify('Kết quả chưa đầy đủ. Hãy thu hẹp bộ lọc.', 'warning') })}` }))}
    ${specimen(
      'Chọn nhiều người · Sidebar & list',
      'FlowUserPicker',
      FlowStack({
        children: html`${FlowPropertyFields({
          children: FlowUserPicker({
            id: 'demo-users',
            label: 'Người phụ trách',
            size: 'md',
            value: demoUsers,
            options: demoUserOptions,
            onChange: (ids) => {
              demoUsers = ids
              paint()
            },
          }),
        })}${FlowUserPicker({
          id: 'demo-users-compact',
          label: 'Người phụ trách',
          size: 'sm',
          value: demoUsers,
          options: demoUserOptions,
          onChange: (ids) => {
            demoUsers = ids
            paint()
          },
        })}`,
      }),
    )}
    ${specimen(
      'Trạng thái & ưu tiên có màu',
      'FlowChoiceField',
      FlowPropertyFields({
        children: html`${FlowChoiceField({
          id: 'demo-choice-status',
          label: 'Trạng thái',
          icon: 'status',
          value: demoChoiceStatus,
          options: Object.entries(FLOW_STATUSES).map(([value, label]) => ({
            value,
            label,
            content: FlowStatus({ status: value, label }),
          })),
          onChange: (value) => {
            demoChoiceStatus = value
            paint()
          },
        })}${FlowChoiceField({
          id: 'demo-choice-priority',
          label: 'Ưu tiên',
          icon: 'flag',
          value: demoChoicePriority,
          options: priorityOptions.map((o) => ({ ...o, content: FlowPriority({ priority: o.value }) })),
          onChange: (value) => {
            demoChoicePriority = value
            paint()
          },
        })}`,
      }),
    )}
    ${specimen(
      'Chỉnh nhanh trong danh sách',
      'FlowChoiceField · sm / FlowDateField',
      FlowInline({
        children: html`${FlowChoiceField({
          id: 'demo-list-status',
          label: 'Trạng thái công việc mẫu',
          size: 'sm',
          value: demoChoiceStatus,
          options: Object.entries(FLOW_STATUSES).map(([value, label]) => ({
            value,
            label,
            content: FlowStatus({ status: value, label }),
          })),
          onChange: (value) => {
            demoChoiceStatus = value
            paint()
          },
        })}${FlowChoiceField({
          id: 'demo-list-priority',
          label: 'Ưu tiên công việc mẫu',
          size: 'sm',
          value: demoChoicePriority,
          options: priorityOptions.map((o) => ({ ...o, content: FlowPriority({ priority: o.value }) })),
          onChange: (value) => {
            demoChoicePriority = value
            paint()
          },
        })}${FlowDateField({
          id: 'demo-list-due',
          label: 'Hạn hoàn thành công việc mẫu',
          value: demoDueDate,
          onChange: (value) => {
            demoDueDate = value
            paint()
          },
        })}`,
      }),
    )}
    ${specimen(
      'Tệp đính kèm',
      'FlowFileDropzone',
      FlowFileDropzone({
        id: 'demo-file-picker',
        files: demoFiles,
        onChange: (files) => {
          demoFiles = files
          paint()
        },
      }),
    )}
    ${specimen('Form thiết lập', 'FlowSetupForm · FlowFormGrid', FlowSetupForm({ onSubmit: (e) => e.preventDefault(), children: FlowFormGrid({ children: html`${FlowInput({ id: 'setup-name', label: 'Tên dự án' })}${FlowInput({ id: 'setup-code', label: 'Mã dự án' })}` }), actions: FlowButton({ label: 'Tạo dự án', type: 'submit', variant: 'primary' }) }))}
      ${specimen('Atlas chưa kết nối', 'FlowAtlasWelcome', FlowAtlasWelcome({ projectName: 'Không gian thiết kế', action: FlowButton({ label: 'Kết nối GitHub', variant: 'primary', onClick: () => navigate('workspace') }) }))}
    ${specimen('Atlas trong dự án', 'FlowAtlasViewport · host của KetAtlas', FlowAtlasViewport({ label: 'Atlas demo', children: FlowEmpty({ title: 'Atlas', description: 'Viewer KetAtlas được gắn vào vùng này sau khi chọn repository, nhánh và bundle.' }) }))}
    ${sectionHeading('feedback', '04 — Trạng thái & hội thoại', 'Đủ hướng dẫn để bước tiếp')}
    <div class="demo-grid">
      ${specimen('Khi chưa có công việc', 'FlowEmpty', FlowEmpty({ title: 'Bắt đầu từ một việc nhỏ', description: 'Tạo công việc đầu tiên để cả nhóm biết điều gì cần làm tiếp theo.', action: FlowButton({ label: 'Tạo công việc', icon: 'plus', onClick: () => runtime.open('flow-create') }) }))}
      ${specimen(
        'Hội thoại tập trung',
        'FlowDialog',
        html`<strong style="font-size:var(--kv-text-xl);font-weight:var(--kv-weight-medium)"
            >Một thao tác, một điểm tập trung.</strong
          >
          <p class="demo-caption">
            Giữ ngữ cảnh phía sau. Tab để di chuyển, Escape để đóng và trở lại đúng nơi vừa mở.
          </p>
          <div class="demo-row">
            ${FlowButton({ label: 'Thử tạo công việc', variant: 'primary', icon: 'plus', onClick: () => runtime.open('flow-create') })}${FlowButton({ label: 'Thử xác nhận', onClick: () => runtime.open('flow-reset') })}
          </div>`,
      )}
    </div>`
}

function workspace() {
  const rows = visibleTasks()
  return html`<div class="demo-viewbar">
      ${FlowSegmented({
        label: 'Chế độ xem công việc',
        appearance: 'underline',
        value: layout,
        options: [
          { value: 'list', label: 'Danh sách', icon: 'list' },
          { value: 'board', label: 'Bảng', icon: 'board' },
        ],
        onChange: (value) => {
          layout = value
          selected.clear()
          paint()
        },
      })}
      <div class="demo-view-context">
        <span>Trải nghiệm sản phẩm</span>${FlowTag({ label: 'Sprint 12' })}
      </div>
    </div>
    <div class="demo-toolbar">
      <div class="demo-toolbar-actions">
        ${FlowSearch({
          label: 'Tìm công việc',
          placeholder: 'Tìm tên, mã, thành viên…',
          value: query,
          onInput: (e) => {
            query = e.target.value
            filterChanged()
          },
        })}
        ${FlowSelect({
          label: 'Lọc trạng thái',
          value: status,
          options: [{ value: 'all', label: 'Mọi trạng thái' }, ...statusOptions],
          onChange: (e) => {
            status = e.target.value
            filterChanged()
          },
        })}
      </div>
      <span class="demo-result-count">${rows.length} công việc</span>
    </div>
    <dl class="demo-stats" aria-label="Tổng quan công việc đang hiển thị">
      <div>
        <dt>Tổng công việc</dt>
        <dd>${rows.length}</dd>
      </div>
      ${renderList(
        Object.entries(FLOW_STATUSES),
        ([value]) =>
          html`<div>
            <dt>${FlowStatus({ status: value })}</dt>
            <dd>${rows.filter((t) => t.status === value).length}</dd>
          </div>`,
      )}
    </dl>
    ${
      selected.size
        ? html`<div class="demo-bulk">
            <span>Đã chọn ${selected.size} công việc</span
            >${FlowButton({ label: 'Đánh dấu hoàn tất', icon: 'check', variant: 'primary', size: 'sm', onClick: completeSelected })}${FlowButton(
              {
                label: 'Bỏ chọn',
                variant: 'ghost',
                size: 'sm',
                onClick: () => {
                  selected.clear()
                  paint()
                },
              },
            )}
          </div>`
        : null
    }
    ${
      rows.length === 0
        ? FlowEmpty({
            title: 'Không tìm thấy công việc',
            description: 'Thử từ khóa khác hoặc bỏ bộ lọc để xem lại công việc của nhóm.',
            action: FlowButton({
              label: 'Xóa bộ lọc',
              onClick: () => {
                query = ''
                status = 'all'
                filterChanged()
              },
            }),
          })
        : layout === 'list'
          ? html`<section class="demo-specimen">
              ${table(rows)}
              <div class="demo-table-footer">
                <span>${rows.length} / ${tasks.length} công việc</span
                ><span>Thay đổi được lưu trên trình duyệt này</span>
              </div>
            </section>`
          : html`<div class="demo-board">
              ${renderList(
                Object.entries(FLOW_STATUSES),
                ([key, label]) =>
                  html`<section class="demo-board-column" aria-label=${label}>
                    <h3>
                      ${FlowStatus({ status: key })}<span
                        >${rows.filter((t) => t.status === key).length}</span
                      >
                    </h3>
                    ${renderList(
                      rows.filter((t) => t.status === key),
                      (task) => FlowTaskCard({ task, onOpen: () => openTask(task) }),
                    )}${rows.some((t) => t.status === key) ? null : html`<div class="demo-board-empty">Chưa có công việc</div>`}
                  </section>`,
              )}
            </div>`
    }
    <p class="demo-notice">
      Đây là không gian thử component. Dữ liệu mẫu được lưu trong trình duyệt, chưa kết nối với dự
      án thật.
    </p>`
}

function dialogs() {
  const task = tasks.find((t) => t.id === detailId) ?? tasks[0]
  return html`${FlowDialog({
    id: 'flow-create',
    title: 'Tạo công việc',
    body: html`<form class="demo-form" on:submit=${submitTask}>
      ${FlowInput({ id: 'task-title', label: 'Tên công việc', placeholder: 'Cần làm gì tiếp theo?', required: true, onInput: (e) => e.target.setCustomValidity('') })}
      <div class="demo-form-row">
        <label
          >Người phụ
          trách${FlowSelect({ label: 'Người phụ trách mới', value: 'Minh Anh', options: peopleOptions })}</label
        ><label
          >Độ ưu
          tiên${FlowSelect({ label: 'Độ ưu tiên mới', value: 'normal', options: priorityOptions })}</label
        >
      </div>
      <p class="demo-caption">Dự án: Flow · Trải nghiệm sản phẩm</p>
      <div class="demo-form-actions">
        ${FlowButton({ label: 'Tạo công việc', variant: 'primary', type: 'submit', icon: 'plus' })}
      </div>
    </form>`,
  })}
  ${FlowDialog({
    id: 'flow-detail',
    title: task.id,
    body: html`<form
      class="demo-form"
      on:submit=${(e) => {
        e.preventDefault()
        const form = e.currentTarget
        const title = form.querySelector('#detail-title').value.trim()
        if (!title || title.length > 180) {
          const input = form.querySelector('#detail-title')
          input.setCustomValidity('Nhập tên công việc từ 1 đến 180 ký tự.')
          input.reportValidity()
          return
        }
        tasks = tasks.map((t) =>
          t.id === task.id
            ? {
                ...t,
                title,
                status: form.querySelector('[aria-label="Trạng thái công việc"]').value,
                assignee: form.querySelector('[aria-label="Người phụ trách"]').value,
                priority: form.querySelector('[aria-label="Độ ưu tiên"]').value,
              }
            : t,
        )
        persist()
        document.getElementById('flow-detail').close()
        notify(`Đã cập nhật ${task.id}.`)
      }}
    >
      <div class="demo-detail-meta">
        ${FlowStatus({ status: task.status })}${FlowTag({ label: 'Sprint 12' })}
      </div>
      ${FlowInput({ id: 'detail-title', label: 'Tên công việc', value: task.title, required: true, onInput: (e) => e.target.setCustomValidity('') })}
      <div class="demo-form-row">
        <label
          >Trạng
          thái${FlowSelect({ label: 'Trạng thái công việc', value: task.status, options: statusOptions })}</label
        ><label
          >Người phụ
          trách${FlowSelect({ label: 'Người phụ trách', value: task.assignee, options: peopleOptions })}</label
        >
      </div>
      <label class="demo-form"
        >Độ ưu
        tiên${FlowSelect({ label: 'Độ ưu tiên', value: task.priority, options: priorityOptions })}</label
      >
      <div class="demo-form-actions">
        ${FlowButton({ label: 'Lưu thay đổi', variant: 'primary', type: 'submit', icon: 'check' })}
      </div>
    </form>`,
  })}
  ${
    spotlightOpen
      ? FlowSpotlight({
          id: 'demo-spotlight',
          query: spotlightQuery,
          activeId: spotlightActive,
          scope: 'Két Việt',
          groups: [
            {
              id: 'tasks',
              label: 'Công việc',
              items: tasks
                .filter((t) => t.title.toLowerCase().includes(spotlightQuery.toLowerCase()))
                .slice(0, 6)
                .map((t) => ({ id: t.id, title: t.title, description: t.id, icon: 'list' })),
            },
          ],
          onQuery: (value) => {
            spotlightQuery = value
            spotlightActive = ''
            paint()
          },
          onActive: (id) => {
            spotlightActive = id
            paint()
          },
          onSelect: (id) => {
            spotlightOpen = false
            paint()
            notify(id)
          },
          onClose: () => {
            spotlightOpen = false
            paint()
          },
        })
      : null
  }
  ${FlowDialog({
    id: 'flow-responsive-task',
    title: 'Công việc mẫu',
    size: 'task',
    headerActions: FlowRecordAsideTrigger({ controls: 'demo-task-properties' }),
    body: FlowRecordLayout({
      asideId: 'demo-task-properties',
      main: FlowSection({
        children: FlowStack({
          children: html`${FlowInput({ id: 'demo-responsive-title', label: 'Tiêu đề', value: 'Thiết kế giao diện tablet' })}${FlowTextarea({ id: 'demo-responsive-description', label: 'Mô tả', value: 'Dưới 1200px, mở Thuộc tính để chỉnh sidebar mà không ép nội dung chính.' })}`,
        }),
      }),
      aside: FlowPropertyFields({
        children: html`${FlowSelectField({ name: 'demo-responsive-status', label: 'Trạng thái', icon: 'status', value: 'open', options: statusOptions })}${FlowSelectField({ name: 'demo-responsive-priority', label: 'Ưu tiên', icon: 'flag', value: 'normal', options: priorityOptions })}${FlowInput({ id: 'demo-responsive-due', label: 'Hạn hoàn thành', type: 'date', value: '2026-09-24' })}`,
      }),
    }),
  })}
  ${FlowDialog({
    id: 'flow-reset',
    title: 'Khôi phục dữ liệu mẫu?',
    body: html`<p>
      Các chỉnh sửa trong demo sẽ được thay bằng bộ công việc ban đầu. Dự án thật không bị ảnh
      hưởng.
    </p>`,
    footer: html`<button data-flow="button" data-flow-close type="button">Giữ thay đổi</button
      >${FlowButton({
        label: 'Khôi phục dữ liệu mẫu',
        variant: 'danger',
        onClick: () => {
          tasks = structuredClone(initialTasks)
          selected.clear()
          query = ''
          status = 'all'
          detailId = tasks[0].id
          persist()
          document.getElementById('flow-reset').close()
          notify('Đã khôi phục dữ liệu mẫu.')
        },
      })}`,
  })}`
}

function paint() {
  container.dataset.theme = theme
  container.dataset.density = density
  const tools = html`${FlowSegmented({
    label: 'Mật độ giao diện',
    value: density,
    options: [
      { value: 'compact', label: 'Gọn' },
      { value: 'comfortable', label: 'Thoáng' },
    ],
    onChange: (value) => {
      density = value
      paint()
    },
  })}${FlowButton({
    label: theme === 'light' ? 'Bật giao diện tối' : 'Bật giao diện sáng',
    icon: theme === 'light' ? 'moon' : 'sun',
    iconOnly: true,
    variant: 'ghost',
    onClick: () => {
      theme = theme === 'light' ? 'dark' : 'light'
      paint()
    },
  })}${page === 'workspace' ? FlowButton({ label: 'Tạo công việc', variant: 'primary', size: 'sm', icon: 'plus', onClick: () => runtime.open('flow-create') }) : null}`
  root.render(
    html`${FlowShell({
      breadcrumb: 'Flow',
      contentWidth: page === 'library' ? 'standard' : 'wide',
      title: page === 'library' ? 'Thư viện giao diện' : 'Công việc của nhóm',
      search:
        page === 'workspace'
          ? FlowSearch({
              label: 'Tìm công việc trên topbar',
              value: query,
              placeholder: 'Tìm theo tên, mã hoặc người phụ trách…',
              onInput: (e) => {
                query = e.target.value
                paint()
              },
            })
          : null,
      actions: tools,
      sidebar: html`${FlowBrand({ company: 'Giao diện sản phẩm · 0.1' })}
          <nav class="demo-nav" aria-label="Điều hướng demo">
            ${navButton('Thư viện giao diện', 'grid', () => navigate('library'), page === 'library', '17')}${navButton('Không gian mẫu', 'layers', () => navigate('workspace'), page === 'workspace')}
          </nav>
          <div class="demo-label demo-sidebar-label">Component</div>
          <nav class="demo-nav demo-secondary-nav" aria-label="Nhóm component">
            ${navButton('Nền tảng', 'sun', () => navigate('library', 'foundations'), false, '01')}${navButton('Thao tác & nhập liệu', 'settings', () => navigate('library', 'controls'), false, '02')}${navButton('Công việc', 'list', () => navigate('library', 'work'), false, '03')}${navButton('Trạng thái & hội thoại', 'inbox', () => navigate('library', 'feedback'), false, '04')}
          </nav>
          <div class="demo-sidebar-note">
            ${FlowAvatar({ name: 'Mai Anh' })}
            <div><strong>Mai Anh</strong><span>Két Việt · Flow UI</span></div>
          </div>`,
      children: html`<div id="demo-page-start" class="demo-content" data-page=${page}>
          ${page === 'library' ? library() : workspace()}
        </div>`,
      footer: html`<span
            >${page === 'workspace' ? 'Dữ liệu mẫu · lưu trong trình duyệt' : 'Token KétJS · Component riêng cho Flow'}</span
          >${FlowButton({ label: 'Khôi phục dữ liệu mẫu', icon: 'reset', variant: 'ghost', size: 'sm', onClick: () => runtime.open('flow-reset') })}`,
    })}${dialogs()}
      ${toast ? FlowToast({ message: toast, tone: toastTone, action: toastTone === 'error' ? FlowButton({ label: 'Thử lại', size: 'sm', onClick: () => notify('Đã lưu thay đổi.') }) : null, onClose: dismissToast, onPause: () => clearTimeout(toastTimer), onResume: resumeToast }) : null}`,
  )
  runtime.sync()
}
paint()
window.addEventListener('hashchange', () => {
  if (location.hash === '#workspace' && page !== 'workspace') {
    page = 'workspace'
    paint()
  } else if (location.hash === '#library' && page !== 'library') {
    page = 'library'
    paint()
  }
})
