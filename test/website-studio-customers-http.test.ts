import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { bootWebsiteStudio } from './fixtures/website-studio.ts'

/**
 * The Studio looks after the sign-in accounts of a site's customers: whoever holds the security of
 * the site lists them, issues one to a partner, closes, reopens and resets it, and decides whether
 * visitors may open one themselves. Every action stays inside the site's own customers.
 */
test('Studio customer accounts: list, issue, close, reopen, reset and the sign-up switch, per site', async (t) => {
  const { app, fixture, revision } = await bootWebsiteStudio()
  t.after(() => app.close())
  await fixture('website.saveDomain', {
    id: 'accounts-domain',
    siteId: 'site-a',
    host: '127.0.0.1',
    primary: true,
  })
  await fixture('user.applyRoleTemplate', {
    roleId: 'studio-customers',
    templateKey: 'website.customers',
    expectedRoleRevision: 0,
    expectedAuthorizationRevision: await revision(),
    idempotencyKey: 'apply-customers',
  })
  await fixture('user.createUser', {
    id: 'studio-accounts',
    login: 'studio-accounts',
    password: 'studio-local',
    name: 'Website accounts',
    defaultCompanyId: 'studio-a',
  })
  await fixture('user.grantCompany', { id: 'accounts-a', userId: 'studio-accounts', companyId: 'studio-a' })
  await fixture('user.assignScopedRole', {
    id: 'accounts-a-customers',
    userId: 'studio-accounts',
    roleId: 'studio-customers',
    scopeKind: 'company',
    companyId: 'studio-a',
    expectedAuthorizationRevision: await revision(),
    idempotencyKey: 'accounts-a-customers',
  })
  for (const [id, name, phone] of [
    ['cuc', 'Chị Cúc', '0708580468'],
    ['lan', 'Chị Lan', '0912345678'],
    ['mai', 'Chị Mai', '0987654321'],
  ])
    await fixture('partner.savePartner', { id, kind: 'person', name, phone })
  // Another site of the same company keeps its own customers.
  await fixture('website.issueCustomerAccess', { siteId: 'site-a2', partnerId: 'mai', phone: '0987654321' })

  const clientFor = async (login: string) => {
    const client = app.client.anonymous()
    await client.login({ login, password: 'studio-local' })
    return async (name: string, input: Row) => {
      const response = await client.post('/website/api/' + name, JSON.stringify(input), {
        headers: { 'content-type': 'application/json' },
      })
      return { status: response.status, ...((await response.json()) as { value: Row; message?: string }) }
    }
  }
  const accounts = await clientFor('studio-accounts')
  const designer = await clientFor('studio-designer')

  // Styling a site does not reach its customers' accounts.
  const designerBoot = (await designer('website_studio.bootstrap', { site: 'site-a' })).value
  assert.ok(
    !(designerBoot.actor as Row & { capabilities: string[] }).capabilities.includes(
      'website.customer.manage',
    ),
  )
  assert.equal((await designer('website_studio.siteReadiness', { siteId: 'site-a' })).value.customers, null)
  assert.equal((await designer('website_studio.customers', { siteId: 'site-a' })).status, 403)
  assert.equal(
    (await designer('website_studio.saveCustomerSettings', { siteId: 'site-a', selfSignup: false })).status,
    403,
  )

  const capabilities = ((await accounts('website_studio.bootstrap', { site: 'site-a' })).value.actor as Row)
    .capabilities as string[]
  assert.ok(capabilities.includes('website.customer.manage'))
  assert.ok(capabilities.includes('website.customer.issue'))
  const list = async (input: Row = {}) =>
    (await accounts('website_studio.customers', { siteId: 'site-a', ...input })).value
  const empty = await list()
  assert.deepEqual(
    {
      available: empty.available,
      selfSignup: empty.selfSignup,
      signInUrl: empty.signInUrl,
      total: empty.total,
    },
    { available: true, selfSignup: true, signInUrl: 'https://127.0.0.1/account/login', total: 0 },
  )

  // Issuing starts from the company's partners; one already signing in here is not issued twice.
  assert.deepEqual(
    (await accounts('website_studio.customerCandidates', { siteId: 'site-a', search: 'C' })).value.rows,
    [],
  )
  const found = (await accounts('website_studio.customerCandidates', { siteId: 'site-a', search: 'Cúc' }))
    .value.rows as Row[]
  assert.deepEqual(
    found.map((row) => [row.id, row.phone, row.account]),
    [['cuc', '0708580468', null]],
  )
  const issued = await accounts('website_studio.issueCustomer', {
    siteId: 'site-a',
    partnerId: 'cuc',
    values: { displayName: 'Chị Cúc', phone: '0708580468', email: '', password: '' },
  })
  assert.equal(issued.status, 200, String(issued.message))
  const password = String(issued.value.password)
  assert.equal(password.length, 12, 'a made-up password is handed back once')
  assert.equal((issued.value.account as Row).status, 'active')
  const again = await accounts('website_studio.issueCustomer', {
    siteId: 'site-a',
    partnerId: 'cuc',
    values: { displayName: 'Chị Cúc', phone: '0708580468' },
  })
  assert.equal(again.status, 400)
  assert.match(String(again.message), /đã có tài khoản/)
  const listed = (await accounts('website_studio.customerCandidates', { siteId: 'site-a', search: 'Cúc' }))
    .value.rows as Row[]
  assert.equal(listed[0]!.account, 'active')

  const visitor = app.client.anonymous()
  const signIn = (secret: string) =>
    visitor.request('/api/customer/v1/auth/session/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone: '0708580468', password: secret }),
    })
  assert.equal((await signIn(password)).status, 200)
  const signedIn = async () =>
    (
      (await (await visitor.request('/api/customer/v1/bootstrap', { headers: {} })).json()) as {
        data: { customer: Row | null }
      }
    ).data.customer

  // Search reads the name, the phone and the email; a name with no digits is not a phone search.
  assert.deepEqual(
    ((await list()).rows as Row[]).map((row) => row.partnerId),
    ['cuc'],
    'the other site’s customer is not listed',
  )
  for (const [search, count] of [
    ['cúc', 1],
    ['0708', 1],
    ['708 580', 1],
    ['Lan', 0],
    ['xyz', 0],
  ] as const)
    assert.equal((await list({ search })).total, count, search)

  // Closing signs the customer out everywhere and keeps them out; reopening keeps the password.
  const closed = await accounts('website_studio.customerCommand', {
    siteId: 'site-a',
    partnerId: 'cuc',
    action: 'disable',
  })
  assert.equal((closed.value.account as Row).status, 'disabled')
  assert.equal(await signedIn(), null)
  assert.notEqual((await signIn(password)).status, 200)
  assert.equal((await list({ status: 'disabled' })).total, 1)
  assert.equal((await list({ status: 'active' })).total, 0)
  await accounts('website_studio.customerCommand', { siteId: 'site-a', partnerId: 'cuc', action: 'enable' })
  assert.equal((await signIn(password)).status, 200)

  // A reset staff choose is not shown back; the old password stops working and devices sign out.
  const short = await accounts('website_studio.customerCommand', {
    siteId: 'site-a',
    partnerId: 'cuc',
    action: 'reset',
    password: '123',
  })
  assert.equal(short.status, 400)
  const reset = await accounts('website_studio.customerCommand', {
    siteId: 'site-a',
    partnerId: 'cuc',
    action: 'reset',
    password: 'moi-123456',
  })
  assert.equal(reset.status, 200, String(reset.message))
  assert.equal(reset.value.password, null)
  assert.equal(await signedIn(), null)
  assert.notEqual((await signIn(password)).status, 200)
  assert.equal((await signIn('moi-123456')).status, 200)
  const detail = (await accounts('website_studio.customer', { siteId: 'site-a', partnerId: 'cuc' })).value
  assert.equal(detail.displayName, 'Chị Cúc')
  assert.equal(detail.signInUrl, 'https://127.0.0.1/account/login')
  assert.ok(!('password' in detail) && !('passwordHash' in detail))

  // Another site's customer is out of reach from this one, whatever the action.
  assert.equal(
    (await accounts('website_studio.customer', { siteId: 'site-a', partnerId: 'mai' })).status,
    404,
  )
  for (const action of ['disable', 'reset'])
    assert.equal(
      (await accounts('website_studio.customerCommand', { siteId: 'site-a', partnerId: 'mai', action }))
        .status,
      404,
      action,
    )
  assert.equal(
    ((await accounts('website_studio.customer', { siteId: 'site-a2', partnerId: 'mai' })).value as Row)
      .status,
    'active',
  )

  // Closing sign-up leaves staff-issued accounts as the only way in.
  const register = () =>
    app.client.anonymous().request('/api/customer/v1/auth/session/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: 'Chị Lan', phone: '0912345678', password: 'lan-123456' }),
    })
  assert.equal(
    (await accounts('website_studio.saveCustomerSettings', { siteId: 'site-a', selfSignup: false })).status,
    200,
  )
  assert.equal((await list()).selfSignup, false)
  assert.ok((await register()).status >= 400)
  await accounts('website_studio.saveCustomerSettings', { siteId: 'site-a', selfSignup: true })
  assert.equal((await list()).selfSignup, true)
})

