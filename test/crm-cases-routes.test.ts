import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

const formHeaders = { 'content-type': 'application/x-www-form-urlencoded' }
const post = { headers: formHeaders, redirect: 'manual' as const }

const boot = async (t: TestContext) => {
  const app = await createTestDeployment(ketsuite, { worker: false })
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
  await call('crm.bootstrap.defaults', { idempotencyKey: 'crm-cases-defaults' })
  return { app, call }
}

test('crm cases routes: list and dedicated create preserve filters, presets and locale', async (t) => {
  const { app, call } = await boot(t)
  await call('crm.case.save', {
    id: 'route-case',
    kind: 'opportunity',
    name: 'Route case opportunity',
    partnerId: 'customer',
    stageId: 'crm-stage-proposition',
    idempotencyKey: 'route-case-save-01',
  })

  const list = await app.client.get('/admin/crm/cases?q=Route%20case&preset=open&lang=en')
  const listHtml = await list.text()
  assert.equal(list.status, 200)
  assert.match(listHtml, /data-ui="list-page"/)
  assert.match(listHtml, /data-ui="chrome-search-input"[^>]*value="Route case"/)
  assert.match(listHtml, /href="\/admin\/crm\/cases\/route-case\?lang=en"/)
  assert.match(listHtml, /href="\/admin\/crm\/cases\/new\?[^"<]*lang=en/)
  assert.match(listHtml, /returnTo=%2Fadmin%2Fcrm%2Fcases%3Fq%3DRoute%2520case/)
  assert.doesNotMatch(listHtml, /id="crm-case-create-form"|data-ui="chatter"/)

  const returnTo = '/admin/crm/cases?q=Route%20case&preset=open&lang=en'
  const create = await app.client.get(
    `/admin/crm/cases/new?stageId=crm-stage-proposition&kind=opportunity&lang=en&returnTo=${encodeURIComponent(returnTo)}`,
  )
  const createHtml = await create.text()
  assert.equal(create.status, 200)
  assert.match(createHtml, /data-ui="form-page"/)
  assert.match(createHtml, /action="\/admin\/crm\/cases\/new\?lang=en"/)
  assert.match(createHtml, /href="\/admin\/crm\/cases\?q=Route%20case&amp;preset=open&amp;lang=en"/)
  assert.match(createHtml, /name="kind"[\s\S]*?value="opportunity"[^>]*selected/)
  assert.match(
    createHtml,
    /<select[^>]*name="stageId"[\s\S]*?<option[^>]*value="crm-stage-proposition"[^>]*selected/,
  )
  assert.match(createHtml, /data-ui="relation-select"/)
  assert.doesNotMatch(createHtml, /data-ui="chatter"|data-ui="form-page-aside"/)

  const pipeline = await app.client.get('/admin/crm/pipeline?teamId=crm-team-sales&lang=en')
  const pipelineHtml = await pipeline.text()
  assert.equal(pipeline.status, 200)
  assert.match(
    pipelineHtml,
    /href="\/admin\/crm\/cases\/new\?stageId=crm-stage-proposition&amp;kind=opportunity/,
  )
})

test('crm cases routes: new POST and backward-compatible list POST retain safety and redirects', async (t) => {
  const { app, call } = await boot(t)
  const created = await app.client.post(
    '/admin/crm/cases/new?lang=en',
    new URLSearchParams({
      name: 'Created on dedicated route',
      kind: 'lead',
      partnerId: 'customer',
      priority: '2',
    }),
    post,
  )
  assert.equal(created.status, 303)
  const createdId = created.headers.get('location')!.split('?')[0]!.split('/').pop()!
  assert.equal((await call<Row>('crm.case.get', { id: createdId })).name, 'Created on dedicated route')

  const legacy = await app.client.post(
    '/admin/crm/cases?lang=en',
    new URLSearchParams({
      name: 'Created on legacy route',
      kind: 'opportunity',
      partnerId: 'customer',
      priority: '1',
    }),
    post,
  )
  assert.equal(legacy.status, 303)
  const legacyId = legacy.headers.get('location')!.split('?')[0]!.split('/').pop()!
  assert.equal((await call<Row>('crm.case.get', { id: legacyId })).name, 'Created on legacy route')

  const invalidReturn = '/admin/crm/pipeline?teamId=crm-team-sales&mine=1&lang=en'
  const invalid = await app.client.post(
    '/admin/crm/cases/new?lang=en',
    new URLSearchParams({
      name: '',
      kind: 'opportunity',
      stageId: 'crm-stage-proposition',
      expectedRevenue: '99000000',
      probability: '45',
      returnTo: invalidReturn,
    }),
    post,
  )
  const invalidHtml = await invalid.text()
  assert.equal(invalid.status, 200)
  assert.match(invalidHtml, /data-ui="form-page"/)
  assert.match(invalidHtml, /data-ui="form-errors"[^>]*role="alert"/)
  assert.match(invalidHtml, /name="kind"[\s\S]*?value="opportunity"[^>]*selected/)
  assert.match(invalidHtml, /name="expectedRevenue"[^>]*value="99000000"/)
  assert.match(invalidHtml, /name="probability"[^>]*value="45"/)
  assert.match(invalidHtml, /href="\/admin\/crm\/pipeline\?teamId=crm-team-sales&amp;mine=1&amp;lang=en"/)

  const refused = await app.client.post(
    '/admin/crm/cases/new?lang=en',
    new URLSearchParams({ name: 'Cross-site record', kind: 'lead' }),
    {
      headers: { ...formHeaders, origin: 'https://evil.test' },
      redirect: 'manual',
    },
  )
  assert.equal(refused.status, 403)
  const rows = await call<{ rows: Row[] }>('crm.case.list', { search: 'Cross-site record' })
  assert.equal(rows.rows.length, 0)
})
