import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { modalWorkspace } from '../packages/ketsuite/src/ui/index.ts'
import {
  employeeFormModal,
  employeesListScreen,
} from '../packages/ketsuite/src/modules/hr_backend/screens/index.ts'

const messages: Record<string, string> = {
  'hr_backend.action.archive': 'Lưu trữ',
  'hr_backend.action.cancel': 'Hủy',
  'hr_backend.action.create': 'Tạo nhân viên',
  'hr_backend.action.restore': 'Khôi phục',
  'hr_backend.action.save': 'Lưu',
  'hr_backend.employees.activeHelp': 'Bỏ chọn để lưu trữ nhân viên nhưng vẫn giữ lịch sử nhân sự.',
  'hr_backend.employees.create': 'Thêm nhân viên',
  'hr_backend.employees.edit': 'Chỉnh sửa nhân viên',
  'hr_backend.employees.formHint': 'Vai trò nhân viên được duy trì tự động.',
  'hr_backend.employees.nameHelp': 'Tên hiển thị thuộc hồ sơ đối tác.',
  'hr_backend.employees.title': 'Nhân viên',
  'hr_backend.employees.userHelp': 'ID tài khoản nội bộ liên kết.',
  'hr_backend.empty.employees': 'Chưa có nhân viên',
  'hr_backend.empty.employeesHint': 'Tạo hồ sơ nhân viên đầu tiên.',
  'hr_backend.field.actions': 'Thao tác',
  'hr_backend.field.active': 'Đang làm việc',
  'hr_backend.field.branchId': 'Chi nhánh',
  'hr_backend.field.code': 'Mã',
  'hr_backend.field.endDate': 'Ngày nghỉ việc',
  'hr_backend.field.name': 'Tên',
  'hr_backend.field.startDate': 'Ngày vào làm',
  'hr_backend.field.state': 'Trạng thái',
  'hr_backend.field.timezone': 'Múi giờ',
  'hr_backend.field.userId': 'User ID',
  'hr_backend.state.active': 'Đang làm việc',
  'hr_backend.state.archived': 'Đã lưu trữ',
}

const translate = ((key: string) => messages[key] ?? key) as Translator
translate.locale = 'vi'
translate.has = (key) => key in messages
translate.resolves = translate.has

const branchOptions = [
  { value: '', label: '—' },
  { value: 'root:default', label: 'root:default' },
]

const list = () =>
  employeesListScreen(
    translate,
    {
      action: '/admin/hr?lang=vi',
      createHref: '/admin/hr?create=1&lang=vi',
      rows: [
        {
          id: 'employee-1',
          code: 'NV001',
          name: 'Nguyễn Minh Anh',
          branch: 'root:default',
          timezone: 'Asia/Ho_Chi_Minh',
          active: true,
          editHref: '/admin/hr?edit=employee-1&lang=vi',
        },
      ],
    },
    {},
  )

test('HR employees list: public ListPage keeps edit, state and archive commands', () => {
  const html = renderToString(list())

  assert.match(html, /data-ui="list-page"/)
  assert.match(html, /href="\/admin\/hr\?create=1&amp;lang=vi"/)
  assert.match(html, /data-row-href="\/admin\/hr\?edit=employee-1&amp;lang=vi"/)
  assert.match(html, /NV001/)
  assert.match(html, /Nguyễn Minh Anh/)
  assert.match(html, /data-ui="badge" data-tone="positive"[\s\S]*?Đang làm việc/)
  assert.match(html, /name="action" value="archive"/)
  assert.match(html, /name="id" value="employee-1"/)
  assert.doesNotMatch(html, /id="hr-employee-form"|data-ui="modal-layer"/)
})

test('HR employee create: large modal retains rejected relational and date values', () => {
  const html = renderToString(
    modalWorkspace(
      list(),
      employeeFormModal(translate, {
        action: '/admin/hr?create=1&lang=vi',
        branches: [...branchOptions, { value: 'missing-branch', label: 'missing-branch' }],
        cancelHref: '/admin/hr?lang=vi',
        errors: ['homeBranchId: Chi nhánh không hợp lệ.'],
        values: {
          code: 'NV002',
          name: 'Lê Thu Hà',
          userId: 'user-2',
          homeBranchId: 'missing-branch',
          timezone: 'Asia/Ho_Chi_Minh',
          startDate: '2026-09-01',
        },
      }),
    ),
  )

  assert.match(html, /data-ui="modal-layer" data-route-modal="true"/)
  assert.match(html, /data-ui="modal-sheet" data-size="large" role="dialog"/)
  assert.equal(html.match(/data-ui="form-field"/g)?.length, 6)
  assert.match(html, /action="\/admin\/hr\?create=1&amp;lang=vi"/)
  assert.match(html, /name="code"[^>]*value="NV002"/)
  assert.match(html, /name="name"[^>]*value="Lê Thu Hà"/)
  assert.match(html, /name="userId"[^>]*value="user-2"/)
  assert.match(html, /<option value="missing-branch" selected="true">/)
  assert.match(html, /name="startDate"[^>]*value="2026-09-01"/)
  assert.match(html, /homeBranchId: Chi nhánh không hợp lệ\./)
})

test('HR employee edit: modal preserves relations, dates and active state without editing partner name', () => {
  const html = renderToString(
    modalWorkspace(
      list(),
      employeeFormModal(translate, {
        action: '/admin/hr?edit=employee-1&lang=vi',
        branches: branchOptions,
        cancelHref: '/admin/hr?lang=vi',
        editing: true,
        values: {
          id: 'employee-1',
          code: 'NV001',
          name: 'Nguyễn Minh Anh',
          userId: 'user-1',
          homeBranchId: 'root:default',
          timezone: 'Asia/Ho_Chi_Minh',
          startDate: '2026-01-01',
          endDate: '2026-12-31',
          active: true,
        },
      }),
    ),
  )

  assert.equal(html.match(/data-ui="form-field"/g)?.length, 8)
  assert.match(html, /name="id" value="employee-1"/)
  assert.match(html, /name="name"[^>]*value="Nguyễn Minh Anh"[^>]*disabled="true"/)
  assert.match(html, /name="userId"[^>]*value="user-1"/)
  assert.match(html, /<option value="root:default" selected="true">/)
  assert.match(html, /name="endDate"[^>]*value="2026-12-31"/)
  assert.match(html, /type="checkbox" name="active"[^>]*checked="true"/)
})
