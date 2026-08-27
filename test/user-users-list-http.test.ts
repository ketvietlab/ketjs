import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
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
  for (let index = 0; index < 32; index += 1) {
    const suffix = String(index).padStart(2, '0')
    await fixture('user.createUser', {
      id: `user-${suffix}`,
      login: `login-${suffix}`,
      password: index === 0 ? 'correct horse' : undefined,
      name: index === 7 ? 'Search Needle' : `User ${suffix}`,
      email: index === 8 ? 'needle@example.test' : null,
      superuser: index === 0,
      accessKind: index === 9 ? 'portal' : 'internal',
    })
  }
  await fixture('user.grantCompany', { id: 'user-00:acme', userId: 'user-00', companyId: 'acme' })
  await fixture('user.archiveUser', { id: 'user-31', active: false })
  await app.client.login({ login: 'login-00', password: 'correct horse' })
  return app
}

test('users HTTP list searches before exact paging and preserves locale/archive state', async (t) => {
  const app = await boot(t)
  const first = await (await app.client.get('/admin/users?lang=en')).text()
  assert.match(first, /data-ui="list-page"/)
  assert.match(first, /1-30 \/ 31/)
  assert.doesNotMatch(first, /user-31/)

  const second = await (await app.client.get('/admin/users?page=2&lang=en')).text()
  assert.match(second, /31-31 \/ 31/)

  const archived = await (await app.client.get('/admin/users?archived=1&page=2&lang=en')).text()
  assert.match(archived, /31-32 \/ 32/)
  assert.match(archived, /data-row-href="\/admin\/users\/user-31\?lang=en"/)

  const byName = await (await app.client.get('/admin/users?q=needle&lang=en')).text()
  assert.match(byName, /Search Needle/)
  assert.match(byName, /Users: 2/)
  assert.match(byName, /needle@example\.test|login-08/)

  const stateful = await (await app.client.get('/admin/users?q=user&archived=1&page=2&lang=en')).text()
  assert.match(stateful, /name="q"[^>]*value="user"/)
  assert.match(stateful, /type="hidden" name="archived" value="1"/)
  assert.match(stateful, /type="hidden" name="lang" value="en"/)
  assert.match(stateful, /href="\/admin\/users\?q=user&amp;lang=en"/)
  assert.equal((await app.client.request('/admin/users?lang=en', { method: 'PUT' })).status, 405)
})
