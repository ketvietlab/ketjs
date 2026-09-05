import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

async function bootEmployees(t: TestContext) {
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
  await fixture('partner.savePartner', { id: 'employee-party', kind: 'person', name: 'Nguyễn Minh Anh' })
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
  await fixture('hr.department.save', { id: 'operations', name: 'Vận hành' })
  await fixture('hr.job.save', { id: 'packer', name: 'Đóng gói' })
  await fixture('hr.employee.save', {
    id: 'employee-1',
    code: 'NV001',
    partnerId: 'employee-party',
    userId: 'employee-user',
    departmentId: 'operations',
    jobId: 'packer',
    homeBranchId: 'root:default',
    timezone: 'Asia/Ho_Chi_Minh',
    startDate: '2026-01-01',
  })
  await e2e.client.login({ login: 'admin', password: 'correct horse' })
  return { e2e, fixture }
}

const createForm = (code: string, branch = 'root:default') =>
  new URLSearchParams({
    code,
    name: 'Lê Thu Hà',
    userId: '',
    homeBranchId: branch,
    timezone: 'Asia/Ho_Chi_Minh',
    startDate: '2026-09-01',
  })

const editForm = (overrides: Record<string, string> = {}) =>
  new URLSearchParams({
    code: 'NV001A',
    userId: '',
    homeBranchId: 'root:default',
    timezone: 'UTC',
    startDate: '2026-01-02',
    endDate: '2026-12-31',
    active: '1',
    ...overrides,
  })

