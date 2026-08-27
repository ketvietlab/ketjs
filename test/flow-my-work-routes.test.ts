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
  await call('flow.issue.save', {
    id: 'issue-login',
    projectId: 'platform',
    columnId: 'todo',
    title: 'Finish login',
    priority: 'high',
    assigneeUserId: 'admin',
    dueDate: '2020-01-01',
    idempotencyKey: 'issue-login',
  })
  await call('flow.issue.save', {
    id: 'issue-unassigned',
    projectId: 'platform',
    columnId: 'todo',
    title: 'Document the API',
    priority: 'normal',
    dueDate: '2030-01-01',
    idempotencyKey: 'issue-unassigned',
  })
  return app
}

test('flow cross-project issue routes: render ListPage, retain list state and localize every record link', async (t) => {
  const app = await boot(t)

  const mine = await app.client.get('/admin/flow/mine?q=Finish&lang=en')
  const rendered = await mine.text()
  const textContent = rendered.replace(/<!--k\[?-->/g, '')
  assert.equal(mine.status, 200)
  assert.match(rendered, /data-ui="list-page"/)
  assert.doesNotMatch(rendered, /data-ui="record-workspace"|data-ui="form-page"/)
  assert.match(textContent, /data-ui="list-page-title">My work/)
  assert.match(rendered, /name="q"[^>]*value="Finish"/)
  assert.match(rendered, /name="lang" value="en"/)
  assert.match(rendered, /data-active="true"[^>]*href="\/admin\/flow\/mine\?lang=en"/)
  assert.match(textContent, /href="\/admin\/flow\/issues\?lang=en">All\s*<span>2<\/span>/)
  assert.match(textContent, /href="\/admin\/flow\/mine\?lang=en" aria-current="page">Mine\s*<span>1<\/span>/)
  assert.match(rendered, /href="\/admin\/flow\/issues\/issue-login\?lang=en"/)
  assert.match(rendered, /href="\/admin\/flow\/projects\/platform\/board\?lang=en"/)
  assert.match(rendered, /data-late="true"/)
  assert.match(rendered, /Overdue issues/)

  const all = await app.client.get('/admin/flow/issues?lang=en')
  const allHtml = await all.text()
  const allTextContent = allHtml.replace(/<!--k\[?-->/g, '')
  assert.equal(all.status, 200)
  assert.match(allTextContent, /data-ui="list-page-title">All issues/)
  assert.match(allHtml, /data-active="true"[^>]*href="\/admin\/flow\/issues\?lang=en"/)

  const unsupported = await app.client.request('/admin/flow/mine?lang=en', { method: 'POST' })
  assert.equal(unsupported.status, 405)
})
