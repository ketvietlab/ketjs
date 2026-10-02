import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

// Product navigation exposes the managed catalogue without custom-role creation.
test('the roles screen serves managed roles without authoring controls', async (t: TestContext) => {
  const app = await createTestDeployment(ketsuite, { worker: false })
  t.after(() => app.close())
  const scope = { company: 'acme', branch: 'root:acme', branches: ['root:acme'] }
  const fixture = (name: string, input: Record<string, unknown>) =>
    app.fixture.call<Row>(name, input, { scope })
  await fixture('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'ACME' })
  await fixture('company.saveCompany', { id: 'acme', code: 'ACME', partnerId: 'acme-party', currency: 'VND' })
  await fixture('user.createUser', {
    id: 'admin',
    login: 'admin',
    password: 'correct horse',
    name: 'Admin',
    superuser: true,
  })
  await fixture('user.grantCompany', { id: 'admin:acme', userId: 'admin', companyId: 'acme' })
  await app.client.login({ login: 'admin', password: 'correct horse' })

  const roles = await (await app.client.get('/admin/roles?lang=en')).text()
  assert.match(roles, /data-ui="list-page"/)
  assert.doesNotMatch(roles, /href="\/admin\/roles\/new/)
  const users = await (await app.client.get('/admin/users?lang=en')).text()
  assert.match(users, /data-ui="list-page"/)
  assert.match(users, /href="\/admin\/roles/)
  // The shared host is present, but its context rejects legacy/custom records.
  assert.match(users, /data-record-kind="user\.role"/)
  assert.match(users, /data-record-kind="user\.user"/)
})
