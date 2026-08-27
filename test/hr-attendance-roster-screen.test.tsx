import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { rosterScreen } from '../packages/ketsuite/src/modules/hr_backend/screens/index.ts'

const messages: Record<string, string> = {
  'hr_backend.action.generate': 'Sinh lịch',
  'hr_backend.action.publish': 'Phát hành',
  'hr_backend.action.reopen': 'Mở lại',
  'hr_backend.empty.shifts': 'Chưa có ca',
  'hr_backend.empty.shiftsHint': 'Gán chu kỳ cho nhân viên rồi sinh lại lịch.',
  'hr_backend.field.branchId': 'Chi nhánh',
  'hr_backend.field.date': 'Ngày',
  'hr_backend.field.employee': 'Nhân viên',
  'hr_backend.field.startAt': 'Bắt đầu',
  'hr_backend.field.stopAt': 'Kết thúc',
  'hr_backend.field.weekStart': 'Thứ Hai đầu tuần',
  'hr_backend.roster.generate': 'Sinh lịch tuần',
  'hr_backend.roster.hint': 'Ca xoay được sinh idempotent.',
  'hr_backend.roster.title': 'Lịch ca',
  'hr_backend.roster.week': 'Tuần',
  'hr_backend.state.draft': 'Nháp',
  'hr_backend.state.published': 'Đã phát hành',
}

const translate = ((key: string) => messages[key] ?? key) as Translator
translate.locale = 'vi'
translate.has = (key) => key in messages
translate.resolves = translate.has

const action = '/admin/hr/roster?lang=vi'
const workflowAction = (roster: Record<string, unknown>) =>
  `/admin/hr/roster?id=${String(roster.id)}&version=${String(roster.version)}&branch=root%3Adefault&week=2026-08-17&lang=vi`

test('HR roster screen: specialized planner retains generation parameters and rejected values', () => {
  const html = renderToString(
    rosterScreen(translate, {
      action,
      branchId: 'missing-branch',
      errors: ['branchId: Chi nhánh không hợp lệ.'],
      rows: [],
      weekStart: '2026-08-17',
      workflowAction,
    }),
  )

  assert.doesNotMatch(html, /data-ui="list-page"|data-ui="form-page"|data-ui="modal-layer"/)
  assert.match(html, /data-ui="record-form"/)
  assert.match(html, /action="\/admin\/hr\/roster\?lang=vi"/)
  assert.match(html, /name="branchId"[^>]*value="missing-branch"/)
  assert.match(html, /name="weekStart"[^>]*value="2026-08-17"/)
  assert.match(html, /data-ui="form-errors" role="alert"/)
  assert.match(html, /branchId: Chi nhánh không hợp lệ\./)
  assert.doesNotMatch(html, /data-ui="data-table"|name="action" value="publish"/)
})

test('HR roster screen: draft week keeps relation labels, timezone instants and publish command', () => {
  const html = renderToString(
    rosterScreen(translate, {
      action,
      branchId: 'root:default',
      rows: [
        {
          id: 'root:default:2026-08-17',
          state: 'draft',
          version: 1,
          weekStart: '2026-08-17',
          shifts: [
            {
              id: 'shift-1',
              employeeName: 'Nguyễn Minh Anh',
              localDate: '2026-08-17',
              startAt: '2026-08-17T01:00:00.000Z',
              stopAt: '2026-08-17T10:00:00.000Z',
            },
          ],
        },
      ],
      weekStart: '2026-08-17',
      workflowAction,
    }),
  )

  assert.match(html, /data-ui="badge" data-tone="neutral" data-value="draft"/)
  assert.match(html, /name="action" value="publish"/)
  assert.doesNotMatch(html, /name="action" value="reopen"/)
  assert.match(
    html,
    /action="\/admin\/hr\/roster\?id=root:default:2026-08-17&amp;version=1&amp;branch=root%3Adefault&amp;week=2026-08-17&amp;lang=vi"/,
  )
  assert.match(html, /Nguyễn Minh Anh/)
  assert.match(html, /2026-08-17T01:00:00\.000Z/)
  assert.match(html, /2026-08-17T10:00:00\.000Z/)
})

test('HR roster screen: published week exposes only the reopen lifecycle command', () => {
  const html = renderToString(
    rosterScreen(translate, {
      action,
      branchId: 'root:default',
      rows: [
        {
          id: 'root:default:2026-08-17',
          state: 'published',
          version: 2,
          weekStart: '2026-08-17',
          shifts: [],
        },
      ],
      weekStart: '2026-08-17',
      workflowAction,
    }),
  )

  assert.match(html, /data-ui="badge" data-tone="positive" data-value="published"/)
  assert.match(html, /name="action" value="reopen"/)
  assert.doesNotMatch(html, /name="action" value="publish"/)
  assert.match(html, /Chưa có ca/)
})
