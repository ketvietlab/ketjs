import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bootDeployment, callFn, defineDeployment, defineModule } from '@ketvietlab/ketjs'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

const probe = defineModule({
  name: 'permission_probe',
  functions: {
    read: { output: { ok: 'bool' }, handler: () => ({ ok: true }) },
    write: { output: { ok: 'bool' }, handler: () => ({ ok: true }) },
    grant: { output: { ok: 'bool' }, handler: () => ({ ok: true }) },
  },
  // A screen that opens on a read and is somebody's work only with the write.
  menus: {
    'permission_probe.screen': {
      label: 'menu.screen',
      path: '/probe',
      needs: 'permission_probe.read',
      for: ['permission_probe.write'],
    },
  },
  messages: { vi: { 'menu.screen': 'Màn hình thử' }, en: { 'menu.screen': 'Probe screen' } },
  permissions: {
    posture: 'permission-bearing',
    owner: 'permission_probe',
    bundles: {
      'permission_probe.view': { labels: { en: 'View', vi: 'Xem' } },
      'permission_probe.work': { labels: { en: 'Work', vi: 'Làm việc' } },
      'permission_probe.admin': { labels: { en: 'Admin', vi: 'Quản trị' } },
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
      'permission_probe.grant': {
        risk: 'security',
        bundles: ['permission_probe.admin'],
        owner: 'permission_probe',
        policy: 'permission_probe.grant is given only by a superuser',
      },
    },
    exemptions: {},
  },
})

