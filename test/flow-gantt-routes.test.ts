import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { tableNameFor } from '@ketvietlab/ketjs'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

const boot = async (t: TestContext) => {
  const app = await createTestDeployment(ketsuite, { worker: false })
  t.after(() => app.close())
  const scope = { company: 'acme', branch: 'root:acme', branches: ['root:acme'] }
  const fixture = (name: string, input: Record<string, unknown>) =>
    app.fixture.call<Row>(name, input, { scope })
  await fixture('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'ACME' })
  await fixture('company.saveCompany', {
    id: 'acme',
    code: 'ACME',
    partnerId: 'acme-party',
    currency: 'VND',
  })
  await fixture('user.createUser', {
    id: 'admin',
    login: 'admin',
    password: 'correct horse',
    name: 'Administrator',
    defaultCompanyId: 'acme',
    superuser: true,
  })
  await fixture('user.grantCompany', { id: 'admin:acme', userId: 'admin', companyId: 'acme' })
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
  for (let index = 1; index <= 201; index += 1) {
    const number = String(index).padStart(3, '0')
    await call('flow.issue.save', {
      id: `gantt-issue-${number}`,
      projectId: 'platform',
      columnId: 'todo',
      title: `Gantt issue ${number}`,
      startDate: '2026-08-01',
      dueDate: '2026-08-02',
      idempotencyKey: `gantt-issue-${number}`,
    })
  }
  return app
}

test('project Gantt pages the complete issue set and keeps locale in chart navigation', async (t) => {
  const app = await boot(t)
  const firstResponse = await app.client.get('/admin/flow/projects/platform/gantt?lang=en')
  const first = await firstResponse.text()
  assert.equal(firstResponse.status, 200)
  assert.match(first, /data-ui="gantt"/)
  assert.equal(first.match(/data-ui="gantt-row"/g)?.length, 200)
  assert.match(first, /1-200 \/ 201/)
  assert.match(first, /href="\/admin\/flow\/projects\/platform\/gantt\?lang=en&amp;page=2"/)
  assert.match(first, /href="\/admin\/flow\/issues\/gantt-issue-001\?lang=en"/)
  assert.doesNotMatch(first, /gantt-issue-201/)

  const second = await (await app.client.get('/admin/flow/projects/platform/gantt?page=2&lang=en')).text()
  assert.equal(second.match(/data-ui="gantt-row"/g)?.length, 1)
  assert.match(second, /201-201 \/ 201/)
  assert.match(second, /href="\/admin\/flow\/issues\/gantt-issue-201\?lang=en"/)
  assert.match(second, /href="\/admin\/flow\/projects\/platform\/gantt\?lang=en"/)

  assert.equal((await app.client.get('/admin/flow/projects/missing/gantt?lang=en')).status, 404)
  assert.equal(
    (
      await app.client.post('/admin/flow/projects/platform/gantt?lang=en', new URLSearchParams(), {
        redirect: 'manual',
      })
    ).status,
    405,
  )
})

test('flow gantt route: past its reading ceiling the chart says it is a first slice', async (t) => {
  const app = await boot(t)
  // Two thousand and one more than the harness already made, so the ceiling is
  // crossed by one. Written straight into the store: the subject is what the
  // route reads, not what two thousand saves do.
  await app.fixture.withTenant('', async ({ adapter }) => {
    const columns = [
      'companyId',
      'id',
      'projectId',
      'columnId',
      'title',
      'priority',
      'threadId',
      'active',
      'version',
      'startDate',
      'dueDate',
      'createdAt',
      'updatedAt',
    ]
    const sql = `INSERT INTO ${adapter.quoteIdent(tableNameFor('flow.Issue'))} (${columns
      .map((name) => adapter.quoteIdent(name))
      .join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`
    for (let index = 0; index < 2000; index += 1)
      await adapter.run(sql, [
        'acme',
        `bulk-${index}`,
        'platform',
        'todo',
        `Bulk ${index}`,
        'normal',
        `thread:flow.Issue:bulk-${index}`,
        1,
        1,
        '2026-08-01',
        '2026-08-02',
        '2026-08-01T00:00:00.000Z',
        new Date(Date.parse('2026-08-01T00:00:00.000Z') + index * 1000).toISOString(),
      ] as never[])
  })

  const html = await (await app.client.get('/admin/flow/projects/platform/gantt?lang=en')).text()
  assert.match(html, /This timeline is a first slice/)
  // The two numbers are the ceiling and the truth, and they are not the same.
  assert.match(html, /reads at most 2,?000 issues/)
  assert.match(html, /holds 2,?201/)
})
