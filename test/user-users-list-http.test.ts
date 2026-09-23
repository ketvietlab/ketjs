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
  assert.match(first, /data-island="backend\.search-filter"/)
  assert.match(first, /1-30 \/ 31/)
  assert.doesNotMatch(first, /user-31/)

  const second = await (await app.client.get('/admin/users?page=2&lang=en')).text()
  assert.match(second, /31-31 \/ 31/)

  const archived = await (await app.client.get('/admin/users?archived=1&page=2&lang=en')).text()
  assert.match(archived, /31-32 \/ 32/)
  assert.match(
    archived,
    /data-row-href="\/admin\/users\?archived=1&amp;page=2&amp;lang=en&amp;record=user\.user%3Auser-31"/,
  )

  const byName = await (await app.client.get('/admin/users?q=needle&lang=en')).text()
  assert.match(byName, /Search Needle/)
  assert.match(byName, /Users: 2/)
  assert.match(byName, /needle@example\.test|login-08/)

  const stateful = await (await app.client.get('/admin/users?q=user&archived=1&page=2&lang=en')).text()
  // The search-filter bar owns the query and the archived toggle now, so what
  // the page must keep is the state the URL names, not a GET form.
  assert.match(stateful, /data-island="backend\.search-filter"/)
  assert.doesNotMatch(stateful, /name="q"[^>]*data-ui="chrome-search-input"/)
  assert.equal((await app.client.request('/admin/users?lang=en', { method: 'PUT' })).status, 405)
})

test('the create action opens a person in the record modal, keeping the list state behind it', async (t) => {
  const app = await boot(t)
  const page = await (await app.client.get('/admin/users?q=user&archived=1&page=2&lang=en')).text()

  // The create link names the record, so the collection behind the modal keeps its query.
  assert.match(
    page,
    /href="\/admin\/users\?q=user&amp;archived=1&amp;page=2&amp;lang=en&amp;record=user\.user%3Anew"/,
  )
  // The closed host is what opens that link once the page hydrates.
  assert.match(page, /data-ui="record-modal-host" data-record-kind="user\.user"/)
  // A row opens the same modal on the person it names, not a page of its own.
  assert.match(
    page,
    /data-row-href="\/admin\/users\?q=user&amp;archived=1&amp;page=2&amp;lang=en&amp;record=user\.user%3A[^"]+"/,
  )
  assert.doesNotMatch(page, /data-row-href="\/admin\/users\/[^"?]+\?/)
})

test('the list narrows by where people work and what they hold, and says so removably', async (t) => {
  const app = await boot(t)
  const scope = { company: 'acme', branch: 'root:acme', branches: ['root:acme'] }
  const fixture = (name: string, input: Record<string, unknown>) =>
    app.fixture.call<Row>(name, input, { scope })
  await fixture('user.saveRole', { id: 'cashier', name: 'Thu ngân' })
  await fixture('user.assignRole', { id: 'a-01', userId: 'user-01', roleId: 'cashier' })

  // Both questions are offered beside paging.
  const plain = await (await app.client.get('/admin/users?lang=en')).text()
  assert.match(plain, /Thu ngân/)

  // Only the person who works at that company is left, and the chip drops it again.
  const byCompany = await (await app.client.get('/admin/users?company=acme&lang=en')).text()
  assert.match(byCompany, /Users: 1/)
  assert.match(byCompany, /login-00/)
  assert.match(byCompany, /href="\/admin\/users\?lang=en"/)

  // Only the person holding that role is left.
  const byRole = await (await app.client.get('/admin/users?role=cashier&lang=en')).text()
  assert.match(byRole, /Users: 1/)
  assert.match(byRole, /login-01/)

  // Asked for both at once nobody qualifies, and the way out is dropping the question.
  const neither = await (await app.client.get('/admin/users?company=acme&role=cashier&lang=en')).text()
  assert.match(neither, /Users: 0/)
  assert.match(neither, /Clear the filters/)
})
