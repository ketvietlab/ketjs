import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bootDeployment, callFn, defineDeployment, defineModule } from '@ketvietlab/ketjs'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

const probe = defineModule({
  name: 'permission_probe',
  functions: {
    read: { output: { ok: 'bool' }, handler: () => ({ ok: true }) },
    count: { output: { ok: 'bool' }, handler: () => ({ ok: true }) },
  },
  permissions: {
    posture: 'permission-bearing',
    owner: 'permission_probe',
    bundles: {
      'permission_probe.view': { labels: { en: 'View', vi: 'Xem' } },
      'permission_probe.tally': { labels: { en: 'Tally', vi: 'Đếm' } },
    },
    functions: {
      'permission_probe.read': {
        risk: 'read',
        bundles: ['permission_probe.view'],
        owner: 'permission_probe',
      },
      'permission_probe.count': {
        risk: 'read',
        bundles: ['permission_probe.tally'],
        owner: 'permission_probe',
      },
    },
    exemptions: {},
  },
})

const deployment = defineDeployment({
  ...ketsuite,
  name: 'multi_role_probe',
  modules: [...ketsuite.modules, probe],
  permissions: {
    roleTemplates: {
      'test.reader': {
        version: 1,
        labels: { en: 'Reader', vi: 'Người đọc' },
        bundles: ['permission_probe.view'],
      },
      'test.tallier': {
        version: 1,
        labels: { en: 'Tallier', vi: 'Người đếm' },
        bundles: ['permission_probe.tally'],
      },
    },
  },
})

const companyScope = (company: string, branch = `root:${company}`) => ({
  company,
  companies: [company],
  branch,
  branches: [branch],
})

test('one user holds two roles and the union says which role gave what', async (t) => {
  const booted = await bootDeployment(deployment, {
    env: { KET_LOG: 'null', KET_SQLITE: ':memory:', KET_SECRET: 'multi-role-probe' },
    port: 0,
    log: () => {},
  })
  t.after(() => booted.close())
  const adapter = booted.adapter!
  const run = <T>(
    fn: string,
    args: Record<string, unknown>,
    scope = companyScope('company-a'),
    actor: string | null = 'root',
  ) => callFn(fn, args, { adapter, manifest: booted.manifest, scope, actor }).then((r) => r.value as T)

  await run('partner.savePartner', { id: 'company-a:partner', kind: 'company', name: 'A' })
  await run('company.saveCompany', {
    id: 'company-a',
    code: 'A',
    partnerId: 'company-a:partner',
    currency: 'VND',
  })
  await run(
    'user.createUser',
    { id: 'root', login: 'root', password: 'correct horse', name: 'Root', superuser: true },
    companyScope('company-a'),
    null,
  )
  await run(
    'user.createUser',
    { id: 'staff', login: 'staff', password: 'correct horse', name: 'Staff' },
    companyScope('company-a'),
    null,
  )
  await run('user.grantCompany', { id: 'membership:a', userId: 'staff', companyId: 'company-a' })

  let rev = (await run<{ revision: number }>('user.authorizationState', {})).revision
  for (const [roleId, templateKey] of [
    ['reader', 'test.reader'],
    ['tallier', 'test.tallier'],
  ] as const) {
    const applied = await run<{ ok: boolean; revision: number }>('user.applyRoleTemplate', {
      roleId,
      templateKey,
      expectedRoleRevision: 0,
      expectedAuthorizationRevision: rev,
      idempotencyKey: `apply-${roleId}`,
      reason: 'probe',
    })
    assert.equal(applied.ok, true, `apply ${roleId}`)
    rev = applied.revision
  }
  for (const roleId of ['reader', 'tallier']) {
    const assigned = await run<{ ok: boolean; revision: number; errors?: unknown }>('user.assignScopedRole', {
      id: `assignment-${roleId}`,
      userId: 'staff',
      roleId,
      scopeKind: 'company',
      companyId: 'company-a',
      expectedAuthorizationRevision: rev,
      idempotencyKey: `assign-${roleId}`,
      reason: 'probe',
    })
    assert.equal(assigned.ok, true, `assign ${roleId}: ${JSON.stringify(assigned.errors)}`)
    rev = assigned.revision
  }

  const access = await run<{ functions: Array<{ key: string; paths: Array<{ roleId: string }> }> }>(
    'user.effectiveAccess',
    { userId: 'staff' },
    companyScope('company-a'),
  )
  // Two roles, and neither one alone answers for both functions. Every earlier
  // test assigned one role at two scopes, which proves scoping and says nothing
  // about the union.
  assert.deepEqual(access.functions.map((permission) => permission.key).sort(), [
    'permission_probe.count',
    'permission_probe.read',
  ])
  // The union records where each permission came from, which is what an audit
  // asks: not whether the person may do it, but on whose authority.
  assert.deepEqual(
    Object.fromEntries(
      access.functions.map((permission) => [permission.key, permission.paths.map((p) => p.roleId)]),
    ),
    { 'permission_probe.read': ['reader'], 'permission_probe.count': ['tallier'] },
  )

  // Taking one role back leaves the other standing.
  const removed = await run<{ ok: boolean; revision: number; errors?: unknown }>('user.unassignScopedRole', {
    userId: 'staff',
    roleId: 'tallier',
    scopeKey: 'company:company-a',
    expectedAuthorizationRevision: rev,
    idempotencyKey: 'unassign-tallier',
    reason: 'one role removed, one kept',
  })
  assert.equal(removed.ok, true, JSON.stringify(removed.errors))
  const after = await run<{ functions: Array<{ key: string }> }>(
    'user.effectiveAccess',
    { userId: 'staff' },
    companyScope('company-a'),
  )
  assert.deepEqual(
    after.functions.map((permission) => permission.key),
    ['permission_probe.read'],
  )
})
