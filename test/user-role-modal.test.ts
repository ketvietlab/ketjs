// The role record modal's read, and the one write that edits a custom role.
//
// A managed role and a custom role are the same record read two ways: one is this
// deployment's own policy and is copied, the other is a local decision and is
// edited. These cover that split, and that the areas form is the whole answer.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bootDeployment, callFn, defineDeployment, defineModule } from '@ketvietlab/ketjs'
import type { Row } from '@ketvietlab/ketjs'
import { ketsuite } from '../apps/ketsuite/deployment.ts'
import { capabilityTone, permissionArea } from '../packages/ketsuite/src/modules/user/permission-areas.ts'
import { ketsuitePermissionModules } from '../packages/ketsuite/src/permission-catalogue.ts'

const probe = defineModule({
  name: 'permission_probe',
  functions: {
    read: { output: { ok: 'bool' }, handler: () => ({ ok: true }) },
    write: { effects: [], output: { ok: 'bool' }, handler: () => ({ ok: true }) },
  },
  permissions: {
    posture: 'permission-bearing',
    owner: 'permission_probe',
    bundles: {
      'permission_probe.view': { labels: { en: 'View', vi: 'Xem' } },
      'permission_probe.work': { labels: { en: 'Work', vi: 'Làm' } },
    },
    functions: {
      'permission_probe.read': {
        risk: 'read',
        bundles: ['permission_probe.view'],
        owner: 'permission_probe',
      },
      'permission_probe.write': {
        risk: 'operate',
        bundles: ['permission_probe.work'],
        owner: 'permission_probe',
      },
    },
    exemptions: {},
  },
})

const deployment = defineDeployment({
  ...ketsuite,
  name: 'user_role_modal',
  modules: [...ketsuite.modules, probe],
  permissions: {
    roleTemplates: {
      'test.reader': {
        version: 1,
        labels: { en: 'Reader', vi: 'Người đọc' },
        bundles: ['permission_probe.view'],
      },
    },
  },
})

const scope = { company: 'company-a', companies: ['company-a'], branch: null, branches: null }

type RoleContext = {
  data: {
    record: { id: string; name: string; mode: string; templateVersion: number | null; healthy: boolean }
    sources: Array<{ fnKey: string; sourceKind: string; sourceVersion: number | null }>
    bundles: Array<{ key: string; label: string; module: string; held: boolean; covered: number }>
    holders: Array<{ id: string; name: string }>
    revision: number
    permissions: Record<string, boolean>
  }
  messages: Record<string, string>
} | null

