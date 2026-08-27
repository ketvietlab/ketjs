import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

async function bootMyWork(t: TestContext) {
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
  })
  await fixture('user.createUser', {
    id: 'admin',
    login: 'admin',
    password: 'correct horse',
    name: 'Administrator',
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
    defaultCompanyId: 'default',
    defaultBranchId: 'root:default',
  })
  await fixture('user.grantCompany', {
    id: 'employee:default',
    userId: 'employee-user',
    companyId: 'default',
  })
  await fixture('hr.employee.save', {
    id: 'employee-1',
    code: 'NV001',
    partnerId: 'employee-party',
    userId: 'employee-user',
    homeBranchId: 'root:default',
    timezone: 'Asia/Ho_Chi_Minh',
    startDate: '2026-01-01',
  })
  await fixture('hr.leaveType.save', { id: 'annual', code: 'AL', name: 'Phép năm', paid: true })

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

  const dateFrom = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10)
  const dateTo = new Date(Date.now() + 11 * 86_400_000).toISOString().slice(0, 10)
  await fixture('hr.leave.manageAllocation', {
    id: `employee-1:annual:${dateFrom.slice(0, 4)}`,
    employeeId: 'employee-1',
    leaveTypeId: 'annual',
    year: Number(dateFrom.slice(0, 4)),
    days: '20',
  })
  await e2e.client.login({ login: 'employee', password: 'correct horse' })
  return { dateFrom, dateTo, e2e, fixture }
}

const form = (values: Record<string, string>) => new URLSearchParams(values)

