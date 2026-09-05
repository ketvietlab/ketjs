import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { projectCreateScreen } from '../packages/ketsuite/src/modules/flow_backend/screens/project-create.tsx'
import { projectsListScreen } from '../packages/ketsuite/src/modules/flow_backend/screens/projects-list.tsx'

const messages: Record<string, string> = {
  'flow_backend.projects.title': 'Dự án',
  'flow_backend.projects.subtitle': 'Theo dõi tiến độ và khối lượng công việc.',
  'flow_backend.projects.totalProjects': 'Tổng dự án',
  'flow_backend.projects.activeProjects': 'Đang thực hiện',
  'flow_backend.projects.activeHint': 'Có việc đang triển khai',
  'flow_backend.projects.totalIssues': 'Tổng công việc',
  'flow_backend.projects.issuesDone': 'Hoàn thành',
  'flow_backend.projects.tabsLabel': 'Lọc dự án',
  'flow_backend.projects.tabAll': 'Tất cả',
  'flow_backend.projects.tabMine': 'Của tôi',
  'flow_backend.projects.column': 'Dự án',
  'flow_backend.projects.progress': 'Tiến độ',
  'flow_backend.projects.activity': 'Hoạt động gần đây',
  'flow_backend.projects.create': 'Dự án mới',
  'flow_backend.projects.state.active': 'Đang thực hiện',
  'flow_backend.field.key': 'Mã',
  'flow_backend.field.name': 'Tên',
  'flow_backend.field.status': 'Trạng thái',
  'flow_backend.field.description': 'Mô tả',
  'flow_backend.field.template': 'Mẫu',
  'flow_backend.field.customColumns': 'Trạng thái tùy chỉnh',
  'flow_backend.action.cancel': 'Hủy',
  'flow_backend.empty.title': 'Chưa có dữ liệu',
  'flow_backend.empty.hint': 'Chưa có hồ sơ nào.',
  'backend.table.columns': 'Cột',
  'backend.table.selectAll': 'Chọn tất cả',
  'backend.table.selectRow': 'Chọn dòng',
}

const translate = ((key: string) => messages[key] ?? key) as Translator
translate.locale = 'vi'
translate.has = (key) => key in messages
translate.resolves = translate.has

test('flow projects list: uses ListPage with metrics, tabs, business columns and recent activity', () => {
  const rendered = renderToString(
    projectsListScreen(
      translate,
      {},
      {
        rows: [
          {
            id: 'project-platform',
            key: 'PLAT',
            name: 'Nền tảng nội bộ',
            description: 'Chuẩn hóa vận hành',
            state: 'active',
            done: 3,
            total: 5,
          },
        ],
        projectCount: 4,
        issueCount: 12,
        issuesDone: 7,
        activeCount: 2,
        activity: [
          {
            id: 'issue-login',
            title: 'Hoàn thiện đăng nhập',
            projectName: 'Nền tảng nội bộ',
            columnName: 'Đang làm',
            assigneeName: 'Minh',
          },
        ],
        tab: 'mine',
        tabs: [
          { id: 'all', label: 'Tất cả', href: '/admin/flow/projects' },
          { id: 'mine', label: 'Của tôi', href: '/admin/flow/projects?tab=mine' },
        ],
        createHref:
          '/admin/flow/projects/new?lang=vi&returnTo=%2Fadmin%2Fflow%2Fprojects%3Ftab%3Dmine%26lang%3Dvi',
        locale: '?lang=vi',
      },
    ),
  )

  assert.equal(rendered.match(/data-ui="list-page-title"/g)?.length, 1)
  assert.doesNotMatch(rendered, /flow-project-create-form|data-ui="form-page"/)
  assert.match(rendered, /href="\/admin\/flow\/projects\/new\?lang=vi&amp;returnTo=/)
  assert.equal(rendered.match(/data-ui="metric"/g)?.length, 4)
  assert.match(rendered, /Tổng dự án/)
  assert.match(rendered, /7\/12/)
  assert.match(rendered, /href="\/admin\/flow\/projects\?tab=mine&amp;lang=vi"/)
  assert.match(rendered, /data-active="true"[^>]*href="\/admin\/flow\/projects\?tab=mine&amp;lang=vi"/)
  assert.match(rendered, /data-col="name"/)
  assert.match(rendered, /data-col="key"/)
  assert.match(rendered, /data-col="state"/)
  assert.match(rendered, /data-col="progress"/)
  assert.match(rendered, /data-col="description"/)
  assert.match(rendered, /Đang thực hiện/)
  assert.match(rendered, /3\/5/)
  assert.match(rendered, /href="\/admin\/flow\/projects\/project-platform\/board\?lang=vi"/)
  assert.match(rendered, /Hoạt động gần đây/)
  assert.match(rendered, /Hoàn thiện đăng nhập/)
  assert.match(rendered, /href="\/admin\/flow\/issues\/issue-login\?lang=vi"/)
})

test('flow project create: uses FormPage and preserves values, errors, return state and locale actions', () => {
  const rendered = renderToString(
    projectCreateScreen(
      translate,
      {},
      {
        action: '/admin/flow/projects/new?lang=vi',
        cancelHref: '/admin/flow/projects?tab=mine&lang=vi',
        returnTo: '/admin/flow/projects?tab=mine&lang=vi',
        recordId: 'project-ops',
        idempotencyKey: 'create-project-ops',
        errors: ['Cần nhập ít nhất một trạng thái'],
        fields: [
          { name: 'key', label: 'Mã', value: 'OPS', required: true },
          { name: 'name', label: 'Tên', value: 'Vận hành', required: true },
          {
            name: 'description',
            label: 'Mô tả',
            type: 'textarea',
            value: 'Chuẩn hóa quy trình',
            span: 'full',
          },
          {
            name: 'template',
            label: 'Mẫu',
            type: 'select',
            value: 'custom',
            options: [{ value: 'custom', label: 'Tùy chỉnh' }],
          },
          {
            name: 'customColumns',
            label: 'Trạng thái tùy chỉnh',
            value: '',
            span: 'full',
          },
        ],
      },
    ),
  )

  assert.match(rendered, /data-ui="form-page"/)
  assert.doesNotMatch(rendered, /data-ui="list-page"|data-ui="chatter"/)
  assert.match(rendered, /id="flow-project-create-form"/)
  assert.match(rendered, /action="\/admin\/flow\/projects\/new\?lang=vi"/)
  assert.match(rendered, /name="returnTo" value="\/admin\/flow\/projects\?tab=mine&amp;lang=vi"/)
  assert.match(rendered, /href="\/admin\/flow\/projects\?tab=mine&amp;lang=vi"/)
  assert.match(rendered, /name="key"[^>]*value="OPS"/)
  assert.match(rendered, /name="name"[^>]*value="Vận hành"/)
  assert.match(rendered, /Chuẩn hóa quy trình/)
  assert.match(rendered, /value="custom" selected/)
  assert.match(rendered, /Cần nhập ít nhất một trạng thái/)
  assert.match(rendered, /type="submit"[^>]*form="flow-project-create-form"/)
  // A resubmitted form has to land on the same project: `project.save` upserts by
  // id, so the record id and the idempotency key belong in the rendered form.
  assert.match(rendered, /name="id" value="project-ops"/)
  assert.match(rendered, /name="idempotencyKey" value="create-project-ops"/)
})
