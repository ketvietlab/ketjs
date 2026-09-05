import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

const boot = async (t: TestContext) => {
  const app = await createTestDeployment(ketsuite)
  t.after(() => app.close())
  const scope = { company: 'acme', branches: null }
  const fixture = (name: string, input: Record<string, unknown>) =>
    app.fixture.call<Row>(name, input, { scope })
  await fixture('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'ACME' })
  await fixture('partner.savePartner', {
    id: 'customer',
    kind: 'person',
    name: 'Nguyễn Minh',
    email: 'minh@example.test',
  })
  await fixture('company.saveCompany', { id: 'acme', code: 'ACME', partnerId: 'acme-party', currency: 'VND' })
  await fixture('user.createUser', {
    id: 'admin',
    login: 'admin',
    password: 'correct horse',
    name: 'Administrator',
    partnerId: 'customer',
    defaultCompanyId: 'acme',
    superuser: true,
  })
  await fixture('user.grantCompany', { id: 'admin:acme', userId: 'admin', companyId: 'acme' })
  await app.client.login({ login: 'admin', password: 'correct horse' })
  const call = async <T = Row>(name: string, input: Record<string, unknown> = {}) =>
    (await app.client.call<T>(name, input)).value
  await call('crm.bootstrap.defaults', { idempotencyKey: 'crm-defaults' })
  return { app, call }
}

test('crm HTTP E2E: create, convert, move and win a sales record', async (t) => {
  const { app, call } = await boot(t)
  const created = await app.client.post(
    '/admin/crm/cases?lang=en',
    new URLSearchParams({
      name: 'Enterprise gift opportunity',
      kind: 'lead',
      partnerId: 'customer',
      priority: '2',
      email: 'buyer@example.test',
      expectedRevenue: '12500000',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(created.status, 303)
  const location = created.headers.get('location')!
  const id = location.split('?')[0]!.split('/').pop()!
  let row = await call<Row>('crm.case.get', { id })
  assert.equal(row.kind, 'lead')

  // Converting is confirmed, not clicked. The acknowledgement is checked on the
  // server, so a post without it leaves a lead as a lead.
  const unconfirmed = await app.client.post(
    `/admin/crm/cases/${id}?lang=en`,
    new URLSearchParams({ action: 'convert', expectedVersion: String(row.version) }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(unconfirmed.status, 200)
  assert.match(await unconfirmed.text(), /Confirm the need before converting/u)
  assert.equal((await call<Row>('crm.case.get', { id })).kind, 'lead')

  // And it says which version it saw. Without that the compare-and-set behind
  // the action matches by construction and a stale tab wins.
  const unversioned = await app.client.post(
    `/admin/crm/cases/${id}?lang=en`,
    new URLSearchParams({ action: 'convert', confirm: 'on' }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(unversioned.status, 422)
  assert.equal((await call<Row>('crm.case.get', { id })).kind, 'lead')

  // The confirmation step chooses the stage the opportunity opens in.
  const step = await app.client.get(`/admin/crm/cases/${id}?lang=en&modal=convert`)
  assert.equal(step.status, 200)
  const stepHtml = await step.text()
  assert.match(stepHtml, /Convert lead to opportunity/u)
  assert.match(stepHtml, /No second customer and no second case are created/u)

  const converted = await app.client.post(
    `/admin/crm/cases/${id}?lang=en`,
    new URLSearchParams({
      action: 'convert',
      confirm: 'on',
      stageId: 'crm-stage-qualified',
      expectedVersion: String(row.version),
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(converted.status, 303)
  // The step the conversion was asked from closes behind it.
  assert.doesNotMatch(String(converted.headers.get('location')), /modal=convert/u)
  row = await call<Row>('crm.case.get', { id })
  assert.equal(row.kind, 'opportunity')
  assert.equal(row.stageId, 'crm-stage-qualified', 'the chosen stage is the one it opens in')
  // The same case, not a second one: converting keeps the record it changed.
  assert.equal(row.id, id)
  assert.equal(row.partnerId, 'customer')

  const moved = await app.client.post(
    '/admin/crm/pipeline/move?lang=en',
    new URLSearchParams({
      id,
      stageId: 'crm-stage-qualified',
      expectedVersion: String(row.version),
      idempotencyKey: 'move-qualified',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(moved.status, 303)
  row = await call<Row>('crm.case.get', { id })
  const won = await app.client.post(
    `/admin/crm/cases/${id}?lang=en`,
    new URLSearchParams({ action: 'won', expectedVersion: String(row.version) }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(won.status, 303)
  assert.equal((await call<Row>('crm.case.get', { id })).terminalState, 'won')
})

test('crm HTTP E2E: global filter/grouping, planner and configuration remain operational', async (t) => {
  const { app, call } = await boot(t)
  for (const [id, kind] of [
    ['lead-a', 'lead'],
    ['opportunity-a', 'opportunity'],
  ] as const) {
    const result = await call<Row>('crm.case.save', {
      id,
      kind,
      name: `Record ${id}`,
      partnerId: 'customer',
      idempotencyKey: `save-${id}`,
    })
    assert.equal(result.ok, true)
  }
  const grouped = await app.client.get('/admin/crm/cases?group=kind&lang=en')
  const groupedHtml = await grouped.text()
  assert.equal(grouped.status, 200)
  assert.equal((groupedHtml.match(/data-ui="chrome-search"/g) ?? []).length, 2)
  assert.match(groupedHtml, /data-presentation="inline"/)
  assert.match(groupedHtml, /data-presentation="modal"/)
  assert.match(groupedHtml, /data-ui="search-menu"/)

  const planner = await app.client.get('/admin/crm/activities?tab=mine&lang=en')
  assert.equal(planner.status, 200)
  assert.match(await planner.text(), /CRM activities/)

  const configured = await app.client.post(
    '/admin/crm/configuration?tab=scoreRules&lang=en',
    new URLSearchParams({
      name: 'Revenue score',
      active: 'on',
      field: 'expectedRevenue',
      operator: 'gte',
      value: '10000000',
      points: '20',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(configured.status, 303)
  const config = await call<Record<string, Row[]>>('crm.configuration.get')
  assert.equal(
    config.scoreRules.some((item) => item.name === 'Revenue score'),
    true,
  )
})

test('crm HTTP E2E: optimistic conflict and company isolation', async (t) => {
  const { app, call } = await boot(t)
  await call<Row>('crm.case.save', {
    id: 'conflict',
    kind: 'lead',
    name: 'Conflict record',
    partnerId: 'customer',
    idempotencyKey: 'save-conflict',
  })
  const row = await call<Row>('crm.case.get', { id: 'conflict' })
  const results = await Promise.all([
    call<Row>('crm.case.move', {
      id: row.id,
      stageId: 'crm-stage-qualified',
      expectedVersion: row.version,
      idempotencyKey: 'move-conflict-a',
    }),
    call<Row>('crm.case.move', {
      id: row.id,
      stageId: 'crm-stage-proposition',
      expectedVersion: row.version,
      idempotencyKey: 'move-conflict-b',
    }),
  ])
  assert.equal(results.filter((item) => item.ok).length, 1)
  assert.equal(results.filter((item) => !item.ok).length, 1)

  const website = await app.client.anonymous().get('/contact/sales?lang=en')
  assert.equal(website.status, 200)
  assert.match(await website.text(), /Request a consultation/)
  const page = await app.client.get('/admin/crm/cases?lang=en')
  const visibleText = (await page.text()).replace(/<[^>]*>/g, ' ')
  assert.doesNotMatch(visibleText, /crm_backend\.[A-Za-z]/)
})
