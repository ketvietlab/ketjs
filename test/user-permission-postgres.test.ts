import assert from 'node:assert/strict'
import { test } from 'node:test'
import { callFn, compose, defineModule, migrateOne, registerFunctions } from '@ketvietlab/ketjs'
import type { Adapter, Row } from '@ketvietlab/ketjs'
import { postgresAdapter } from '@ketvietlab/ketjs-postgres'
import { address, company, partner, user } from '@ketvietlab/ketsuite'

const configured =
  process.env.KET_TEST_PG ?? process.env.DATABASE_URL ?? 'postgres://dev:devpassword@127.0.0.1:5435/ketjs_dev'
const adminUrl = new URL(configured)
adminUrl.pathname = '/postgres'
const reachable = await (async () => {
  const adapter = postgresAdapter(adminUrl.toString())
  try {
    await adapter.open()
    const role = (await adapter.all('SELECT rolcreatedb FROM pg_roles WHERE rolname = current_user'))[0]
    await adapter.close()
    return Boolean(role?.rolcreatedb)
  } catch {
    await adapter.close().catch(() => {})
    return false
  }
})()
const live = { skip: reachable ? false : `no PostgreSQL CREATE DATABASE role at ${adminUrl.toString()}` }

const probe = defineModule({
  name: 'permission_probe',
  depends: ['user'],
  functions: {
    read: { output: { ok: 'bool' }, handler: () => ({ ok: true }) },
    approve: { output: { ok: 'bool' }, handler: () => ({ ok: true }) },
    seedManagedRole: {
      exposure: 'internal',
      input: { id: 'id', custom: 'bool?' },
      effects: ['write:user.Role', 'write:user.Grant', 'write:user.GrantSource'],
      handler: (ctx, args) =>
        ctx.tx(async (tx) => {
          await tx.db.insert('user.Role', {
            id: args.id,
            name: `Seed ${String(args.id)}`,
            description: 'PostgreSQL concurrency seed',
            mode: 'managed',
            templateKey: 'test.probe-operator',
            templateVersion: 1,
            templateDigest: 'version-one',
            revision: 1,
          })
          await tx.db.insert('user.GrantSource', {
            id: `${String(args.id)}:managed:read`,
            roleId: args.id,
            fnKey: 'permission_probe.read',
            sourceKind: 'managed-template',
            sourceKey: 'test.probe-operator',
            sourceVersion: 1,
          })
          await tx.db.insert('user.Grant', {
            id: `${String(args.id)}:read`,
            roleId: args.id,
            fnKey: 'permission_probe.read',
          })
          if (args.custom === true) {
            await tx.db.insert('user.GrantSource', {
              id: `${String(args.id)}:custom:approve`,
              roleId: args.id,
              fnKey: 'permission_probe.approve',
              sourceKind: 'custom',
              sourceKey: 'direct',
              sourceVersion: null,
            })
            await tx.db.insert('user.Grant', {
              id: `${String(args.id)}:approve`,
              roleId: args.id,
              fnKey: 'permission_probe.approve',
            })
          }
          return { ok: true }
        }),
    },
  },
  permissions: {
    posture: 'permission-bearing',
    owner: 'permission_probe',
    bundles: {
      'permission_probe.view': { labels: { en: 'View probe', vi: 'Xem kiểm thử' } },
      'permission_probe.approve': {
        labels: { en: 'Approve probe', vi: 'Duyệt kiểm thử' },
        includes: ['permission_probe.view'],
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
    },
    exemptions: {
      'permission_probe.seedManagedRole': {
        reason: 'bootstrap-only',
        authority: 'PostgreSQL test fixture',
      },
    },
  },
})

const modules = [address, partner, company, user, probe]
const manifest = compose(modules, {
  headless: true,
  roleTemplates: {
    'test.probe-operator': {
      version: 2,
      labels: { en: 'Probe operator', vi: 'Nhân viên kiểm thử' },
      bundles: ['permission_probe.approve'],
    },
  },
})
const scope = {
  company: 'company-a',
  companies: ['company-a'],
  branch: 'root:company-a',
  branches: ['root:company-a'],
}
const call = <T>(
  adapter: Adapter,
  name: string,
  input: Record<string, unknown>,
  actor: string | null = 'root',
) => callFn(name, input, { adapter, manifest, scope, actor }).then((result) => result.value as T)

test('user permission PostgreSQL: concurrent scope and template mutations converge', live, async () => {
  const database = `ket_user_permission_${process.pid}_${Date.now()}`
  const databaseUrl = new URL(adminUrl)
  databaseUrl.pathname = `/${database}`
  const admin = postgresAdapter(adminUrl.toString(), { max: 1 })
  const first = postgresAdapter(databaseUrl.toString(), { max: 3 })
  const second = postgresAdapter(databaseUrl.toString(), { max: 3 })
  await admin.open()
  let created = false
  try {
    await admin.exec(`CREATE DATABASE "${database}"`)
    created = true
    await Promise.all([first.open(), second.open()])
    await migrateOne(first, manifest)
    registerFunctions(modules)
    await call(first, 'partner.savePartner', {
      id: 'company-a:partner',
      kind: 'company',
      name: 'Company A',
    })
    await call(first, 'company.saveCompany', {
      id: 'company-a',
      code: 'A',
      partnerId: 'company-a:partner',
      currency: 'VND',
    })
    await call(
      first,
      'user.createUser',
      {
        id: 'root',
        login: 'root',
        password: 'correct horse',
        name: 'Root',
        superuser: true,
      },
      null,
    )
    await call(
      first,
      'user.createUser',
      {
        id: 'operator',
        login: 'operator',
        password: 'correct horse',
        name: 'Operator',
      },
      null,
    )
    await call(first, 'user.grantCompany', {
      id: 'operator:company-a',
      userId: 'operator',
      companyId: 'company-a',
    })
    await call(first, 'permission_probe.seedManagedRole', { id: 'role-a', custom: false })
    const baseRevision = (await call<{ revision: number }>(first, 'user.authorizationState', {})).revision

    const assignmentInput = {
      userId: 'operator',
      roleId: 'role-a',
      scopeKind: 'company',
      companyId: 'company-a',
      expectedAuthorizationRevision: baseRevision,
      reason: 'concurrent scope test',
    }
    const assigned = await Promise.all([
      call<Row>(first, 'user.assignScopedRole', {
        ...assignmentInput,
        id: 'assignment-a',
        idempotencyKey: 'assignment-a',
      }),
      call<Row>(second, 'user.assignScopedRole', {
        ...assignmentInput,
        id: 'assignment-b',
        idempotencyKey: 'assignment-b',
      }),
    ])
    assert.equal(assigned.filter((result) => result.ok === true).length, 1)
    assert.equal(assigned.filter((result) => result.ok === false).length, 1)
    assert.equal(Number((await first.all('SELECT COUNT(*) AS count FROM user_assignment', []))[0]?.count), 1)

    const assignVersusRevoke = await Promise.all([
      call<Row>(first, 'user.assignScopedRole', {
        ...assignmentInput,
        id: 'assignment-c',
        expectedAuthorizationRevision: baseRevision + 1,
        idempotencyKey: 'assignment-c',
      }),
      call<Row>(second, 'user.unassignScopedRole', {
        userId: 'operator',
        roleId: 'role-a',
        scopeKey: 'company:company-a',
        expectedAuthorizationRevision: baseRevision + 1,
        idempotencyKey: 'unassign-a',
        reason: 'concurrent revoke test',
      }),
    ])
    assert.ok(assignVersusRevoke.some((result) => result.ok === true))
    assert.equal(Number((await first.all('SELECT COUNT(*) AS count FROM user_assignment', []))[0]?.count), 0)

    await call(first, 'permission_probe.seedManagedRole', { id: 'role-b', custom: true })
    const revision = Number(
      (await first.all('SELECT revision FROM user_authorization_revision WHERE id = $1', ['tenant']))[0]
        ?.revision ?? 0,
    )
    const upgrade = {
      roleId: 'role-b',
      templateKey: 'test.probe-operator',
      expectedRoleRevision: 1,
      expectedAuthorizationRevision: revision,
      reason: 'concurrent template upgrade',
    }
    const upgrades = await Promise.all([
      call<Row>(first, 'user.applyRoleTemplate', { ...upgrade, idempotencyKey: 'upgrade-a' }),
      call<Row>(second, 'user.applyRoleTemplate', { ...upgrade, idempotencyKey: 'upgrade-b' }),
    ])
    assert.equal(upgrades.filter((result) => result.ok === true).length, 1)
    assert.equal(upgrades.filter((result) => result.ok === false).length, 1)
    assert.equal(
      Number(
        (
          await first.all(
            'SELECT COUNT(*) AS count FROM user_grant_source WHERE "roleId" = $1 AND "sourceKind" = $2',
            ['role-b', 'custom'],
          )
        )[0]?.count,
      ),
      1,
    )

    // The next race uses a fresh managed role for the same template. Remove the
    // previous case so the role-name uniqueness invariant does not turn this
    // independent concurrency scenario into a template-duplication test.
    await first.run('DELETE FROM user_grant_source WHERE "roleId" = $1', ['role-b'])
    await first.run('DELETE FROM user_grant WHERE "roleId" = $1', ['role-b'])
    await first.run('DELETE FROM user_role WHERE id = $1', ['role-b'])

    await call(first, 'permission_probe.seedManagedRole', { id: 'role-c', custom: false })
    const nextRevision = Number(
      (await first.all('SELECT revision FROM user_authorization_revision WHERE id = $1', ['tenant']))[0]
        ?.revision ?? 0,
    )
    const raced = await Promise.all([
      call<Row>(first, 'user.applyRoleTemplate', {
        roleId: 'role-c',
        templateKey: 'test.probe-operator',
        expectedRoleRevision: 1,
        expectedAuthorizationRevision: nextRevision,
        idempotencyKey: 'upgrade-c',
        reason: 'upgrade versus custom grant',
      }),
      call<Row>(second, 'user.grantFunction', {
        id: 'role-c:custom-approve',
        roleId: 'role-c',
        fnKey: 'permission_probe.approve',
      }),
    ])
    assert.ok(raced.some((result) => result.ok === true))
    assert.equal(
      Number(
        (
          await first.all(
            'SELECT COUNT(*) AS count FROM user_grant_source WHERE "roleId" = $1 AND "fnKey" = $2 AND "sourceKind" = $3',
            ['role-c', 'permission_probe.approve', 'custom'],
          )
        )[0]?.count,
      ),
      1,
    )
  } finally {
    await Promise.all([first.close().catch(() => {}), second.close().catch(() => {})])
    if (created) await admin.exec(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`).catch(() => {})
    await admin.close()
  }
})
