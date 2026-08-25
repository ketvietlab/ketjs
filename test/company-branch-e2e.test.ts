import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

const bootCompany = async (t: TestContext) => {
  const e2e = await createTestDeployment(ketsuite, { worker: false })
  t.after(() => e2e.close())
  const scope = { company: 'acme', branch: 'root:acme', branches: ['root:acme'] }
  const fixture = (name: string, input: Record<string, unknown>, actor?: string) =>
    e2e.fixture.call<Row>(name, input, { scope, actor })

  for (const [id, name] of [
    ['acme', 'Công ty Kết Việt'],
    ['globex', 'Globex Corporation'],
  ]) {
    await fixture('partner.savePartner', { id: `${id}:partner`, kind: 'company', name })
    await fixture('company.saveCompany', {
      id,
      code: id.toUpperCase(),
      partnerId: `${id}:partner`,
      currency: id === 'acme' ? 'VND' : 'USD',
    })
  }
  await fixture('company.saveBranch', {
    id: 'acme:north',
    companyId: 'acme',
    code: 'NORTH',
    name: 'Miền Bắc',
    parentId: 'root:acme',
  })
  await fixture('user.createUser', {
    id: 'admin',
    login: 'admin',
    password: 'correct horse',
    name: 'Administrator',
    superuser: true,
  })
  await fixture('user.createUser', {
    id: 'backup-admin',
    login: 'backup-admin',
    password: 'correct horse',
    name: 'Backup administrator',
    superuser: true,
  })
  await fixture('user.grantCompany', { id: 'admin:acme', userId: 'admin', companyId: 'acme' })
  await fixture('user.grantCompany', { id: 'admin:globex', userId: 'admin', companyId: 'globex' })
  await fixture('user.grantBranch', {
    id: 'admin:acme:north',
    userId: 'admin',
    branchId: 'acme:north',
  })
  await e2e.client.login({ login: 'admin', password: 'correct horse' })
  return { e2e, fixture }
}

test('company-branch-e2e: company, hierarchy, branch and context screens cross real HTTP', async (t) => {
  const { e2e } = await bootCompany(t)
  const pages: Array<[string, RegExp]> = [
    ['/admin/companies', /Công ty Kết Việt/],
    ['/admin/companies/acme', /Chi nhánh vận hành/],
    ['/admin/companies/hierarchy', /Cây pháp nhân/],
    ['/admin/companies/acme/branches/acme:north', /Miền Bắc/],
    ['/admin/context', /Ngữ cảnh làm việc/],
  ]
  for (const [path, expected] of pages) {
    const response = await e2e.client.get(path, { headers: { accept: 'text/html' } })
    assert.equal(response.status, 200, path)
    const html = await response.text()
    assert.match(html, expected, path)
    assert.doesNotMatch(html, /data-ui="context-switcher"/, `${path} has no company selector in the topbar`)
    assert.doesNotMatch(html, /data-ui="topbar"/, `${path} uses its three-line workspace heading`)
    assert.match(
      html,
      /data-ui="viewer-context-switcher"/,
      `${path} has the company selector in the user menu`,
    )
    assert.doesNotMatch(html, /company_backend\.[A-Za-z]/, path)
  }

  const english = await e2e.client.get('/admin/context?lang=en', { headers: { accept: 'text/html' } })
  assert.equal(english.status, 200)
  assert.match(await english.text(), /Working context/)
})

test('company-branch-e2e: context switch is atomic, actor-bound and same-origin', async (t) => {
  const { e2e } = await bootCompany(t)
  const forbidden = await e2e.client.post('/admin/context', new URLSearchParams(), {
    headers: {
      accept: 'text/html',
      'content-type': 'application/x-www-form-urlencoded',
      origin: 'https://attacker.example',
    },
    redirect: 'manual',
  })
  assert.equal(forbidden.status, 403)

  await e2e.client.form<string>('/admin/context', {
    companyId: 'globex',
    branchId: 'root:globex',
    'company.acme': '1',
    'company.globex': '1',
    'branch.root:acme': '1',
    'branch.acme:north': '1',
    'branch.root:globex': '1',
  })
  const who = await e2e.client.json<{
    company: string
    companies: string[]
    branch: string
    branches: string[]
  }>('/whoami')
  assert.equal(who.company, 'globex')
  assert.equal(who.branch, 'root:globex')
  assert.deepEqual(who.companies.sort(), ['acme', 'globex'])
})

test('company-branch-e2e: membership revoke and archive affect an existing session next request', async (t) => {
  const { e2e, fixture } = await bootCompany(t)
  await e2e.client.form<string>('/admin/context', {
    companyId: 'globex',
    branchId: 'root:globex',
    'company.acme': '1',
    'company.globex': '1',
    'branch.root:acme': '1',
    'branch.acme:north': '1',
    'branch.root:globex': '1',
  })
  await fixture(
    'user.setDefaultContext',
    { userId: 'admin', companyId: 'globex', branchId: 'root:globex' },
    'admin',
  )
  await fixture('user.revokeCompany', { userId: 'admin', companyId: 'acme' }, 'admin')
  const afterRevoke = await e2e.client.json<{ companies: string[]; branches: string[] }>('/whoami')
  assert.deepEqual(afterRevoke.companies, ['globex'])
  assert.deepEqual(afterRevoke.branches, ['root:globex'])

  await fixture('user.archiveUser', { id: 'admin', active: false }, 'admin')
  const archived = await e2e.client.get('/whoami')
  assert.equal(archived.status, 401)
})
