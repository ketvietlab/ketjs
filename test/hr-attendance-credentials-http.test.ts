import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

async function bootCredentials(t: TestContext) {
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
  await e2e.client.login({ login: 'admin', password: 'correct horse' })
  return { e2e, fixture }
}

const form = (values: Record<string, string>) => new URLSearchParams(values)
const postOptions = {
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  redirect: 'manual' as const,
}
const base = '/admin/attendance/credentials?lang=en'
const issuePath = (issue: string) => `/admin/attendance/credentials?issue=${issue}&lang=en`
const kioskRequestKey = '014d0a65-f11e-44f5-a19f-15f4556525bb'
const qrRequestKey = '68dfd489-6ff7-4fb9-af59-8567bdb89ad9'
const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const secretFrom = (html: string): string => {
  const found = html.match(/data-ui="notice-message"><!--k\[-->([A-Za-z0-9_-]{16,})/)
  assert.ok(found?.[1], html)
  return found[1]
}

test('attendance credentials HTTP owns localized modals, validation, CSRF, allowlist and PIN PRG', async (t) => {
  const { e2e } = await bootCredentials(t)
  const hub = await (await e2e.client.get(base)).text()
  assert.doesNotMatch(hub, /data-ui="modal-layer"/)
  for (const issue of ['kiosk', 'pin', 'qr'])
    assert.match(hub, new RegExp(`href="/admin/attendance/credentials\\?issue=${issue}&amp;lang=en"`))

  const pinModal = await (await e2e.client.get(issuePath('pin'))).text()
  assert.match(pinModal, /data-ui="modal-layer"/)
  assert.match(pinModal, /<option value="employee-1"/)
  assert.match(pinModal, /NV001 · Nguyễn Minh Anh/)
  assert.match(pinModal, /href="\/admin\/attendance\/credentials\?lang=en"/)
  assert.equal((await e2e.client.get('/admin/attendance/credentials?issue=unknown&lang=en')).status, 404)
  assert.equal((await e2e.client.request(base, { method: 'PUT' })).status, 405)

  const crossSite = await e2e.client.post(
    issuePath('kiosk'),
    form({ action: 'kiosk', name: 'Không được cấp', requestKey: kioskRequestKey }),
    {
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin: 'https://cross-site.example',
      },
      redirect: 'manual',
    },
  )
  assert.equal(crossSite.status, 403)
  const unknown = await e2e.client.post(
    base,
    form({ action: 'unknown', employeeId: 'employee-1' }),
    postOptions,
  )
  assert.equal(unknown.status, 400)
  assert.equal((await e2e.client.post(base, form({ employeeId: 'employee-1' }), postOptions)).status, 400)
  const namelessKiosk = await e2e.client.post(
    issuePath('kiosk'),
    form({ action: 'kiosk', name: '   ', requestKey: kioskRequestKey }),
    postOptions,
  )
  const namelessKioskHtml = await namelessKiosk.text()
  assert.equal(namelessKiosk.status, 200)
  assert.match(namelessKioskHtml, /name: This field is required\./)
  await e2e.fixture.withTenant('', async ({ adapter }) => {
    assert.equal((await adapter.all('SELECT id FROM attendance_kiosk')).length, 0)
    assert.equal((await adapter.all('SELECT id FROM attendance_credential')).length, 0)
  })

  const invalidPin = await e2e.client.post(
    issuePath('pin'),
    form({ action: 'pin', employeeId: 'employee-1', pin: '12' }),
    postOptions,
  )
  const invalidPinHtml = await invalidPin.text()
  assert.equal(invalidPin.status, 200)
  assert.match(invalidPinHtml, /pin: The value is invalid\./)
  assert.match(invalidPinHtml, /<option value="employee-1" selected="true">/)
  assert.match(invalidPinHtml, /type="password" name="pin"[^>]*value=""/)

  const savedPin = await e2e.client.post(
    issuePath('pin'),
    form({ action: 'pin', employeeId: 'employee-1', pin: '2468' }),
    postOptions,
  )
  assert.equal(savedPin.status, 303)
  assert.equal(savedPin.headers.get('location'), '/admin/attendance/credentials?result=pin-saved&lang=en')
  const savedPinHtml = await (await e2e.client.get(savedPin.headers.get('location')!)).text()
  assert.match(savedPinHtml, /Attendance PIN saved\./)
})

