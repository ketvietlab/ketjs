import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

const post = { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' as const }
const hidden = (html: string, name: string): string => {
  const match = html.match(new RegExp(`name="${name}" value="([^"]*)"`))
  assert.ok(match, `missing ${name}`)
  return match[1]!
}

const boot = async (t: TestContext) => {
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
    name: 'Administrator',
    superuser: true,
  })
  await fixture('user.grantCompany', { id: 'admin:acme', userId: 'admin', companyId: 'acme' })
  await fixture('user.saveRole', { id: 'manager', name: 'Manager' })
  await app.client.login({ login: 'admin', password: 'correct horse' })
  return app
}

test('user create/detail preserves stable retry identity, return state and explicit commands', async (t) => {
  const app = await boot(t)
  const returnTo = '/admin/users?q=Draft&archived=1&lang=en'
  const path = `/admin/users/new?lang=en&returnTo=${encodeURIComponent(returnTo)}`
  const create = await app.client.get(path)
  const createHtml = await create.text()
  assert.equal(create.status, 200)
  assert.match(createHtml, /data-ui="form-page" data-scope="user-form-page" data-has-aside="false"/)
  assert.match(createHtml, /href="\/admin\/users\?q=Draft&amp;archived=1&amp;lang=en"/)
  const id = hidden(createHtml, 'id')

  const rejected = await app.client.post(
    path,
    new URLSearchParams({
      action: 'save',
      id,
      login: '',
      name: 'Draft User',
      email: 'draft@example.test',
      accessKind: 'internal',
    }),
    post,
  )
  const rejectedHtml = await rejected.text()
  assert.equal(rejected.status, 200)
  assert.equal(hidden(rejectedHtml, 'id'), id)
  assert.match(rejectedHtml, /name="email"[^>]*value="draft@example.test"/)

  const body = new URLSearchParams({
    action: 'save',
    id,
    login: 'draft.user',
    name: 'Draft User',
    email: 'draft@example.test',
    accessKind: 'internal',
  })
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const saved = await app.client.post(path, body, post)
    assert.equal(saved.status, 303)
    assert.equal(
      saved.headers.get('location'),
      `/admin/users/${id}?lang=en&returnTo=${encodeURIComponent(returnTo)}`,
    )
  }

  const detailPath = `/admin/users/${id}?lang=en&returnTo=${encodeURIComponent(returnTo)}`
  const detail = await (await app.client.get(detailPath)).text()
  assert.match(detail, /data-ui="tabs"/)
  assert.match(detail, /Quyền truy cập/)
  assert.doesNotMatch(detail, /name="superuser"|Quản lý quyền truy cập/)
  assert.match(detail, /href="\/admin\/users\?q=Draft&amp;archived=1&amp;lang=en"/)

  assert.equal(
    (
      await app.client.post(
        detailPath,
        new URLSearchParams({
          action: 'save',
          login: 'draft.user',
          name: 'Draft User',
          email: 'draft@example.test',
          accessKind: 'internal',
          active: '1',
          superuser: '1',
        }),
        post,
      )
    ).status,
    303,
  )
  assert.equal(
    (await app.adapter!.all('SELECT superuser FROM user_user WHERE id = ?', [id]))[0]!.superuser,
    0,
    'ordinary profile payload cannot grant special access',
  )
  assert.equal((await app.client.post(path, new URLSearchParams({ id }), post)).status, 400)
  assert.equal(
    (await app.client.post(`${detailPath.replace('?', '/companies?')}`, new URLSearchParams(), post)).status,
    400,
  )
  assert.equal(
    (
      await app.client.post(
        `${detailPath.replace('?', '/token?')}`,
        new URLSearchParams({ action: 'unknown' }),
        post,
      )
    ).status,
    400,
  )

  const unsafe = await (
    await app.client.get('/admin/users/new?lang=en&returnTo=https://attacker.example')
  ).text()
  assert.match(unsafe, /href="\/admin\/users\?lang=en"/)
  assert.doesNotMatch(unsafe, /attacker\.example/)
})

test('a legacy scoped assignment can be removed directly from its row, with one confirmation', async (t) => {
  const app = await boot(t)
  const scope = { company: 'acme', branch: 'root:acme', branches: ['root:acme'] }
  const fixture = async (name: string, input: Record<string, unknown>) =>
    (await app.fixture.call<any>(name, input, { scope })).value
  await fixture('user.createUser', { id: 'staff', login: 'staff', name: 'Staff' })
  await fixture('user.grantCompany', { id: 'staff:acme', userId: 'staff', companyId: 'acme' })
  await fixture('user.saveRole', { id: 'cashier', name: 'Cashier' })
  const revision = (await fixture('user.authorizationState', {})).revision
  await fixture('user.assignScopedRole', {
    id: 'cashier-assignment',
    userId: 'staff',
    roleId: 'cashier',
    scopeKind: 'company',
    companyId: 'acme',
    reason: 'Legacy assignment',
    expectedAuthorizationRevision: revision,
    idempotencyKey: 'legacy',
  })
  const access = await (await app.client.get('/admin/users/staff/access')).text()
  assert.match(access, /Cashier/)
  assert.match(access, /data-row-href=/)
  const removePath = '/admin/users/staff/remove/cashier-assignment'
  const form = await (await app.client.get(removePath)).text()
  assert.match(form, /Xác nhận gỡ vai trò/)
  assert.doesNotMatch(form, /name="command" value="preview"/)
  const removed = await app.client.post(
    removePath,
    new URLSearchParams({
      command: 'confirm',
      reason: 'taken back',
      idempotencyKey: hidden(form, 'idempotencyKey'),
      expectedAuthorizationRevision: hidden(form, 'expectedAuthorizationRevision'),
    }),
    post,
  )
  assert.equal(removed.status, 303)
  const after = await (await app.client.get('/admin/users/staff/access')).text()
  assert.match(after, /Chưa gán vai trò/)
  const audits = await fixture('user.listAuthorizationAudit', { userId: 'staff' })
  assert.ok(
    audits.some(
      (event: any) => event.reason === 'taken back' && event.event === 'authorization.assignment.removed',
    ),
  )
})
