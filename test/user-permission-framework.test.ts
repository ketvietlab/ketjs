import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  bootDeployment,
  callFn,
  compose,
  defineDeployment,
  defineModule,
  migrateOne,
  registerFunctions,
  sqliteAdapter,
} from '@ketvietlab/ketjs'
import type { ModelDef } from '@ketvietlab/ketjs'
import { address, company, partner, user } from '@ketvietlab/ketsuite'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

const bulkActions = Array.from({ length: 64 }, (_, index) => `bulk${index}`)

const probe = defineModule({
  name: 'permission_probe',
  functions: {
    read: { output: { ok: 'bool' }, handler: () => ({ ok: true }) },
    approve: { output: { ok: 'bool' }, handler: () => ({ ok: true }) },
    ...Object.fromEntries(
      bulkActions.map((action) => [action, { output: { ok: 'bool' }, handler: () => ({ ok: true }) }]),
    ),
  },
  permissions: {
    posture: 'permission-bearing',
    owner: 'permission_probe',
    bundles: {
      'permission_probe.view': {
        labels: { en: 'View probe', vi: 'Xem kiểm thử' },
      },
      'permission_probe.approve': {
        labels: { en: 'Approve probe', vi: 'Duyệt kiểm thử' },
        includes: ['permission_probe.view'],
      },
      'permission_probe.bulk-read': {
        labels: { en: 'Bulk read probes', vi: 'Xem nhiều kiểm thử' },
      },
    },
    functions: {
      'permission_probe.read': {
        risk: 'read',
        bundles: ['permission_probe.view'],
        owner: 'permission_probe',
      },
      'permission_probe.approve': {
        risk: 'approve',
        bundles: ['permission_probe.approve'],
        owner: 'permission_probe',
        policy: 'permission-probe.approval',
      },
      ...Object.fromEntries(
        bulkActions.map((action) => [
          `permission_probe.${action}`,
          {
            risk: 'read' as const,
            bundles: ['permission_probe.bulk-read'],
            owner: 'permission_probe',
          },
        ]),
      ),
    },
    exemptions: {},
  },
})

