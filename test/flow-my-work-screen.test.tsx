import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { crossProjectScreen } from '../packages/ketsuite/src/modules/flow_backend/screens/my-work.tsx'

const messages: Record<string, string> = {
  'flow_backend.issues.subtitle': 'Mọi công việc trong hệ thống, được theo dõi tại một nơi.',
  'flow_backend.issues.tabsLabel': 'Lọc công việc',
  'flow_backend.overview.title': 'Tổng quan',
  'flow_backend.overview.total': 'Tổng công việc',
  'flow_backend.overview.done': 'Hoàn thành',
  'flow_backend.overview.working': 'Đang thực hiện',
  'flow_backend.overview.waiting': 'Chưa bắt đầu',
  'flow_backend.overview.overdue': 'Quá hạn',
  'flow_backend.overview.overall': 'Tiến độ chung',
  'flow_backend.overview.lateTitle': 'Công việc quá hạn',
  'flow_backend.overview.lateNone': 'Không có công việc quá hạn',
  'flow_backend.overview.lateNoneHint': 'Mọi công việc còn hạn đều đang đúng tiến độ.',
  'flow_backend.field.title': 'Tiêu đề',
  'flow_backend.field.project': 'Dự án',
  'flow_backend.field.assignee': 'Người phụ trách',
  'flow_backend.field.priority': 'Độ ưu tiên',
  'flow_backend.field.column': 'Trạng thái',
  'flow_backend.field.dueDate': 'Hạn chót',
  'flow_backend.field.progress': 'Tiến độ',
  'backend.table.columns': 'Cột',
  'backend.table.selectAll': 'Chọn tất cả',
  'backend.table.selectRow': 'Chọn dòng',
}

const translate = ((key: string) => messages[key] ?? key) as Translator
translate.locale = 'vi'
translate.has = (key) => key in messages
translate.resolves = translate.has

test('flow cross-project issues: uses ListPage and keeps summary, list state and localized record links', () => {
  const rendered = renderToString(
    crossProjectScreen(
      translate,
      {
        chrome: {
          search: {
            name: 'q',
            value: 'đăng nhập',
            placeholder: 'Tìm công việc…',
            keep: { lang: 'vi', view: 'mine' },
          },
          pager: { from: 1, to: 1, total: 1 },
        },
      },
      'Việc của tôi',
      [
        {
          id: 'issue-login',
          title: 'Hoàn thiện đăng nhập',
          projectId: 'platform',
          projectName: 'Nền tảng nội bộ',
          assigneeName: 'Minh',
          priority: 'high',
          columnName: 'Đang làm',
          dueDate: '2026-08-01',
          overdue: true,
          progress: 50,
          subtaskDone: 1,
          subtaskTotal: 2,
        },
      ],
      [],
      {
        total: 5,
        done: 1,
        overdue: 1,
        waiting: 2,
        working: 1,
        mine: 5,
        late: [
          {
            id: 'issue-login',
            title: 'Hoàn thiện đăng nhập',
            projectName: 'Nền tảng nội bộ',
            dueDate: '2026-08-01',
          },
        ],
        tab: 'mine',
        tabs: [
          { id: 'all', label: 'Tất cả', href: '/admin/flow/issues', count: 12 },
          { id: 'mine', label: 'Của tôi', href: '/admin/flow/mine', count: 5 },
        ],
        locale: '?lang=vi',
      },
    ),
  )
  const textContent = rendered.replace(/<!--k\[?-->/g, '')

  assert.equal(rendered.match(/data-ui="list-page-title"/g)?.length, 1)
  assert.doesNotMatch(rendered, /data-ui="record-workspace"|data-ui="form-page"/)
  assert.match(textContent, /data-ui="list-page-status">Việc của tôi: 5/)
  assert.match(rendered, /name="q"[^>]*value="đăng nhập"/)
  assert.match(rendered, /name="lang" value="vi"/)
  assert.match(rendered, /name="view" value="mine"/)
  assert.equal(rendered.match(/data-ui="metric"/g)?.length, 5)
  assert.match(textContent, /Tổng quan/)
  assert.match(textContent, /Tiến độ chung/)
  assert.match(rendered, /data-tone="danger"[^>]*data-dot="true"/)
  assert.match(rendered, /data-active="true"[^>]*href="\/admin\/flow\/mine\?lang=vi"/)
  assert.match(rendered, /href="\/admin\/flow\/issues\/issue-login\?lang=vi"/)
  assert.match(rendered, /href="\/admin\/flow\/projects\/platform\/board\?lang=vi"/)
  assert.match(rendered, /data-col="dueDate"/)
  assert.match(rendered, /data-late="true"/)
  assert.match(rendered, /Công việc quá hạn/)
  assert.match(rendered, /Nền tảng nội bộ/)
})

test('flow cross-project issues: keeps the task-specific empty state inside ListPage', () => {
  const rendered = renderToString(
    crossProjectScreen(translate, {}, 'Việc của tôi', [], [], {
      total: 0,
      done: 0,
      overdue: 0,
      waiting: 0,
      working: 0,
      mine: 0,
      late: [],
      tab: 'mine',
      tabs: [],
    }),
  )

  assert.match(rendered, /data-ui="list-page"/)
  assert.match(rendered, /flow_backend\.mine\.emptyTitle/)
  assert.match(rendered, /Không có công việc quá hạn/)
})
