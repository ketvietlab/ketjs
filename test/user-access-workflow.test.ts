import assert from 'node:assert/strict'
import { test } from 'node:test'
import { postgresAdapter } from '@ketvietlab/ketjs-postgres'
import {
  callFn,
  compose,
  defineModule,
  migrateOne,
  registerFunctions,
  sqliteAdapter,
} from '@ketvietlab/ketjs'
import {
  address,
  company,
  partner,
  user,
  createInternalUserWithAccess,
  USER_ACCESS_EFFECTS,
} from '@ketvietlab/ketsuite'

const probe = defineModule({
  name: 'workflow_probe',
  functions: {
    read: { output: { ok: 'bool' }, handler: () => ({ ok: true }) },
    create: {
      exposure: 'internal',
      input: { id: 'id', email: 'text', roleIds: 'json', fail: 'bool?' },
      effects: [...USER_ACCESS_EFFECTS],
      handler: (ctx, args) =>
        createInternalUserWithAccess(
          ctx,
          {
            id: String(args.id),
            name: 'Người mới',
            login: String(args.id),
            email: String(args.email),
            companyId: 'c',
            roleIds: args.roleIds as string[],
            reason: 'Thêm nhân sự',
          },
          async () => {
            if (args.fail) throw new Error('outbox failed')
            return { queued: true }
          },
        ),
    },
  },
  permissions: {
    posture: 'permission-bearing',
    owner: 'workflow_probe',
    bundles: { 'workflow_probe.view': { labels: { vi: 'Tra cứu', en: 'View' } } },
    functions: {
      'workflow_probe.read': { risk: 'read', bundles: ['workflow_probe.view'], owner: 'workflow_probe' },
    },
    exemptions: {},
  },
})
const modules = [address, partner, company, user, probe]
const manifest = compose(modules, {
  headless: true,
  roleTemplates: {
    'test.viewer': {
      version: 1,
      labels: { vi: 'Nhân viên', en: 'Viewer' },
      bundles: ['workflow_probe.view'],
    },
    'test.reader': { version: 1, labels: { vi: 'Tra cứu', en: 'Reader' }, bundles: ['workflow_probe.view'] },
  },
})

