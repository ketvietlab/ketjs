import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

async function bootLeaves(t: TestContext) {
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
  await fixture('hr.employee.save', {
    id: 'employee-1',
    code: 'NV001',
    partnerId: 'employee-party',
    homeBranchId: 'root:default',
    timezone: 'Asia/Ho_Chi_Minh',
    startDate: '2026-01-01',
  })
  await fixture('hr.leaveType.save', { id: 'annual', code: 'AL', name: 'Phép năm', paid: true })
  await fixture('hr.leave.manageAllocation', {
    id: 'employee-1:annual:2026',
    employeeId: 'employee-1',
    leaveTypeId: 'annual',
    year: 2026,
    days: '60',
  })
  for (let index = 0; index < 32; index++) {
    const date = new Date(Date.UTC(2026, 8, index + 1)).toISOString().slice(0, 10)
    await fixture(
      'hr.leave.request',
      {
        id: `leave-${String(index + 1).padStart(2, '0')}`,
        employeeId: 'employee-1',
        leaveTypeId: 'annual',
        dateFrom: date,
        dateTo: date,
        portion: 'full',
        reason: index === 31 ? 'Khám bệnh' : `Yêu cầu ${String(index + 1)}`,
      },
      'admin',
    )
  }
  await e2e.client.login({ login: 'admin', password: 'correct horse' })
  return { e2e, fixture }
}

const decision = (value: string) => new URLSearchParams({ action: value })

test('HR leave approvals HTTP: ListPage search/filter/paging and decisions preserve state safely', async (t) => {
  const { e2e, fixture } = await bootLeaves(t)

  const first = await (await e2e.client.get('/admin/hr/leaves?lang=en')).text()
  assert.match(first, /data-ui="list-page"/)
  assert.match(first, /Leave approvals/)
  assert.match(first, /data-ui="chrome-search"/)
  assert.match(first, /data-ui="search-menu"/)
  assert.match(first, /1-30 \/ 32/)
  assert.match(first, /leave-01/)
  assert.doesNotMatch(first, /leave-32/)
  assert.match(first, /NV001 · Nguyễn Minh Anh/)
  assert.match(first, /annual/)
  assert.match(first, /name="action" value="approved"/)
  assert.match(first, /name="action" value="rejected"/)

  const second = await (await e2e.client.get('/admin/hr/leaves?page=2&lang=en')).text()
  assert.match(second, /31-32 \/ 32/)
  assert.match(second, /leave-31/)
  assert.match(second, /leave-32/)
  assert.doesNotMatch(second, /leave-01/)

  const searchPath = '/admin/hr/leaves?q=leave-32&state=requested&lang=en'
  const searched = await (await e2e.client.get(searchPath)).text()
  assert.match(searched, /value="leave-32"/)
  assert.match(searched, /data-ui="facet"/)
  assert.match(searched, /leave-32/)
  assert.match(searched, /2026-10-02 – 2026-10-02/)
  assert.match(searched, /Khám bệnh/)
  assert.match(
    searched,
    /action="\/admin\/hr\/leaves\?q=leave-32&amp;state=requested&amp;lang=en&amp;id=leave-32"/,
  )

  const refused = await e2e.client.post(
    '/admin/hr/leaves?q=leave-30&state=requested&lang=en&id=leave-30',
    decision('rejected'),
    {
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin: 'https://cross-site.example',
      },
      redirect: 'manual',
    },
  )
  assert.equal(refused.status, 403)
  let requests = (await fixture('hr.leave.manageList', {}, 'admin')) as unknown as Row[]
  assert.equal(requests.find((row) => row.id === 'leave-30')?.state, 'requested')

  const invalidPath = '/admin/hr/leaves?q=leave-31&state=requested&lang=vi&id=leave-31'
  const invalid = await e2e.client.post(invalidPath, decision('invalid'), {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    redirect: 'manual',
  })
  assert.equal(invalid.status, 200)
  const invalidHtml = await invalid.text()
  assert.match(invalidHtml, /data-ui="notice" data-tone="danger" role="alert"/)
  assert.match(invalidHtml, /Không thể cập nhật yêu cầu nghỉ/)
  assert.match(invalidHtml, /leave-31/)
  assert.match(invalidHtml, /value="leave-31"/)
  requests = (await fixture('hr.leave.manageList', {}, 'admin')) as unknown as Row[]
  assert.equal(requests.find((row) => row.id === 'leave-31')?.state, 'requested')

  const approved = await e2e.client.post(`${searchPath}&id=leave-32`, decision('approved'), {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    redirect: 'manual',
  })
  assert.equal(approved.status, 303)
  assert.equal(approved.headers.get('location'), searchPath)
  const approveRetry = await e2e.client.post(`${searchPath}&id=leave-32`, decision('approved'), {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    redirect: 'manual',
  })
  assert.equal(approveRetry.status, 303)
  requests = (await fixture('hr.leave.manageList', {}, 'admin')) as unknown as Row[]
  assert.equal(requests.find((row) => row.id === 'leave-32')?.state, 'approved')

  const rejectPath = '/admin/hr/leaves?q=leave-31&state=requested&lang=en&id=leave-31'
  const rejected = await e2e.client.post(rejectPath, decision('rejected'), {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    redirect: 'manual',
  })
  assert.equal(rejected.status, 303)
  assert.equal(rejected.headers.get('location'), '/admin/hr/leaves?q=leave-31&state=requested&lang=en')
  const rejectRetryWithOppositeDecision = await e2e.client.post(rejectPath, decision('approved'), {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    redirect: 'manual',
  })
  assert.equal(rejectRetryWithOppositeDecision.status, 303)
  requests = (await fixture('hr.leave.manageList', {}, 'admin')) as unknown as Row[]
  assert.equal(
    requests.find((row) => row.id === 'leave-31')?.state,
    'rejected',
    'a retried decision must not reverse an already decided request',
  )

  const approvedFilter = await (await e2e.client.get('/admin/hr/leaves?state=approved&lang=en')).text()
  assert.match(approvedFilter, /leave-32/)
  assert.doesNotMatch(approvedFilter, /leave-31/)
  assert.match(approvedFilter, /data-value="approved"/)
  assert.doesNotMatch(approvedFilter, /name="action" value="approved"/)

  await fixture('user.createUser', {
    id: 'hr-manager',
    login: 'hr-manager',
    password: 'correct horse',
    name: 'HR Manager',
    defaultCompanyId: 'default',
    defaultBranchId: 'root:default',
  })
  await fixture('user.grantCompany', {
    id: 'hr-manager:default',
    userId: 'hr-manager',
    companyId: 'default',
  })
  const preset = await fixture('user.applyPreset', { module: 'hr', level: 'manager' }, 'admin')
  await fixture(
    'user.assignRole',
    { id: 'hr-manager:role', userId: 'hr-manager', roleId: preset.roleId },
    'admin',
  )
  await e2e.client.login({ login: 'hr-manager', password: 'correct horse' })
  assert.equal((await e2e.client.get('/admin/hr/leaves?state=requested&lang=vi')).status, 200)
})
