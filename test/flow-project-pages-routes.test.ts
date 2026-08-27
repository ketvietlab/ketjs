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
  await call('flow.page.save', {
    id: 'guide',
    projectId: 'platform',
    title: 'Product guide',
    idempotencyKey: 'page-guide',
  })
  await call('flow.page.save', {
    id: 'setup',
    projectId: 'platform',
    parentPageId: 'guide',
    title: 'Local setup',
    idempotencyKey: 'page-setup',
  })
  return { app, call }
}

test('flow project pages route: specialized tree and URL-owned create preserve hierarchy, state and safety', async (t) => {
  const { app, call } = await boot(t)
  const collection = '/admin/flow/projects/platform/pages?lang=en'

  const page = await app.client.get(collection)
  const html = await page.text()
  const textContent = html.replace(/<!--k\[?-->/g, '')
  assert.equal(page.status, 200)
  assert.match(html, /data-ui="record-workspace"/)
  assert.doesNotMatch(html, /data-ui="list-page"|data-ui="form-page"|data-ui="modal-layer"/)
  assert.match(textContent, /data-ui="record-heading">Internal platform/)
  assert.match(html, /data-ui="doc-tree"/)
  assert.match(html, /data-ui="doc-branch"/)
  assert.match(html, /href="\/admin\/flow\/pages\/guide\?lang=en"/)
  assert.match(html, /href="\/admin\/flow\/pages\/setup\?lang=en"/)
  assert.match(textContent, /Product guide/)
  assert.match(textContent, /Local setup/)
  assert.match(html, /data-ui="doc-count"/)
  assert.match(html, /href="\/admin\/flow\/projects\/platform\/pages\?lang=en&amp;create=1"/)

  const create = await app.client.get(`${collection}&create=1`)
  const createHtml = await create.text()
  assert.equal(create.status, 200)
  assert.match(createHtml, /data-ui="record-workspace"/)
  assert.match(createHtml, /data-ui="doc-tree"/)
  assert.match(createHtml, /data-ui="modal-layer" data-route-modal="true"/)
  assert.match(createHtml, /id="flow-project-page-create-form"/)
  assert.match(createHtml, /action="\/admin\/flow\/projects\/platform\/pages\?lang=en&amp;create=1"/)
  assert.match(createHtml, /name="action" value="save"/)
  assert.match(createHtml, /name="id" value="[^"]+"/)
  assert.match(createHtml, /name="idempotencyKey" value="[^"]+"/)
  assert.match(createHtml, /data-ui="modal-close" href="\/admin\/flow\/projects\/platform\/pages\?lang=en"/)

  const invalid = await app.client.post(
    `${collection}&create=1`,
    new URLSearchParams({
      action: 'save',
      id: 'page-record-invalid',
      title: 'Draft runbook',
      parentPageId: 'missing',
      idempotencyKey: 'page-invalid',
    }),
    post,
  )
  assert.equal(invalid.status, 303)
  const invalidLocation = invalid.headers.get('location') ?? ''
  const invalidUrl = new URL(invalidLocation, 'http://ket.local')
  assert.equal(invalidUrl.pathname, '/admin/flow/projects/platform/pages')
  assert.equal(invalidUrl.searchParams.get('lang'), 'en')
  assert.equal(invalidUrl.searchParams.get('create'), '1')
  assert.equal(invalidUrl.searchParams.get('title'), 'Draft runbook')
  assert.equal(invalidUrl.searchParams.get('parentPageId'), 'missing')
  const invalidHtml = await (await app.client.get(invalidLocation)).text()
  assert.match(invalidHtml, /data-ui="modal-layer" data-route-modal="true"/)
  assert.match(invalidHtml, /name="id" value="page-record-invalid"/)
  assert.match(invalidHtml, /name="idempotencyKey" value="page-invalid"/)
  assert.match(invalidHtml, /name="title"[^>]*value="Draft runbook"/)
  assert.match(invalidHtml, /<option value="missing" selected="true">/)
  assert.match(invalidHtml, /The record was not found/)

  const saved = await app.client.post(
    `${collection}&create=1`,
    new URLSearchParams({
      action: 'save',
      title: 'Operations runbook',
      parentPageId: 'guide',
      idempotencyKey: 'page-create-success',
    }),
    post,
  )
  assert.equal(saved.status, 303)
  assert.match(saved.headers.get('location') ?? '', /^\/admin\/flow\/pages\/[^?]+\?lang=en$/)
  const pages = await call<Row[]>('flow.page.list', { projectId: 'platform' })
  const runbook = pages.find((row) => row.title === 'Operations runbook')
  assert.equal(runbook?.parentPageId, 'guide')

  const legacy = await app.client.post(
    collection,
    new URLSearchParams({ action: 'save', title: 'Legacy page', idempotencyKey: 'page-legacy' }),
    post,
  )
  assert.equal(legacy.status, 303)
  assert.match(legacy.headers.get('location') ?? '', /^\/admin\/flow\/pages\/[^?]+\?lang=en$/)
  const afterLegacy = await call<Row[]>('flow.page.list', { projectId: 'platform' })
  assert.ok(afterLegacy.some((row) => row.title === 'Legacy page'))

  const forged = await app.client.post(
    `${collection}&create=1`,
    new URLSearchParams({ action: 'save', title: 'Forged' }),
    {
      headers: { ...formHeaders, origin: 'https://evil.example' },
      redirect: 'manual',
    },
  )
  assert.equal(forged.status, 403)

  const missing = await app.client.get('/admin/flow/projects/missing/pages?lang=en')
  assert.equal(missing.status, 404)
  const refused = await app.client.request(collection, { method: 'PUT' })
  assert.equal(refused.status, 405)
})
