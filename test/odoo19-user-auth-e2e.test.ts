import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { createTestApp } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/app.ts'

const bootIdentity = async (t: TestContext) => {
  const e2e = await createTestApp(ketsuite, { worker: false })
  t.after(() => e2e.close())
  const scope = { company: 'acme', branch: 'root:acme', branches: ['root:acme'] }
  const fixture = <T = Row>(name: string, input: Record<string, unknown>, actor?: string) =>
    e2e.fixture.call<T>(name, input, { scope, actor }).then((result) => result.value)

  await fixture('partner.savePartner', { id: 'acme:partner', kind: 'company', name: 'Kết Việt' })
  await fixture('company.saveCompany', {
    id: 'acme',
    code: 'KET',
    partnerId: 'acme:partner',
    currency: 'VND',
  })
  for (const [id, login, name] of [
    ['admin', 'Admin', 'Quản trị viên'],
    ['backup', 'backup', 'Quản trị dự phòng'],
  ]) {
    await fixture('user.createUser', {
      id,
      login,
      password: 'correct horse',
      name,
      superuser: true,
    })
    await fixture('user.grantCompany', { id: `${id}:acme`, userId: id, companyId: 'acme' })
  }
  await e2e.client.login({ login: ' ADMIN ', password: 'correct horse' })
  return { e2e, fixture, scope }
}

test('e2e user 19: every administration and profile screen crosses real HTTP', async (t) => {
  const { e2e } = await bootIdentity(t)
  for (const [path, expected] of [
    ['/admin/users?lang=vi', /Người dùng/],
    ['/admin/users/admin?lang=en', /Login identity/],
    ['/admin/users/new?lang=vi', /Tạo người dùng/],
    ['/admin/roles?lang=en', /Roles/],
    ['/admin/roles/new?lang=vi', /Tạo vai trò/],
    ['/admin/permission-presets?lang=en', /Permission presets/],
    ['/admin/profile?lang=vi', /Hồ sơ của tôi/],
  ] as const) {
    const response = await e2e.client.get(path, { headers: { accept: 'text/html' } })
    assert.equal(response.status, 200, path)
    assert.match(await response.text(), expected, path)
  }
})

test('e2e user 19: invitation is digest-only, single-use and accepted over HTTP', async (t) => {
  const { e2e, fixture } = await bootIdentity(t)
  await fixture('user.createUser', {
    id: 'invited',
    login: ' Invited.User ',
    name: 'Invited User',
    accessKind: 'internal',
  })
  await fixture('user.grantCompany', { id: 'invited:acme', userId: 'invited', companyId: 'acme' })
  const issued = await fixture<{ ok: boolean; token: string; expiresAt: string }>(
    'user.issueAuthToken',
    { userId: 'invited', kind: 'invitation', realm: 'backend' },
    'admin',
  )
  assert.equal(issued.ok, true)
  const tokenRow = (await e2e.adapter!.all('SELECT digest FROM user_auth_token', []))[0]!
  assert.notEqual(tokenRow.digest, issued.token)
  assert.equal(String(tokenRow.digest).length, 64)

  const invited = e2e.client.anonymous()
  const page = await invited.get(`/auth/invitation?token=${encodeURIComponent(issued.token)}`, {
    headers: { accept: 'text/html' },
  })
  assert.equal(page.status, 200)
  assert.match(await page.text(), /Hoàn tất lời mời/)
  const accepted = await invited.form<string>('/auth/invitation', {
    token: issued.token,
    password: 'new secure password',
    confirmPassword: 'new secure password',
  })
  assert.match(accepted, /Mật khẩu đã được cập nhật/)
  await invited.login({ login: 'invited.user', password: 'new secure password' })

  const replay = await fixture<{ ok: boolean }>('user.consumeAuthToken', {
    token: issued.token,
    kind: 'invitation',
    realm: 'backend',
    password: 'another password',
  })
  assert.equal(replay.ok, false)
})

test('e2e user 19: self password rotation keeps this session and closes the others', async (t) => {
  const { e2e } = await bootIdentity(t)
  const other = e2e.client.anonymous()
  await other.login({ login: 'admin', password: 'correct horse' })

  const changed = await e2e.client.form<string>('/admin/profile/password', {
    currentPassword: 'correct horse',
    newPassword: 'battery staple',
  })
  assert.match(changed, /Hồ sơ của tôi/)
  assert.equal((await e2e.client.get('/whoami')).status, 200)
  assert.equal((await other.get('/whoami')).status, 401)
  await e2e.client.logout()
  await e2e.client.login({ login: 'admin', password: 'battery staple' })
})

test("e2e user 19: self-service cannot revoke another user's session", async (t) => {
  const { e2e, fixture } = await bootIdentity(t)
  await fixture('user.createUser', {
    id: 'operator',
    login: 'operator',
    password: 'operator password',
    name: 'Operator',
  })
  await fixture('user.grantCompany', { id: 'operator:acme', userId: 'operator', companyId: 'acme' })
  const operator = e2e.client.anonymous()
  await operator.login({ login: 'operator', password: 'operator password' })
  const adminSession = (
    await e2e.adapter!.all(
      "SELECT id FROM ket_session WHERE user_id = 'admin' ORDER BY created_at LIMIT 1",
      [],
    )
  )[0]
  assert.ok(adminSession)

  const denied = await operator.request(
    `/admin/users/admin/sessions/${encodeURIComponent(String(adminSession.id))}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'action=revoke',
    },
  )
  assert.equal(denied.status, 400)
  assert.equal((await e2e.client.get('/whoami')).status, 200)
})

test('e2e user 19: auth mutations are POST-only and reject cross-site origins', async (t) => {
  const { e2e } = await bootIdentity(t)
  assert.equal((await e2e.client.get('/logout')).status, 405)
  for (const [path, body] of [
    ['/admin/profile/password', 'currentPassword=correct+horse&newPassword=battery+staple'],
    ['/auth/reset', 'token=fake&password=battery+staple&confirmPassword=battery+staple'],
  ] as const) {
    const response = await e2e.client.request(path, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin: 'https://attacker.example',
      },
      body,
    })
    assert.equal(response.status, 403, path)
  }
  assert.equal((await e2e.client.get('/whoami')).status, 200)
})

test('e2e user 19: generic HTTP cannot call internal authentication functions', async (t) => {
  const { e2e } = await bootIdentity(t)
  for (const name of ['user.authenticate', 'user.consumeAuthToken', 'user.issueAuthToken']) {
    const response = await e2e.client.request(`/_ket/fn/${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    assert.equal(response.status, 400, name)
    assert.equal(((await response.json()) as { code: string }).code, 'E_FUNCTION_INTERNAL')
  }
})
