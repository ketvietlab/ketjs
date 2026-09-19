import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

import { renderCaseModal, type CaseModalPayload } from './crm-case-modal-helper.ts'

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
    phone: '0909000123',
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
  assert.match(listHtml, /record=crm.case%3Aroute-case/)
  assert.match(listHtml, /record=crm.case%3Anew/)
  assert.match(listHtml, /q=Route\+case&amp;preset=open&amp;lang=en/)
  assert.doesNotMatch(listHtml, /id="crm-case-create-form"|data-ui="chatter"/)

  const returnTo = '/admin/crm/cases?q=Route%20case&preset=open&lang=en'
  const create = await app.client.get(
    `/admin/crm/cases/new?stageId=crm-stage-proposition&kind=opportunity&lang=en&returnTo=${encodeURIComponent(returnTo)}`,
  )
  assert.equal(create.status, 200)
  assert.match(create.url, /record=crm.case%3Anew/)
  const payload = await call<CaseModalPayload>('crm.case.modalContext', {
    kind: 'opportunity',
    stageId: 'crm-stage-proposition',
    locale: 'en',
  })
  const createHtml = renderCaseModal(payload)
  assert.match(createHtml, /data-ui="record-form"/)
  assert.match(createHtml, /name="kind"[\s\S]*?value="opportunity"[^>]*selected/)
  assert.match(createHtml, /name="stageId"[\s\S]*?value="crm-stage-proposition"[^>]*selected/)
  assert.match(createHtml, /data-island="backend.relation-select"/)

  const pipeline = await app.client.get('/admin/crm/pipeline?teamId=crm-team-sales&lang=en')
  const pipelineHtml = await pipeline.text()
  assert.equal(pipeline.status, 200)
  assert.match(pipelineHtml, /stageId=crm-stage-proposition&amp;kind=opportunity&amp;record=crm.case%3Anew/)
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
  assert.match(invalidHtml, /name="name"[^>]*aria-invalid="true"/)
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

test('crm cases routes: Partner intent prefills contact context and returns field refusals in place', async (t) => {
  const { app, call } = await boot(t)
  const create = await app.client.get('/admin/crm/cases/new?kind=lead&partnerId=customer&lang=en')
  assert.equal(create.status, 200)
  assert.match(create.url, /partnerId=customer/)
  const payload = await call<CaseModalPayload>('crm.case.modalContext', {
    kind: 'lead',
    partnerId: 'customer',
    locale: 'en',
  })
  const createHtml = renderCaseModal(payload)
  assert.equal(payload.data.partnerIntent, true)
  assert.match(createHtml, /name="email"[^>]*value="minh@example\.test"/)
  assert.match(createHtml, /name="phone"[^>]*value="0909000123"/)
  assert.match(createHtml, /name="contactName"[^>]*value="Nguyễn Minh"/)
  assert.match(createHtml, /name="description"[^>]*required/)

  const refused = await app.client.post(
    '/admin/crm/cases/new?lang=en',
    new URLSearchParams({
      partnerIntent: '1',
      partnerId: 'customer',
      kind: 'lead',
      name: '',
      description: '',
      expectedRevenue: 'still here',
      returnTo: '/admin/partner/partners/customer?lang=en',
    }),
    post,
  )
  const refusedHtml = await refused.text()
  assert.equal(refused.status, 200)
  assert.match(refusedHtml, /name="name"[^>]*aria-invalid="true"/)
  assert.match(refusedHtml, /name="description"[^>]*aria-invalid="true"/)
  assert.match(refusedHtml, /name="expectedRevenue"[^>]*value="still here"[^>]*aria-invalid="true"/)
  assert.match(refusedHtml, /href="\/admin\/partner\/partners\/customer\?lang=en"/)
})

