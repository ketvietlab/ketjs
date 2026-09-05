import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

const bootHr = async (t: TestContext) => {
  const e2e = await createTestDeployment(ketsuite, { worker: false })
  t.after(() => e2e.close())
  const scope = { company: 'default', branch: 'root:default', branches: ['root:default'] }
  const fixture = async (name: string, input: Record<string, unknown>, actor?: string) =>
    (await e2e.fixture.call<Row>(name, input, { scope, actor })).value

  await fixture('partner.savePartner', { id: 'default-party', kind: 'company', name: 'Két Việt' })
  await fixture('company.saveCompany', {
    id: 'default',
    code: 'KET',
    partnerId: 'default-party',
    currency: 'VND',
  })
  await fixture('partner.savePartner', {
    id: 'employee-party',
    kind: 'person',
    name: 'Nguyễn Minh Anh',
    email: 'minhanh@example.test',
  })
  await fixture('user.createUser', {
    id: 'admin',
    login: 'admin',
    password: 'correct horse',
    name: 'Quản trị',
    defaultCompanyId: 'default',
    defaultBranchId: 'root:default',
    superuser: true,
  })
  await fixture('user.grantCompany', { id: 'admin:default', userId: 'admin', companyId: 'default' })
  await fixture('user.createUser', {
    id: 'employee-user',
    login: 'employee',
    password: 'correct horse',
    name: 'Nguyễn Minh Anh',
    partnerId: 'employee-party',
    defaultCompanyId: 'default',
    defaultBranchId: 'root:default',
    superuser: false,
  })
  await fixture('user.grantCompany', {
    id: 'employee:default',
    userId: 'employee-user',
    companyId: 'default',
  })

  await fixture('hr.employee.save', {
    id: 'employee',
    code: 'NV001',
    partnerId: 'employee-party',
    userId: 'employee-user',
    homeBranchId: 'root:default',
    timezone: 'Asia/Ho_Chi_Minh',
    startDate: '2026-01-01',
  })
  await fixture('hr.shiftTemplate.save', {
    id: 'day',
    code: 'DAY',
    name: 'Ca ngày',
    branchId: 'root:default',
    startTime: '00:00',
    endTime: '23:59',
    breakMinutes: 60,
    timezone: 'Asia/Ho_Chi_Minh',
  })
  await fixture('hr.shiftTemplate.save', {
    id: 'night',
    code: 'NIGHT',
    name: 'Ca đêm',
    branchId: 'root:default',
    startTime: '22:00',
    endTime: '06:00',
    breakMinutes: 30,
    timezone: 'Asia/Ho_Chi_Minh',
  })
  await fixture('hr.rotation.save', {
    id: 'two-week',
    name: 'Xoay hai tuần',
    cycleWeeks: 2,
    slots: [
      { weekIndex: 0, weekday: 4, shiftTemplateId: 'day' },
      { weekIndex: 1, weekday: 4, shiftTemplateId: 'night' },
    ],
  })
  await fixture('hr.rotation.assign', {
    id: 'employee-rotation',
    employeeId: 'employee',
    rotationId: 'two-week',
    branchId: 'root:default',
    anchorDate: '2026-08-17',
    effectiveFrom: '2026-08-01',
  })
  const generated = await fixture('hr.roster.generate', { branchId: 'root:default', weekStart: '2026-08-17' })
  assert.equal(generated.ok, true)
  assert.equal(generated.generated, 1)
  const retry = await fixture('hr.roster.generate', { branchId: 'root:default', weekStart: '2026-08-17' })
  assert.equal(retry.generated, 0, 'rotation generation is idempotent')
  await fixture('hr.roster.managePublish', { id: 'root:default:2026-08-17', version: 1 })

  await fixture('hr.leaveType.save', { id: 'annual', code: 'AL', name: 'Phép năm', paid: true })
  await fixture('hr.leave.manageAllocation', {
    id: 'employee:annual:2026',
    employeeId: 'employee',
    leaveTypeId: 'annual',
    year: 2026,
    days: '12',
  })
  const hrPreset = await fixture('user.applyPreset', { module: 'hr', level: 'user' }, 'admin')
  const attendancePreset = await fixture('user.applyPreset', { module: 'attendance', level: 'user' }, 'admin')
  await fixture(
    'user.assignRole',
    { id: 'employee:hr', userId: 'employee-user', roleId: hrPreset.roleId },
    'admin',
  )
  await fixture(
    'user.assignRole',
    { id: 'employee:attendance', userId: 'employee-user', roleId: attendancePreset.roleId },
    'admin',
  )

  return { e2e, fixture }
}

