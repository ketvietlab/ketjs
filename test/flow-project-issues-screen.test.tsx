import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import {
  issueCreateModal,
  issuesScreen,
} from '../packages/ketsuite/src/modules/flow_backend/screens/issues.tsx'
import { modalWorkspace } from '../packages/ketsuite/src/ui/index.ts'

const messages: Record<string, string> = {
  'flow_backend.action.cancel': 'Hủy',
  'flow_backend.action.create': 'Tạo mới',
  'flow_backend.empty.title': 'Chưa có dữ liệu',
  'flow_backend.empty.hint': 'Chưa có hồ sơ nào ở đây.',
  'flow_backend.issues.subtitle': 'Quản lý và theo dõi tất cả công việc trong hệ thống.',
  'flow_backend.field.title': 'Tiêu đề',
  'flow_backend.field.column': 'Trạng thái',
  'flow_backend.field.assignee': 'Người phụ trách',
  'flow_backend.field.priority': 'Độ ưu tiên',
  'flow_backend.field.dueDate': 'Hạn chót',
  'flow_backend.field.progress': 'Tiến độ',
  'flow.priority.high': 'Cao',
  'backend.table.columns': 'Cột',
  'backend.table.selectAll': 'Chọn tất cả',
  'backend.table.selectRow': 'Chọn dòng',
  'flow_backend.issues.filterTruncatedTitle': 'Kết quả chưa đầy đủ',
  'flow_backend.issues.filterTruncatedBody': 'Bộ lọc dừng ở {count} công việc khớp.',
}

// Substituting like the real translator does, so a screen that forgets to pass
// a parameter shows `{count}` here too rather than quietly reading fine.
const translate = ((key: string, params?: Record<string, unknown>) =>
  (messages[key] ?? key).replace(/\{(\w+)\}/g, (whole, name) =>
    params && name in params ? String(params[name]) : whole,
  )) as Translator
translate.locale = 'vi'
translate.has = (key) => key in messages
translate.resolves = translate.has

test('flow project issues: ListPage is collection-only and preserves list state, custom fields and locale', () => {
  const html = renderToString(
    issuesScreen(
      translate,
      {
        chrome: {
          search: {
            name: 'q',
            value: 'login',
            placeholder: 'Tìm công việc…',
            keep: { lang: 'vi', filter: 'priority:high' },
          },
          pager: { from: 1, to: 1, total: 1 },
        },
      },
      {
        projectName: 'Nền tảng nội bộ',
        rows: [
          {
            id: 'issue-login',
            title: 'Hoàn thiện đăng nhập',
            columnName: 'Đang làm',
            assigneeName: 'Minh',
            priority: 'high',
            dueDate: '2026-09-01',
            progress: 50,
            subtaskDone: 1,
            subtaskTotal: 2,
            fieldValues: { environment: 'production' },
          },
        ],
        fields: [
          {
            id: 'environment',
            code: 'environment',
            name: 'Môi trường',
            config: { options: [{ code: 'production', label: 'Sản xuất' }] },
          },
        ],
        total: 1,
        createHref: '/admin/flow/projects/platform/issues?filter=priority%3Ahigh&lang=vi&create=1',
        locale: '?lang=vi',
      },
    ),
  )
  const textContent = html.replace(/<!--k\[?-->/g, '')

  assert.match(html, /data-ui="list-page"/)
  assert.doesNotMatch(html, /data-ui="record-workspace"|data-ui="form-page"|flow-issue-create-form/)
  assert.match(
    html,
    /href="\/admin\/flow\/projects\/platform\/issues\?filter=priority%3Ahigh&amp;lang=vi&amp;create=1"/,
  )
  assert.match(textContent, /data-ui="list-page-footer">Nền tảng nội bộ: 1/)
  assert.match(html, /name="q"[^>]*value="login"/)
  assert.match(html, /name="lang" value="vi"/)
  assert.match(html, /href="\/admin\/flow\/issues\/issue-login\?lang=vi"/)
  assert.match(html, /data-col="field:environment"/)
  assert.match(textContent, /Môi trường/)
  assert.match(textContent, /Sản xuất/)
  assert.match(textContent, /1\/2/)
})

test('flow project issue create: URL-owned modal retains rejected values, return state and idempotency', () => {
  const list = issuesScreen(
    translate,
    {},
    {
      projectName: 'Nền tảng nội bộ',
      rows: [],
      total: 0,
      createHref: '/admin/flow/projects/platform/issues?lang=vi&create=1',
    },
  )
  const html = renderToString(
    modalWorkspace(
      list,
      issueCreateModal(translate, {
        projectName: 'Nền tảng nội bộ',
        action: '/admin/flow/projects/platform/issues?lang=vi&create=1',
        cancelHref: '/admin/flow/projects/platform/issues?q=login&lang=vi',
        idempotencyKey: 'issue-create-once',
        errors: ['Tiêu đề là bắt buộc'],
        fields: [
          { name: 'title', label: 'Tiêu đề', value: 'Nội dung nhập dở', required: true },
          {
            name: 'columnId',
            label: 'Trạng thái',
            type: 'select',
            value: 'doing',
            options: [{ value: 'doing', label: 'Đang làm' }],
          },
          {
            name: 'priority',
            label: 'Độ ưu tiên',
            type: 'select',
            value: 'high',
            options: [{ value: 'high', label: 'Cao' }],
          },
        ],
      }),
    ),
  )

  assert.match(html, /data-ui="list-page"/)
  assert.match(html, /data-ui="modal-layer" data-route-modal="true"/)
  assert.match(html, /id="flow-issue-create-form"/)
  assert.match(html, /action="\/admin\/flow\/projects\/platform\/issues\?lang=vi&amp;create=1"/)
  assert.match(
    html,
    /data-ui="modal-close" href="\/admin\/flow\/projects\/platform\/issues\?q=login&amp;lang=vi"/,
  )
  assert.match(html, /name="returnTo" value="\/admin\/flow\/projects\/platform\/issues\?q=login&amp;lang=vi"/)
  assert.match(html, /name="idempotencyKey" value="issue-create-once"/)
  assert.match(html, /name="title"[^>]*value="Nội dung nhập dở"/)
  assert.match(html, /<option value="doing" selected="true">/)
  assert.match(html, /<option value="high" selected="true">/)
  assert.match(html, /Tiêu đề là bắt buộc/)
})

test('flow project issues: a truncated custom-field filter is said on the screen, not only in the answer', () => {
  // The domain has reported this since the filter was written; nothing read it,
  // so a partial result arrived with a pager that called it the whole thing.
  const render = (filterTruncated: boolean) =>
    renderToString(
      issuesScreen(
        translate,
        { chrome: { pager: { from: 1, to: 1, total: 1 } } },
        {
          projectName: 'Nền tảng nội bộ',
          rows: [{ id: 'issue-login', title: 'Hoàn thiện đăng nhập' }],
          total: 1,
          createHref: '',
          filterTruncated,
        },
      ),
    )

  const warned = render(true).replace(/<!--k\[?-->/g, '')
  assert.match(warned, /Kết quả chưa đầy đủ/)
  // The number is the cap the domain actually applied, not a sentence about it.
  assert.match(warned, /900/)
  assert.doesNotMatch(render(false).replace(/<!--k\[?-->/g, ''), /Kết quả chưa đầy đủ/)
})
