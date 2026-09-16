// Where a person works, settled in one commit.
//
// The older path granted and revoked one workplace per call from a route loop.
// These cover what a single decision has to hold: the whole selection applied
// together, the places they no longer work taken away, and a refusal that leaves
// the person exactly as they were.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bootDeployment, callFn, defineDeployment } from '@ketvietlab/ketjs'
import type { Row } from '@ketvietlab/ketjs'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

const deployment = defineDeployment({ ...ketsuite, name: 'user_workplaces' })

const scope = { company: 'company-a', companies: ['company-a'], branch: null, branches: null }

type Result = { ok: boolean; revision?: number; errors?: Row[]; replayed?: boolean }

const boot = async (t: { after: (fn: () => unknown) => void }) => {
  const booted = await bootDeployment(deployment, {
    env: { KET_LOG: 'null', KET_SQLITE: ':memory:', KET_SECRET: 'user-workplaces' },
    port: 0,
    log: () => {},
  })
  t.after(() => booted.close())
  const adapter = booted.adapter!
  const run = <T>(fn: string, args: Record<string, unknown>, actor: string | null = 'root') =>
    callFn(fn, args, { adapter, manifest: booted.manifest, scope, actor }).then((r) => r.value as T)

  for (const [id, code] of [
    ['company-a', 'A'],
    ['company-b', 'B'],
  ] as const) {
    await run('partner.savePartner', { id: `${id}:partner`, kind: 'company', name: code }, null)
    await run('company.saveCompany', { id, code, partnerId: `${id}:partner`, currency: 'VND' }, null)
  }
  await run(
    'user.createUser',
    { id: 'root', login: 'root', password: 'correct horse', name: 'Root', superuser: true },
    null,
  )
  await run('user.createUser', { id: 'trang', login: 'minhtrang', name: 'Minh Trang' }, null)

  const branches = [
    ...(await run<Row[]>('company.listBranches', { companyId: 'company-a' })),
    ...(await run<Row[]>('company.listBranches', { companyId: 'company-b' })),
  ]
  const rootOf = (companyId: string) =>
    String(branches.find((row) => String(row.companyId) === companyId && row.isRoot === true)?.id ?? '')
  const revisionOf = async () => (await run<{ revision: number }>('user.authorizationState', {})).revision
  const held = async () => {
    const user = await run<Row & { memberships?: Array<{ companyId: string }> }>('user.getUser', {
      id: 'trang',
    })
    return { companies: (user.memberships ?? []).map((row) => String(row.companyId)), user }
  }
  return { run, rootOf, revisionOf, held }
}

test('one commit gives every workplace asked for and takes back the rest', async (t) => {
  const { run, rootOf, revisionOf, held } = await boot(t)

  const first = await run<Result>('user.setWorkplaces', {
    userId: 'trang',
    companyIds: ['company-a', 'company-b'],
    branchIds: [],
    defaultCompanyId: 'company-a',
    defaultBranchId: rootOf('company-a'),
    reason: 'Nhận việc ở hai công ty',
    expectedAuthorizationRevision: await revisionOf(),
    idempotencyKey: 'workplaces-1',
  })
  assert.equal(first.ok, true, JSON.stringify(first.errors ?? first))

  const after = await held()
  assert.deepEqual([...(after.companies ?? [])].sort(), ['company-a', 'company-b'])
  // Holding a company carries its root branch: that is what makes it usable.
  assert.equal(after.user.defaultBranchId, rootOf('company-a'))

  // The second decision replaces the first rather than adding to it.
  const second = await run<Result>('user.setWorkplaces', {
    userId: 'trang',
    companyIds: ['company-b'],
    branchIds: [],
    defaultCompanyId: 'company-b',
    defaultBranchId: rootOf('company-b'),
    reason: 'Chuyển hẳn sang công ty B',
    expectedAuthorizationRevision: await revisionOf(),
    idempotencyKey: 'workplaces-2',
  })
  assert.equal(second.ok, true, JSON.stringify(second.errors ?? second))
  const moved = await held()
  assert.deepEqual(moved.companies, ['company-b'])
  assert.equal(moved.user.defaultCompanyId, 'company-b')
})

test('a refusal changes nothing at all', async (t) => {
  const { run, rootOf, revisionOf, held } = await boot(t)
  await run<Result>('user.setWorkplaces', {
    userId: 'trang',
    companyIds: ['company-a'],
    branchIds: [],
    defaultCompanyId: 'company-a',
    defaultBranchId: rootOf('company-a'),
    reason: 'Nhận việc',
    expectedAuthorizationRevision: await revisionOf(),
    idempotencyKey: 'workplaces-start',
  })
  const before = await held()

  for (const [field, patch] of [
    ['reason', { reason: '  ' }],
    ['companyIds', { companyIds: [] }],
    // Landing somewhere they do not work is the mistake this guards against.
    ['defaultCompanyId', { companyIds: ['company-b'], defaultCompanyId: 'company-a' }],
    ['expectedAuthorizationRevision', { expectedAuthorizationRevision: 999 }],
  ] as const) {
    const refused = await run<Result>('user.setWorkplaces', {
      userId: 'trang',
      companyIds: ['company-b'],
      branchIds: [],
      defaultCompanyId: 'company-b',
      defaultBranchId: rootOf('company-b'),
      reason: 'Thử',
      expectedAuthorizationRevision: await revisionOf(),
      idempotencyKey: `refuse-${field}`,
      ...patch,
    })
    assert.equal(refused.ok, false, `${field} is refused`)
    assert.equal(String(refused.errors?.[0]?.field), field)
  }

  const after = await held()
  assert.deepEqual(after.companies, before.companies)
  assert.equal(after.user.defaultCompanyId, before.user.defaultCompanyId)
})

test('the same decision sent twice is one decision', async (t) => {
  const { run, rootOf, revisionOf } = await boot(t)
  const request = {
    userId: 'trang',
    companyIds: ['company-a'],
    branchIds: [],
    defaultCompanyId: 'company-a',
    defaultBranchId: rootOf('company-a'),
    reason: 'Nhận việc',
    expectedAuthorizationRevision: await revisionOf(),
    idempotencyKey: 'workplaces-retry',
  }
  const first = await run<Result>('user.setWorkplaces', request)
  const again = await run<Result>('user.setWorkplaces', request)

  assert.equal(first.ok, true, JSON.stringify(first.errors ?? first))
  assert.equal(again.ok, true)
  assert.equal(again.replayed, true)
  assert.equal(again.revision, first.revision)
})
