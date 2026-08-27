import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

async function bootRoster(t: TestContext) {
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
  await fixture('hr.shiftTemplate.save', {
    id: 'day',
    code: 'DAY',
    name: 'Ca ngày',
    branchId: 'root:default',
    startTime: '08:00',
    endTime: '17:00',
    breakMinutes: 60,
    timezone: 'Asia/Ho_Chi_Minh',
  })
  await fixture('hr.rotation.save', {
    id: 'weekly',
    name: 'Ca tuần',
    cycleWeeks: 1,
    slots: [{ weekIndex: 0, weekday: 1, shiftTemplateId: 'day' }],
  })
  await fixture('hr.rotation.assign', {
    id: 'employee-rotation',
    employeeId: 'employee-1',
    rotationId: 'weekly',
    branchId: 'root:default',
    anchorDate: '2026-08-17',
    effectiveFrom: '2026-08-17',
  })
  await e2e.client.login({ login: 'admin', password: 'correct horse' })
  return { e2e, fixture }
}

const form = (values: Record<string, string>) => new URLSearchParams(values)
const weekPath = '/admin/hr/roster?branch=root%3Adefault&week=2026-08-17&lang=en'

test('HR roster HTTP: weekly workflow preserves locale, CSRF, rejected values and retry idempotency', async (t) => {
  const { e2e, fixture } = await bootRoster(t)

  const empty = await (await e2e.client.get(weekPath)).text()
  assert.doesNotMatch(empty, /data-ui="list-page"|data-ui="form-page"|data-ui="modal-layer"/)
  assert.match(empty, /action="\/admin\/hr\/roster\?lang=en"/)
  assert.match(empty, /name="branchId"[^>]*value="root:default"/)
  assert.match(empty, /name="weekStart"[^>]*value="2026-08-17"/)

  const refusedGenerate = await e2e.client.post(
    '/admin/hr/roster?lang=en',
    form({ branchId: 'root:default', weekStart: '2026-08-17' }),
    {
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin: 'https://cross-site.example',
      },
      redirect: 'manual',
    },
  )
  assert.equal(refusedGenerate.status, 403)
  assert.equal(
    (
      (await fixture(
        'hr.roster.manageList',
        { branchId: 'root:default', weekStart: '2026-08-17' },
        'admin',
      )) as unknown as Row[]
    ).length,
    0,
  )

  const invalid = await e2e.client.post(
    '/admin/hr/roster?lang=vi',
    form({ branchId: 'missing-branch', weekStart: '2026-08-17' }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(invalid.status, 200)
  const invalidHtml = await invalid.text()
  assert.match(invalidHtml, /data-ui="form-errors" role="alert"/)
  assert.match(invalidHtml, /name="branchId"[^>]*value="missing-branch"/)
  assert.match(invalidHtml, /name="weekStart"[^>]*value="2026-08-17"/)
  assert.match(invalidHtml, /action="\/admin\/hr\/roster\?lang=vi"/)

  const generated = await e2e.client.post(
    '/admin/hr/roster?lang=en',
    form({ branchId: 'root:default', weekStart: '2026-08-17' }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(generated.status, 303)
  assert.equal(generated.headers.get('location'), weekPath)

  const generatedRetry = await e2e.client.post(
    '/admin/hr/roster?lang=en',
    form({ branchId: 'root:default', weekStart: '2026-08-17' }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(generatedRetry.status, 303)
  assert.equal(generatedRetry.headers.get('location'), weekPath)

  let rows = (await fixture(
    'hr.roster.manageList',
    { branchId: 'root:default', weekStart: '2026-08-17' },
    'admin',
  )) as unknown as Row[]
  assert.equal(rows.length, 1)
  assert.equal((rows[0]!.shifts as Row[]).length, 1, 'generate retry must not duplicate shifts')
  assert.equal(rows[0]?.state, 'draft')
  assert.equal(rows[0]?.version, 1)

  const draft = await (await e2e.client.get(weekPath)).text()
  assert.match(draft, /Nguyễn Minh Anh/)
  assert.match(draft, /2026-08-17T01:00:00\.000Z/)
  assert.match(draft, /2026-08-17T10:00:00\.000Z/)
  assert.match(draft, /name="action" value="publish"/)
  assert.match(
    draft,
    /action="\/admin\/hr\/roster\?id=root%3Adefault%3A2026-08-17&amp;version=1&amp;branch=root%3Adefault&amp;week=2026-08-17&amp;lang=en"/,
  )

  const refusedPublish = await e2e.client.post(
    '/admin/hr/roster?id=root%3Adefault%3A2026-08-17&version=1&branch=root%3Adefault&week=2026-08-17&lang=en',
    form({ action: 'publish' }),
    {
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin: 'https://cross-site.example',
      },
      redirect: 'manual',
    },
  )
  assert.equal(refusedPublish.status, 403)

  const publishPath =
    '/admin/hr/roster?id=root%3Adefault%3A2026-08-17&version=1&branch=root%3Adefault&week=2026-08-17&lang=en'
  const published = await e2e.client.post(publishPath, form({ action: 'publish' }), {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    redirect: 'manual',
  })
  assert.equal(published.status, 303)
  assert.equal(published.headers.get('location'), weekPath)

  const publishRetry = await e2e.client.post(publishPath, form({ action: 'publish' }), {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    redirect: 'manual',
  })
  assert.equal(publishRetry.status, 303)
  rows = (await fixture(
    'hr.roster.manageList',
    { branchId: 'root:default', weekStart: '2026-08-17' },
    'admin',
  )) as unknown as Row[]
  assert.equal(rows[0]?.state, 'published')
  assert.equal(rows[0]?.version, 2, 'publish retry must not increment the version again')

  const publishedHtml = await (await e2e.client.get(weekPath)).text()
  assert.match(publishedHtml, /data-value="published"/)
  assert.match(publishedHtml, /name="action" value="reopen"/)
  assert.doesNotMatch(publishedHtml, /name="action" value="publish"/)

  const reopenPath =
    '/admin/hr/roster?id=root%3Adefault%3A2026-08-17&version=2&branch=root%3Adefault&week=2026-08-17&lang=en'
  const reopened = await e2e.client.post(reopenPath, form({ action: 'reopen' }), {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    redirect: 'manual',
  })
  assert.equal(reopened.status, 303)
  assert.equal(reopened.headers.get('location'), weekPath)
  const reopenRetry = await e2e.client.post(reopenPath, form({ action: 'reopen' }), {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    redirect: 'manual',
  })
  assert.equal(reopenRetry.status, 303)
  rows = (await fixture(
    'hr.roster.manageList',
    { branchId: 'root:default', weekStart: '2026-08-17' },
    'admin',
  )) as unknown as Row[]
  assert.equal(rows[0]?.state, 'draft')
  assert.equal(rows[0]?.version, 3, 'reopen retry must not increment the version again')

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
  assert.equal((await e2e.client.get(weekPath)).status, 200)
})