test('HR employees HTTP: modal create/edit preserves roles, relations, state, locale and legacy POST', async (t) => {
  const { e2e, fixture } = await bootEmployees(t)

  const list = await (await e2e.client.get('/admin/hr?lang=vi')).text()
  assert.match(list, /data-ui="list-page"/)
  assert.match(list, /href="\/admin\/hr\?create=1&amp;lang=vi"/)
  assert.match(list, /data-row-href="\/admin\/hr\?edit=employee-1&amp;lang=vi"/)
  assert.match(list, /NV001/)
  assert.match(list, /Nguyễn Minh Anh/)
  assert.doesNotMatch(list, /id="hr-employee-form"|data-ui="modal-layer"/)

  const create = await (await e2e.client.get('/admin/hr?create=1&lang=vi')).text()
  assert.match(create, /data-ui="list-page"/)
  assert.match(create, /data-ui="modal-layer" data-route-modal="true"/)
  assert.match(create, /action="\/admin\/hr\?create=1&amp;lang=vi"/)
  assert.match(create, /data-ui="modal-close" href="\/admin\/hr\?lang=vi"/)
  assert.match(create, /type="hidden" name="id" value="[^"]+"/)
  assert.equal(create.match(/data-ui="form-field"/g)?.length, 6)
  assert.doesNotMatch(create, /name="partnerId"|Partner ID/)

  const refused = await e2e.client.post('/admin/hr?create=1&lang=en', createForm('CROSS'), {
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      origin: 'https://cross-site.example',
    },
    redirect: 'manual',
  })
  assert.equal(refused.status, 403)

  const invalidValues = createForm('NV002', 'missing')
  invalidValues.set('id', 'employee-create-retry')
  const invalid = await e2e.client.post('/admin/hr?create=1&lang=vi', invalidValues, {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    redirect: 'manual',
  })
  assert.equal(invalid.status, 200)
  const invalidHtml = await invalid.text()
  assert.match(invalidHtml, /data-ui="form-errors" role="alert"/)
  assert.match(invalidHtml, /type="hidden" name="id" value="employee-create-retry"/)
  assert.match(invalidHtml, /name="code"[^>]*value="NV002"/)
  assert.match(invalidHtml, /name="name"[^>]*value="Lê Thu Hà"/)
  assert.match(
    invalidHtml,
    /<option value="missing" selected="true">|name="homeBranchId"[^>]*value="missing"/,
  )
  assert.match(invalidHtml, /name="startDate"[^>]*value="2026-09-01"/)

  const created = await e2e.client.post('/admin/hr?create=1&lang=en', createForm('NV002'), {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    redirect: 'manual',
  })
  assert.equal(created.status, 303)
  assert.equal(created.headers.get('location'), '/admin/hr?lang=en')

  const edit = await (await e2e.client.get('/admin/hr?edit=employee-1&lang=en')).text()
  assert.match(edit, /data-ui="modal-layer" data-route-modal="true"/)
  assert.match(edit, /action="\/admin\/hr\?edit=employee-1&amp;lang=en"/)
  assert.equal(edit.match(/data-ui="form-field"/g)?.length, 8)
  assert.match(edit, /name="id" value="employee-1"/)
  assert.match(edit, /name="name"[^>]*value="Nguyễn Minh Anh"[^>]*disabled="true"/)
  assert.match(edit, /name="userId"[^>]*value="employee-user"/)
  assert.match(edit, /name="startDate"[^>]*value="2026-01-01"/)
  assert.match(edit, /type="checkbox" name="active"[^>]*checked="true"/)

  const missing = await e2e.client.get('/admin/hr?edit=missing&lang=en')
  assert.equal(missing.status, 404)

  const invalidEdit = await e2e.client.post(
    '/admin/hr?edit=employee-1&lang=vi',
    editForm({ timezone: 'Mars/Olympus' }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(invalidEdit.status, 200)
  const invalidEditHtml = await invalidEdit.text()
  assert.match(invalidEditHtml, /data-ui="form-errors" role="alert"/)
  assert.match(invalidEditHtml, /name="code"[^>]*value="NV001A"/)
  assert.match(invalidEditHtml, /<option value="Mars\/Olympus" selected="true">/)
  assert.match(invalidEditHtml, /name="endDate"[^>]*value="2026-12-31"/)

  const updated = await e2e.client.post('/admin/hr?edit=employee-1&lang=en', editForm(), {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    redirect: 'manual',
  })
  assert.equal(updated.status, 303)
  assert.equal(updated.headers.get('location'), '/admin/hr?lang=en')

  const afterEdit = (await fixture(
    'hr.employee.manageList',
    { includeArchived: true },
    'admin',
  )) as unknown as Row[]
  const edited = afterEdit.find((row) => row.id === 'employee-1')!
  assert.deepEqual(
    {
      code: edited.code,
      departmentId: edited.departmentId,
      endDate: edited.endDate,
      jobId: edited.jobId,
      name: edited.name,
      partnerId: edited.partnerId,
      startDate: edited.startDate,
      timezone: edited.timezone,
      userId: edited.userId,
    },
    {
      code: 'NV001A',
      departmentId: 'operations',
      endDate: '2026-12-31',
      jobId: 'packer',
      name: 'Nguyễn Minh Anh',
      partnerId: 'employee-party',
      startDate: '2026-01-02',
      timezone: 'UTC',
      userId: null,
    },
  )

  const archived = await e2e.client.post(
    '/admin/hr?lang=vi',
    new URLSearchParams({ action: 'archive', id: 'employee-1' }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(archived.status, 303)
  const archivedList = await (await e2e.client.get('/admin/hr?lang=vi')).text()
  assert.match(archivedList, /NV001A/)
  assert.match(archivedList, /data-ui="badge" data-tone="neutral"[\s\S]*?Đã lưu trữ/)
  assert.match(archivedList, /name="action" value="restore"/)

  const restored = await e2e.client.post(
    '/admin/hr?lang=en',
    new URLSearchParams({ action: 'restore', id: 'employee-1' }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(restored.status, 303)
  assert.equal(restored.headers.get('location'), '/admin/hr?lang=en')
  const retainedRole = (await fixture(
    'partner.listPartners',
    { role: 'employee', search: 'Nguyễn Minh Anh' },
    'admin',
  )) as unknown as Row[]
  assert.equal(retainedRole.length, 1)

  const legacy = createForm('NV003')
  legacy.set('id', 'legacy-employee')
  const legacyCreated = await e2e.client.post('/admin/hr?lang=vi', legacy, {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    redirect: 'manual',
  })
  assert.equal(legacyCreated.status, 303)
  assert.equal(legacyCreated.headers.get('location'), '/admin/hr?lang=vi')

  const partners = (await fixture(
    'partner.listPartners',
    { role: 'employee', search: 'Lê Thu Hà' },
    'admin',
  )) as unknown as Row[]
  assert.equal(partners.length, 2)

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
  await e2e.client.logout()
  await e2e.client.login({ login: 'hr-manager', password: 'correct horse' })
  const permitted = await e2e.client.get('/admin/hr?lang=en')
  assert.equal(permitted.status, 200)
  assert.match(await permitted.text(), /data-ui="list-page"/)
})
