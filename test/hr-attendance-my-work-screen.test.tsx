import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { modalWorkspace } from '../packages/ketsuite/src/ui/index.ts'
import {
  leaveRequestModal,
  myWorkScreen,
} from '../packages/ketsuite/src/modules/attendance_backend/screens/index.ts'

const messages: Record<string, string> = {
  'attendance_backend.action.cancel': 'Hủy',
  'attendance_backend.action.clockIn': 'Vào ca',
  'attendance_backend.action.clockOut': 'Ra ca',
  'attendance_backend.action.requestLeave': 'Gửi yêu cầu',
  'attendance_backend.clock.off': 'Chưa vào ca',
  'attendance_backend.clock.on': 'Đang trong ca',
  'attendance_backend.empty.leaves': 'Chưa có yêu cầu nghỉ',
  'attendance_backend.empty.leavesHint': 'Yêu cầu nghỉ sẽ xuất hiện tại đây.',
  'attendance_backend.empty.profile': 'Chưa liên kết nhân viên',
  'attendance_backend.empty.profileHint': 'Liên kết tài khoản.',
  'attendance_backend.empty.schedule': 'Không có ca',
  'attendance_backend.empty.scheduleHint': 'Ca đã phát hành sẽ xuất hiện tại đây.',
  'attendance_backend.empty.sessions': 'Chưa có lượt chấm công',
  'attendance_backend.empty.sessionsHint': 'Chấm công đầu tiên để bắt đầu.',
  'attendance_backend.field.branch': 'Chi nhánh',
  'attendance_backend.field.date': 'Ngày',
  'attendance_backend.field.dateFrom': 'Từ ngày',
  'attendance_backend.field.dateTo': 'Đến ngày',
  'attendance_backend.field.days': 'Số ngày',
  'attendance_backend.field.employee': 'Nhân viên',
  'attendance_backend.field.leaveType': 'Loại phép',
  'attendance_backend.field.portion': 'Buổi',
  'attendance_backend.field.reason': 'Lý do',
  'attendance_backend.field.start': 'Vào',
  'attendance_backend.field.state': 'Trạng thái',
  'attendance_backend.field.stop': 'Ra',
  'attendance_backend.field.timezone': 'Múi giờ',
  'attendance_backend.leaveState.requested': 'Chờ duyệt',
  'attendance_backend.my.clock': 'Trạng thái chấm công',
  'attendance_backend.my.clockSince': 'Bắt đầu từ',
  'attendance_backend.my.leave': 'Nghỉ phép',
  'attendance_backend.my.leaveHint': 'Chọn loại phép và thời gian nghỉ.',
  'attendance_backend.my.leaveRequest': 'Gửi yêu cầu nghỉ',
  'attendance_backend.my.profile': 'Hồ sơ',
  'attendance_backend.my.schedule': 'Lịch ca',
  'attendance_backend.my.sessions': 'Lịch sử chấm công',
  'attendance_backend.my.title': 'Công việc của tôi',
  'attendance_backend.portion.afternoon': 'Buổi chiều',
  'attendance_backend.portion.full': 'Cả ngày',
  'attendance_backend.portion.morning': 'Buổi sáng',
  'attendance_backend.result.title': 'Kết quả',
  'attendance_backend.state.open': 'Đang mở',
}

const translate = ((key: string) => messages[key] ?? key) as Translator
translate.locale = 'vi'
translate.has = (key) => key in messages
translate.resolves = translate.has

const base = () =>
  myWorkScreen(translate, {
    action: '/my/work?lang=vi',
    clock: { onClock: false },
    leaveHref: '/my/work?leave=1&lang=vi',
    leaves: [
      {
        id: 'leave-1',
        leaveTypeId: 'annual',
        dateFrom: '2026-08-28',
        dateTo: '2026-08-29',
        requestedDays: '2',
        state: 'requested',
      },
    ],
    profile: {
      code: 'NV001',
      name: 'Nguyễn Minh Anh',
      homeBranchId: 'root:default',
      timezone: 'Asia/Ho_Chi_Minh',
    },
    sessions: [
      {
        id: 'session-1',
        startAt: '2026-08-27T01:00:00.000Z',
        stopAt: null,
        state: 'open',
      },
    ],
    shifts: [
      {
        id: 'shift-1',
        localDate: '2026-08-27',
        startAt: '2026-08-27T01:00:00.000Z',
        stopAt: '2026-08-27T10:00:00.000Z',
      },
    ],
  })

test('Attendance My Work: specialized surface keeps employee timezone, schedule, sessions and leave relations', () => {
  const html = renderToString(base())

  assert.doesNotMatch(html, /data-ui="list-page"|data-ui="form-page"|data-ui="modal-layer"/)
  assert.match(html, /NV001 · Nguyễn Minh Anh/)
  assert.match(html, /Asia\/Ho_Chi_Minh/)
  assert.match(html, /2026-08-27T01:00:00\.000Z/)
  assert.match(html, /2026-08-27T10:00:00\.000Z/)
  assert.match(html, /annual/)
  assert.match(html, /2026-08-28 – 2026-08-29/)
  assert.match(html, /data-value="requested"/)
  assert.match(html, /href="\/my\/work\?leave=1&amp;lang=vi"/)
  assert.match(html, /action="\/my\/work\?lang=vi"/)
  assert.match(html, /name="expect" value="in"/)
  assert.match(html, /Vào ca/)
})

test('Attendance My Work: live clock state makes the next action explicit and retry-safe', () => {
  const html = renderToString(
    myWorkScreen(translate, {
      action: '/my/work?lang=vi',
      clock: {
        onClock: true,
        branchId: 'root:default',
        startAt: '2026-08-27T01:00:00.000Z',
      },
      leaveHref: '/my/work?leave=1&lang=vi',
      leaves: [],
      profile: null,
      sessions: [],
      shifts: [],
    }),
  )

  assert.match(html, /data-tone="warning" data-value="on"/)
  assert.match(html, /Bắt đầu từ 2026-08-27T01:00:00\.000Z/)
  assert.match(html, /root:default/)
  assert.match(html, /name="expect" value="out"/)
  assert.match(html, /Ra ca/)
})

test('Attendance leave request: URL-owned modal retains rejected relation, dates, portion and reason', () => {
  const html = renderToString(
    modalWorkspace(
      base(),
      leaveRequestModal(translate, {
        action: '/my/work?leave=1&lang=vi',
        cancelHref: '/my/work?lang=vi',
        errors: ['dateTo: Ngày kết thúc không hợp lệ.'],
        values: {
          leaveTypeId: 'annual',
          dateFrom: '2026-08-30',
          dateTo: '2026-08-29',
          portion: 'morning',
          reason: 'Khám bệnh',
        },
      }),
    ),
  )

  assert.match(html, /data-ui="modal-layer" data-route-modal="true"/)
  assert.equal(html.match(/data-ui="form-field"/g)?.length, 5)
  assert.match(html, /action="\/my\/work\?leave=1&amp;lang=vi"/)
  assert.match(html, /data-ui="modal-close" href="\/my\/work\?lang=vi"/)
  assert.match(html, /name="leaveTypeId"[^>]*value="annual"/)
  assert.match(html, /name="dateFrom"[^>]*value="2026-08-30"/)
  assert.match(html, /name="dateTo"[^>]*value="2026-08-29"/)
  assert.match(html, /<option value="morning" selected="true">/)
  assert.match(html, /name="reason"[^>]*value="Khám bệnh"/)
  assert.match(html, /dateTo: Ngày kết thúc không hợp lệ\./)
})