test('Attendance My Work HTTP: specialized clock and leave modal preserve permissions, locale and retry safety', async (t) => {
  const { dateFrom, dateTo, e2e, fixture } = await bootMyWork(t)

  const initialResponse = await e2e.client.get('/my/work?lang=en')
  assert.equal(initialResponse.status, 200)
  const initial = await initialResponse.text()
  assert.doesNotMatch(initial, /data-ui="list-page"|data-ui="form-page"|data-ui="modal-layer"/)
  assert.match(initial, /My work/)
  assert.match(initial, /NV001 · Nguyễn Minh Anh/)
  assert.match(initial, /Asia\/Ho_Chi_Minh/)
  assert.match(initial, /action="\/my\/work\?lang=en"/)
  assert.match(initial, /name="expect" value="in"/)
  assert.match(initial, /Clock in/)
  assert.match(initial, /href="\/my\/work\?leave=1&amp;lang=en"/)

  const modal = await (await e2e.client.get('/my/work?leave=1&lang=en')).text()
  assert.match(modal, /data-ui="modal-layer" data-route-modal="true"/)
  assert.equal(modal.match(/data-ui="form-field"/g)?.length, 5)
  assert.match(modal, /action="\/my\/work\?leave=1&amp;lang=en"/)
  assert.match(modal, /data-ui="modal-close" href="\/my\/work\?lang=en"/)

  const unsupported = await e2e.client.request('/my/work?lang=en', { method: 'PUT' })
  assert.equal(unsupported.status, 405)

  const refusedPunch = await e2e.client.post('/my/work?lang=en', form({ action: 'punch', expect: 'in' }), {
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      origin: 'https://cross-site.example',
    },
    redirect: 'manual',
  })
  assert.equal(refusedPunch.status, 403)
  let clock = (await fixture('attendance.clock.mine', {}, 'employee-user')) as unknown as Row
  assert.equal(clock.onClock, false)

  const checkedIn = await e2e.client.post('/my/work?lang=en', form({ action: 'punch', expect: 'in' }), {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    redirect: 'manual',
  })
  assert.equal(checkedIn.status, 303)
  assert.equal(checkedIn.headers.get('location'), '/my/work?result=in&lang=en')
  clock = (await fixture('attendance.clock.mine', {}, 'employee-user')) as unknown as Row
  assert.equal(clock.onClock, true)

  const retry = await e2e.client.post('/my/work?lang=en', form({ action: 'punch', expect: 'in' }), {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    redirect: 'manual',
  })
  assert.equal(retry.status, 200)
  const retryHtml = await retry.text()
  assert.match(retryHtml, /Unable to complete/)
  assert.match(retryHtml, /name="expect" value="out"/)
  clock = (await fixture('attendance.clock.mine', {}, 'employee-user')) as unknown as Row
  assert.equal(clock.onClock, true, 'a repeated check-in must not clock the employee out')

  const resultPage = await (await e2e.client.get('/my/work?result=in&lang=en')).text()
  assert.match(resultPage, /Checked in/)
  assert.match(resultPage, /data-ui="notice" data-tone="positive"/)

  const checkedOut = await e2e.client.post('/my/work?lang=en', form({ action: 'punch', expect: 'out' }), {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    redirect: 'manual',
  })
  assert.equal(checkedOut.status, 303)
  assert.equal(checkedOut.headers.get('location'), '/my/work?result=out&lang=en')

  const refusedLeave = await e2e.client.post(
    '/my/work?leave=1&lang=en',
    form({ action: 'leave', leaveTypeId: 'annual', dateFrom, dateTo, portion: 'full' }),
    {
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin: 'https://cross-site.example',
      },
      redirect: 'manual',
    },
  )
  assert.equal(refusedLeave.status, 403)
  assert.equal(((await fixture('hr.leave.mine', {}, 'employee-user')) as unknown as Row[]).length, 0)

  const invalid = await e2e.client.post(
    '/my/work?leave=1&lang=vi',
    form({
      action: 'leave',
      leaveTypeId: 'annual',
      dateFrom: dateTo,
      dateTo: dateFrom,
      portion: 'morning',
      reason: 'Khám bệnh',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(invalid.status, 200)
  const invalidHtml = await invalid.text()
  assert.match(invalidHtml, /data-ui="modal-layer" data-route-modal="true"/)
  assert.match(invalidHtml, /data-ui="form-errors" role="alert"/)
  assert.match(invalidHtml, /name="leaveTypeId"[^>]*value="annual"/)
  assert.match(invalidHtml, new RegExp(`name="dateFrom"[^>]*value="${dateTo}"`))
  assert.match(invalidHtml, new RegExp(`name="dateTo"[^>]*value="${dateFrom}"`))
  assert.match(invalidHtml, /<option value="morning" selected="true">/)
  assert.match(invalidHtml, /name="reason"[^>]*value="Khám bệnh"/)

  const requested = await e2e.client.post(
    '/my/work?leave=1&lang=en',
    form({
      action: 'leave',
      leaveTypeId: 'annual',
      dateFrom,
      dateTo,
      portion: 'full',
      reason: 'Family appointment',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(requested.status, 303)
  assert.equal(requested.headers.get('location'), '/my/work?result=success&lang=en')
  const afterLeave = await (await e2e.client.get('/my/work?result=success&lang=en')).text()
  assert.match(afterLeave, /Success/)
  assert.match(afterLeave, /annual/)
  assert.match(afterLeave, new RegExp(`${dateFrom} – ${dateTo}`))
  assert.match(afterLeave, /data-value="requested"/)

  const legacyPunch = await e2e.client.post('/my/work?lang=en', form({ action: 'punch' }), {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    redirect: 'manual',
  })
  assert.equal(legacyPunch.status, 303, 'the legacy punch POST without expect remains compatible')
  assert.equal(legacyPunch.headers.get('location'), '/my/work?result=in&lang=en')
})

test('Attendance My Work HTTP: session month follows attendance policy while schedule follows employee timezone', async (t) => {
  t.mock.timers.enable({
    apis: ['Date'],
    now: new Date('2026-07-31T17:30:00.000Z'),
  })
  const { e2e, fixture } = await bootMyWork(t)

  await fixture(
    'attendance.policy.save',
    {
      timezone: 'America/Los_Angeles',
      lateGraceMinutes: 5,
      earlyGraceMinutes: 5,
      roundingMinutes: 1,
      overtimeMinimumMinutes: 30,
    },
    'admin',
  )
  const rosterId = 'root:default:2026-07-27'
  await fixture(
    'hr.shiftTemplate.save',
    {
      id: 'tokyo-august-day',
      code: 'AUG-DAY',
      name: 'August day',
      branchId: 'root:default',
      startTime: '08:00',
      endTime: '16:00',
      breakMinutes: 0,
      timezone: 'Asia/Ho_Chi_Minh',
    },
    'admin',
  )
  await fixture(
    'hr.rotation.save',
    {
      id: 'tokyo-august-rotation',
      name: 'August rotation',
      cycleWeeks: 1,
      slots: [{ weekIndex: 0, weekday: 6, shiftTemplateId: 'tokyo-august-day' }],
    },
    'admin',
  )
  await fixture(
    'hr.rotation.assign',
    {
      id: 'employee-august-rotation',
      employeeId: 'employee-1',
      rotationId: 'tokyo-august-rotation',
      branchId: 'root:default',
      anchorDate: '2026-07-27',
      effectiveFrom: '2026-07-27',
    },
    'admin',
  )
  await fixture('hr.roster.generate', { branchId: 'root:default', weekStart: '2026-07-27' }, 'admin')
  await fixture('hr.roster.managePublish', { id: rosterId, version: 1 }, 'admin')
  await fixture('attendance.punch.self', { expect: 'in' }, 'employee-user')
  await fixture('attendance.punch.self', { expect: 'out' }, 'employee-user')

  const response = await e2e.client.get('/my/work?lang=en')
  const html = await response.text()
  assert.equal(response.status, 200)
  assert.match(html, /Asia\/Ho_Chi_Minh/, 'the profile keeps the employee timezone')
  assert.match(html, /2026-08-01/, 'the schedule uses the employee-local August date range')
  assert.match(
    html,
    /2026-07-31T17:30:00\.000Z/,
    'the session uses the policy-local July month instead of the employee-local August month',
  )
})
