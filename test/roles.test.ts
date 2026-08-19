import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bootApp, callFn, compose, defineModule, from, migrateOne, registerFunctions, sqliteAdapter } from 'ketjs'
import type { Ctx } from 'ketjs'
import { ketsuite } from '../apps/ketsuite/app.ts'

/**
 * A role is a named list of function keys, additive across roles — Salesforce
 * permission sets rather than Odoo's ir.model.access. The unit is the action, so
 * the role *is* the list of actions, and `ket permissions` can print what any list
 * reaches because there is nothing to traverse.
 */

// ── enforcement, at the one place every call goes through ────────────────────

const shop = defineModule({
  name: 'shop',
  models: { Item: { scope: 'shared', fields: { id: 'id', name: 'text' } } },
  functions: {
    list: { effects: ['read:shop.Item'], output: { id: 'id', name: 'text' }, handler: (ctx: Ctx) => ctx.db.all(from(ctx.table('shop.Item'))) },
    add: { input: { id: 'id', name: 'text' }, effects: ['write:shop.Item'], output: { ok: 'bool' }, handler: async (ctx: Ctx, a) => { await ctx.db.insert('shop.Item', a); return { ok: true } } },
  },
})

const boot = async () => {
  const manifest = compose([shop])
  const adapter = sqliteAdapter()
  await adapter.open()
  await migrateOne(adapter, manifest)
  registerFunctions([shop])
  return { adapter, manifest, scope: { company: 'c1' } }
}

test('allow: a caller may call what is on the list', async () => {
  const o = await boot()
  await callFn('shop.add', { id: 'i1', name: 'Xoài' }, { ...o, allow: ['shop.add'] })
  assert.equal((await o.adapter.all('SELECT * FROM shop_item', [])).length, 1)
  await o.adapter.close()
})

test('allow: and nothing else, however well-formed the call is', async () => {
  const o = await boot()
  await assert.rejects(() => callFn('shop.add', { id: 'i1', name: 'X' }, { ...o, allow: ['shop.list'] }),
    (e: unknown) => { assert.equal((e as { code: string }).code, 'E_FN_NOT_PERMITTED'); return true })
  assert.equal((await o.adapter.all('SELECT * FROM shop_item', [])).length, 0)
  await o.adapter.close()
})

test('allow: refusal comes before input validation, so a refused caller learns nothing else', async () => {
  const o = await boot()
  // Wrong arguments AND no permission. If validation ran first the error would
  // describe the signature — which is a map of the surface, handed to someone who
  // may not touch it.
  await assert.rejects(() => callFn('shop.add', { nonsense: 1 }, { ...o, allow: [] }),
    (e: unknown) => { assert.equal((e as { code: string }).code, 'E_FN_NOT_PERMITTED'); return true })
  await o.adapter.close()
})

test('allow: absent means unrestricted, because a call with no identity has none to narrow', async () => {
  const o = await boot()
  // Migrations, internal calls, tests and the public storefront all arrive this
  // way. Restriction begins where identity does.
  await callFn('shop.add', { id: 'i1', name: 'X' }, o)
  await callFn('shop.add', { id: 'i2', name: 'Y' }, { ...o, allow: null })
  assert.equal((await o.adapter.all('SELECT * FROM shop_item', [])).length, 2)
  await o.adapter.close()
})

test('allow: an empty list is a real restriction, not a missing one', async () => {
  const o = await boot()
  await assert.rejects(() => callFn('shop.list', {}, { ...o, allow: [] }),
    (e: unknown) => { assert.equal((e as { code: string }).code, 'E_FN_NOT_PERMITTED'); return true })
  await o.adapter.close()
})

// ── the role model, and the whole thing running ──────────────────────────────