const boot = async (t: { after: (fn: () => unknown) => void }) => {
  const booted = await bootDeployment(deployment, {
    env: { KET_LOG: 'null', KET_SQLITE: ':memory:', KET_SECRET: 'user-role-modal' },
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
  const revision = (await run<{ revision: number }>('user.authorizationState', {})).revision
  await run('user.applyRoleTemplate', {
    roleId: 'reader',
    templateKey: 'test.reader',
    expectedRoleRevision: 0,
    expectedAuthorizationRevision: revision,
    idempotencyKey: 'apply-reader',
    reason: 'probe',
  })
  await run('user.saveRole', { id: 'local', name: 'Vai trò tùy chỉnh' })
  const revisionOf = async () => (await run<{ revision: number }>('user.authorizationState', {})).revision
  return { run, revisionOf }
}

test('a managed role is read with where its authority came from', async (t) => {
  const { run } = await boot(t)
  const context = await run<RoleContext>('user.roleModalContext', { id: 'reader' })

  assert.ok(context)
  assert.equal(context.data.record.mode, 'managed')
  assert.equal(context.data.record.templateVersion, 1)
  assert.equal(context.data.record.healthy, true)
  // Every grant names the template that put it there, so nobody reads it as a hand-grant.
  assert.ok(context.data.sources.length > 0)
  for (const source of context.data.sources) assert.notEqual(source.sourceKind, 'legacy-direct')
  // A managed role offers no areas form: it is copied, not edited.
  assert.deepEqual(context.data.bundles, [])
})

test('a custom role is read as the areas it may hold', async (t) => {
  const { run } = await boot(t)
  const context = await run<RoleContext>('user.roleModalContext', { id: 'local' })

  assert.ok(context)
  assert.equal(context.data.record.mode, 'custom')
  assert.deepEqual(context.data.sources, [])
  const probeBundles = context.data.bundles.filter((row) => row.module === 'permission_probe')
  // Ordered by the words a reader sees, not by key: 'Làm' comes before 'Xem'.
  assert.deepEqual(
    probeBundles.map((row) => [row.label, row.key, row.held]),
    [
      ['Làm', 'permission_probe.work', false],
      ['Xem', 'permission_probe.view', false],
    ],
  )
})

test('the areas form reads as named business groups, one short label per checkbox', async (t) => {
  const { run } = await boot(t)
  const context = await run<RoleContext>('user.roleModalContext', { id: 'local' })
  assert.ok(context)
  type Laid = { key: string; short: string; area: string; group: string; tone: string | null }
  const rows = context.data.bundles as unknown as Laid[]

  // A module nobody has named still shows, under "Khác" with its code tidied, so a
  // new module is never silently ungrantable.
  const view = rows.find((row) => row.key === 'permission_probe.view')
  assert.deepEqual(view && [view.area, view.group, view.short, view.tone], [
    'permission probe',
    'other',
    'Xem',
    null,
  ])
  const groups = (context.data as unknown as { groups: Array<{ id: string; label: string }> }).groups
  assert.equal(groups.at(-1)?.label, 'Khác')
})

test('a catalogued module is named, grouped and marked without its code', () => {
  assert.deepEqual(permissionArea('pos', 'vi'), { group: 'store', label: 'POS' })
  assert.deepEqual(permissionArea('account_staff_channel', 'vi'), {
    group: 'finance',
    label: 'Kế toán · Ứng dụng nhân viên',
  })
  assert.equal(capabilityTone('configure'), 'admin')
  assert.equal(capabilityTone('security'), 'admin')
  assert.equal(capabilityTone('sensitive'), 'sensitive')
  assert.equal(capabilityTone('cash-control'), 'sensitive')
  assert.equal(capabilityTone('tender'), null)
  // Every module the shipped catalogue gives bundles to has a name, so none falls into "Khác".
  const unnamed = Object.entries(ketsuitePermissionModules)
    .filter(([, def]) => Object.keys(def.bundles ?? {}).length)
    .map(([module]) => module)
    .filter((module) => permissionArea(module, 'vi').group === 'other')
  assert.deepEqual(unnamed, [])
})

test('the areas form is the whole answer: what is dropped goes with its grants', async (t) => {
  const { run, revisionOf } = await boot(t)

  const given = await run<{ ok: boolean; errors?: Row[] }>('user.setRoleBundles', {
    roleId: 'local',
    bundleKeys: ['permission_probe.view', 'permission_probe.work'],
    reason: 'Tổ hỗ trợ cần cả hai',
    expectedAuthorizationRevision: await revisionOf(),
    idempotencyKey: 'bundles-1',
  })
  assert.equal(given.ok, true, JSON.stringify(given.errors ?? given))

  const both = await run<RoleContext>('user.roleModalContext', { id: 'local' })
  assert.deepEqual(
    both!.data.bundles
      .filter((row) => row.held)
      .map((row) => row.key)
      .sort(),
    ['permission_probe.view', 'permission_probe.work'],
  )

  // Sending one area back means the other is gone, not that nothing changed.
  const narrowed = await run<{ ok: boolean; errors?: Row[] }>('user.setRoleBundles', {
    roleId: 'local',
    bundleKeys: ['permission_probe.view'],
    reason: 'Bỏ phần nghiệp vụ',
    expectedAuthorizationRevision: await revisionOf(),
    idempotencyKey: 'bundles-2',
  })
  assert.equal(narrowed.ok, true, JSON.stringify(narrowed.errors ?? narrowed))
  const after = await run<RoleContext>('user.roleModalContext', { id: 'local' })
  assert.deepEqual(
    after!.data.bundles.filter((row) => row.held).map((row) => row.key),
    ['permission_probe.view'],
  )
})

test('a managed role refuses the areas form, and says so as a refusal rather than a change', async (t) => {
  const { run, revisionOf } = await boot(t)
  const before = await run<RoleContext>('user.roleModalContext', { id: 'reader' })

  const refused = await run<{ ok: boolean; errors?: Row[] }>('user.setRoleBundles', {
    roleId: 'reader',
    bundleKeys: [],
    reason: 'Thử sửa vai trò chuẩn',
    expectedAuthorizationRevision: await revisionOf(),
    idempotencyKey: 'managed-refused',
  })

  assert.equal(refused.ok, false)
  assert.equal(String(refused.errors?.[0]?.field), 'roleId')
  // What the template granted is still granted.
  const after = await run<RoleContext>('user.roleModalContext', { id: 'reader' })
  assert.equal(after!.data.sources.length, before!.data.sources.length)
})

test('who holds a role is part of reading it', async (t) => {
  const { run, revisionOf } = await boot(t)
  await run('user.provisionUser', {
    id: 'trang',
    name: 'Minh Trang',
    login: 'minhtrang',
    roleIds: ['reader'],
    scopeKind: 'company',
    companyId: 'company-a',
    reason: 'Nhân viên mới',
    expectedAuthorizationRevision: await revisionOf(),
    idempotencyKey: 'hire-trang',
  })

  const context = await run<RoleContext>('user.roleModalContext', { id: 'reader' })
  assert.deepEqual(
    context!.data.holders.map((row) => row.id),
    ['trang'],
  )
  assert.deepEqual((await run<RoleContext>('user.roleModalContext', { id: 'local' }))!.data.holders, [])
})
