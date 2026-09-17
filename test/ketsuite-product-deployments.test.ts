// KetSuite's public products are cut the way the private deployments are: each
// one composes, keeps to its own business, and starts with its own job roles.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bootDeployment, callFn } from '@ketvietlab/ketjs'
import type { DeploymentDeclaration, Row } from '@ketvietlab/ketjs'
import {
  commerce,
  DEFAULT_KETSUITE_DEPLOYMENT,
  hospitality,
  ketsuite,
  ketsuiteDeployments,
  office,
} from '../packages/ketsuite/src/deployment.ts'
import { ketsuiteRoleTemplates } from '../packages/ketsuite/src/role-templates.ts'

const moduleNames = (deployment: DeploymentDeclaration): string[] =>
  deployment.modules.map((module) => (typeof module === 'string' ? module : module.name))

const products = [
  ['commerce', commerce, ketsuiteRoleTemplates.commerce],
  ['hospitality', hospitality, ketsuiteRoleTemplates.hospitality],
  ['office', office, ketsuiteRoleTemplates.office],
] as const

test('each product is its own deployment, datastore and set of modules', () => {
  assert.deepEqual(Object.keys(ketsuiteDeployments).sort(), ['commerce', 'dev', 'hospitality', 'office'])
  assert.equal(DEFAULT_KETSUITE_DEPLOYMENT, 'commerce')
  assert.equal(ketsuiteDeployments.dev, ketsuite)
  const stores = products.map(([, deployment]) => deployment.datastore)
  assert.equal(new Set(stores).size, products.length, 'no two products share a datastore')

  // A shop has no hotel in it, a hotel has no counter, and the office has neither.
  assert.ok(moduleNames(commerce).includes('pos'))
  assert.ok(!moduleNames(commerce).includes('hospitality_core'))
  assert.ok(moduleNames(hospitality).includes('hospitality_core'))
  assert.ok(!moduleNames(hospitality).includes('pos'))
  assert.ok(moduleNames(office).includes('flow'))
  assert.ok(!moduleNames(office).some((name) => name === 'pos' || name === 'hospitality_core'))
  // The development deployment keeps every one of them.
  for (const [, deployment] of products)
    for (const name of moduleNames(deployment)) assert.ok(moduleNames(ketsuite).includes(name), name)
})

for (const [name, deployment, templates] of products)
  test(`${name}: composes, and a new tenant starts with its own job roles`, async (t) => {
    const booted = await bootDeployment(deployment, {
      env: { KET_LOG: 'null', KET_SQLITE: ':memory:', KET_SECRET: `product-${name}` },
      port: 0,
      log: () => {},
    })
    t.after(() => booted.close())
    const call = <T>(fn: string, args: Record<string, unknown>, actor: string, scope = {}) =>
      callFn(fn, args, {
        adapter: booted.adapter!,
        manifest: booted.manifest,
        actor,
        scope: { company: null, branch: null, ...scope },
      }).then((r) => r.value as T)

    // Only this product's roles are declared: another product's jobs are not offered here.
    assert.deepEqual(
      Object.keys(booted.manifest.permissions.roleTemplates).sort(),
      Object.keys(templates).sort(),
    )

    const tenant = await call<{ ok: boolean; companyId: string; branchId: string; userId: string }>(
      'user.provisionAdmin',
      {
        companyName: 'An Việt',
        companyCode: 'AV',
        currency: 'VND',
        adminLogin: 'owner',
        adminName: 'Owner',
        adminPassword: 'correct horse battery',
      },
      'system:provision',
    )
    assert.equal(tenant.ok, true)
    const synced = await call<{ ok: boolean; applied: string[] }>(
      'user.syncRoleTemplates',
      {},
      'system:role-templates',
    )
    assert.equal(synced.ok, true, JSON.stringify(synced))

    const context = await call<{ data: { roles: Array<{ id: string }> } }>(
      'user.userModalContext',
      {},
      tenant.userId,
      {
        company: tenant.companyId,
        branch: tenant.branchId,
      },
    )
    assert.deepEqual(context.data.roles.map((role) => role.id).sort(), Object.keys(templates).sort())
    const [roles] = [await call<Row[]>('user.listRoles', {}, tenant.userId, { company: tenant.companyId })]
    assert.ok(roles.every((role) => String(role.templateKey).startsWith(`${name}.`)))
  })
