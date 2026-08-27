import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

const formHeaders = { 'content-type': 'application/x-www-form-urlencoded' }
const post = { headers: formHeaders, redirect: 'manual' as const }

const boot = async (t: TestContext) => {
  const app = await createTestDeployment(ketsuite)
  t.after(() => app.close())
  const scope = { company: 'acme', branches: null }
  const fixture = (name: string, input: Record<string, unknown>) =>
    app.fixture.call<Row>(name, input, { scope })

  await fixture('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'ACME' })
  await fixture('partner.savePartner', { id: 'admin-party', kind: 'person', name: 'Administrator' })
  await fixture('company.saveCompany', { id: 'acme', partnerId: 'acme-party', currency: 'VND' })
  await fixture('user.createUser', {
    id: 'admin',
    login: 'admin',
    password: 'correct horse',
    name: 'Administrator',
    partnerId: 'admin-party',
    defaultCompanyId: 'acme',
    superuser: true,
  })
  await fixture('user.grantCompany', {
    id: 'admin:acme',
    userId: 'admin',
    companyId: 'acme',
  })
  await app.client.login({ login: 'admin', password: 'correct horse' })

  const call = async <T = Row>(name: string, input: Record<string, unknown>) =>
    (await app.client.call<T>(name, input)).value
  await call('flow.project.save', {
    values: { id: 'platform', key: 'PLAT', name: 'Internal platform' },
    idempotencyKey: 'project-platform',
  })
  await call('flow.column.save', {
    values: { id: 'todo', projectId: 'platform', code: 'todo', name: 'To do', sequence: 10 },
    idempotencyKey: 'column-todo',
  })
  await call('flow.column.save', {
    values: { id: 'doing', projectId: 'platform', code: 'doing', name: 'Doing', sequence: 20 },
    idempotencyKey: 'column-doing',
  })
  await call('flow.issue.save', {
    id: 'issue-login',
    projectId: 'platform',
    columnId: 'todo',
    title: 'Finish login',
    priority: 'high',
    idempotencyKey: 'issue-login',
  })
  return { app, call }
}

test('flow project issues: URL-owned create modal preserves list state, validation, compatibility and CSRF', async (t) => {
  const { app, call } = await boot(t)
  const collection = '/admin/flow/projects/platform/issues?q=Finish&lang=en'

  const list = await app.client.get(collection)
  const listHtml = await list.text()
  assert.equal(list.status, 200)
  assert.match(listHtml, /data-ui="list-page"/)
  assert.doesNotMatch(listHtml, /data-ui="form-page"|data-ui="modal-layer"|flow-issue-create-form/)
  assert.match(listHtml, /Internal platform/)
  assert.match(listHtml, /href="\/admin\/flow\/issues\/issue-login\?lang=en"/)
  assert.match(
    listHtml,
    /href="\/admin\/flow\/projects\/platform\/issues\?q=Finish&amp;lang=en&amp;create=1"/,
  )

  const create = await app.client.get(`${collection}&create=1`)
  const createHtml = await create.text()
  assert.equal(create.status, 200)
  assert.match(createHtml, /data-ui="list-page"/)
  assert.match(createHtml, /data-ui="modal-layer" data-route-modal="true"/)
  assert.match(createHtml, /id="flow-issue-create-form"/)
  assert.match(
    createHtml,
    /action="\/admin\/flow\/projects\/platform\/issues\?q=Finish&amp;lang=en&amp;create=1"/,
  )
  assert.match(createHtml, /href="\/admin\/flow\/projects\/platform\/issues\?q=Finish&amp;lang=en"/)
  assert.match(
    createHtml,
    /name="returnTo" value="\/admin\/flow\/projects\/platform\/issues\?q=Finish&amp;lang=en"/,
  )
  assert.match(createHtml, /name="idempotencyKey" value="[^"]+"/)
  assert.equal(createHtml.match(/data-ui="form-field"/g)?.length, 3)

  const invalid = await app.client.post(
    `${collection}&create=1`,
    new URLSearchParams({
      title: 'Rejected draft',
      columnId: 'missing',
      priority: 'high',
      returnTo: collection,
      idempotencyKey: 'issue-invalid',
    }),
    post,
  )
  assert.equal(invalid.status, 303)
  const invalidLocation = invalid.headers.get('location') ?? ''
  assert.match(invalidLocation, /^\/admin\/flow\/projects\/platform\/issues\?q=Finish&lang=en&create=1/)
  assert.match(invalidLocation, /title=Rejected\+draft/)
  assert.match(invalidLocation, /columnId=missing/)
  assert.match(invalidLocation, /priority=high/)
  const invalidHtml = await (await app.client.get(invalidLocation)).text()
  assert.match(invalidHtml, /data-ui="modal-layer" data-route-modal="true"/)
  assert.match(invalidHtml, /name="title"[^>]*value="Rejected draft"/)
  assert.match(invalidHtml, /<option value="missing" selected="true">/)
  assert.match(invalidHtml, /<option value="high" selected="true">/)
  assert.match(invalidHtml, /That status does not belong to this project/)

  const unsafe = await app.client.post(
    `${collection}&create=1`,
    new URLSearchParams({
      title: 'Unsafe return draft',
      columnId: 'missing',
      priority: 'normal',
      returnTo: 'https://evil.example/steal',
      idempotencyKey: 'issue-unsafe-return',
    }),
    post,
  )
  assert.equal(unsafe.status, 303)
  assert.match(
    unsafe.headers.get('location') ?? '',
    /^\/admin\/flow\/projects\/platform\/issues\?q=Finish&lang=en&create=1/,
  )
  assert.doesNotMatch(unsafe.headers.get('location') ?? '', /evil\.example/)

  const saved = await app.client.post(
    `${collection}&create=1`,
    new URLSearchParams({
      title: 'Finish routing',
      columnId: 'doing',
      priority: 'high',
      returnTo: collection,
      idempotencyKey: 'issue-create-success',
    }),
    post,
  )
  assert.equal(saved.status, 303)
  assert.equal(saved.headers.get('location'), collection)
  const listed = await call<{ rows: Row[] }>('flow.issue.list', { projectId: 'platform', limit: 50 })
  assert.ok(listed.rows.some((row) => row.title === 'Finish routing'))

  const legacy = await app.client.post(
    '/admin/flow/projects/platform/issues?lang=en',
    new URLSearchParams({ title: 'Legacy issue', columnId: 'todo', priority: 'normal' }),
    post,
  )
  assert.equal(legacy.status, 303)
  assert.equal(legacy.headers.get('location'), '/admin/flow/projects/platform/issues?lang=en')
  const legacyListed = await call<{ rows: Row[] }>('flow.issue.list', { projectId: 'platform', limit: 50 })
  assert.ok(legacyListed.rows.some((row) => row.title === 'Legacy issue'))

  const forged = await app.client.post(
    `${collection}&create=1`,
    new URLSearchParams({ title: 'Forged', columnId: 'todo', priority: 'normal' }),
    {
      headers: { ...formHeaders, origin: 'https://evil.example' },
      redirect: 'manual',
    },
  )
  assert.equal(forged.status, 403)

  const refused = await app.client.request('/admin/flow/projects/platform/issues?lang=en', {
    method: 'PUT',
  })
  assert.equal(refused.status, 405)
})
