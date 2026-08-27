import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { modalWorkspace } from '../packages/ketsuite/src/ui/index.ts'
import {
  credentialModal,
  credentialScreen,
  credentialSecretModal,
} from '../packages/ketsuite/src/modules/attendance_backend/screens/index.ts'

const messages: Record<string, string> = {
  'attendance_backend.action.cancel': 'Hủy',
  'attendance_backend.action.dismiss': 'Đóng',
  'attendance_backend.action.kiosk': 'Cấp kiosk',
  'attendance_backend.action.pin': 'Lưu PIN',
  'attendance_backend.action.qr': 'Cấp QR',
  'attendance_backend.credentials.actions': 'Thao tác cấp mã',
  'attendance_backend.credentials.kiosk': 'Cấp kiosk',
  'attendance_backend.credentials.kioskHint': 'Tạo mã cho kiosk.',
  'attendance_backend.credentials.once': 'Secret chỉ hiển thị một lần',
  'attendance_backend.credentials.pin': 'Đặt PIN',
  'attendance_backend.credentials.pinHint': 'Đặt PIN cho nhân viên.',
  'attendance_backend.credentials.qr': 'Cấp lại QR',
  'attendance_backend.credentials.qrHint': 'Xoay QR cho nhân viên.',
  'attendance_backend.credentials.subtitle': 'Cấp quyền chấm công an toàn.',
  'attendance_backend.credentials.title': 'Kiosk và mã chấm công',
  'attendance_backend.field.branch': 'Chi nhánh',
  'attendance_backend.field.employee': 'Nhân viên',
  'attendance_backend.field.name': 'Tên',
  'attendance_backend.field.pin': 'PIN',
}
const translate = ((key: string) => messages[key] ?? key) as Translator
translate.locale = 'vi'
translate.has = (key) => key in messages
translate.resolves = translate.has

const hub = () =>
  credentialScreen(translate, {
    actions: {
      kiosk: '/admin/attendance/credentials?issue=kiosk&lang=vi',
      pin: '/admin/attendance/credentials?issue=pin&lang=vi',
      qr: '/admin/attendance/credentials?issue=qr&lang=vi',
    },
  })

test('attendance credential hub is specialized and exposes URL-owned short workflows', () => {
  const html = renderToString(hub())
  assert.match(html, /data-ui="record-workspace"/)
  assert.doesNotMatch(html, /data-ui="list-page"|data-ui="form-page"|data-ui="modal-layer"/)
  for (const issue of ['kiosk', 'pin', 'qr'])
    assert.match(html, new RegExp(`href="/admin/attendance/credentials\\?issue=${issue}&amp;lang=vi"`))
})

test('attendance credential modals keep branch server-owned and rejected employee relation values', () => {
  const kioskHtml = renderToString(
    modalWorkspace(
      hub(),
      credentialModal(translate, {
        action: '/admin/attendance/credentials?issue=kiosk&lang=vi',
        branchId: 'root:default',
        cancelHref: '/admin/attendance/credentials?lang=vi',
        employeeOptions: [],
        issue: 'kiosk',
        values: { name: 'Cổng chính', requestKey: 'request-kiosk-001' },
      }),
    ),
  )
  assert.match(kioskHtml, /data-ui="modal-layer"[^>]*data-presentation="dialog"/)
  assert.match(kioskHtml, /action="\/admin\/attendance\/credentials\?issue=kiosk&amp;lang=vi"/)
  assert.match(kioskHtml, /type="hidden" name="branchId" value="root:default"/)
  assert.match(kioskHtml, /type="hidden" name="requestKey" value="request-kiosk-001"/)
  assert.match(kioskHtml, /name="name"[^>]*value="Cổng chính"/)
  assert.doesNotMatch(kioskHtml, /data-kind="text"[^>]*>[\s\S]*?name="branchId"/)

  const pinHtml = renderToString(
    modalWorkspace(
      hub(),
      credentialModal(translate, {
        action: '/admin/attendance/credentials?issue=pin&lang=vi',
        cancelHref: '/admin/attendance/credentials?lang=vi',
        employeeOptions: [{ value: 'employee-1', label: 'NV001 · Nguyễn Minh Anh' }],
        errors: ['employeeId: Không tìm thấy'],
        issue: 'pin',
        values: { employeeId: 'missing-employee' },
      }),
    ),
  )
  assert.match(pinHtml, /<option value="missing-employee" selected="true">/)
  assert.match(pinHtml, /<option value="employee-1"/)
  assert.match(pinHtml, /type="password" name="pin"[^>]*value=""/)
  assert.match(pinHtml, /data-ui="form-errors" role="alert"/)
})

test('attendance QR secret result is an immediate modal and never places the secret in a URL', () => {
  const secret = 'one-shot-token-123456'
  const html = renderToString(
    modalWorkspace(
      hub(),
      credentialSecretModal(translate, {
        cancelHref: '/admin/attendance/credentials?lang=vi',
        issue: 'qr',
        secret,
      }),
    ),
  )
  assert.match(html, /Secret chỉ hiển thị một lần/)
  assert.match(html, new RegExp(secret))
  assert.match(html, /data-ui="qr-code"/)
  assert.doesNotMatch(html, new RegExp(`href="[^"]*${secret}`))
})
