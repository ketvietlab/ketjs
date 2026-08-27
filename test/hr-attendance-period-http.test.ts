import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

async function bootPeriod(t: TestContext) {
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
  await e2e.client.login({ login: 'admin', password: 'correct horse' })
  return { e2e, fixture }
}

const form = (values: Record<string, string>) => new URLSearchParams(values)
const path = '/admin/attendance?month=2026-07&lang=en'
const postOptions = {
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  redirect: 'manual' as const,
}

test('attendance period HTTP uses policy-local month and retains invalid submitted month', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-08-01T00:30:00.000Z') })
  const { e2e, fixture } = await bootPeriod(t)
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

  const response = await e2e.client.get('/admin/attendance?lang=en')
  const html = await response.text()
  assert.equal(response.status, 200)
  assert.match(html, /name="month"[^>]*value="2026-07"/)
  assert.match(html, /2026-07 · America\/Los_Angeles/)
  assert.match(html, /action="\/admin\/attendance\?lang=en"/)
  assert.match(html, /type="hidden" name="lang" value="en"/)
  assert.match(html, /action="\/admin\/attendance\?month=2026-07&amp;lang=en"/)

  const invalid = await e2e.client.post(
    '/admin/attendance?lang=en',
    form({ action: 'close', month: '2026-13', expectedVersion: '1' }),
    postOptions,
  )
  const invalidHtml = await invalid.text()
  assert.equal(invalid.status, 200)
  assert.match(invalidHtml, /data-ui="form-errors" role="alert"/)
  assert.match(invalidHtml, /month: The month must use YYYY-MM\./)
  assert.match(invalidHtml, /name="month"[^>]*value="2026-13"/)
})

test('attendance period HTTP preserves CSRF, action allowlist, CAS and retry idempotency', async (t) => {
  const { e2e, fixture } = await bootPeriod(t)
  await fixture(
    'attendance.policy.save',
    {
      timezone: 'Asia/Ho_Chi_Minh',
      lateGraceMinutes: 5,
      earlyGraceMinutes: 5,
      roundingMinutes: 1,
      overtimeMinimumMinutes: 30,
    },
    'admin',
  )
  await fixture('attendance.period.report', { month: '2026-07' }, 'admin')

  const refused = await e2e.client.post(
    path,
    form({ action: 'close', month: '2026-07', expectedVersion: '1' }),
    {
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin: 'https://cross-site.example',
      },
      redirect: 'manual',
    },
  )
  assert.equal(refused.status, 403)
  let period = (await fixture('attendance.period.report', { month: '2026-07' }, 'admin')) as Row
  assert.equal(period.state, 'open')
  assert.equal(period.version, 1)

  const unknown = await e2e.client.post(
    path,
    form({ action: 'typo', month: '2026-07', expectedVersion: '1' }),
    postOptions,
  )
  assert.equal(unknown.status, 400)

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const closed = await e2e.client.post(
      path,
      form({ action: 'close', month: '2026-07', expectedVersion: '1' }),
      postOptions,
    )
    const closedBody = await closed.text()
    assert.equal(closed.status, 303, closedBody)
    assert.equal(closed.headers.get('location'), path)
  }
  period = (await fixture('attendance.period.report', { month: '2026-07' }, 'admin')) as Row
  assert.equal(period.state, 'locked')
  assert.equal(period.version, 2, 'close retry must not increment the version twice')

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const reopened = await e2e.client.post(
      path,
      form({ action: 'reopen', month: '2026-07', expectedVersion: '2' }),
      postOptions,
    )
    assert.equal(reopened.status, 303)
    assert.equal(reopened.headers.get('location'), path)
  }
  period = (await fixture('attendance.period.report', { month: '2026-07' }, 'admin')) as Row
  assert.equal(period.state, 'open')
  assert.equal(period.version, 3, 'reopen retry must not increment the version twice')

  const stale = await e2e.client.post(
    path,
    form({ action: 'close', month: '2026-07', expectedVersion: '1' }),
    postOptions,
  )
  const staleHtml = await stale.text()
  assert.equal(stale.status, 200)
  assert.match(staleHtml, /version: The value is invalid\./)
  assert.match(staleHtml, /name="expectedVersion" value="3"/)
  period = (await fixture('attendance.period.report', { month: '2026-07' }, 'admin')) as Row
  assert.equal(period.state, 'open')
  assert.equal(period.version, 3)
})
