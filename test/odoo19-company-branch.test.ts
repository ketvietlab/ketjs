import assert from 'node:assert/strict'
import { test } from 'node:test'
import { callFn, compose, migrateOne, registerFunctions, sqliteAdapter } from 'ketjs'
import type { Adapter, Manifest } from 'ketjs'
import { company, partner, user } from 'ketsuite'
import { address } from 'ketsuite'

const modules = [address, partner, company, user]
const scope = { company: 'acme', branch: 'root:acme', branches: ['root:acme'] }

const boot = async (): Promise<{ adapter: Adapter; manifest: Manifest }> => {
  const manifest = compose(modules)
  const adapter = sqliteAdapter()
  await adapter.open()
  await migrateOne(adapter, manifest)
  registerFunctions(modules)
  return { adapter, manifest }
}

const call = <T = Record<string, unknown>>(
  runtime: { adapter: Adapter; manifest: Manifest },
  name: string,
  input: Record<string, unknown>,
  actor?: string,
) => callFn(name, input, { ...runtime, scope, actor }).then((result) => result.value as T)

const createCompany = async (
  runtime: { adapter: Adapter; manifest: Manifest },
  id: string,
  name: string,
  parentId?: string,
) => {
  await call(runtime, 'partner.savePartner', { id: `${id}:partner`, kind: 'company', name })
  return call<{ ok: boolean; rootBranchId: string }>(runtime, 'company.saveCompany', {
    id,
    code: id.toUpperCase(),
    partnerId: `${id}:partner`,
    parentId: parentId ?? null,
    currency: 'VND',
  })
}

test('company 19: creation atomically creates one root branch and one partner represents one company', async () => {
  const runtime = await boot()
  const created = await createCompany(runtime, 'acme', 'ACME')
  assert.equal(created.ok, true)
  assert.equal(created.rootBranchId, 'root:acme')
  const roots = await runtime.adapter.all(
    'SELECT * FROM company_branch WHERE "companyId" = ? AND "parentId" IS NULL',
    ['acme'],
  )
  assert.equal(roots.length, 1)
  assert.equal(roots[0]!.rootKey, 'acme')

  const duplicate = await call<Record<string, unknown>>(runtime, 'company.saveCompany', {
    id: 'other',
    code: 'OTHER',
    partnerId: 'acme:partner',
    currency: 'VND',
  })
  assert.equal(duplicate.ok, false)
  assert.match(JSON.stringify(duplicate.errors), /company\.error\.partnerUnique/)
  await runtime.adapter.close()
})

test('company 19: company and branch trees reject deep cycles and cross-company parents', async () => {
  const runtime = await boot()
  await createCompany(runtime, 'a', 'A')
  await createCompany(runtime, 'b', 'B', 'a')
  await createCompany(runtime, 'c', 'C', 'b')
  const cycle = await call<Record<string, unknown>>(runtime, 'company.saveCompany', {
    id: 'a',
    code: 'A',
    partnerId: 'a:partner',
    parentId: 'c',
    currency: 'VND',
  })
  assert.equal(cycle.ok, false)
  assert.match(JSON.stringify(cycle.errors), /company\.error\.parentCycle/)

  await call(runtime, 'company.saveBranch', {
    id: 'a:north',
    companyId: 'a',
    code: 'NORTH',
    name: 'North',
    parentId: 'root:a',
  })
  await call(runtime, 'company.saveBranch', {
    id: 'a:store',
    companyId: 'a',
    code: 'STORE',
    name: 'Store',
    parentId: 'a:north',
  })
  const branchCycle = await call<Record<string, unknown>>(runtime, 'company.saveBranch', {
    id: 'a:north',
    companyId: 'a',
    code: 'NORTH',
    name: 'North',
    parentId: 'a:store',
  })
  assert.equal(branchCycle.ok, false)
  assert.match(JSON.stringify(branchCycle.errors), /company\.error\.branchCycle/)

  const crossCompany = await call<Record<string, unknown>>(runtime, 'company.saveBranch', {
    id: 'b:wrong',
    companyId: 'b',
    code: 'WRONG',
    name: 'Wrong',
    parentId: 'a:north',
  })
  assert.equal(crossCompany.ok, false)
  assert.match(JSON.stringify(crossCompany.errors), /company\.error\.branchParentCompany/)
  await runtime.adapter.close()
})

