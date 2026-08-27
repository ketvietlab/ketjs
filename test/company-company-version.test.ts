import assert from 'node:assert/strict'
import { test } from 'node:test'
import { callFn, compose, migrateOne, registerFunctions, sqliteAdapter } from '@ketvietlab/ketjs'
import type { Adapter, Manifest } from '@ketvietlab/ketjs'
import { address, company, partner, user } from '@ketvietlab/ketsuite'

const modules = [address, partner, company, user]
const scope = { company: 'alpha', branch: 'root:alpha', branches: ['root:alpha'] }

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
) => callFn(name, input, { ...runtime, scope }).then((result) => result.value as T)

const createCompany = async (
  runtime: { adapter: Adapter; manifest: Manifest },
  id: string,
  code: string,
) => {
  await call(runtime, 'partner.savePartner', {
    id: `${id}:partner`,
    kind: 'company',
    name: `${code} Company`,
  })
  return call<{ ok: boolean; version: number }>(runtime, 'company.saveCompany', {
    id,
    code,
    partnerId: `${id}:partner`,
    currency: 'VND',
  })
}

test('company save uses optional CAS while exact command retries remain no-op successes', async () => {
  const runtime = await boot()
  const created = await createCompany(runtime, 'alpha', 'ALPHA')
  assert.equal(created.version, 1)

  const update = {
    id: 'alpha',
    code: 'ALPHA-NEW',
    partnerId: 'alpha:partner',
    parentId: null,
    currency: 'USD',
    expectedVersion: 1,
  }
  const saved = await call<{ ok: boolean; version: number }>(runtime, 'company.saveCompany', update)
  assert.equal(saved.ok, true)
  assert.equal(saved.version, 2)

  const replay = await call<{ ok: boolean; version: number }>(runtime, 'company.saveCompany', update)
  assert.equal(replay.ok, true)
  assert.equal(replay.version, 2)

  const stale = await call<Record<string, unknown>>(runtime, 'company.saveCompany', {
    ...update,
    code: 'STALE',
  })
  assert.equal(stale.ok, false)
  assert.match(JSON.stringify(stale.errors), /company\.error\.versionConflict/)
  const row = (await runtime.adapter.all('SELECT code, currency, version FROM company_company'))[0]
  assert.equal(row?.code, 'ALPHA-NEW')
  assert.equal(row?.currency, 'USD')
  assert.equal(row?.version, 2)
  await runtime.adapter.close()
})

test('company archive CAS is retry-safe and rejects a stale opposite transition', async () => {
  const runtime = await boot()
  await createCompany(runtime, 'alpha', 'ALPHA')
  await createCompany(runtime, 'beta', 'BETA')

  const archived = await call<{ ok: boolean; version: number }>(runtime, 'user.archiveCompany', {
    id: 'beta',
    active: false,
    expectedVersion: 1,
  })
  assert.equal(archived.ok, true)
  assert.equal(archived.version, 2)
  const replay = await call<{ ok: boolean; version: number }>(runtime, 'user.archiveCompany', {
    id: 'beta',
    active: false,
    expectedVersion: 1,
  })
  assert.equal(replay.ok, true)
  assert.equal(replay.version, 2)

  const staleRestore = await call<Record<string, unknown>>(runtime, 'user.archiveCompany', {
    id: 'beta',
    active: true,
    expectedVersion: 1,
  })
  assert.equal(staleRestore.ok, false)
  assert.match(JSON.stringify(staleRestore.errors), /company\.error\.versionConflict/)
  const restored = await call<{ ok: boolean; version: number }>(runtime, 'user.archiveCompany', {
    id: 'beta',
    active: true,
    expectedVersion: 2,
  })
  assert.equal(restored.ok, true)
  assert.equal(restored.version, 3)
  await runtime.adapter.close()
})
