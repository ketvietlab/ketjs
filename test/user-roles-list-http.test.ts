import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

test('roles HTTP list preserves locale, encoded identity and GET-only semantics', async (t: TestContext) => {
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
  await fixture('user.saveRole', { id: 'manager/a', name: 'Manager', description: 'Operational manager' })
  await app.client.login({ login: 'admin', password: 'correct horse' })

  const response = await app.client.get('/admin/roles?lang=en')
  const html = await response.text()
  assert.equal(response.status, 200)
  assert.match(html, /data-ui="list-page"/)
  assert.match(html, /data-row-href="\/admin\/roles\/manager%2Fa\?lang=en"/)
  assert.match(html, /href="\/admin\/roles\/new\?lang=en"/)
  assert.equal((await app.client.request('/admin/roles?lang=en', { method: 'POST' })).status, 405)
})