test('crm record modal: large surfaces, commands preserve stage and version, stale saves are refused', async (t) => {
  const { call } = await boot(t)
  const { caseModalDefinition } = await import(
    '../packages/ketsuite/src/modules/crm_backend/modal/case-modal-view.tsx'
  )
  const { caseContext } = await import('./crm-case-modal-helper.ts')
  assert.equal(caseModalDefinition.size, 'large')
  assert.ok(caseModalDefinition.fixedHeight)
  await call('crm.case.save', {
    id: 'native',
    kind: 'opportunity',
    name: 'Native modal',
    stageId: 'crm-stage-proposition',
    partnerId: 'customer',
    idempotencyKey: 'native-create-001',
  })
  const payload = await call<CaseModalPayload>('crm.case.modalContext', { id: 'native', locale: 'en' })
  const context = caseContext(payload)
  assert.deepEqual(
    caseModalDefinition.tabs!.filter((tab) => !tab.visible || tab.visible(context)).map((tab) => tab.id),
    ['overview', 'sales', 'activities', 'timeline'],
  )
  const form = new FormData()
  form.set('name', 'Edited through modal')
  form.set('partnerId', 'customer')
  form.set('priority', '2')
  form.set('expectedRevenue', '500000')
  form.set('probability', '30')
  const input = caseModalDefinition.commands!.save!.input(form, context, {})
  assert.equal(input.stageId, 'crm-stage-proposition')
  assert.equal(input.expectedVersion, payload.data.record.version)
  const saved = await call<Row>('crm.case.save', input)
  assert.equal(saved.ok, true, JSON.stringify(saved))
  const held = await call<Row>('crm.case.get', { id: 'native' })
  assert.equal(held.stageId, 'crm-stage-proposition')
  assert.equal(held.name, 'Edited through modal')
  const stale = await call<Row>('crm.case.save', {
    ...input,
    name: 'Stale edit',
    idempotencyKey: 'native-stale-001',
  })
  assert.equal(stale.ok, false)
  assert.equal((await call<Row>('crm.case.get', { id: 'native' })).name, 'Edited through modal')
  const draft = {
    ...context,
    draft: (name: string, fallback = '') => (name === 'name' ? 'Unsaved draft' : fallback),
    fieldError: (name: string) => (name === 'name' ? 'Title required' : null),
  }
  const { renderToString } = await import('@ketvietlab/ketjs-view')
  const html = renderToString(
    caseModalDefinition.tabs![0]!.view(draft) as import('@ketvietlab/ketjs-view').TemplateResult,
  )
  assert.match(html, /value="Unsaved draft"/)
  assert.match(html, /aria-invalid="true"/)
  assert.match(html, /Title required/)
  assert.equal(await call('crm.case.modalContext', { id: 'missing' }), null)
})

test('crm record modal: existing links redirect with tab and locale, unknown records stay 404', async (t) => {
  const { app, call } = await boot(t)
  await call('crm.case.save', {
    id: 'deep-link',
    kind: 'lead',
    name: 'Deep link',
    idempotencyKey: 'deep-link-create',
  })
  const response = await app.client.get('/admin/crm/cases/deep-link?tab=timeline&lang=en', {
    redirect: 'manual',
  })
  assert.equal(response.status, 303)
  const destination = new URL(response.headers.get('location')!, app.baseUrl)
  assert.equal(destination.pathname, '/admin/crm/cases')
  assert.equal(destination.searchParams.get('record'), 'crm.case:deep-link')
  assert.equal(destination.searchParams.get('tab'), 'timeline')
  assert.equal(destination.searchParams.get('lang'), 'en')
  assert.equal((await app.client.get('/admin/crm/cases/missing', { redirect: 'manual' })).status, 404)
})

test('crm record modal: read-only actor receives no mutation actions or unrelated people', async (t) => {
  const { app, call } = await boot(t)
  await call('crm.case.save', {
    id: 'reader-case',
    kind: 'lead',
    name: 'Readable case',
    idempotencyKey: 'reader-create-001',
  })
  const fixture = (name: string, input: Record<string, unknown>) =>
    app.fixture.call(name, input, { scope: { company: 'acme', branches: null } })
  await fixture('user.createUser', {
    id: 'reader',
    login: 'reader',
    password: 'reader-test',
    name: 'CRM Reader',
    defaultCompanyId: 'acme',
  })
  await fixture('user.grantCompany', { id: 'reader:acme', userId: 'reader', companyId: 'acme' })
  await fixture('user.saveRole', { id: 'crm-reader', name: 'CRM reader' })
  for (const fnKey of ['crm.case.modalContext', 'crm.case.get'])
    await fixture('user.grantFunction', { id: `reader:${fnKey}`, roleId: 'crm-reader', fnKey })
  await fixture('user.assignRole', { id: 'reader:role', userId: 'reader', roleId: 'crm-reader' })
  await call('crm.team.member.save', {
    id: 'reader:member',
    userId: 'reader',
    teamId: 'crm-team-sales',
    idempotencyKey: 'reader-team-member',
  })
  await app.client.logout()
  await app.client.login({ login: 'reader', password: 'reader-test' })
  const payload = await call<CaseModalPayload>('crm.case.modalContext', { id: 'reader-case' })
  assert.ok(payload, 'a team member may read the case')
  assert.equal(Object.values(payload.data.permissions).some(Boolean), false)
  assert.deepEqual(
    payload.data.users.map((user) => user.id),
    ['reader'],
  )
  assert.doesNotMatch(renderCaseModal(payload), /data-record-dialog=|data-ui="record-form"/)
  assert.equal(await call('crm.case.modalContext', {}), null)
})
