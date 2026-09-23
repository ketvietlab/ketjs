import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bootDeployment, callFn, defineDeployment, defineModule } from '@ketvietlab/ketjs'
import type { Row } from '@ketvietlab/ketjs'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

const probe = defineModule({
  name: 'permission_probe',
  functions: { read: { output: { ok: 'bool' }, handler: () => ({ ok: true }) } },
  permissions: {
    posture: 'permission-bearing',
    owner: 'permission_probe',
    bundles: { 'permission_probe.view': { labels: { en: 'View', vi: 'Xem' } } },
    functions: {
      'permission_probe.read': {
        risk: 'read',
        bundles: ['permission_probe.view'],
        owner: 'permission_probe',
      },
    },
    exemptions: {},
  },
})

const deployment = defineDeployment({
  ...ketsuite,
  name: 'user_provision_probe',
  modules: [...ketsuite.modules, probe],
  permissions: {
    roleTemplates: {
      'test.reader': {
        version: 1,
        labels: { en: 'Reader', vi: 'Người đọc' },
        bundles: ['permission_probe.view'],
      },
      'test.second': {
        version: 1,
        labels: { en: 'Second', vi: 'Thứ hai' },
        bundles: ['permission_probe.view'],
      },
    },
  },
})

const scope = { company: 'company-a', companies: ['company-a'], branch: null, branches: null }

type Provisioned = { ok: boolean; id?: string; revision?: number; errors?: Row[]; replayed?: boolean }

const boot = async (t: { after: (fn: () => unknown) => void }) => {
  const booted = await bootDeployment(deployment, {
    env: { KET_LOG: 'null', KET_SQLITE: ':memory:', KET_SECRET: 'user-provision-probe' },
    port: 0,
    log: () => {},
  })
  t.after(() => booted.close())
  const adapter = booted.adapter!
  const run = <T>(fn: string, args: Record<string, unknown>, actor: string | null = 'root') =>
    callFn(fn, args, { adapter, manifest: booted.manifest, scope, actor }).then((r) => r.value as T)

  await run('partner.savePartner', { id: 'company-a:partner', kind: 'company', name: 'A' }, null)
  await run(
    'company.saveCompany',
    { id: 'company-a', code: 'A', partnerId: 'company-a:partner', currency: 'VND' },
    null,
  )
  await run(
    'user.createUser',
    { id: 'root', login: 'root', password: 'correct horse', name: 'Root', superuser: true },
    null,
  )
  let revision = (await run<{ revision: number }>('user.authorizationState', {})).revision
  for (const [roleId, templateKey] of [
    ['reader', 'test.reader'],
    ['second', 'test.second'],
  ] as const) {
    const applied = await run<{ ok: boolean; revision: number }>('user.applyRoleTemplate', {
      roleId,
      templateKey,
      expectedRoleRevision: 0,
      expectedAuthorizationRevision: revision,
      idempotencyKey: `apply-${roleId}`,
      reason: 'probe',
    })
    revision = applied.revision
  }
  const revisionOf = async () => (await run<{ revision: number }>('user.authorizationState', {})).revision
  return { run, revisionOf }
}

const provision = (revision: number, overrides: Record<string, unknown> = {}) => ({
  id: 'minh-trang',
  name: 'Minh Trang',
  login: 'minhtrang',
  email: 'trang@example.test',
  roleIds: ['reader', 'second'],
  scopeKind: 'company',
  companyId: 'company-a',
  reason: 'Nhân viên chăm sóc khách hàng mới',
  expectedAuthorizationRevision: revision,
  idempotencyKey: 'provision-minh-trang',
  ...overrides,
})

test('provisioning hires a person: the account, the workplace and every role in one commit', async (t) => {
  const { run, revisionOf } = await boot(t)
  const result = await run<Provisioned>('user.provisionUser', provision(await revisionOf()))

  assert.equal(result.ok, true, JSON.stringify(result.errors ?? result))
  assert.equal(result.id, 'minh-trang')

  const [person] = await run<Row[]>('user.listUsers', { search: 'minhtrang' })
  assert.equal(person?.login, 'minhtrang')
  const access = await run<{ functions: Array<{ key: string }> }>('user.effectiveAccess', {
    userId: 'minh-trang',
  })
  assert.ok(access.functions.some((fn) => fn.key === 'permission_probe.read'))

  // Both roles landed, and the membership their scope needs came with them.
  const audit = await run<Row[]>('user.listAuthorizationAudit', { targetId: 'minh-trang' })
  const entry = audit.find((row) => String(row.event) === 'authorization.assignment.created')
  assert.ok(entry, 'the new authority is written down')
  assert.equal(String(entry.reason), 'Nhân viên chăm sóc khách hàng mới')
  assert.deepEqual((entry.metadata as { roleIds?: string[] })?.roleIds, ['reader', 'second'])
})

test('provisioning without a role creates a person who works somewhere and may do nothing', async (t) => {
  const { run, revisionOf } = await boot(t)
  const result = await run<Provisioned>('user.provisionUser', provision(await revisionOf(), { roleIds: [] }))
  assert.equal(result.ok, true, JSON.stringify(result.errors ?? result))

  const [person] = await run<Row[]>('user.listUsers', { search: 'minhtrang' })
  assert.equal(person?.login, 'minhtrang')
  // The workplace is theirs, so a role can be given there later without adding one.
  const context = await run<{ data: { memberships: { companies: string[] } } }>('user.userModalContext', {
    id: 'minh-trang',
  })
  assert.deepEqual(context.data.memberships.companies, ['company-a'])
  // No role is no function: nothing was granted on the way in.
  const access = await run<{ functions: Array<{ key: string }> }>('user.effectiveAccess', {
    userId: 'minh-trang',
  })
  assert.deepEqual(access.functions, [])
  // The hire is still written down, as what it was.
  const audit = await run<Row[]>('user.listAuthorizationAudit', { targetId: 'minh-trang' })
  assert.ok(audit.some((row) => String(row.event) === 'authorization.user.created'))
  assert.ok(!audit.some((row) => String(row.event) === 'authorization.assignment.created'))
})

test('provisioning refuses without a reason, with a role it may not give, or against a stale revision', async (t) => {
  const { run, revisionOf } = await boot(t)
  const revision = await revisionOf()

  for (const [field, overrides] of [
    ['reason', { reason: '   ' }],
    ['roleIds', { roleIds: ['no-such-role'] }],
    ['expectedAuthorizationRevision', { expectedAuthorizationRevision: revision + 5 }],
  ] as const) {
    const refused = await run<Provisioned>(
      'user.provisionUser',
      provision(revision, { ...overrides, idempotencyKey: `refuse-${field}` }),
    )
    assert.equal(refused.ok, false, `${field} is refused`)
    assert.equal(String(refused.errors?.[0]?.field), field)
  }

  // Nothing half-made survives a refusal.
  assert.deepEqual(await run<Row[]>('user.listUsers', { search: 'minhtrang' }), [])
})

test('provisioning the same request twice creates one person', async (t) => {
  const { run, revisionOf } = await boot(t)
  // A retry is the same request sent again: same id, same roles, same revision.
  const request = provision(await revisionOf())
  const first = await run<Provisioned>('user.provisionUser', request)
  const again = await run<Provisioned>('user.provisionUser', request)

  assert.equal(first.ok, true)
  assert.equal(again.ok, true)
  assert.equal(again.replayed, true)
  assert.equal((await run<Row[]>('user.listUsers', { search: 'minhtrang' })).length, 1)
})