test('user workflow: atomic creation, batch assignment, preview, exact removal and email checks', async (t) => {
  const adapter = process.env.KET_USER_WORKFLOW_PG
    ? postgresAdapter(process.env.KET_USER_WORKFLOW_PG)
    : sqliteAdapter(':memory:')
  // Raw fixture statements use SQLite placeholders; production queries already use the adapter dialect.
  if (adapter.name === 'postgres') {
    const run = adapter.run.bind(adapter),
      all = adapter.all.bind(adapter)
    const sql = (query: string) => {
      let n = 0
      return query.replace(/\?/g, () => `$${++n}`)
    }
    adapter.run = (query, params) => run(sql(query), params)
    adapter.all = (query, params) => all(sql(query), params)
  }
  await adapter.open()
  t.after(() => adapter.close())
  await migrateOne(adapter, manifest)
  registerFunctions(modules)
  const run = async (fn: string, args: Record<string, unknown>, actor: string | null = 'root') =>
    (
      await callFn(fn, args, {
        adapter,
        manifest,
        scope: { company: 'c', companies: ['c'], branch: 'root:c', branches: ['root:c'] },
        actor,
      })
    ).value as any
  await run('partner.savePartner', { id: 'p', name: 'Công ty', kind: 'company' })
  await run('company.saveCompany', { id: 'c', code: 'C', partnerId: 'p', currency: 'VND' })
  assert.equal(
    (await run('user.createUser', { id: 'root', login: 'root', name: 'Root', superuser: true }, null)).ok,
    true,
  )
  assert.equal(
    (
      await run(
        'user.createUser',
        { id: 'person', login: 'person', name: 'Người dùng', email: 'EXISTING@EXAMPLE.TEST' },
        null,
      )
    ).ok,
    true,
  )
  await run('user.grantCompany', { id: 'm', userId: 'person', companyId: 'c' })
  const revision = async () => (await run('user.authorizationState', {})).revision as number
  for (const id of ['viewer', 'reader']) {
    const result = await run('user.applyRoleTemplate', {
      roleId: id,
      templateKey: `test.${id}`,
      expectedRoleRevision: 0,
      expectedAuthorizationRevision: await revision(),
      idempotencyKey: `seed-${id}`,
      reason: 'Khởi tạo vai trò hệ thống',
    })
    assert.equal(result.ok, true, JSON.stringify(result))
  }
  const selection = { userId: 'person', roleIds: ['viewer', 'reader'], scopeKind: 'company', companyId: 'c' }
  const before = await revision()
  const preview = await run('user.previewRoleAssignment', selection)
  assert.equal(preview.ok, true, JSON.stringify(preview))
  assert.equal(preview.contexts.length, 1, 'company and identical root branch are one impact context')
  assert.equal(await revision(), before)
  assert.equal((await adapter.all('SELECT * FROM user_assignment')).length, 0)
  const batch = {
    ...selection,
    reason: 'Phân công công việc',
    expectedAuthorizationRevision: before,
    idempotencyKey: 'batch',
  }
  assert.equal((await run('user.assignRoles', batch)).ok, true)
  assert.equal(await revision(), before + 1)
  assert.equal((await run('user.assignRoles', batch)).replayed, true)
  assert.equal((await adapter.all('SELECT * FROM user_assignment')).length, 2)
  const duplicate = await run('user.assignRoles', {
    ...batch,
    idempotencyKey: 'duplicate',
    expectedAuthorizationRevision: await revision(),
  })
  assert.equal(duplicate.ok, false)
  const stale = await run('user.assignRoles', { ...batch, scopeKind: 'tenant', idempotencyKey: 'stale' })
  assert.equal(stale.ok, false)
  const assignments = await adapter.all('SELECT * FROM user_assignment')
  const removal = { ...selection, roleIds: [], assignmentId: assignments[0]!.id }
  const impact = await run('user.previewRoleAssignment', removal)
  assert.equal(impact.ok, true)
  assert.ok(impact.contexts.every((c: any) => c.removed.length === 0))
  assert.ok(impact.contexts.every((c: any) => c.retainedBundles.length > 0))
  assert.equal(
    (
      await run('user.unassignScopedRole', {
        userId: 'person',
        roleId: 'viewer',
        assignmentId: assignments[0]!.id,
        scopeKey: 'company:c',
        reason: 'Đổi công việc',
        expectedAuthorizationRevision: await revision(),
        idempotencyKey: 'remove',
      })
    ).removed,
    1,
  )
  const audit = await run('user.listAuthorizationAudit', { userId: 'person' })
  assert.ok(audit.some((e: any) => e.event === 'authorization.assignment.removed'))
  assert.equal((await run('user.checkUserEmail', { email: ' existing@example.test ' })).available, false)
  assert.equal((await run('user.checkUserEmail', { email: 'wrong' })).ok, false)
  const created = await run('workflow_probe.create', {
    id: 'new-user',
    email: ' NEW@EXAMPLE.TEST ',
    roleIds: ['viewer', 'reader'],
  })
  assert.equal(created.ok, true, JSON.stringify(created))
  assert.equal(
    (await adapter.all('SELECT * FROM user_assignment WHERE "userId" = ?', ['new-user'])).length,
    2,
  )
  assert.equal((await run('user.checkUserEmail', { email: 'new@example.test' })).available, false)
  await assert.rejects(() =>
    run('workflow_probe.create', {
      id: 'rollback',
      email: 'rollback@example.test',
      roleIds: ['viewer'],
      fail: true,
    }),
  )
  assert.equal((await adapter.all('SELECT * FROM user_user WHERE id = ?', ['rollback'])).length, 0)
  assert.equal((await run('user.checkUserEmail', { email: 'rollback@example.test' })).available, true)
  const rejected = await run('workflow_probe.create', {
    id: 'invalid-role',
    email: 'free@example.test',
    roleIds: ['missing'],
  })
  assert.equal(rejected.ok, false)
  assert.equal((await adapter.all('SELECT * FROM user_user WHERE id = ?', ['invalid-role'])).length, 0)
  await run(
    'user.createUser',
    { id: 'underscored', login: 'underscored', name: 'Email underscore', email: 'first_last@example.test' },
    null,
  )
  assert.equal((await run('user.checkUserEmail', { email: 'FIRST_LAST@example.test' })).available, false)
  assert.equal((await run('user.checkUserEmail', { email: 'firstXlast@example.test' })).available, true)
  assert.equal(
    (
      await run('user.saveUser', {
        id: 'new-user',
        login: 'new-user',
        name: 'Người mới',
        email: 'changed@example.test',
        accessKind: 'internal',
        active: true,
        superuser: false,
      })
    ).ok,
    true,
  )
  assert.equal((await run('user.checkUserEmail', { email: 'new@example.test' })).available, true)
  assert.equal((await run('user.checkUserEmail', { email: 'changed@example.test' })).available, false)
  // Legacy and explicit tenant rows can coexist during migration: remove exactly one ID.
  await adapter.run(
    'INSERT INTO user_assignment (id,"userId","roleId","scopeKind","scopeKey") VALUES (?, ?, ?, ?, ?)',
    ['legacy', 'person', 'viewer', null, null],
  )
  await adapter.run(
    'INSERT INTO user_assignment (id,"userId","roleId","scopeKind","scopeKey") VALUES (?, ?, ?, ?, ?)',
    ['tenant', 'person', 'viewer', 'tenant', 'tenant'],
  )
  await adapter.run('UPDATE user_user SET active = FALSE WHERE id = ?', ['person'])
  assert.equal(
    (
      await run('user.previewRoleAssignment', {
        userId: 'person',
        roleIds: [],
        scopeKind: 'tenant',
        assignmentId: 'legacy',
      })
    ).ok,
    true,
  )
  assert.equal(
    (
      await run('user.unassignScopedRole', {
        userId: 'person',
        roleId: 'viewer',
        assignmentId: 'legacy',
        scopeKey: 'tenant',
        reason: 'Gỡ quyền cũ',
        expectedAuthorizationRevision: await revision(),
        idempotencyKey: 'legacy-remove',
      })
    ).removed,
    1,
  )
  assert.equal((await adapter.all('SELECT * FROM user_assignment WHERE id = ?', ['tenant'])).length, 1)
  for (const auditId of ['page-a', 'page-b'])
    await adapter.run(
      'INSERT INTO user_security_audit (id,event,"occurredAt","userId","authorizationRevision") VALUES (?, ?, ?, ?, ?)',
      [auditId, 'authorization.assignment.created', new Date().toISOString(), 'person', 999],
    )
  const newest = await run('user.listAuthorizationAudit', { userId: 'person', limit: 1 })
  assert.equal(newest[0].id, 'page-b')
  const older = await run('user.listAuthorizationAudit', {
    userId: 'person',
    limit: 1,
    beforeRevision: 999,
    beforeId: newest[0].id,
  })
  assert.equal(older[0].id, 'page-a', 'cursor retains events with the same revision')
})
