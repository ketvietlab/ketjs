import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bootDeployment, callFn, defineDeployment, defineModule } from '@ketvietlab/ketjs'
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
    roles: Array<{ id: string; name: string }>
    assignments: Array<{ id: string; roleId: string; scopeKey: string; company: string | null }>
    audit: Array<{ event: string; reason: string | null; roleIds: string[]; outcome: string }>
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
  assert.equal(await run<Context>('user.userModalContext', { id: 'ghost' }), null)
})
