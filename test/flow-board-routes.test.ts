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
    values: {
      id: 'todo',
      projectId: 'platform',
      code: 'todo',
      name: 'To do',
      sequence: 10,
    },
    idempotencyKey: 'column-todo',
  })
  await call('flow.column.save', {
    values: {
      id: 'done',
      projectId: 'platform',
      code: 'done',
      name: 'Done',
      sequence: 20,
      terminalState: true,
    },
    idempotencyKey: 'column-done',
  })
  await call('flow.issue.save', {
    id: 'issue-login',
    projectId: 'platform',
    columnId: 'todo',
    title: 'Finish login',
    priority: 'high',
    assigneeUserId: 'admin',
    dueDate: '2026-09-01',
    idempotencyKey: 'issue-login',
  })
  return { app, call }
}

test('flow board route: retains specialized kanban, localized interactions and protected moves', async (t) => {
  const { app, call } = await boot(t)

  const page = await app.client.get('/admin/flow/projects/platform/board?lang=en')
  const rendered = await page.text()
  const textContent = rendered.replace(/<!--k\[?-->/g, '')
  assert.equal(page.status, 200)
  assert.match(rendered, /data-ui="record-workspace"/)
  assert.doesNotMatch(rendered, /data-ui="list-page"|data-ui="form-page"/)
  assert.match(rendered, /Internal platform/)
  assert.match(rendered, /data-island="flow.board"/)
  assert.equal(rendered.match(/data-ui="flow-board-column"/g)?.length, 2)
  assert.match(rendered, /To do/)
  assert.match(textContent, /1 \/ 1/)
  assert.match(rendered, /Done/)
  assert.match(textContent, /0 \/ 0/)
  assert.match(rendered, /Finish login/)
  assert.match(rendered, /href="\/admin\/flow\/issues\/issue-login\?lang=en"/)
  assert.match(rendered, /action="\/admin\/flow\/projects\/platform\/board\/move\?lang=en"/)
  assert.match(rendered, /name="expectedVersion" value="1"/)
  assert.match(rendered, /data-priority="high"/)
  assert.match(rendered, /Administrator/)
  assert.match(rendered, /2026-09-01/)
  assert.match(rendered, /href="\/admin\/flow\/projects\/platform\/issues\?lang=en"/)
  assert.match(rendered, /href="\/admin\/flow\/projects\/platform\/settings\?lang=en"/)

  const moved = await app.client.post(
    '/admin/flow/projects/platform/board/move?lang=en',
    new URLSearchParams({
      id: 'issue-login',
      columnId: 'done',
      expectedVersion: '1',
      idempotencyKey: 'move-login',
    }),
    post,
  )
  assert.equal(moved.status, 303)
  assert.equal(moved.headers.get('location'), '/admin/flow/projects/platform/board?lang=en')
  const issue = await call<Row>('flow.issue.get', { id: 'issue-login' })
  assert.equal(issue.columnId, 'done')
  assert.equal(issue.version, 2)

  const stale = await app.client.post(
    '/admin/flow/projects/platform/board/move?lang=en',
    new URLSearchParams({
      id: 'issue-login',
      columnId: 'todo',
      expectedVersion: '1',
      idempotencyKey: 'move-stale',
    }),
    post,
  )
  assert.equal(stale.status, 409)
  assert.match(await stale.text(), /changed|thay đổi/i)

  const forged = await app.client.post(
    '/admin/flow/projects/platform/board/move?lang=en',
    new URLSearchParams({
      id: 'issue-login',
      columnId: 'todo',
      expectedVersion: '2',
      idempotencyKey: 'move-forged',
    }),
    {
      headers: { ...formHeaders, origin: 'https://evil.example' },
      redirect: 'manual',
    },
  )
  assert.equal(forged.status, 403)

  const missing = await app.client.get('/admin/flow/projects/missing/board?lang=en')
  assert.equal(missing.status, 404)
})
