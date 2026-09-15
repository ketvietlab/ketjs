import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

// A CRM or care manager configures CRM without the sensitive user bundle. The
// screen used to call `user.listUsers` unconditionally and answered them 403.
test('crm configuration: renders for a manager who may not list users', async (t) => {
  const app = await createTestDeployment(ketsuite)
  t.after(() => app.close())
  const scope = { company: 'acme', branches: null }
  const fixture = (name: string, input: Record<string, unknown>) =>
    app.fixture.call<Row>(name, input, { scope })
  await fixture('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'ACME' })
  await fixture('partner.savePartner', { id: 'admin-party', kind: 'person', name: 'Administrator' })
  await fixture('partner.savePartner', { id: 'manager-party', kind: 'person', name: 'Care Manager' })
  await fixture('company.saveCompany', { id: 'acme', code: 'ACME', partnerId: 'acme-party', currency: 'VND' })
  for (const [id, login, password, name, partnerId, superuser] of [
    ['admin', 'admin', 'correct horse', 'Administrator', 'admin-party', true],
    ['manager', 'manager', 'manager password', 'Care Manager', 'manager-party', false],
  ] as const) {
    await fixture('user.createUser', {
      id,
      login,
      password,
      name,
      partnerId,
      defaultCompanyId: 'acme',
      superuser,
    })
    await fixture('user.grantCompany', { id: `${id}:acme`, userId: id, companyId: 'acme' })
  }
  await fixture('user.saveRole', { id: 'crm-configurator', name: 'CRM configurator' })
  for (const [index, fnKey] of ['crm.configuration.get', 'crm.tag.list', 'crm.team.member.list'].entries())
    await fixture('user.grantFunction', {
      id: `crm-configurator-${index}`,
      roleId: 'crm-configurator',
      fnKey,
    })
  await fixture('user.assignRole', {
    id: 'manager:crm-configurator',
    userId: 'manager',
    roleId: 'crm-configurator',
  })

  await app.client.login({ login: 'admin', password: 'correct horse' })
  const call = async <T = Row>(name: string, input: Record<string, unknown> = {}) =>
    (await app.client.call<T>(name, input)).value
  await call('crm.bootstrap.defaults', { idempotencyKey: 'crm-defaults' })
  await call('crm.team.member.save', {
    id: 'member-manager',
    teamId: 'crm-team-sales',
    userId: 'manager',
    idempotencyKey: 'member-manager-0001',
  })
  await app.client.logout()

  await app.client.login({ login: 'manager', password: 'manager password' })
  const page = await app.client.get('/admin/crm/configuration?tab=teams&lang=en')
  const html = await page.text()
  assert.equal(page.status, 200, html.slice(0, 400))
  // The people pickers fall back to CRM team members the manager can see.
  assert.match(html, /Care Manager/)
  assert.doesNotMatch(html, /Administrator<\/option>/)
})
