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
  await fixture('partner.savePartner', { id: 'reader-party', kind: 'person', name: 'Reader' })
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
  await fixture('user.createUser', {
    id: 'reader',
    login: 'reader',
    password: 'reader password',
    name: 'Reader',
    partnerId: 'reader-party',
    defaultCompanyId: 'acme',
  })
  for (const userId of ['admin', 'reader']) {
    await fixture('user.grantCompany', {
      id: `${userId}:acme`,
      userId,
      companyId: 'acme',
    })
  }
  await fixture('user.saveRole', { id: 'epic-reader', name: 'Epic reader' })
  for (const [index, fnKey] of ['flow.epic.get', 'flow.issue.list'].entries()) {
    await fixture('user.grantFunction', { id: `epic-reader-${index}`, roleId: 'epic-reader', fnKey })
  }
  await fixture('user.assignRole', { id: 'reader:epic-reader', userId: 'reader', roleId: 'epic-reader' })
  await app.client.login({ login: 'admin', password: 'correct horse' })

  const call = async <T = Row>(name: string, input: Record<string, unknown>) =>
    (await app.client.call<T>(name, input)).value
  await call('flow.project.save', {
    values: { id: 'platform', key: 'PLAT', name: 'Internal platform' },
    idempotencyKey: 'project-platform',
  })
  // The reader has the function grant and now needs the other half of the
  // answer: being on the project. A grant says what somebody may do; being a
  // member says which projects they may do it to (FLW-DEC-012).
  await call('flow.project.member.add', {
    projectId: 'platform',
    userId: 'reader',
    idempotencyKey: 'member-reader-platform',
  })
  await call('flow.column.save', {
    values: { id: 'todo', projectId: 'platform', code: 'todo', name: 'To do', sequence: 10 },
    idempotencyKey: 'column-todo',
  })
  await call('flow.epic.save', {
    values: { id: 'release', projectId: 'platform', title: 'First release' },
    idempotencyKey: 'epic-release',
  })
  await call('flow.epic.save', {
    values: { id: 'archived-release', projectId: 'platform', title: 'Archived release' },
    idempotencyKey: 'epic-archived-release',
  })
  await call('flow.epic.archive', { id: 'archived-release' })
  for (let index = 1; index <= 101; index += 1) {
    const number = String(index).padStart(3, '0')
    await call('flow.issue.save', {
      id: `release-issue-${number}`,
      projectId: 'platform',
      columnId: 'todo',
      epicId: 'release',
      title: `Release issue ${number}`,
      idempotencyKey: `issue-release-${number}`,
    })
  }
  return app
}

test('flow epic detail route: FormPage preserves Live Doc, project context, locale and complete issue path', async (t) => {
  const app = await boot(t)
  const detail = '/admin/flow/epics/release?lang=en'
  const response = await app.client.get(detail)
  const html = await response.text()
  const textContent = html.replace(/<!--k\[?-->/g, '')

  assert.equal(response.status, 200)
  assert.match(html, /data-ui="form-page"/)
  assert.doesNotMatch(html, /data-ui="record-workspace"|data-ui="modal-layer"/)
  assert.match(textContent, /data-ui="form-page-title">First release/)
  assert.match(textContent, /data-ui="form-page-description">Internal platform/)
  assert.match(html, /data-island="livedoc.editor"/)
  assert.match(html, /href="\/admin\/flow\/projects\/platform\/epics\?lang=en"/)
  assert.match(html, /href="\/admin\/flow\/projects\/platform\/epics\/release\/map\?lang=en"/)
  assert.match(html, /href="\/admin\/flow\/issues\/release-issue-[0-9]+\?lang=en"/)
  assert.equal(html.match(/data-ui="record-row"/g)?.length, 50)
  assert.match(textContent, /101 issues/)
  assert.match(textContent, /View all issues/)
  assert.match(html, /href="\/admin\/flow\/projects\/platform\/issues\?[^"]*lang=en/)
  assert.match(html, /filter=/)

  const content = await app.client.get('/admin/flow/epics/release/content?lang=en')
  assert.equal(content.status, 200)
  const payload = (await content.json()) as { topic: string }
  assert.match(payload.topic, /^doc:acme:flow\.Epic:release:/)

  assert.equal((await app.client.get('/admin/flow/epics/missing?lang=en')).status, 404)
  assert.equal(
    (
      await app.client.post('/admin/flow/epics/release?lang=en', new URLSearchParams(), {
        redirect: 'manual',
      })
    ).status,
    405,
  )
  assert.equal((await app.client.request('/admin/flow/epics/release?lang=en', { method: 'PUT' })).status, 405)

  const archived = await app.client.get('/admin/flow/epics/archived-release?lang=en')
  assert.equal(archived.status, 200)
  assert.match(await archived.text(), /data-ui="form-page"/)

  await app.client.logout()
  await app.client.login({ login: 'reader', password: 'reader password' })
  const readOnly = await app.client.get(detail)
  const readOnlyHtml = await readOnly.text()
  assert.equal(readOnly.status, 200)
  assert.match(readOnlyHtml, /data-ui="form-page"/)
  assert.match(readOnlyHtml, /data-island="livedoc.editor"/)
  assert.match(readOnlyHtml.replace(/<!--k\[?-->/g, ''), /data-ui="form-page-description">platform/)
  assert.equal((await app.client.get('/admin/flow/epics/release/content?lang=en')).status, 200)
  const deniedWrite = await app.client.request('/admin/flow/epics/release/push?lang=en', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ update: 'not-permitted' }),
  })
  assert.equal(deniedWrite.status, 403)
})