test('Studio settings read and save the site itself, refusing a stale save', async (t) => {
  const { app } = await bootWebsiteStudio()
  t.after(() => app.close())
  const client = app.client.anonymous()
  await client.login({ login: 'studio-designer', password: 'studio-local' })
  const call = async (name: string, input: Row) => {
    const response = await client.post('/website/api/' + name, JSON.stringify(input), {
      headers: { 'content-type': 'application/json' },
    })
    return { status: response.status, ...((await response.json()) as { value: Row; message?: string }) }
  }
  // The customer screens open from a link or a reload, not only from inside the Studio.
  for (const path of ['/website/customers', '/website/customers/new', '/website/customers/cuc'])
    assert.equal((await client.get(`${path}?site=site-a`)).status, 200, path)
  const readiness = (await call('website_studio.siteReadiness', { siteId: 'site-a' })).value
  const site = readiness.site as Row
  assert.deepEqual([site.title, site.code, site.defaultLocale], ['site-a', 'site-a', 'vi'])
  assert.equal(readiness.publicUrl, '')
  const save = (expectedRevisionId: unknown, title: string) =>
    call('website_studio.saveResource', {
      siteId: 'site-a',
      kind: 'sites',
      id: 'site-a',
      expectedRevisionId,
      values: { title, code: 'site-a', defaultLocale: 'vi' },
    })
  const saved = await save(site.revisionId, 'Lành')
  assert.equal(saved.status, 200, String(saved.message))
  assert.equal(saved.value.title, 'Lành')
  assert.equal(
    ((await call('website_studio.siteReadiness', { siteId: 'site-a' })).value.site as Row).title,
    'Lành',
  )
  const stale = await save(site.revisionId, 'Lành cũ')
  assert.equal(stale.status, 400)
  assert.match(String(stale.message), /đã thay đổi/)
})
