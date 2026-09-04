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
  await fixture('company.saveCompany', {
    id: 'acme',
    partnerId: 'acme-party',
    currency: 'VND',
  })
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
  return app
}

test('flow project routes: split list/create while preserving validation, locale, legacy POST and CSRF', async (t) => {
  const app = await boot(t)

  const list = await app.client.get('/admin/flow/projects?tab=mine&lang=en')
  const listHtml = await list.text()
  assert.equal(list.status, 200)
  assert.match(listHtml, /data-ui="list-page"/)
  assert.doesNotMatch(listHtml, /data-ui="form-page"|flow-project-create-form/)
  assert.match(listHtml, /href="\/admin\/flow\/projects\?tab=mine&amp;lang=en&amp;create=1"/)
  assert.match(listHtml, /href="\/admin\/flow\/projects\?tab=mine&amp;lang=en"/)

  const create = await app.client.get(
    '/admin/flow/projects/new?key=OPS&name=Operations&template=custom&returnTo=%2Fadmin%2Fflow%2Fprojects%3Ftab%3Dmine%26lang%3Den&lang=en',
  )
  const createHtml = await create.text()
  assert.equal(create.status, 200)
  assert.match(createHtml, /data-ui="modal-layer" data-route-modal="true"/)
  assert.match(createHtml, /name="key"[^>]*value="OPS"/)
  assert.match(createHtml, /name="name"[^>]*value="Operations"/)
  assert.match(createHtml, /value="custom" selected/)
  assert.match(createHtml, /action="\/admin\/flow\/projects\?tab=mine&amp;lang=en&amp;create=1"/)
  assert.match(createHtml, /href="\/admin\/flow\/projects\?tab=mine&amp;lang=en"/)

  const unsafe = await app.client.get(
    '/admin/flow/projects/new?returnTo=https%3A%2F%2Fevil.example%2Fsteal&lang=en',
  )
  const unsafeHtml = await unsafe.text()
  assert.equal(unsafe.status, 200)
  assert.match(unsafeHtml, /href="\/admin\/flow\/projects\?lang=en"/)
  assert.doesNotMatch(unsafeHtml, /evil\.example/)

  const invalid = await app.client.post(
    '/admin/flow/projects/new?lang=en',
    new URLSearchParams({
      key: 'OPS',
      name: 'Operations',
      description: 'Workflow modernization',
      template: 'custom',
      customColumns: '',
      returnTo: '/admin/flow/projects?tab=mine&lang=en',
    }),
    post,
  )
  assert.equal(invalid.status, 303)
  const invalidHtml = await (await app.client.get(invalid.headers.get('location') ?? '')).text()
  assert.match(invalidHtml, /data-ui="modal-layer" data-route-modal="true"/)
  assert.match(invalidHtml, /The custom template needs at least one status name/)
  assert.match(invalidHtml, /name="key"[^>]*value="OPS"/)
  assert.match(invalidHtml, /name="name"[^>]*value="Operations"/)
  assert.match(invalidHtml, /Workflow modernization/)
  assert.match(invalidHtml, /value="custom" selected/)
  assert.match(invalidHtml, /action="\/admin\/flow\/projects\?tab=mine&amp;lang=en&amp;create=1"/)

  const invalidLegacy = await app.client.post(
    '/admin/flow/projects?tab=mine&lang=en',
    new URLSearchParams({
      key: 'OLD',
      name: 'Legacy invalid',
      template: 'custom',
      customColumns: '',
    }),
    post,
  )
  assert.equal(invalidLegacy.status, 303)
  const invalidLegacyHtml = await (await app.client.get(invalidLegacy.headers.get('location') ?? '')).text()
  assert.match(invalidLegacyHtml, /data-ui="modal-layer" data-route-modal="true"/)
  assert.match(invalidLegacyHtml, /action="\/admin\/flow\/projects\?tab=mine&amp;lang=en&amp;create=1"/)
  assert.match(invalidLegacyHtml, /name="returnTo" value="\/admin\/flow\/projects\?tab=mine&amp;lang=en"/)
  assert.match(invalidLegacyHtml, /name="key"[^>]*value="OLD"/)

  const legacy = await app.client.post(
    '/admin/flow/projects?tab=mine&lang=en',
    new URLSearchParams({
      key: 'LEG',
      name: 'Legacy compatible',
      description: 'Created through the original endpoint',
      template: 'simple',
    }),
    post,
  )
  assert.equal(legacy.status, 303)
  assert.match(legacy.headers.get('location') ?? '', /^\/admin\/flow\/projects\/[^/]+\/board\?lang=en$/)
  const projects = (await app.client.call<Row[]>('flow.project.list', { search: 'LEG', limit: 10 })).value
  assert.equal(projects.length, 1)
  assert.equal(projects[0]?.name, 'Legacy compatible')
  const columns = (await app.client.call<Row[]>('flow.column.list', { projectId: String(projects[0]?.id) }))
    .value
  assert.deepEqual(
    columns.map((column) => column.name),
    ['To do', 'Done'],
  )

  const forged = await app.client.post(
    '/admin/flow/projects/new?lang=en',
    new URLSearchParams({ key: 'BAD', name: 'Forged', template: 'simple' }),
    {
      headers: { ...formHeaders, origin: 'https://evil.example' },
      redirect: 'manual',
    },
  )
  assert.equal(forged.status, 403)
})

test('flow project create: resubmitting the same form lands on one project, not two', async (t) => {
  const app = await boot(t)

  // The rendered form carries the record id and the idempotency key.
  const form = await app.client.get('/admin/flow/projects?create=1&lang=en')
  const html = await form.text()
  const id = /name="id" value="([^"]+)"/.exec(html)?.[1]
  const idempotencyKey = /name="idempotencyKey" value="([^"]+)"/.exec(html)?.[1]
  assert.ok(id, 'create form carries a record id')
  assert.ok(idempotencyKey, 'create form carries an idempotency key')

  const body = () =>
    new URLSearchParams({
      id: id!,
      idempotencyKey: idempotencyKey!,
      key: 'DUP',
      name: 'Submitted twice',
      template: 'simple',
    })

  const first = await app.client.post('/admin/flow/projects/new?lang=en', body(), post)
  assert.equal(first.status, 303)
  const second = await app.client.post('/admin/flow/projects/new?lang=en', body(), post)
  assert.equal(second.status, 303)
  // Both posts land on the same project rather than creating a second one.
  assert.equal(first.headers.get('location'), second.headers.get('location'))

  const projects = (
    await app.client.call<Row[]>('flow.project.list', { search: 'Submitted twice', limit: 10 })
  ).value
  assert.equal(projects.length, 1)
  // And the seeded columns are not duplicated either — they are derived from the
  // project and the column code, so the second pass upserts rather than inserts.
  const columns = (await app.client.call<Row[]>('flow.column.list', { projectId: String(projects[0]?.id) }))
    .value
  assert.deepEqual(
    columns.map((column) => column.name),
    ['To do', 'Done'],
  )
})
