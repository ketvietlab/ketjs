import assert from 'node:assert/strict'
import { test } from 'node:test'
import { callFn, compose, migrateOne, registerFunctions, sqliteAdapter } from '@ketvietlab/ketjs'
import { company, partner, user, verifyPassword } from '@ketvietlab/ketsuite'
import { address } from '@ketvietlab/ketsuite'

const modules = [address, partner, company, user]
const input = {
  companyName: 'Kết Việt',
  companyCode: ' ket ',
  currency: ' vnd ',
  adminLogin: ' Admin@Example.COM ',
  adminName: 'Quản trị viên',
  adminEmail: 'admin@example.com',
  adminPassword: 'correct horse battery staple',
}

const boot = async () => {
  const manifest = compose(modules)
  const adapter = sqliteAdapter()
  await adapter.open()
  await migrateOne(adapter, manifest)
  registerFunctions(modules)
  const call = <T = Record<string, unknown>>(
    args: Record<string, unknown> = input,
    actor = 'system:provision',
  ) =>
    callFn('user.provisionAdmin', args, {
      adapter,
      manifest,
      actor,
      scope: { company: null, branch: null },
    }).then((result) => result.value as T)
  return { adapter, manifest, call }
}

test('user-provision: an empty database becomes one complete legal entity and superuser', async () => {
  const runtime = await boot()
  try {
    const meta = runtime.manifest.functions['user.provisionAdmin']
    assert.equal(meta?.exposure, 'internal')
    assert.equal(meta?.provision, true)

    const result = await runtime.call<{
      ok: boolean
      companyId: string
      branchId: string
      partnerId: string
      userId: string
    }>()
    assert.equal(result.ok, true)
    assert.equal(result.branchId, `root:${result.companyId}`)

    const [companyRow] = await runtime.adapter.all('SELECT * FROM company_company')
    const [branch] = await runtime.adapter.all('SELECT * FROM company_branch')
    const [partnerRow] = await runtime.adapter.all('SELECT * FROM partner_partner')
    const [admin] = await runtime.adapter.all('SELECT * FROM user_user')
    assert.equal(companyRow?.code, 'KET')
    assert.equal(companyRow?.currency, 'VND')
    assert.equal(companyRow?.partnerId, result.partnerId)
    assert.equal(branch?.id, result.branchId)
    assert.equal(branch?.rootKey, result.companyId)
    assert.equal(partnerRow?.kind, 'company')
    assert.equal(admin?.login, 'admin@example.com')
    assert.equal(admin?.superuser, 1)
    assert.equal(admin?.defaultCompanyId, result.companyId)
    assert.equal(admin?.defaultBranchId, result.branchId)
    assert.equal(await verifyPassword(input.adminPassword, String(admin?.passwordHash)), true)
    assert.equal((await runtime.adapter.all('SELECT * FROM user_membership')).length, 1)
    assert.equal((await runtime.adapter.all('SELECT * FROM user_branch_membership')).length, 1)

    const audit = await runtime.adapter.all('SELECT * FROM user_security_audit')
    assert.equal(audit.length, 1)
    assert.equal(audit[0]?.event, 'provision.admin')
    assert.ok(!JSON.stringify(audit).includes(input.adminPassword))

    const again = await runtime.call<{ ok: boolean; errors: Array<{ code: string }> }>()
    assert.equal(again.ok, false)
    assert.equal(again.errors[0]?.code, 'user.error.provisionExists')
    assert.equal((await runtime.adapter.all('SELECT * FROM user_user')).length, 1)
    assert.equal((await runtime.adapter.all('SELECT * FROM company_company')).length, 1)
  } finally {
    await runtime.adapter.close()
  }
})

test('user-provision: only the trusted command actor may bootstrap and input errors are coded', async () => {
  const runtime = await boot()
  try {
    const denied = await runtime.call<{ ok: boolean; errors: Array<{ code: string }> }>(input, 'admin')
    assert.equal(denied.ok, false)
    assert.equal(denied.errors[0]?.code, 'user.error.provisionActor')
    const invalid = await runtime.call<{ ok: boolean; errors: Array<{ field: string; code: string }> }>({
      ...input,
      companyName: '',
      adminPassword: 'short',
    })
    assert.equal(invalid.ok, false)
    assert.ok(
      invalid.errors.some((error) => error.field === 'companyName' && error.code === 'user.error.required'),
    )
    assert.ok(
      invalid.errors.some(
        (error) => error.field === 'adminPassword' && error.code === 'user.error.passwordLength',
      ),
    )
    assert.equal((await runtime.adapter.all('SELECT * FROM user_user')).length, 0)
    assert.equal((await runtime.adapter.all('SELECT * FROM company_company')).length, 0)
  } finally {
    await runtime.adapter.close()
  }
})

test('user-provision: admin/admin is restricted to the exact development scaffold actor', async () => {
  const runtime = await boot()
  const short = {
    ...input,
    adminLogin: 'admin',
    adminPassword: 'admin',
  }
  try {
    const production = await runtime.call<{ ok: boolean; errors: Array<{ code: string }> }>(
      short,
      'system:provision',
    )
    assert.equal(production.ok, false)
    assert.ok(production.errors.some((error) => error.code === 'user.error.passwordLength'))

    const development = await runtime.call<{ ok: boolean }>(short, 'system:scaffold')
    assert.equal(development.ok, true)
  } finally {
    await runtime.adapter.close()
  }
})

test('user-provision: a late database failure rolls the entire bootstrap back', async () => {
  const runtime = await boot()
  try {
    await runtime.adapter.exec(`
      CREATE TRIGGER reject_provisioned_admin
      BEFORE INSERT ON user_user
      BEGIN
        SELECT RAISE(ABORT, 'forced provision rollback');
      END
    `)
    await assert.rejects(runtime.call(), /forced provision rollback/)
    for (const table of [
      'partner_partner',
      'company_company',
      'company_branch',
      'user_user',
      'user_membership',
      'user_branch_membership',
      'user_security_audit',
      'user_security_guard',
    ])
      assert.equal((await runtime.adapter.all(`SELECT * FROM ${table}`)).length, 0, table)
  } finally {
    await runtime.adapter.close()
  }
})
