import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { periodScreen } from '../packages/ketsuite/src/modules/attendance_backend/screens/index.ts'

const messages: Record<string, string> = {
  'attendance_backend.action.close': 'Chốt kỳ',
  'attendance_backend.action.export': 'Xuất CSV',
  'attendance_backend.action.openPeriod': 'Mở kỳ',
  'attendance_backend.action.reopen': 'Mở lại',
  'attendance_backend.admin.subtitle': 'Rà soát ngày công theo múi giờ chính sách.',
  'attendance_backend.admin.title': 'Bảng công tháng',
  'attendance_backend.empty.entries': 'Chưa có dữ liệu công',
  'attendance_backend.empty.entriesHint': 'Phát hành ca rồi mở lại kỳ.',
  'attendance_backend.field.date': 'Ngày',
  'attendance_backend.field.employee': 'Nhân viên',
  'attendance_backend.field.exception': 'Ngoại lệ',
  'attendance_backend.field.month': 'Tháng',
  'attendance_backend.field.overtime': 'Tăng ca duyệt',
  'attendance_backend.field.planned': 'Kế hoạch',
  'attendance_backend.field.worked': 'Thực tế',
  'attendance_backend.period.entries': 'Ngày công',
  'attendance_backend.period.entryCount': 'Số dòng',
  'attendance_backend.period.state': 'Trạng thái kỳ',
  'attendance_backend.state.locked': 'Đã khóa',
  'attendance_backend.state.open': 'Đang mở',
}

const translate = ((key: string) => messages[key] ?? key) as Translator
translate.locale = 'vi'
translate.has = (key) => key in messages
translate.resolves = translate.has

test('attendance period screen keeps month context, lifecycle version and computed entry grid', () => {
  const html = renderToString(
    periodScreen(translate, {
      action: '/admin/attendance?lang=vi',
      exportHref: '/admin/attendance/export/2026-08?lang=vi',
      lang: 'vi',
      month: '2026-08',
      period: {
        id: '2026-08',
        month: '2026-08',
        timezone: 'Asia/Ho_Chi_Minh',
        state: 'locked',
        version: 4,
        entries: [
          {
            id: 'entry-1',
            employeeId: 'employee-1',
            localDate: '2026-08-21',
            plannedMinutes: 480,
            workedMinutes: 465,
            approvedOvertimeMinutes: 30,
            exception: null,
          },
        ],
      },
      workflowAction: '/admin/attendance?month=2026-08&lang=vi',
    }),
  )

  assert.doesNotMatch(html, /data-ui="list-page"|data-ui="modal-layer"/)
  assert.match(html, /data-ui="form-page"[^>]*data-variant="operational"/)
  assert.match(html, /method="get" action="\/admin\/attendance\?lang=vi"/)
  assert.match(html, /type="hidden" name="lang" value="vi"/)
  assert.match(html, /name="month"[^>]*value="2026-08"/)
  assert.match(html, /2026-08 · Asia\/Ho_Chi_Minh/)
  assert.match(html, /name="expectedVersion" value="4"/)
  assert.match(html, /name="action" value="reopen"/)
  assert.doesNotMatch(html, /name="action" value="close"/)
  assert.match(html, /href="\/admin\/attendance\/export\/2026-08\?lang=vi"/)
  assert.match(html, /data-ui="table"/)
  assert.match(html, /employee-1/)
  assert.match(html, /2026-08-21/)
  assert.match(html, /data-col="worked"[\s\S]*?465/)
})

test('attendance period screen retains a rejected month and translated errors', () => {
  const html = renderToString(
    periodScreen(translate, {
      action: '/admin/attendance?lang=vi',
      errors: ['month: Tháng phải theo định dạng YYYY-MM.'],
      month: '2026-13',
      period: null,
      workflowAction: '/admin/attendance?month=2026-13&lang=vi',
    }),
  )

  assert.match(html, /data-ui="form-errors" role="alert"/)
  assert.match(html, /month: Tháng phải theo định dạng YYYY-MM\./)
  assert.match(html, /name="month"[^>]*value="2026-13"/)
  assert.doesNotMatch(html, /data-ui="data-table"|name="expectedVersion"|name="action" value="close"/)
})