test('attendance credential secrets are digest-only, immediate and replay-safe', async (t) => {
  const { e2e } = await bootCredentials(t)
  const kioskCommand = form({
    action: 'kiosk',
    name: 'Front gate',
    requestKey: kioskRequestKey,
  })
  const kioskResponse = await e2e.client.post(issuePath('kiosk'), kioskCommand, postOptions)
  const kioskHtml = await kioskResponse.text()
  assert.equal(kioskResponse.status, 200, kioskHtml)
  const kioskSecret = secretFrom(kioskHtml)
  assert.doesNotMatch(kioskHtml, new RegExp(`href="[^"]*${kioskSecret}`))

  let kioskDigest = ''
  await e2e.fixture.withTenant('', async ({ adapter }) => {
    const rows = await adapter.all('SELECT id, "secretDigest" FROM attendance_kiosk')
    assert.equal(rows.length, 1)
    assert.equal(rows[0]?.id, kioskRequestKey)
    kioskDigest = String(rows[0]?.secretDigest)
    assert.equal(kioskDigest, digest(kioskSecret))
    assert.notEqual(kioskDigest, kioskSecret)
  })
  const kioskReplay = await e2e.client.post(issuePath('kiosk'), kioskCommand, postOptions)
  const kioskReplayHtml = await kioskReplay.text()
  assert.equal(kioskReplay.status, 200)
  assert.match(kioskReplayHtml, /requestKey: This credential request was already processed\./)
  assert.doesNotMatch(kioskReplayHtml, new RegExp(kioskSecret))
  await e2e.fixture.withTenant('', async ({ adapter }) => {
    const rows = await adapter.all('SELECT "secretDigest" FROM attendance_kiosk')
    assert.equal(rows.length, 1)
    assert.equal(rows[0]?.secretDigest, kioskDigest)
  })

  const qrCommand = form({
    action: 'qr',
    employeeId: 'employee-1',
    requestKey: qrRequestKey,
  })
  const qrResponse = await e2e.client.post(issuePath('qr'), qrCommand, postOptions)
  const qrHtml = await qrResponse.text()
  assert.equal(qrResponse.status, 200)
  const qrSecret = secretFrom(qrHtml)
  assert.match(qrHtml, /data-ui="qr-code"/)
  let qrDigest = ''
  await e2e.fixture.withTenant('', async ({ adapter }) => {
    const rows = await adapter.all(
      'SELECT "qrDigest", "qrRequestKey" FROM attendance_credential WHERE "employeeId" = ?',
      ['employee-1'],
    )
    assert.equal(rows.length, 1)
    qrDigest = String(rows[0]?.qrDigest)
    assert.equal(qrDigest, digest(qrSecret))
    assert.notEqual(qrDigest, qrSecret)
    assert.equal(rows[0]?.qrRequestKey, qrRequestKey)
  })
  const qrReplay = await e2e.client.post(issuePath('qr'), qrCommand, postOptions)
  const qrReplayHtml = await qrReplay.text()
  assert.match(qrReplayHtml, /requestKey: This credential request was already processed\./)
  assert.doesNotMatch(qrReplayHtml, new RegExp(qrSecret))
  await e2e.fixture.withTenant('', async ({ adapter }) => {
    const row = (await adapter.all('SELECT "qrDigest" FROM attendance_credential'))[0]
    assert.equal(row?.qrDigest, qrDigest)
  })

  const fresh = await (await e2e.client.get(base)).text()
  assert.doesNotMatch(fresh, new RegExp(kioskSecret))
  assert.doesNotMatch(fresh, new RegExp(qrSecret))
  const internal = await e2e.client.post(
    '/_ket/fn/attendance.credential.manageQr',
    new URLSearchParams({ employeeId: 'employee-1' }),
    postOptions,
  )
  assert.equal(internal.status, 400)
  assert.match(await internal.text(), /E_FUNCTION_INTERNAL/)
})

test('attendance manager capability opens the hub and owns internal issuance', async (t) => {
  const { e2e, fixture } = await bootCredentials(t)
  await fixture('user.createUser', {
    id: 'attendance-manager',
    login: 'attendance-manager',
    password: 'correct horse',
    name: 'Attendance Manager',
    defaultCompanyId: 'default',
    defaultBranchId: 'root:default',
  })
  await fixture('user.grantCompany', {
    id: 'attendance-manager:default',
    userId: 'attendance-manager',
    companyId: 'default',
  })
  const preset = await fixture('user.applyPreset', { module: 'attendance', level: 'manager' }, 'admin')
  await fixture(
    'user.assignRole',
    { id: 'attendance-manager:role', userId: 'attendance-manager', roleId: preset.roleId },
    'admin',
  )
  await e2e.client.logout()
  await e2e.client.login({ login: 'attendance-manager', password: 'correct horse' })

  const hub = await e2e.client.get(base)
  const hubHtml = await hub.text()
  assert.equal(hub.status, 200)
  assert.match(hubHtml, /href="\/admin\/attendance\/credentials\?issue=kiosk&amp;lang=en"/)
  const pinModal = await (await e2e.client.get(issuePath('pin'))).text()
  assert.match(pinModal, /<option value="employee-1"/)
  const capability = await e2e.client.post(
    '/_ket/fn/attendance.credential.manageOptions',
    new URLSearchParams(),
    postOptions,
  )
  const capabilityBody = await capability.text()
  assert.equal(capability.status, 200, capabilityBody)
  assert.match(capabilityBody, /employee-1/)
  assert.doesNotMatch(capabilityBody, /secret|digest|pinHash|qrDigest/i)

  const issued = await e2e.client.post(
    issuePath('kiosk'),
    form({ action: 'kiosk', name: 'Manager gate', requestKey: kioskRequestKey }),
    postOptions,
  )
  const issuedHtml = await issued.text()
  assert.equal(issued.status, 200, issuedHtml)
  assert.ok(secretFrom(issuedHtml))

  const internal = await e2e.client.post(
    '/_ket/fn/attendance.kiosk.manageIssue',
    form({ id: qrRequestKey, name: 'Bypass', branchId: 'root:default' }),
    postOptions,
  )
  assert.equal(internal.status, 400)
  assert.match(await internal.text(), /E_FUNCTION_INTERNAL/)
})
