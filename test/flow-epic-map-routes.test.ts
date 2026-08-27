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
  await fixture('user.saveRole', { id: 'epic-map-reader', name: 'Epic map reader' })
  for (const [index, fnKey] of [
    'flow.project.get',
    'flow.epic.list',
    'flow.column.list',
    'flow.issue.list',
    'flow.issue.dependencies',
  ].entries()) {
    await fixture('user.grantFunction', {
      id: `epic-map-reader-${index}`,
      roleId: 'epic-map-reader',
      fnKey,
    })
  }
  await fixture('user.assignRole', {
    id: 'reader:epic-map-reader',
    userId: 'reader',
    roleId: 'epic-map-reader',
  })
  await app.client.login({ login: 'admin', password: 'correct horse' })

  const call = async <T = Row>(name: string, input: Record<string, unknown>) =>
    (await app.client.call<T>(name, input)).value
  for (const [id, key, name] of [
    ['platform', 'PLAT', 'Internal platform'],
    ['other', 'OTHER', 'Other project'],
  ]) {
    await call('flow.project.save', {
      values: { id, key, name },
      idempotencyKey: `project-${id}`,
    })
  }
  await call('flow.column.save', {
    values: { id: 'todo', projectId: 'platform', code: 'todo', name: 'To do', sequence: 10 },
    idempotencyKey: 'column-todo',
  })
  for (let index = 1; index <= 81; index += 1) {
    const number = String(index).padStart(3, '0')
    await call('flow.epic.save', {
      values: { id: `epic-${number}`, projectId: 'platform', title: `Epic ${number}` },
      idempotencyKey: `epic-${number}`,
    })
  }
  await call('flow.epic.save', {
    values: { id: 'archived-epic', projectId: 'platform', title: 'Archived epic' },
    idempotencyKey: 'archived-epic',
  })
  await call('flow.epic.archive', { id: 'archived-epic' })
  for (let index = 1; index <= 201; index += 1) {
    const number = String(index).padStart(3, '0')
    await call('flow.issue.save', {
      id: `map-issue-${number}`,
      projectId: 'platform',
      columnId: 'todo',
      epicId: 'epic-081',
      title: `Map issue ${number}`,
      idempotencyKey: `map-issue-${number}`,
    })
  }
  await call('flow.issue.dependency.add', {
    id: 'map-cross-batch-edge',
    issueId: 'map-issue-201',
    dependsOnIssueId: 'map-issue-001',
    relation: 'blocks',
    idempotencyKey: 'map-cross-batch-edge',
  })
  return app
}

test('flow epic dependency map: exact lookup, complete graph, locale, compatibility and permissions', async (t) => {
  const app = await boot(t)
  const boundedDependencies = (
    await app.client.call<Row[]>('flow.issue.dependencies', {
      issueIds: ['map-issue-201'],
    })
  ).value
  const outgoingDependencies = (
    await app.client.call<Row[]>('flow.issue.dependencies', {
      issueIds: ['map-issue-201'],
      includeExternalTargets: true,
    })
  ).value
  assert.deepEqual(boundedDependencies, [])
  assert.equal(outgoingDependencies.length, 1)
  assert.equal(outgoingDependencies[0]?.dependsOnIssueId, 'map-issue-001')

  const path = '/admin/flow/projects/platform/epics/epic-081/map?lang=en'
  const response = await app.client.get(path)
  const html = await response.text()
  const textContent = html.replace(/<!--k\[?-->/g, '')

  assert.equal(response.status, 200)
  assert.match(html, /data-ui="record-workspace"/)
  assert.doesNotMatch(html, /data-ui="list-page"|data-ui="form-page"|data-ui="modal-layer"/)
  assert.match(html, /data-island="flow.map"/)
  assert.match(textContent, /data-ui="record-heading">Epic 081/)
  assert.match(textContent, /Internal platform/)
  assert.equal(html.match(/data-ui="flow-map-node"/g)?.length, 201)
  assert.equal(html.match(/data-ui="flow-map-edge"/g)?.length, 1)
  assert.match(textContent, /Waiting for Map issue 001/)
  assert.match(html, /href="\/admin\/flow\/issues\/map-issue-[0-9]+\?lang=en"/)
  assert.match(html, /href="\/admin\/flow\/epics\/epic-081\?lang=en"/)
  assert.match(html, /href="\/admin\/flow\/projects\/platform\/epics\?lang=en"/)

  assert.equal(
    (await app.client.get('/admin/flow/projects/platform/epics/archived-epic/map?lang=en')).status,
    200,
  )
  assert.equal((await app.client.get('/admin/flow/projects/missing/epics/epic-081/map?lang=en')).status, 404)
  assert.equal((await app.client.get('/admin/flow/projects/other/epics/epic-081/map?lang=en')).status, 404)
  assert.equal((await app.client.get('/admin/flow/projects/platform/epics/missing/map?lang=en')).status, 404)
  assert.equal(
    (
      await app.client.post(path, new URLSearchParams(), {
        redirect: 'manual',
      })
    ).status,
    405,
  )
  assert.equal((await app.client.request(path, { method: 'PUT' })).status, 405)

  await app.client.logout()
  await app.client.login({ login: 'reader', password: 'reader password' })
  const readOnly = await app.client.get(path)
  const readOnlyHtml = await readOnly.text()
  assert.equal(readOnly.status, 200)
  assert.match(readOnlyHtml, /data-island="flow.map"/)
  assert.equal(readOnlyHtml.match(/data-ui="flow-map-node"/g)?.length, 201)
})