const deployment = defineDeployment({
  ...ketsuite,
  name: 'user_modal_context',
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
      'test.worker': {
        version: 1,
        labels: { en: 'Worker', vi: 'Người làm' },
        bundles: ['permission_probe.view', 'permission_probe.work'],
      },
      'test.guardian': {
        version: 1,
        labels: { en: 'Guardian', vi: 'Người gác' },
        bundles: ['permission_probe.admin'],
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

type Context = {
  data: {
    record: {
      id: string
      login: string
      name: string
      email: string
      accessKind: string
      active: boolean
      superuser: boolean
    }
    companies: Array<{ id: string; name: string }>
    branches: Array<{ id: string; name: string; companyId: string }>
    roles: Array<{ id: string; name: string; tier: string }>
    actor: { self: boolean; superuser: boolean }
    lastDenial?: { fn: string; count: number } | null
    surfaces?: Array<{
      key: string
      label: string
      status: string
      missing: Array<{ key: string; tier: string }>
      via: string[]
      fixes: string[]
    }>
    assignments: Array<{ id: string; roleId: string; scopeKey: string; company: string | null }>
    audit: Array<{ event: string; reason: string | null; roleIds: string[]; outcome: string }>
    roleCoverage: Record<string, Array<{ key: string; covered: number; total: number }>>
    revision: number
    permissions: Record<string, boolean>
  }
  messages: Record<string, string>
} | null

const boot = async (t: { after: (fn: () => unknown) => void }) => {
  const booted = await bootDeployment(deployment, {
    env: { KET_LOG: 'null', KET_SQLITE: ':memory:', KET_SECRET: 'user-modal-context' },
    port: 0,
    log: () => {},
  })
  t.after(() => booted.close())
  const adapter = booted.adapter!
  const run = <T>(
    fn: string,
    args: Record<string, unknown>,
    actor: string | null = 'root',
    scope = companyScope('company-a'),
  ) => callFn(fn, args, { adapter, manifest: booted.manifest, scope, actor }).then((r) => r.value as T)

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
  await run('user.createUser', { id: 'staff', login: 'staff', name: 'Staff' }, null)

  let revision = (await run<{ revision: number }>('user.authorizationState', {})).revision
  for (const [roleId, templateKey] of [
    ['reader', 'test.reader'],
    ['second', 'test.second'],
  ] as const) {
    const applied = await run<{ revision: number }>('user.applyRoleTemplate', {
      roleId,
      templateKey,
      expectedRoleRevision: 0,
      expectedAuthorizationRevision: revision,
      idempotencyKey: `apply-${roleId}`,
      reason: 'probe',
    })
    revision = applied.revision
  }
  // A custom role is a local edit of one deployment's policy; the create form must not offer it.
  await run('user.saveRole', { id: 'legacy', name: 'Legacy' })
  return run
}

test('the create context offers the workplaces and managed roles the viewer may use', async (t) => {
  const run = await boot(t)
  const result = await run<Context>('user.userModalContext', {})

  assert.ok(result, 'a viewer who may create a user gets the create context')
  const context = result.data
  assert.deepEqual(context.record, {
    id: '',
    name: '',
    login: '',
    email: '',
    accessKind: 'internal',
    active: true,
    superuser: false,
    lastLoginAt: null,
    passwordReady: false,
    defaultCompanyId: null,
    defaultBranchId: null,
    superuserExpiresAt: null,
    superuserReason: null,
  })
  assert.deepEqual(
    context.companies.map((company) => company.id),
    ['company-a', 'company-b'],
  )
  // Each branch carries the company it belongs to, so the form can narrow the choice.
  for (const branch of context.branches) assert.ok(branch.companyId, `${branch.id} names its company`)
  assert.ok(context.branches.some((branch) => branch.companyId === 'company-a'))
  // A company is named by its party record; the row itself holds only a code.
  assert.deepEqual(
    context.companies.map((company) => company.name),
    ['A', 'B'],
  )
  for (const company of context.companies)
    assert.notEqual(company.name, company.id, 'a reader is never shown an id as a name')
  assert.deepEqual(context.roles.map((role) => role.id).sort(), ['reader', 'second'])
  assert.equal(context.permissions.create, true)
})

test('only the roles the server would accept are offered', async (t) => {
  const run = await boot(t)
  // `user.saveRole` made a custom role, and a template that has moved on leaves the
  // role it built behind. Neither is assignable, so neither may be offered.
  const [managed] = await run<Array<{ id: string }>>('user.listRoles', {}).then((rows) =>
    rows.filter((row) => row.id === 'reader'),
  )
  assert.ok(managed)

  const offered = (await run<Context>('user.userModalContext', {}))!.data.roles.map((role) => role.id)
  assert.equal(offered.includes('legacy'), false, 'a custom role is refused by assignRoles')

  // Prove the offer and the refusal agree: every offered role can actually be given.
  const state = await run<{ revision: number }>('user.authorizationState', {})
  await run('user.provisionUser', {
    id: 'probe-person',
    name: 'Probe',
    login: 'probe',
    roleIds: offered,
    scopeKind: 'company',
    companyId: 'company-a',
    reason: 'Kiểm chứng danh sách vai trò',
    expectedAuthorizationRevision: state.revision,
    idempotencyKey: 'offered-roles',
  }).then((result) => assert.equal((result as { ok: boolean }).ok, true))
})

test('the revision the modal carries is the one a write is checked against', async (t) => {
  const run = await boot(t)
  // Booting applied a role template, so the tenant's authority has already moved.
  const state = await run<{ revision: number }>('user.authorizationState', {})
  assert.ok(state.revision > 0, 'the fixture moved the revision')

  const context = await run<Context>('user.userModalContext', {})
  assert.equal(context?.data.revision, state.revision)

  // The proof that it is the right number: a write carrying it is accepted.
  const hired = await run<{ ok: boolean; errors?: unknown }>('user.provisionUser', {
    id: 'trang',
    name: 'Minh Trang',
    login: 'minhtrang',
    roleIds: ['reader'],
    scopeKind: 'company',
    companyId: 'company-a',
    reason: 'Nhân viên mới',
    expectedAuthorizationRevision: context!.data.revision,
    idempotencyKey: 'hire-from-modal',
  })
  assert.equal(hired.ok, true, JSON.stringify(hired.errors ?? hired))
})

test('the access tab can give a role and take it back with what the context carries', async (t) => {
  const run = await boot(t)
  const opened = await run<Context>('user.userModalContext', {})
  assert.ok(opened)

  // Hire the person the way the create form does, then reopen them as the modal would.
  await run('user.provisionUser', {
    id: 'trang',
    name: 'Minh Trang',
    login: 'minhtrang',
    roleIds: ['reader'],
    scopeKind: 'company',
    companyId: 'company-a',
    reason: 'Nhân viên mới',
    expectedAuthorizationRevision: opened.data.revision,
    idempotencyKey: 'hire-trang',
  })

  // Assign a second role from the access tab: the command sends the context's revision.
  const before = await run<Context>('user.userModalContext', { id: 'trang' })
  assert.ok(before)
  const preview = await run<{ ok: boolean; contexts?: unknown[] }>('user.previewRoleAssignment', {
    userId: 'trang',
    roleIds: ['second'],
    scopeKind: 'company',
    companyId: 'company-a',
    addMembership: true,
  })
  assert.equal(preview.ok, true, 'the consequence can be read before the write')

  const assigned = await run<{ ok: boolean; errors?: unknown }>('user.assignRoles', {
    userId: 'trang',
    roleIds: ['second'],
    scopeKind: 'company',
    companyId: 'company-a',
    addMembership: true,
    reason: 'Kiêm nhiệm tổ hai',
    expectedAuthorizationRevision: before.data.revision,
    idempotencyKey: 'assign-second',
  })
  assert.equal(assigned.ok, true, JSON.stringify(assigned.errors ?? assigned))

  const after = await run<Context>('user.userModalContext', { id: 'trang' })
  const held = after!.data.assignments
  assert.deepEqual(held.map((row) => row.roleId).sort(), ['reader', 'second'])

  // Taking it back uses the row the tab was rendered from — its own scope key, not
  // one re-derived from the names on screen.
  const row = held.find((item) => item.roleId === 'second')!
  assert.equal(row.scopeKey, 'company:company-a')
  const removed = await run<{ ok: boolean; removed?: number; errors?: unknown }>('user.unassignScopedRole', {
    userId: 'trang',
    assignmentId: row.id,
    roleId: row.roleId,
    scopeKey: row.scopeKey,
    reason: 'Hết kiêm nhiệm',
    expectedAuthorizationRevision: after!.data.revision,
    idempotencyKey: 'unassign-second',
  })
  assert.equal(removed.ok, true, JSON.stringify(removed.errors ?? removed))
  assert.equal(removed.removed, 1)

  const finally_ = await run<Context>('user.userModalContext', { id: 'trang' })
  assert.deepEqual(
    finally_!.data.assignments.map((item) => item.roleId),
    ['reader'],
  )

  // A role is reported as the areas it covers, measured from its grants — not as a
  // list of function keys nobody staffs a branch by.
  const covered = finally_!.data.roleCoverage.reader
  assert.deepEqual(
    covered?.map((row) => [row.key, row.covered, row.total]),
    [['permission_probe.view', 1, 1]],
  )

  // Everything above is written down, newest first, with the reason each carried.
  const log = finally_!.data.audit
  assert.deepEqual(
    log.map((entry) => entry.event),
    [
      'authorization.assignment.removed',
      'authorization.assignment.created',
      'authorization.assignment.created',
    ],
  )
  assert.equal(log[0]?.reason, 'Hết kiêm nhiệm')
  assert.deepEqual(log[0]?.roleIds, ['second'])
  assert.equal(log.at(-1)?.reason, 'Nhân viên mới')
})

test('the log is refused to a viewer who may not read it, and the record still opens', async (t) => {
  const run = await boot(t)
  const opened = await run<Context>('user.userModalContext', {})
  await run('user.provisionUser', {
    id: 'trang',
    name: 'Minh Trang',
    login: 'minhtrang',
    roleIds: ['reader'],
    scopeKind: 'company',
    companyId: 'company-a',
    reason: 'Nhân viên mới',
    expectedAuthorizationRevision: opened!.data.revision,
    idempotencyKey: 'hire-trang',
  })

  // 'staff' may not even open a user, so grant the one read the modal gates on and
  // nothing else: the record comes back, the log does not.
  const asStaff = await run<Context>('user.userModalContext', { id: 'trang' }, 'staff')
  assert.equal(asStaff, null, 'without user.getUser there is no record at all')

  const asRoot = await run<Context>('user.userModalContext', { id: 'trang' })
  assert.equal(asRoot!.data.permissions.audit, true)
  assert.ok(asRoot!.data.audit.length > 0)
})

test('the create context is refused to a viewer who may not create a user', async (t) => {
  const run = await boot(t)

  assert.equal(await run<Context>('user.userModalContext', {}, 'staff'), null)
  // The same viewer cannot read an existing person through the modal either.
  assert.equal(await run<Context>('user.userModalContext', { id: 'root' }, 'staff'), null)
})

test('an existing person is read as the record the modal opens', async (t) => {
  const run = await boot(t)
  const result = await run<Context>('user.userModalContext', { id: 'staff' })

  assert.ok(result)
  assert.equal(result.data.record.id, 'staff')
  assert.equal(result.data.record.login, 'staff')
  assert.equal(result.data.record.name, 'Staff')
  assert.equal(result.data.record.active, true)
  // Saving a profile sends this back unchanged, so the form can never mint a superuser.
  assert.equal(result.data.record.superuser, false)
  assert.equal((await run<Context>('user.userModalContext', { id: 'root' }))?.data.record.superuser, true)
  // The modal's text travels with its data, so the view never shows a message key.
  assert.equal(result.messages['user_backend.users.create'], 'Tạo người dùng')
  // The runtime's own chrome too: without these the Vietnamese modal says "Close" and "Not saved".
  assert.equal(result.messages['recordModal.close'], 'Đóng')
  assert.equal(result.messages['recordModal.errorTitle'], 'Chưa lưu được')
  const english = await run<Context>('user.userModalContext', { id: 'staff', locale: 'en' })
  assert.equal(english?.messages['recordModal.close'], 'Close')
  assert.equal(await run<Context>('user.userModalContext', { id: 'ghost' }), null)
})

test('the context says who reads, which roles guard authority, and what each screen lets the person do', async (t) => {
  const run = await boot(t)
  let revision = (await run<{ revision: number }>('user.authorizationState', {})).revision
  revision = (
    await run<{ revision: number }>('user.applyRoleTemplate', {
      roleId: 'guardian',
      templateKey: 'test.guardian',
      expectedRoleRevision: 0,
      expectedAuthorizationRevision: revision,
      idempotencyKey: 'apply-guardian',
      reason: 'probe',
    })
  ).revision
  const hired = await run<{ ok: boolean }>('user.provisionUser', {
    id: 'probe-person',
    name: 'Probe',
    login: 'probe',
    roleIds: ['reader'],
    scopeKind: 'company',
    companyId: 'company-a',
    reason: 'probe',
    expectedAuthorizationRevision: revision,
    idempotencyKey: 'surfaces',
  })
  assert.equal(hired.ok, true)

  const context = (await run<Context>('user.userModalContext', { id: 'probe-person' }))!.data
  assert.deepEqual(context.actor, { self: false, superuser: true })
  // A template holding a security-risk function is marked, so a form can say who may give it.
  const tiers = Object.fromEntries(context.roles.map((role) => [role.id, role.tier]))
  assert.equal(tiers.guardian, 'security')
  assert.equal(tiers.reader, 'standard')

  // A deliberately read-only role is usable: optional writes are not missing dependencies.
  const screen = context.surfaces?.find((row) => row.key === 'permission_probe.screen')
  assert.ok(screen, 'a screen the person can open is listed')
  assert.equal(screen.label, 'Màn hình thử')
  assert.equal(screen.status, 'full')
  assert.deepEqual(screen.missing, [])
  assert.equal(screen.via.length, 1)
  assert.deepEqual(screen.fixes, [])

  // Reading your own record is marked, so the access controls can refuse it up front.
  assert.equal((await run<Context>('user.userModalContext', { id: 'root' }))?.data.actor.self, true)
  // Nothing that does not open is listed.
  const staff = (await run<Context>('user.userModalContext', { id: 'staff' }))!.data
  assert.equal(
    staff.surfaces?.some((row) => row.key === 'permission_probe.screen'),
    false,
  )
})

test('denial telemetry is server-owned, bounded and hidden without audit permission', async (t) => {
  const run = await boot(t)
  assert.deepEqual(
    await run('user.recordAccessDenial', { userId: 'staff', fnKey: 'permission_probe.write' }),
    { ok: false },
  )
  for (let i = 0; i < 2; i++)
    assert.deepEqual(
      await run('user.recordAccessDenial', { userId: 'staff', fnKey: 'permission_probe.write' }, 'staff'),
      { ok: true },
    )
  const context = await run<Context>('user.userModalContext', { id: 'staff' })
  assert.equal(context?.data.lastDenial?.fn, 'permission_probe.write')
  assert.equal(context?.data.lastDenial?.count, 2)
  await run('user.grantCompany', { id: 'staff-membership', userId: 'staff', companyId: 'company-a' })
  await run('user.grantFunction', { id: 'legacy-read', roleId: 'legacy', fnKey: 'user.getUser' })
  await run('user.assignRole', { id: 'legacy-staff', userId: 'staff', roleId: 'legacy' })
  const restricted = await run<Context>('user.userModalContext', { id: 'staff' }, 'staff')
  assert.ok(restricted, 'an authorised profile reader can open the record')
  assert.equal(restricted.data.permissions.audit, false)
  assert.equal(restricted.data.lastDenial, null, 'profile access alone must not reveal denied actions')
  assert.deepEqual(restricted.data.audit, [])
})
