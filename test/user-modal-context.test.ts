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
    record: { id: string; login: string; name: string; email: string; accessKind: string; active: boolean }
    companies: Array<{ id: string; name: string }>
    branches: Array<{ id: string; name: string; companyId: string }>
    roles: Array<{ id: string; name: string }>
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

  const revision = (await run<{ revision: number }>('user.authorizationState', {})).revision
  await run('user.applyRoleTemplate', {
    roleId: 'reader',
    templateKey: 'test.reader',
    expectedRoleRevision: 0,
    expectedAuthorizationRevision: revision,
    idempotencyKey: 'apply-reader',
    reason: 'probe',
  })
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
  })
  assert.deepEqual(
    context.companies.map((company) => company.id),
    ['company-a', 'company-b'],
  )
  // Each branch carries the company it belongs to, so the form can narrow the choice.
  for (const branch of context.branches) assert.ok(branch.companyId, `${branch.id} names its company`)
  assert.ok(context.branches.some((branch) => branch.companyId === 'company-a'))
  assert.deepEqual(
    context.roles.map((role) => role.id),
    ['reader'],
  )
  assert.equal(context.permissions.create, true)
  assert.equal(Number.isInteger(context.revision), true)
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
  // The modal's text travels with its data, so the view never shows a message key.
  assert.equal(result.messages['user_backend.users.create'], 'Tạo người dùng')
  assert.equal(await run<Context>('user.userModalContext', { id: 'ghost' }), null)
})