test('HR attendance headless E2E: rotation, self service, PIN/QR kiosk and i18n', async (t) => {
  const { e2e, fixture } = await bootHr(t)
  const currentMonthParts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date())
  const currentMonth = `${currentMonthParts.find((part) => part.type === 'year')?.value}-${
    currentMonthParts.find((part) => part.type === 'month')?.value
  }`
  await e2e.client.login({ login: 'employee', password: 'correct horse' })

  const mine = await e2e.client.get('/my/work', { headers: { accept: 'text/html' } })
  const mineHtml = await mine.text()
  assert.equal(mine.status, 200, mineHtml)
  assert.match(mineHtml, /Công việc của tôi/)
  assert.match(mineHtml, /Nguyễn Minh Anh/)
  assert.doesNotMatch(mineHtml, /attendance_backend\.[A-Za-z]/)

  const inResult = await e2e.client.form<string>('/my/work', { action: 'punch' })
  assert.match(inResult, /Đã ghi nhận vào ca/)
  const outResult = await e2e.client.form<string>('/my/work', { action: 'punch' })
  assert.match(outResult, /Đã ghi nhận ra ca/)

  const leave = await e2e.client.form<string>('/my/work', {
    action: 'leave',
    leaveTypeId: 'annual',
    dateFrom: '2026-08-20',
    dateTo: '2026-08-20',
    portion: 'full',
    reason: 'Khám bệnh',
  })
  assert.match(leave, /Thành công/)

  const kiosk = await fixture(
    'attendance.kiosk.manageIssue',
    { id: 'front', name: 'Cổng chính', branchId: 'root:default' },
    'admin',
  )
  await fixture('attendance.credential.managePin', { employeeId: 'employee', pin: '2468' }, 'admin')
  const qr = await fixture('attendance.credential.manageQr', { employeeId: 'employee' }, 'admin')

  const kioskGet = await e2e.client.get(`/attendance/kiosk/${encodeURIComponent(String(kiosk.secret))}`)
  assert.equal(kioskGet.status, 200)
  assert.match(await kioskGet.text(), /Kiosk chấm công/)
  const pinHtml = await e2e.client.form<string>(
    `/attendance/kiosk/${encodeURIComponent(String(kiosk.secret))}`,
    { employeeCode: 'NV001', pin: '2468' },
  )
  assert.match(pinHtml, /Đã ghi nhận vào ca/)
  const qrHtml = await e2e.client.form<string>(
    `/attendance/kiosk/${encodeURIComponent(String(kiosk.secret))}`,
    { qr: String(qr.secret) },
  )
  assert.match(qrHtml, /Đã ghi nhận ra ca/)

  await e2e.client.logout()
  await e2e.client.login({ login: 'admin', password: 'correct horse' })
  const pendingLeaves = (await fixture(
    'hr.leave.manageList',
    { state: 'requested' },
    'admin',
  )) as unknown as Row[]
  await fixture(
    'hr.leave.manageDecision',
    { id: pendingLeaves[0]!.id, decision: 'approved', note: 'E2E period close' },
    'admin',
  )
  const english = await e2e.client.get('/admin/hr?lang=en')
  assert.equal(english.status, 200)
  const englishHtml = await english.text()
  assert.match(englishHtml, /Employees/)
  assert.match(englishHtml, /data-ui="list-page"/)
  assert.match(englishHtml, /href="\/admin\/hr\?create=1&amp;lang=en"/)
  assert.doesNotMatch(englishHtml, /id="hr-employee-form"|data-ui="modal-layer"/)
  assert.doesNotMatch(englishHtml, /name="partnerId"|Partner ID/)
  assert.doesNotMatch(englishHtml, /hr_backend\.[A-Za-z]/)

  const createdHtml = await e2e.client.form<string>('/admin/hr?lang=en', {
    code: 'NV002',
    name: 'Lê Thu Hà',
    userId: '',
    homeBranchId: 'root:default',
    timezone: 'Asia/Ho_Chi_Minh',
    startDate: '2026-08-21',
  })
  assert.match(createdHtml, /Lê Thu Hà/)
  const employees = (await fixture('hr.employee.manageList', {}, 'admin')) as unknown as Row[]
  const created = employees.find((row) => row.code === 'NV002')
  assert.equal(created?.name, 'Lê Thu Hà')
  assert.match(String(created?.partnerId), /^employee:.*:partner$/)
  const employeePartners = (await fixture(
    'partner.listPartners',
    { role: 'employee', search: 'Lê Thu Hà' },
    'admin',
  )) as unknown as Row[]
  assert.equal(employeePartners.length, 1)

  const rejected = await fixture(
    'hr.employee.create',
    {
      id: 'employee-invalid',
      code: 'NV003',
      name: 'Partner không được lưu',
      homeBranchId: 'missing-branch',
      timezone: 'Asia/Ho_Chi_Minh',
      startDate: '2026-08-21',
    },
    'admin',
  )
  assert.equal(rejected.ok, false)
  const rolledBack = (await fixture(
    'partner.listPartners',
    { search: 'Partner không được lưu' },
    'admin',
  )) as unknown as Row[]
  assert.deepEqual(rolledBack, [])

  const period = await e2e.client.get(`/admin/attendance?month=${currentMonth}`)
  assert.equal(period.status, 200)
  assert.match(await period.text(), /Bảng công tháng/)
  const locked = await e2e.client.form<string>(`/admin/attendance?month=${currentMonth}`, {
    action: 'close',
  })
  assert.match(locked, /Đã khóa/)
  const exported = await e2e.client.get(`/admin/attendance/export/${currentMonth}`)
  assert.equal(exported.status, 200)
  assert.match(await exported.text(), /employee_code,employee_name,date/)

  await e2e.client.logout()
  await e2e.client.login({ login: 'employee', password: 'correct horse' })
  const blocked = await e2e.client.form<string>('/my/work', { action: 'punch' })
  assert.match(blocked, /Không thể hoàn tất/)
})

test('HR attendance domain: overnight rotation alternates and published roster must reopen', async (t) => {
  const { fixture } = await bootHr(t)
  await fixture('hr.roster.generate', { branchId: 'root:default', weekStart: '2026-08-24' })
  const rows = (await fixture('hr.roster.manageList', {
    branchId: 'root:default',
    weekStart: '2026-08-24',
  })) as unknown as Row[]
  const shift = (rows[0]!.shifts as Row[])[0]!
  assert.equal(shift.localDate, '2026-08-27')
  assert.equal(Date.parse(String(shift.stopAt)) - Date.parse(String(shift.startAt)), 8 * 60 * 60 * 1000)
  await fixture('hr.roster.managePublish', { id: 'root:default:2026-08-24', version: 1 })
  const blocked = await fixture('hr.roster.generate', { branchId: 'root:default', weekStart: '2026-08-24' })
  assert.equal(blocked.ok, false)
  await fixture('hr.roster.manageReopen', { id: 'root:default:2026-08-24', reason: 'Điều chỉnh' })
  assert.equal(
    (await fixture('hr.roster.generate', { branchId: 'root:default', weekStart: '2026-08-24' })).ok,
    true,
  )
})
