import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  callFn,
  defineModule,
  compose,
  migrateOne,
  registerFunctions,
  sqliteAdapter,
} from '@ketvietlab/ketjs'
import { address, company, partner, user } from '@ketvietlab/ketsuite'
import { postgresAdapter } from '@ketvietlab/ketjs-postgres'
import { adminUrl, live } from './postgres-live.ts'

const probe = defineModule({
  name: 'policy_probe',
  functions: {
    read: { output: { ok: 'bool' }, handler: () => ({ ok: true }) },
  },
  permissions: {
    posture: 'permission-bearing',
    owner: 'policy_probe',
    bundles: { 'policy_probe.view': { labels: { vi: 'Tra cứu', en: 'View' } } },
    functions: {
      'policy_probe.read': { risk: 'read', bundles: ['policy_probe.view'], owner: 'policy_probe' },
    },
    exemptions: {},
  },
})
const modules = [address, partner, company, user, probe]
const manifest = compose(modules, {
  headless: true,
  roleTemplates: {
    'test.viewer': { version: 1, labels: { vi: 'Tra cứu', en: 'Viewer' }, bundles: ['policy_probe.view'] },
  },
})

for (const dialect of ['sqlite', 'postgres'] as const)
  test(
    `access policies (${dialect}): durable ownership, CAS, replay, directory validation and live permission union`,
    dialect === 'postgres' ? live : {},
    async (t) => {
      const database = `ket_policy_${process.pid}_${Date.now()}`
      const url = new URL(adminUrl)
      url.pathname = `/${database}`
      const adapter = dialect === 'sqlite' ? sqliteAdapter(':memory:') : postgresAdapter(url.toString())
      if (dialect === 'postgres') {
        const admin = postgresAdapter(adminUrl.toString())
        await admin.open()
        t.after(async () => {
          await adapter.close()
          await admin.exec(`DROP DATABASE IF EXISTS "${database}"`)
          await admin.close()
        })
        await admin.exec(`CREATE DATABASE "${database}"`)
      } else t.after(() => adapter.close())
      await adapter.open()
      await migrateOne(adapter, manifest)
      registerFunctions(modules)
      // The function boundary is deliberately exercised instead of calling handlers directly.
      const run = async (fn: string, args: Record<string, unknown>, actor: string | null = 'root') =>
        (
          await callFn(fn, args, {
            adapter,
            manifest,
            actor,
            scope: { company: 'c', companies: ['c'], branch: 'root:c', branches: ['root:c'] },
          })
        ).value as Record<string, any> // biome-ignore lint/suspicious/noExplicitAny: public JSON function results
      await run('partner.savePartner', { id: 'p', name: 'Company', kind: 'company' })
      await run('company.saveCompany', { id: 'c', code: 'C', partnerId: 'p', currency: 'VND' })
      for (const id of ['root', 'person']) {
        assert.equal(
          (await run('user.createUser', { id, login: id, name: id, superuser: id === 'root' }, null)).ok,
          true,
        )
        await run('user.grantCompany', { id: `m-${id}`, userId: id, companyId: 'c' })
      }
      const revision = async () => (await run('user.authorizationState', {})).revision
      assert.equal(
        (
          await run('user.applyRoleTemplate', {
            roleId: 'viewer',
            templateKey: 'test.viewer',
            expectedRoleRevision: 0,
            expectedAuthorizationRevision: await revision(),
            idempotencyKey: 'role',
          })
        ).ok,
        true,
      )
      const directory = {
        userId: 'person',
        facts: [{ kind: 'department', value: 'sales', label: 'Sales' }],
        expectedAuthorizationRevision: await revision(),
        idempotencyKey: 'directory',
      }
      assert.equal((await run('user.replaceDirectoryFacts', directory)).ok, false)
      assert.equal((await run('user.replaceDirectoryFacts', directory, 'system:user-directory')).ok, true)
      const policy = {
        id: 'policy',
        name: 'Sales viewers',
        matchKind: 'department',
        matchValue: 'sales',
        roleIds: ['viewer'],
        scopeKind: 'company',
        companyId: 'c',
      }
      assert.equal((await run('user.previewAccessPolicy', { ...policy, matchValue: 'invented' })).ok, false)
      const beforePreview = await revision()
      const preview = await run('user.previewAccessPolicy', policy)
      assert.equal(preview.ok, true)
      assert.equal(preview.changes.length, 1)
      assert.equal(await revision(), beforePreview)
      const save = {
        ...policy,
        expectedAuthorizationRevision: await revision(),
        idempotencyKey: 'save',
        previewDigest: preview.previewDigest,
      }
      assert.equal(
        (
          await run('user.saveAccessPolicy', {
            ...save,
            name: 'Unreviewed',
            idempotencyKey: 'tampered-preview',
          })
        ).ok,
        false,
      )
      assert.equal(await revision(), beforePreview)
      assert.equal((await run('user.saveAccessPolicy', save)).ok, true)
      assert.equal((await run('user.saveAccessPolicy', save)).replayed, true)
      assert.equal((await run('user.saveAccessPolicy', { ...save, name: 'Changed replay' })).ok, false)
      assert.equal((await run('user.saveAccessPolicy', { ...save, idempotencyKey: 'stale' })).ok, false)
      assert.equal((await adapter.all('SELECT * FROM user_policy_assignment')).length, 1)
      assert.equal((await adapter.all('SELECT * FROM user_assignment')).length, 0)
      const effective = await run('user.permitted', { userId: 'person' })
      assert.ok(
        effective.functions.includes('policy_probe.read'),
        'policy grants participate in request authorization',
      )
      const second = {
        ...policy,
        id: 'policy-2',
        expectedAuthorizationRevision: await revision(),
        idempotencyKey: 'second',
      }
      assert.equal((await run('user.saveAccessPolicy', second)).ok, true)
      assert.equal(
        (
          await run('user.assignRoles', {
            userId: 'person',
            roleIds: ['viewer'],
            scopeKind: 'company',
            companyId: 'c',
            expectedAuthorizationRevision: await revision(),
            idempotencyKey: 'manual',
          })
        ).ok,
        true,
      )
      assert.equal(
        (
          await run('user.setAccessPolicyActive', {
            id: 'policy',
            active: false,
            expectedAuthorizationRevision: await revision(),
            idempotencyKey: 'pause',
          })
        ).ok,
        true,
      )
      assert.equal(
        (await adapter.all('SELECT * FROM user_policy_assignment')).length,
        1,
        'another policy retains its edge',
      )
      assert.equal(
        (await adapter.all('SELECT * FROM user_assignment')).length,
        1,
        'manual assignment is independent',
      )
      assert.equal(
        (
          await run(
            'user.replaceDirectoryFacts',
            {
              userId: 'person',
              facts: [],
              expectedAuthorizationRevision: await revision(),
              idempotencyKey: 'left-sales',
            },
            'system:user-directory',
          )
        ).ok,
        true,
      )
      assert.equal((await adapter.all('SELECT * FROM user_policy_assignment')).length, 0)
      assert.equal((await adapter.all('SELECT * FROM user_assignment')).length, 1)
      const audit = await adapter.all(
        "SELECT * FROM user_security_audit WHERE event = 'authorization.policy.reconciled'",
      )
      assert.ok(audit.length >= 4)
      await adapter.exec('UPDATE user_role SET "templateVersion" = 999 WHERE id = \'viewer\'')
      assert.equal(
        (
          await run('user.setAccessPolicyActive', {
            id: 'policy-2',
            active: false,
            expectedAuthorizationRevision: await revision(),
            idempotencyKey: 'pause-outdated',
          })
        ).ok,
        true,
        'outdated roles must not prevent an administrator from stopping a rule',
      )
      assert.equal(
        (
          await run('user.setAccessPolicyActive', {
            id: 'policy-2',
            active: true,
            expectedAuthorizationRevision: await revision(),
            idempotencyKey: 'resume-outdated',
          })
        ).ok,
        false,
        'resuming still requires assignable roles',
      )
      await adapter.exec('UPDATE user_role SET "templateVersion" = 1 WHERE id = \'viewer\'')
      // Matching oneself is refused transactionally, including the newly inserted policy/revision.
      await run(
        'user.replaceDirectoryFacts',
        {
          userId: 'root',
          facts: directory.facts,
          expectedAuthorizationRevision: await revision(),
          idempotencyKey: 'root-directory',
        },
        'system:user-directory',
      )
      const previousRevision = await revision()
      const self = await run('user.saveAccessPolicy', {
        ...policy,
        id: 'self',
        expectedAuthorizationRevision: previousRevision,
        idempotencyKey: 'self',
      })
      assert.equal(self.ok, false)
      assert.equal(await revision(), previousRevision)
      assert.equal((await adapter.all("SELECT * FROM user_access_policy WHERE id = 'self'")).length, 0)
    },
  )