const deployment = defineDeployment({
  ...ketsuite,
  name: 'user_permission_framework',
  modules: [...ketsuite.modules, probe],
  permissions: {
    roleTemplates: {
      'test.probe-operator': {
        version: 1,
        labels: { en: 'Probe operator', vi: 'Nhân viên kiểm thử' },
        bundles: ['permission_probe.view'],
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

const withoutFields = (model: ModelDef, fields: readonly string[]): ModelDef => ({
  ...model,
  fields: Object.fromEntries(Object.entries(model.fields).filter(([key]) => !fields.includes(key))),
})

test('authorization schema preserves legacy rows through the explicit scope-index transition', async (t) => {
  const legacyModels = Object.fromEntries(
    Object.entries(user.models)
      .filter(([key]) => !['GrantSource', 'AuthorizationRevision', 'AuthorizationOperation'].includes(key))
      .map(([key, model]) => {
        if (key === 'User')
          return [key, withoutFields(model, ['superuserOwner', 'superuserReason', 'superuserExpiresAt'])]
        if (key === 'Role')
          return [
            key,
            withoutFields(model, ['mode', 'templateKey', 'templateVersion', 'templateDigest', 'revision']),
          ]
        if (key === 'Assignment')
          return [
            key,
            {
              ...withoutFields(model, ['scopeKind', 'companyId', 'branchId', 'scopeKey']),
              indexes: {
                user_role: { fields: ['userId', 'roleId'], unique: true },
              },
            },
          ]
        if (key === 'SecurityAudit')
          return [
            key,
            withoutFields(model, [
              'actorKey',
              'targetKind',
              'targetId',
              'scopeKey',
              'source',
              'reason',
              'beforeDigest',
              'afterDigest',
              'authorizationRevision',
              'outcome',
            ]),
          ]
        return [key, model]
      }),
  )
  const legacyUser = defineModule({
    name: 'user',
    version: '0.0.legacy',
    depends: ['partner', 'company'],
    models: legacyModels,
  })
  const legacyManifest = compose([address, partner, company, legacyUser])
  const currentModules = [address, partner, company, user]
  const currentManifest = compose(currentModules)
  const adapter = sqliteAdapter()
  await adapter.open()
  t.after(() => adapter.close())
  await migrateOne(adapter, legacyManifest)
  await adapter.run(
    'INSERT INTO user_user (id, login, name, "accessKind", "securityVersion", superuser, active) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ['legacy-user', 'legacy', 'Legacy User', 'internal', 0, false, true],
  )
  await adapter.run('INSERT INTO user_role (id, name) VALUES (?, ?)', ['legacy-role', 'Legacy Role'])
  await adapter.run('INSERT INTO user_grant (id, "roleId", "fnKey") VALUES (?, ?, ?)', [
    'legacy-grant',
    'legacy-role',
    'partner.listPartners',
  ])
  await adapter.run('INSERT INTO user_assignment (id, "userId", "roleId") VALUES (?, ?, ?)', [
    'legacy-assignment',
    'legacy-user',
    'legacy-role',
  ])

  await migrateOne(adapter, currentManifest, { allowDestructive: true })
  registerFunctions(currentModules)
  const role = (await adapter.all('SELECT mode, revision FROM user_role WHERE id = ?', ['legacy-role']))[0]
  const assignment = (
    await adapter.all('SELECT "scopeKey" FROM user_assignment WHERE id = ?', ['legacy-assignment'])
  )[0]
  assert.equal(role?.mode, null)
  assert.equal(role?.revision, null)
  assert.equal(assignment?.scopeKey, null)

  const revoked = await callFn(
    'user.revokeFunction',
    { roleId: 'legacy-role', fnKey: 'partner.listPartners' },
    {
      adapter,
      manifest: currentManifest,
      scope: companyScope('company-a'),
      actor: null,
    },
  )
  assert.equal((revoked.value as { removed: number }).removed, 1)
  const unassigned = await callFn(
    'user.unassignRole',
    { userId: 'legacy-user', roleId: 'legacy-role' },
    {
      adapter,
      manifest: currentManifest,
      scope: companyScope('company-a'),
      actor: null,
    },
  )
  assert.equal((unassigned.value as { removed: number }).removed, 1)
})

test('managed roles and scoped assignments resolve live, audited, and fail closed', async (t) => {
  const booted = await bootDeployment(deployment, {
    env: { KET_LOG: 'null', KET_SQLITE: ':memory:', KET_SECRET: 'permission-framework-test' },
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
  ) =>
    callFn(fn, args, {
      adapter,
      manifest: booted.manifest,
      scope,
      actor,
    }).then((result) => result.value as T)

  for (const [company, code] of [
    ['company-a', 'A'],
    ['company-b', 'B'],
  ] as const) {
    const partner = await run<{ ok: boolean; errors?: unknown }>('partner.savePartner', {
      id: `${company}:partner`,
      kind: 'company',
      name: company,
    })
    assert.equal(partner.ok, true, JSON.stringify(partner.errors))
    const savedCompany = await run<{ ok: boolean; errors?: unknown }>('company.saveCompany', {
      id: company,
      code,
      partnerId: `${company}:partner`,
      currency: 'VND',
    })
    assert.equal(savedCompany.ok, true, JSON.stringify(savedCompany.errors))
  }
  const root = await run<{ ok: boolean; errors?: unknown }>(
    'user.createUser',
    {
      id: 'root',
      login: 'root',
      password: 'correct horse',
      name: 'Root',
      superuser: true,
    },
    companyScope('company-a'),
    null,
  )
  assert.equal(root.ok, true, JSON.stringify(root.errors))
  const operator = await run<{ ok: boolean; errors?: unknown }>(
    'user.createUser',
    {
      id: 'operator',
      login: 'operator',
      password: 'correct horse',
      name: 'Operator',
    },
    companyScope('company-a'),
    null,
  )
  assert.equal(operator.ok, true, JSON.stringify(operator.errors))
  for (const company of ['company-a', 'company-b'])
    assert.equal(
      (
        await run<{ ok: boolean; errors?: unknown }>('user.grantCompany', {
          id: `membership:${company}`,
          userId: 'operator',
          companyId: company,
        })
      ).ok,
      true,
    )
  const baseRevision = (await run<{ revision: number }>('user.authorizationState', {})).revision
  assert.equal(baseRevision, 2)

  const applied = await run<{
    ok: boolean
    revision: number
    diff: { added: string[]; highRiskAdded: string[] }
  }>('user.applyRoleTemplate', {
    roleId: 'probe-operator',
    templateKey: 'test.probe-operator',
    expectedRoleRevision: 0,
    expectedAuthorizationRevision: baseRevision,
    idempotencyKey: 'apply-probe-v1',
    reason: 'test managed template',
  })
  assert.equal(applied.ok, true)
  assert.equal(applied.revision, baseRevision + 1)
  assert.deepEqual(applied.diff.added, ['permission_probe.read'])
  assert.deepEqual(applied.diff.highRiskAdded, [])

  await adapter.run('DELETE FROM user_grant_source WHERE "roleId" = ? AND "sourceKind" = ?', [
    'probe-operator',
    'managed-template',
  ])
  const repaired = await run<{
    ok: boolean
    revision: number
    diff: { added: string[]; managedAdded: string[] }
  }>('user.applyRoleTemplate', {
    roleId: 'probe-operator',
    templateKey: 'test.probe-operator',
    expectedRoleRevision: 1,
    expectedAuthorizationRevision: baseRevision + 1,
    idempotencyKey: 'repair-probe-v1',
    reason: 'repair missing managed provenance',
  })
  assert.equal(repaired.ok, true)
  assert.equal(repaired.revision, baseRevision + 2)
  assert.deepEqual(repaired.diff.added, [])
  assert.deepEqual(repaired.diff.managedAdded, ['permission_probe.read'])

  const noOp = await run<{ ok: boolean; revision: number }>('user.applyRoleTemplate', {
    roleId: 'probe-operator',
    templateKey: 'test.probe-operator',
    expectedRoleRevision: 2,
    expectedAuthorizationRevision: baseRevision + 2,
    idempotencyKey: 'no-op-probe-v1',
    reason: 'verify exact template replay',
  })
  assert.equal(noOp.ok, true)
  assert.equal(noOp.revision, baseRevision + 2)
  const cloned = await run<{ ok: boolean; revision: number }>('user.cloneManagedRole', {
    id: 'probe-operator-custom',
    sourceRoleId: 'probe-operator',
    name: 'Custom probe operator',
    expectedAuthorizationRevision: baseRevision + 2,
    idempotencyKey: 'clone-probe-operator',
    reason: 'verify explicit customization path',
  })
  assert.equal(cloned.ok, true)
  assert.equal(cloned.revision, baseRevision + 3)
  const customRole = await run<{
    mode: string
    templateKey: string | null
    grantSources: Array<{ sourceKind: string }>
  }>('user.getRole', { id: 'probe-operator-custom' })
  assert.equal(customRole.mode, 'custom')
  assert.equal(customRole.templateKey, null)
  assert.deepEqual(
    customRole.grantSources.map((source) => source.sourceKind),
    ['custom'],
  )

  const stale = await run<{ ok: boolean; errors: Array<{ code: string }> }>('user.assignScopedRole', {
    id: 'assignment-a',
    userId: 'operator',
    roleId: 'probe-operator',
    scopeKind: 'company',
    companyId: 'company-a',
    expectedAuthorizationRevision: 0,
    idempotencyKey: 'assign-company-a',
    reason: 'test company scope',
  })
  assert.equal(stale.ok, false)
  assert.equal(stale.errors[0]?.code, 'E_AUTHORIZATION_REVISION_CONFLICT')

  const assigned = await run<{
    ok: boolean
    revision: number
    scopeKey: string
  }>('user.assignScopedRole', {
    id: 'assignment-a',
    userId: 'operator',
    roleId: 'probe-operator',
    scopeKind: 'company',
    companyId: 'company-a',
    expectedAuthorizationRevision: baseRevision + 3,
    idempotencyKey: 'assign-company-a',
    reason: 'test company scope',
  })
  assert.equal(assigned.ok, true)
  assert.equal(assigned.scopeKey, 'company:company-a')
  assert.equal(assigned.revision, baseRevision + 4)

  const replayed = await run<{
    ok: boolean
    revision: number
    replayed: boolean
  }>('user.assignScopedRole', {
    id: 'assignment-a',
    userId: 'operator',
    roleId: 'probe-operator',
    scopeKind: 'company',
    companyId: 'company-a',
    expectedAuthorizationRevision: baseRevision + 3,
    idempotencyKey: 'assign-company-a',
    reason: 'test company scope',
  })
  assert.equal(replayed.replayed, true)
  assert.equal(replayed.revision, baseRevision + 4)

  await adapter.run('INSERT INTO user_grant (id, "roleId", "fnKey") VALUES (?, ?, ?)', [
    'forged-managed-grant',
    'probe-operator',
    'permission_probe.approve',
  ])
  const rejectedManagedUnion = await run<{
    functions: unknown[]
    issues: Array<{ code: string; roleId?: string }>
  }>('user.effectiveAccess', { userId: 'operator' }, companyScope('company-a'))
  assert.deepEqual(rejectedManagedUnion.functions, [])
  assert.deepEqual(rejectedManagedUnion.issues, [
    { code: 'stale-managed-provenance', roleId: 'probe-operator' },
  ])
  const unhealthyRoles = await run<Array<{ id: string; healthIssues: string[] }>>('user.listRoles', {})
  assert.deepEqual(unhealthyRoles.find((role) => role.id === 'probe-operator')?.healthIssues, [
    'stale-managed-provenance',
  ])
  const reconciled = await run<{ ok: boolean; revision: number }>('user.applyRoleTemplate', {
    roleId: 'probe-operator',
    templateKey: 'test.probe-operator',
    expectedRoleRevision: 2,
    expectedAuthorizationRevision: baseRevision + 4,
    idempotencyKey: 'reconcile-probe-v1',
    reason: 'remove a grant without provenance',
  })
  assert.equal(reconciled.ok, true)
  assert.equal(reconciled.revision, baseRevision + 5)
  assert.equal(
    (await adapter.all('SELECT id FROM user_grant WHERE id = ?', ['forged-managed-grant'])).length,
    0,
  )

  const inA = await run<{
    functions: Array<{ key: string; paths: Array<{ scopeKey: string }> }>
  }>('user.effectiveAccess', { userId: 'operator' }, companyScope('company-a'))
  assert.deepEqual(
    inA.functions.map((permission) => permission.key),
    ['permission_probe.read'],
  )
  assert.equal(inA.functions[0]?.paths[0]?.scopeKey, 'company:company-a')

  const inB = await run<{ functions: unknown[] }>(
    'user.effectiveAccess',
    { userId: 'operator' },
    companyScope('company-b'),
  )
  assert.deepEqual(inB.functions, [])

  const removed = await run<{ ok: boolean; revision: number }>('user.unassignScopedRole', {
    userId: 'operator',
    roleId: 'probe-operator',
    scopeKey: 'company:company-a',
    expectedAuthorizationRevision: baseRevision + 5,
    idempotencyKey: 'unassign-company-a',
    reason: 'test revoke next request',
  })
  assert.equal(removed.ok, true)
  assert.equal(removed.revision, baseRevision + 6)
  const after = await run<{ functions: unknown[] }>('user.effectiveAccess', {
    userId: 'operator',
  })
  assert.deepEqual(after.functions, [])

  const invalidBreakGlass = await run<{
    ok: boolean
    errors: Array<{ code: string }>
  }>('user.setBreakGlass', {
    userId: 'operator',
    enabled: true,
    expectedAuthorizationRevision: baseRevision + 6,
    idempotencyKey: 'invalid-break-glass',
    reason: 'expiry is required',
  })
  assert.equal(invalidBreakGlass.ok, false)
  assert.equal(invalidBreakGlass.errors[0]?.code, 'E_BREAK_GLASS_EXPIRY_REQUIRED')
  const expiresAt = new Date(Date.now() + 60 * 60_000).toISOString()
  const activated = await run<{ ok: boolean; revision: number }>('user.setBreakGlass', {
    userId: 'operator',
    enabled: true,
    expiresAt,
    expectedAuthorizationRevision: baseRevision + 6,
    idempotencyKey: 'activate-break-glass',
    reason: 'test emergency access',
  })
  assert.equal(activated.ok, true)
  assert.equal(activated.revision, baseRevision + 7)
  assert.equal(
    (
      await run<{ superuser: boolean }>('user.effectiveAccess', {
        userId: 'operator',
      })
    ).superuser,
    true,
  )
  await adapter.run('UPDATE user_user SET "superuserExpiresAt" = ? WHERE id = ?', [
    new Date(Date.now() - 60_000).toISOString(),
    'operator',
  ])
  assert.equal(
    (
      await run<{ superuser: boolean }>('user.effectiveAccess', {
        userId: 'operator',
      })
    ).superuser,
    false,
  )
  const revoked = await run<{ ok: boolean; revision: number }>('user.setBreakGlass', {
    userId: 'operator',
    enabled: false,
    expectedAuthorizationRevision: baseRevision + 7,
    idempotencyKey: 'revoke-break-glass',
    reason: 'test emergency access complete',
  })
  assert.equal(revoked.ok, true)
  assert.equal(revoked.revision, baseRevision + 8)

  await adapter.run('INSERT INTO user_role (id, name, mode, revision) VALUES (?, ?, ?, ?)', [
    'bulk-reader',
    'Bulk reader',
    'custom',
    1,
  ])
  await adapter.run(
    'INSERT INTO user_assignment (id, "userId", "roleId", "scopeKind", "scopeKey") VALUES (?, ?, ?, ?, ?)',
    ['bulk-assignment', 'operator', 'bulk-reader', 'tenant', 'tenant'],
  )
  for (const action of bulkActions) {
    const fnKey = `permission_probe.${action}`
    await adapter.run('INSERT INTO user_grant (id, "roleId", "fnKey") VALUES (?, ?, ?)', [
      `bulk-reader:${action}`,
      'bulk-reader',
      fnKey,
    ])
    await adapter.run(
      'INSERT INTO user_grant_source (id, "roleId", "fnKey", "sourceKind", "sourceKey") VALUES (?, ?, ?, ?, ?)',
      [`bulk-reader:${action}`, 'bulk-reader', fnKey, 'custom', 'performance-fixture'],
    )
  }
  const countedAdapter = adapter as typeof adapter & {
    all: typeof adapter.all
  }
  const originalAll = countedAdapter.all.bind(adapter)
  let queryCount = 0
  countedAdapter.all = (...args: Parameters<typeof adapter.all>) => {
    queryCount += 1
    return originalAll(...args)
  }
  try {
    const bulkAccess = await run<{ functions: unknown[] }>('user.effectiveAccess', { userId: 'operator' })
    assert.equal(bulkAccess.functions.length, bulkActions.length)
    assert.ok(queryCount <= 10, `effective resolver executed ${queryCount} queries`)
  } finally {
    countedAdapter.all = originalAll
  }

  const audits = await run<Array<Record<string, unknown>>>('user.listAuthorizationAudit', {
    limit: 20,
  })
  assert.deepEqual(
    audits.map((event) => event.event),
    [
      'authorization.scope.company-granted',
      'authorization.scope.company-granted',
      'authorization.role-template.applied',
      'authorization.role-template.applied',
      'authorization.role.cloned',
      'authorization.assignment.created',
      'authorization.role-template.applied',
      'authorization.assignment.removed',
      'authorization.break-glass.activated',
      'authorization.break-glass.revoked',
    ],
  )
  assert.ok(audits.every((event) => event.beforeDigest && event.afterDigest && !('metadata' in event)))
  assert.ok(audits.every((event) => event.actorKey === 'root'))
})