test('company 19: company membership grants root branch and explicit branch grants stay idempotent', async () => {
  const runtime = await boot()
  await createCompany(runtime, 'acme', 'ACME')
  await call(runtime, 'company.saveBranch', {
    id: 'acme:north',
    companyId: 'acme',
    code: 'NORTH',
    name: 'North',
    parentId: 'root:acme',
  })
  await call(runtime, 'user.createUser', {
    id: 'admin',
    login: 'admin',
    password: 'correct horse',
    name: 'Admin',
  })
  // SQLite has one connection, so this test covers repeated idempotency. The live
  // PostgreSQL test below covers truly concurrent transactions.
  for (let index = 0; index < 8; index += 1)
    await call(runtime, 'user.grantCompany', {
      id: `membership:${index}`,
      userId: 'admin',
      companyId: 'acme',
    })
  for (let index = 0; index < 8; index += 1)
    await call(runtime, 'user.grantBranch', {
      id: `branch-membership:${index}`,
      userId: 'admin',
      branchId: 'acme:north',
    })
  assert.equal((await runtime.adapter.all('SELECT * FROM user_membership', [])).length, 1)
  assert.equal((await runtime.adapter.all('SELECT * FROM user_branch_membership', [])).length, 2)
  const held = await call<Record<string, unknown>>(runtime, 'user.getUser', { id: 'admin' })
  assert.equal(held.defaultCompanyId, 'acme')
  assert.equal(held.defaultBranchId, 'root:acme')
  const authenticated = await call<Record<string, unknown>>(runtime, 'user.authenticate', {
    login: 'admin',
    password: 'correct horse',
  })
  assert.deepEqual((authenticated.branches as string[]).sort(), ['acme:north', 'root:acme'])
  await runtime.adapter.close()
})

test('company 19: context is actor-bound and write branch must belong to the active company', async () => {
  const runtime = await boot()
  await createCompany(runtime, 'acme', 'ACME')
  await createCompany(runtime, 'globex', 'Globex')
  await call(runtime, 'user.createUser', {
    id: 'admin',
    login: 'admin',
    password: 'correct horse',
    name: 'Admin',
  })
  await call(runtime, 'user.grantCompany', { id: 'm1', userId: 'admin', companyId: 'acme' })
  await call(runtime, 'user.grantCompany', { id: 'm2', userId: 'admin', companyId: 'globex' })
  const wrong = await call<Record<string, unknown>>(
    runtime,
    'user.prepareContext',
    {
      userId: 'admin',
      companyId: 'acme',
      branchId: 'root:globex',
      companies: ['acme', 'globex'],
      branches: ['root:acme', 'root:globex'],
    },
    'admin',
  )
  assert.equal(wrong.ok, false)
  assert.match(JSON.stringify(wrong.errors), /user\.error\.contextBranch/)
  const otherActor = await call<Record<string, unknown>>(
    runtime,
    'user.prepareContext',
    {
      userId: 'admin',
      companyId: 'acme',
      branchId: 'root:acme',
      companies: ['acme'],
      branches: ['root:acme'],
    },
    'intruder',
  )
  assert.equal(otherActor.ok, false)
  assert.match(JSON.stringify(otherActor.errors), /user\.error\.contextActor/)
  await runtime.adapter.close()
})

test('company 19: active-user defaults protect company and branch archive', async () => {
  const runtime = await boot()
  await createCompany(runtime, 'acme', 'ACME')
  await createCompany(runtime, 'globex', 'Globex')
  await call(runtime, 'company.saveBranch', {
    id: 'acme:north',
    companyId: 'acme',
    code: 'NORTH',
    name: 'North',
    parentId: 'root:acme',
  })
  await call(runtime, 'user.createUser', {
    id: 'admin',
    login: 'admin',
    password: 'correct horse',
    name: 'Admin',
  })
  await call(runtime, 'user.grantCompany', { id: 'm1', userId: 'admin', companyId: 'acme' })
  await call(runtime, 'user.grantBranch', { id: 'bm1', userId: 'admin', branchId: 'acme:north' })
  await call(runtime, 'user.setDefaultContext', {
    userId: 'admin',
    companyId: 'acme',
    branchId: 'acme:north',
  })
  const companyGuard = await call<Record<string, unknown>>(runtime, 'user.archiveCompany', {
    id: 'acme',
    active: false,
  })
  assert.equal(companyGuard.ok, false)
  assert.match(JSON.stringify(companyGuard.errors), /user\.error\.companyDefaultActive/)
  const branchGuard = await call<Record<string, unknown>>(runtime, 'user.archiveBranch', {
    id: 'acme:north',
    active: false,
  })
  assert.equal(branchGuard.ok, false)
  assert.match(JSON.stringify(branchGuard.errors), /user\.error\.branchDefaultActive/)
  await runtime.adapter.close()
})
