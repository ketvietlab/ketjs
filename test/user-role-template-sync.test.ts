// A KetSuite install is usable from its first start: the job roles it ships are
// in the tenant as managed roles, so the first hire has a role to be given, and a
// role that drifted from its template is brought back instead of granting nothing.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bootDeployment, callFn } from '@ketvietlab/ketjs'
import type { Row } from '@ketvietlab/ketjs'
import { ketsuite } from '../apps/ketsuite/deployment.ts'
import { ketsuiteRoleTemplates } from '../packages/ketsuite/src/role-templates.ts'

const boot = async (t: { after: (fn: () => unknown) => void }) => {
  const booted = await bootDeployment(ketsuite, {
    env: { KET_LOG: 'null', KET_SQLITE: ':memory:', KET_SECRET: 'user-role-template-sync' },
    port: 0,
    log: () => {},
  })
  t.after(() => booted.close())
  const adapter = booted.adapter!
  const call = <T>(fn: string, args: Record<string, unknown>, actor: string | null, scope = {}) =>
    callFn(fn, args, {
      adapter,
      manifest: booted.manifest,
      actor,
      scope: { company: null, branch: null, ...scope },
    }).then((r) => r.value as T)
  return { adapter, call }
}

// The development composition carries every product's roles.
const TEMPLATE_KEYS = Object.values(ketsuiteRoleTemplates)
  .flatMap((templates) => Object.keys(templates))
  .sort()

test('a provisioned tenant starts with every shipped job role, ready to assign', async (t) => {
  const { call } = await boot(t)
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
  // What `ketsuite serve` does before it listens.
  const synced = await call<{ ok: boolean }>('user.syncRoleTemplates', {}, 'system:role-templates')
  assert.equal(synced.ok, true, JSON.stringify(synced))

  const roles = await call<Row[]>('user.listRoles', {}, tenant.userId, {
    company: tenant.companyId,
    branch: tenant.branchId,
  })
  const managed = roles.filter((role) => role.mode === 'managed').map((role) => String(role.templateKey))
  assert.deepEqual(managed.sort(), TEMPLATE_KEYS)

  // The create form offers them, which is the whole point.
  const context = await call<{ data: { roles: Array<{ id: string }> } }>(
    'user.userModalContext',
    // No id is the create form.
    {},
    tenant.userId,
    { company: tenant.companyId, branch: tenant.branchId },
  )
  assert.deepEqual(context.data.roles.map((role) => role.id).sort(), TEMPLATE_KEYS)

  // And a hire with one of them goes through, granting what the template says.
  const revision = (
    await call<{ revision: number }>('user.authorizationState', {}, tenant.userId, {
      company: tenant.companyId,
      branch: tenant.branchId,
    })
  ).revision
  const hired = await call<{ ok: boolean; errors?: unknown }>(
    'user.provisionUser',
    {
      id: 'thu-ngan',
      name: 'Thu Ngân',
      login: 'thungan',
      roleIds: ['commerce.pos-cashier'],
      scopeKind: 'company',
      companyId: tenant.companyId,
      reason: 'Mở quầy',
      expectedAuthorizationRevision: revision,
      idempotencyKey: 'hire-cashier',
    },
    tenant.userId,
    { company: tenant.companyId, branch: tenant.branchId },
  )
  assert.equal(hired.ok, true, JSON.stringify(hired.errors))
})

test('sync writes nothing when roles are current, and restores a role that drifted', async (t) => {
  const { adapter, call } = await boot(t)
  const first = await call<{ ok: boolean; applied: string[] }>('user.syncRoleTemplates', {}, 'system:test')
  assert.deepEqual(first.applied.sort(), TEMPLATE_KEYS)

  const again = await call<{ ok: boolean; applied: string[] }>('user.syncRoleTemplates', {}, 'system:test')
  assert.deepEqual(again, { ok: true, applied: [] }, 'a restart applies nothing')

  // A role left on an old digest grants nothing until re-applied; sync re-applies it.
  const columns = await adapter.all('PRAGMA table_info(user_role)', [])
  const digest = String(columns.find((column) => /digest/i.test(String(column.name)))?.name)
  const drifted = await adapter.run(
    `UPDATE user_role SET "${digest}" = 'old' WHERE id = 'commerce.pos-cashier'`,
    [],
  )
  assert.equal(drifted.changes, 1, `the role drifted (${digest})`)
  const healed = await call<{ ok: boolean; applied: string[] }>('user.syncRoleTemplates', {}, 'system:test')
  assert.deepEqual(healed.applied, ['commerce.pos-cashier'])
})

test('sync never takes over a custom role, and only the system may run it', async (t) => {
  const { adapter, call } = await boot(t)
  await adapter.run(
    "INSERT INTO user_role (id, name, description, mode, revision) VALUES ('office.project-contributor', 'Nhân sự riêng', '', 'custom', 1)",
    [],
  )
  const synced = await call<{ ok: boolean; applied: string[] }>('user.syncRoleTemplates', {}, 'system:test')
  assert.equal(synced.ok, true)
  assert.ok(!synced.applied.includes('office.project-contributor'))
  const [kept] = await adapter.all(
    "SELECT mode, name FROM user_role WHERE id = 'office.project-contributor'",
    [],
  )
  assert.equal(kept?.mode, 'custom')
  assert.equal(kept?.name, 'Nhân sự riêng')

  const refused = await call<{ ok: boolean }>('user.syncRoleTemplates', {}, 'someone')
  assert.equal(refused.ok, false)
})

test('a local role already carrying a template name skips that template, not the rest', async (t) => {
  const { adapter, call } = await boot(t)
  const cashier = 'Thu ngân POS · commerce'
  await adapter.run(
    `INSERT INTO user_role (id, name, description, mode, revision) VALUES ('my-cashier', '${cashier}', '', 'custom', 1)`,
    [],
  )
  const synced = await call<{ ok: boolean; applied: string[]; errors?: Array<{ roleId: string }> }>(
    'user.syncRoleTemplates',
    {},
    'system:test',
  )
  // Serving goes on: every other job is in, and the one that clashed is named.
  assert.equal(synced.ok, true)
  assert.deepEqual(
    synced.errors?.map((entry) => entry.roleId),
    ['commerce.pos-cashier'],
  )
  assert.equal(synced.applied.length, TEMPLATE_KEYS.length - 1)
})
