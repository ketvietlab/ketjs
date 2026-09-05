import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { leavesListScreen } from '../packages/ketsuite/src/modules/hr_backend/screens/index.ts'

const messages: Record<string, string> = {
  'hr_backend.action.approve': 'Duyệt',
  'hr_backend.action.reject': 'Từ chối',
  'hr_backend.empty.leaves': 'Không có yêu cầu nghỉ',
  'hr_backend.empty.leavesHint': 'Yêu cầu từ nhân viên sẽ xuất hiện tại đây.',
  'hr_backend.field.actions': 'Thao tác',
  'hr_backend.field.date': 'Ngày',
  'hr_backend.field.days': 'Số ngày',
  'hr_backend.field.employee': 'Nhân viên',
  'hr_backend.field.leaveType': 'Loại nghỉ',
  'hr_backend.field.reason': 'Lý do',
  'hr_backend.field.requestId': 'Mã yêu cầu',
  'hr_backend.field.state': 'Trạng thái',
  'hr_backend.leaves.decisionFailed': 'Không thể cập nhật yêu cầu nghỉ',
  'hr_backend.leaves.subtitle': 'Rà soát yêu cầu trước khi ra quyết định.',
  'hr_backend.leaves.title': 'Duyệt nghỉ phép',
  'hr_backend.state.approved': 'Đã duyệt',
  'hr_backend.state.rejected': 'Từ chối',
  'hr_backend.state.requested': 'Chờ duyệt',
}

const translate = ((key: string) => messages[key] ?? key) as Translator
translate.locale = 'vi'
translate.has = (key) => key in messages
translate.resolves = translate.has

const requested = {
  id: 'leave-001',
  employee: 'NV001 · Nguyễn Minh Anh',
  leaveType: 'annual',
  dateFrom: '2026-09-01',
  dateTo: '2026-09-02',
  requestedDays: '2',
  reason: 'Việc gia đình',
  state: 'requested',
  action: '/admin/hr/leaves?state=requested&lang=vi&id=leave-001',
}

test('HR leave approvals list: ListPage keeps request identity, relations, range, duration and actions', () => {
  const html = renderToString(
    leavesListScreen(
      translate,
      {
        chrome: {
          search: {
            name: 'q',
            value: 'Nguyễn',
            placeholder: 'Tìm yêu cầu',
          },
          pager: { from: 1, to: 1, total: 31, prev: null, next: '/admin/hr/leaves?page=2&lang=vi' },
        },
      },
      { rows: [requested], total: 31 },
    ),
  )

  assert.match(html, /data-ui="list-page"/)
  assert.match(html, /data-ui="list-chrome" data-layout="command"/)
  assert.match(html, /1-1 \/ 31/)
  assert.match(html, /leave-001/)
  assert.match(html, /NV001 · Nguyễn Minh Anh/)
  assert.match(html, /annual/)
  assert.match(html, /2026-09-01 – 2026-09-02/)
  assert.match(html, /data-col="days"[\s\S]*?2/)
  assert.match(html, /Việc gia đình/)
  assert.match(html, /data-ui="badge" data-tone="warning" data-value="requested"/)
  assert.match(html, /name="action" value="approved"/)
  assert.match(html, /name="action" value="rejected"/)
  assert.match(html, /action="\/admin\/hr\/leaves\?state=requested&amp;lang=vi&amp;id=leave-001"/)
})

test('HR leave approvals list: decided requests retain status without offering a second decision', () => {
  const html = renderToString(
    leavesListScreen(
      translate,
      {},
      {
        rows: [{ ...requested, state: 'approved' }],
        total: 1,
      },
    ),
  )

  assert.match(html, /data-ui="badge" data-tone="positive" data-value="approved"/)
  assert.doesNotMatch(html, /name="action" value="approved"|name="action" value="rejected"/)
})

test('HR leave approvals list: decision validation is visible without replacing the collection', () => {
  const html = renderToString(
    leavesListScreen(
      translate,
      {},
      {
        errors: ['decision: Quyết định không hợp lệ.'],
        rows: [requested],
        total: 1,
      },
    ),
  )

  assert.match(html, /data-ui="notice" data-tone="danger" role="alert"/)
  assert.match(html, /Không thể cập nhật yêu cầu nghỉ/)
  assert.match(html, /decision: Quyết định không hợp lệ\./)
  assert.match(html, /data-ui="table"/)
})