const setup = async () => {
  const b = await bootApp(ketsuite, { env: { KET_SQLITE: ':memory:', KET_SECRET: 'shared' }, port: 0 })
  const o = { adapter: b.adapter!, manifest: b.manifest, scope: { company: 'acme' } }
  const run = (fn: string, args: Record<string, unknown> = {}) => callFn(fn, args, o).then(r => r.value as Record<string, unknown>)
  await run('partner.savePartner', { id: 'p1', kind: 'company', name: 'Acme' })
  await run('company.saveCompany', { id: 'acme', partnerId: 'p1', currency: 'VND' })
  for (const [id, login, superuser] of [['u1', 'root', true], ['u2', 'sale', false]] as const) {
    await run('user.createUser', { id, login, password: 'correct horse', name: login, defaultCompanyId: 'acme', superuser })
    await run('user.grantCompany', { id: `m-${id}`, userId: id, companyId: 'acme' })
  }
  const at = `http://127.0.0.1:${b.port}`
  const login = async (l: string) => (await fetch(`${at}/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ login: l, password: 'correct horse' }),
  })).headers.get('set-cookie')!.split(';')[0]!
  const call = async (jar: string, fn: string, args: Record<string, unknown> = {}) => {
    const r = await fetch(`${at}/_ket/fn/${fn}`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie: jar }, body: JSON.stringify(args),
    })
    return (await r.json() as { code?: string }).code ?? 'ok'
  }
  return { b, run, login, call }
}

test('roles: a granted function works and an ungranted one does not, over HTTP', async () => {
  const { b, run, login, call } = await setup()
  await run('user.saveRole', { id: 'r1', name: 'Xem đối tác' })
  await run('user.grantFunction', { id: 'g1', roleId: 'r1', fnKey: 'partner.listPartners' })
  await run('user.assignRole', { id: 'a1', userId: 'u2', roleId: 'r1' })

  const sale = await login('sale')
  assert.equal(await call(sale, 'partner.listPartners'), 'ok')
  assert.equal(await call(sale, 'partner.savePartner', { id: 'p9', kind: 'person', name: 'x' }), 'E_FN_NOT_PERMITTED')
  assert.equal(await call(sale, 'user.saveRole', { id: 'r9', name: 'x' }), 'E_FN_NOT_PERMITTED',
    'and least of all the functions that hand out permissions')
  await b.close()
})

test('roles: revoking takes effect on the next call, not on the next login', async () => {
  const { b, run, login, call } = await setup()
  await run('user.saveRole', { id: 'r1', name: 'Xem đối tác' })
  await run('user.grantFunction', { id: 'g1', roleId: 'r1', fnKey: 'partner.listPartners' })
  await run('user.assignRole', { id: 'a1', userId: 'u2', roleId: 'r1' })
  const sale = await login('sale')
  assert.equal(await call(sale, 'partner.listPartners'), 'ok')

  await run('user.unassignRole', { userId: 'u2', roleId: 'r1' })
  assert.equal(await call(sale, 'partner.listPartners'), 'E_FN_NOT_PERMITTED',
    'a cached list would keep working until logout, and "why can they still do that" is the worse conversation')
  await b.close()
})

test('roles: they add up, because permission sets are additive', async () => {
  const { b, run, login, call } = await setup()
  await run('user.saveRole', { id: 'r1', name: 'Đọc' })
  await run('user.saveRole', { id: 'r2', name: 'Ghi' })
  await run('user.grantFunction', { id: 'g1', roleId: 'r1', fnKey: 'partner.listPartners' })
  await run('user.grantFunction', { id: 'g2', roleId: 'r2', fnKey: 'partner.savePartner' })
  await run('user.assignRole', { id: 'a1', userId: 'u2', roleId: 'r1' })
  await run('user.assignRole', { id: 'a2', userId: 'u2', roleId: 'r2' })

  const sale = await login('sale')
  assert.equal(await call(sale, 'partner.listPartners'), 'ok')
  assert.equal(await call(sale, 'partner.savePartner', { id: 'p9', kind: 'person', name: 'x' }), 'ok')
  await b.close()
})

test('roles: a superuser is exempt, which is the only reason the first role can be granted', async () => {
  const { b, login, call } = await setup()
  const root = await login('root')
  assert.equal(await call(root, 'user.saveRole', { id: 'r9', name: 'x' }), 'ok')
  assert.equal(await call(root, 'partner.listPartners'), 'ok')
  await b.close()
})

test('roles: a user with no role at all may call nothing', async () => {
  const { b, login, call } = await setup()
  const sale = await login('sale')
  assert.equal(await call(sale, 'partner.listPartners'), 'E_FN_NOT_PERMITTED')
  await b.close()
})

test('roles: granting a function nobody ships is refused rather than stored', async () => {
  const { b, run } = await setup()
  await run('user.saveRole', { id: 'r1', name: 'X' })
  const bad = await run('user.grantFunction', { id: 'g1', roleId: 'r1', fnKey: 'khong.co' })
  assert.equal(bad.ok, false)
  // A grant for a removed or misspelt function looks like access, and becomes
  // access again the day the name comes back.
  assert.match(JSON.stringify(bad.errors), /không có hàm/)
  await b.close()
})

test('roles: granting twice is success, and the grant is not duplicated', async () => {
  const { b, run } = await setup()
  await run('user.saveRole', { id: 'r1', name: 'X' })
  await run('user.grantFunction', { id: 'g1', roleId: 'r1', fnKey: 'partner.listPartners' })
  const again = await run('user.grantFunction', { id: 'g2', roleId: 'r1', fnKey: 'partner.listPartners' })
  assert.equal(again.ok, true)
  const role = await run('user.getRole', { id: 'r1' })
  assert.equal((role.grants as unknown[]).length, 1)
  await b.close()
})

test('roles: `permitted` answers with the same list the server enforces', async () => {
  const { b, run } = await setup()
  await run('user.saveRole', { id: 'r1', name: 'X' })
  await run('user.grantFunction', { id: 'g1', roleId: 'r1', fnKey: 'partner.listPartners' })
  await run('user.assignRole', { id: 'a1', userId: 'u2', roleId: 'r1' })
  assert.deepEqual(await run('user.permitted', { userId: 'u2' }), { userId: 'u2', functions: ['partner.listPartners'], superuser: false })
  assert.deepEqual(await run('user.permitted', { userId: 'u1' }), { userId: 'u1', superuser: true })
  await b.close()
})
