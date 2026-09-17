import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

// The roles screen is off: assignment accepts only managed roles, so a custom role
// made there could never be given to anyone. Nothing may reach it by URL or menu.
test('the roles screen is not served and not offered in the menu', async (t: TestContext) => {
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
  assert.doesNotMatch(roles, /data-ui="list-page"/)
  const users = await (await app.client.get('/admin/users?lang=en')).text()
  assert.match(users, /data-ui="list-page"/)
  assert.doesNotMatch(users, /href="\/admin\/roles/)
  // No role modal host is placed, so a hand-typed `record=user.role:…` opens nothing.
  assert.doesNotMatch(users, /data-record-kind="user\.role"/)
  assert.match(users, /data-record-kind="user\.user"/)
})
