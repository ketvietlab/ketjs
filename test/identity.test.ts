import { test } from 'node:test'
import assert from 'node:assert/strict'
import { callFn, compose, migrateOne, registerFunctions, sqliteAdapter, schemaFromManifest } from 'ketjs'
import type { Adapter, Manifest, Scope } from 'ketjs'
import { partner, company, user, hashPassword, verifyPassword, needsRehash } from 'ketsuite'

const mods = [partner, company, user]
const SCOPE: Scope = { company: 'c1' }

async function boot(): Promise<{ adapter: Adapter; manifest: Manifest }> {
  const manifest = compose(mods)
  const adapter = sqliteAdapter()
  await adapter.open()
  await migrateOne(adapter, manifest)
  registerFunctions(mods)
  return { adapter, manifest }
}
const call = (
  o: { adapter: Adapter; manifest: Manifest },
  fn: string,
  args: Record<string, unknown> = {},
  scope: Scope = SCOPE,
) => callFn(fn, args, { ...o, scope }).then((r) => r.value as Record<string, unknown>)

// ── the party model, and what splitting addresses out removed ────────────────

test('partner: a party is a person or an organisation, and nothing else', async () => {
  const o = await boot()
  const bad = await call(o, 'partner.savePartner', { id: 'p1', kind: 'robot', name: 'X' })
  assert.equal(bad.ok, false)
  assert.match(JSON.stringify(bad.errors), /loại đối tác/)
  const good = await call(o, 'partner.savePartner', { id: 'p1', kind: 'company', name: 'Acme' })
  assert.equal(good.ok, true)
  await o.adapter.close()
})

test('partner: an address is its own row, so there is nothing to compute about who to bill', async () => {
  const o = await boot()
  await call(o, 'partner.savePartner', { id: 'p1', kind: 'company', name: 'Acme' })
  for (const [id, use] of [
    ['a1', 'invoice'],
    ['a2', 'delivery'],
  ] as const) {
    const r = await call(o, 'partner.saveAddress', {
      id,
      partnerId: 'p1',
      use,
      street: '1 Lê Lợi',
      city: 'Hà Nội',
      country: 'VN',
    })
    assert.equal(r.ok, true)
  }
  const got = await call(o, 'partner.getPartner', { id: 'p1' })
  assert.equal((got.addresses as unknown[]).length, 2)
  // In Odoo both of these would be partners, and `commercial_partner_id` would
  // exist to walk back up and answer "so who is the customer".
  const parties = await callFn('partner.listPartners', {}, { ...o, scope: SCOPE })
  assert.equal((parties.value as unknown[]).length, 1, 'two addresses did not become two parties')
  await o.adapter.close()
})

test('partner: an address must belong to a party that exists', async () => {
  const o = await boot()
  const r = await call(o, 'partner.saveAddress', {
    id: 'a1',
    partnerId: 'ghost',
    use: 'invoice',
    street: 'x',
    city: 'y',
    country: 'VN',
  })
  assert.equal(r.ok, false)
  await o.adapter.close()
})

test('partner: roles are rows, so being both customer and supplier costs no column', async () => {
  const o = await boot()
  await call(o, 'partner.savePartner', { id: 'p1', kind: 'company', name: 'Acme' })
  await call(o, 'partner.grantRole', { id: 'r1', partnerId: 'p1', role: 'customer' })
  await call(o, 'partner.grantRole', { id: 'r2', partnerId: 'p1', role: 'supplier' })
  const got = await call(o, 'partner.getPartner', { id: 'p1' })
  assert.deepEqual((got.roles as Array<{ role: string }>).map((r) => r.role).sort(), ['customer', 'supplier'])

  // Granting twice is success: the caller wanted it true, and it is.
  const again = await call(o, 'partner.grantRole', { id: 'r3', partnerId: 'p1', role: 'customer' })
  assert.equal(again.ok, true)
  assert.equal(((await call(o, 'partner.getPartner', { id: 'p1' })).roles as unknown[]).length, 2)

  await call(o, 'partner.revokeRole', { partnerId: 'p1', role: 'supplier' })
  assert.deepEqual(
    ((await call(o, 'partner.getPartner', { id: 'p1' })).roles as Array<{ role: string }>).map((r) => r.role),
    ['customer'],
  )
  await o.adapter.close()
})

test('partner: a party cannot be its own parent', async () => {
  const o = await boot()
  const r = await call(o, 'partner.savePartner', { id: 'p1', kind: 'company', name: 'X', parentId: 'p1' })
  assert.equal(r.ok, false)
  await o.adapter.close()
})

// ── the per-company segment: ir.property, as an ordinary model ───────────────

test('terms: the same shared party carries different terms per legal entity', async () => {
  const o = await boot()
  await call(o, 'partner.savePartner', { id: 'p1', kind: 'company', name: 'Acme' })
  await call(o, 'partner.saveTerms', { id: 't1', partnerId: 'p1', paymentTermDays: 30 }, { company: 'c1' })
  await call(o, 'partner.saveTerms', { id: 't2', partnerId: 'p1', paymentTermDays: 0 }, { company: 'c2' })

  assert.equal(
    (await call(o, 'partner.getTerms', { partnerId: 'p1' }, { company: 'c1' })).paymentTermDays,
    30,
  )
  assert.equal((await call(o, 'partner.getTerms', { partnerId: 'p1' }, { company: 'c2' })).paymentTermDays, 0)
  // And the party itself is one row, seen identically from both.
  assert.equal((await call(o, 'partner.getPartner', { id: 'p1' }, { company: 'c2' })).name, 'Acme')
  await o.adapter.close()
})

test('terms: the segment is a real table, not an EAV side table', () => {
  const schema = schemaFromManifest(compose(mods))
  const cols = Object.keys(schema.tables['partner_company_terms']!.columns).sort()
  assert.ok(cols.includes('paymentTermDays'), 'a typed column, visible to SQL')
  assert.ok(cols.includes('companyId'), 'and scoped by the machinery that already exists')
})

// ── companies ────────────────────────────────────────────────────────────────

test('company: a legal entity is backed by an organisation, not by a person', async () => {
  const o = await boot()
  await call(o, 'partner.savePartner', { id: 'p1', kind: 'person', name: 'Nguyễn Văn A' })
  const bad = await call(o, 'company.saveCompany', { id: 'c1', partnerId: 'p1', currency: 'VND' })
  assert.equal(bad.ok, false)
  assert.match(JSON.stringify(bad.errors), /loại/)

  await call(o, 'partner.savePartner', { id: 'p2', kind: 'company', name: 'Acme JSC' })
  assert.equal(
    (await call(o, 'company.saveCompany', { id: 'c1', partnerId: 'p2', currency: 'VND' })).ok,
    true,
  )
  await o.adapter.close()
})

test('company: the register is shared, so knowing a company exists needs no company', async () => {
  const o = await boot()
  await call(o, 'partner.savePartner', { id: 'p2', kind: 'company', name: 'Acme JSC' })
  await call(o, 'company.saveCompany', { id: 'c1', partnerId: 'p2', currency: 'VND' })
  // No scope at all: a company-scoped register of companies would be a circle.
  const list = await callFn('company.listCompanies', {}, { ...o, scope: { company: null } })
  assert.equal((list.value as unknown[]).length, 1)
  await o.adapter.close()
})

// ── users: what must not come back ───────────────────────────────────────────

test('user: no function hands back the password hash, because none declares it', async () => {
  const o = await boot()
  await call(o, 'user.createUser', { id: 'u1', login: 'admin', password: 'correct horse', name: 'Admin' })

  for (const [fn, args] of [
    ['user.listUsers', {}],
    ['user.getUser', { id: 'u1' }],
  ] as const) {
    const got = JSON.stringify(await call(o, fn, args))
    assert.ok(!got.includes('scrypt'), `${fn} leaked the hash`)
    assert.ok(!got.includes('password'), `${fn} leaked the field`)
  }
  // The row does hold it — the projection is what keeps it in.
  const raw = await o.adapter.all('SELECT password FROM user_user', [])
  assert.match(String(raw[0]!.password), /^scrypt\$/)
  await o.adapter.close()
})

test('user: a short password is refused, and a duplicate login too', async () => {
  const o = await boot()
  assert.equal(
    (await call(o, 'user.createUser', { id: 'u1', login: 'a', password: 'short', name: 'A' })).ok,
    false,
  )
  await call(o, 'user.createUser', { id: 'u1', login: 'admin', password: 'correct horse', name: 'A' })
  const dup = await call(o, 'user.createUser', {
    id: 'u2',
    login: 'admin',
    password: 'correct horse',
    name: 'B',
  })
  assert.equal(dup.ok, false)
  assert.match(JSON.stringify(dup.errors), /đã tồn tại/)
  await o.adapter.close()
})

test('user: authenticate answers a verdict, and answers the same for unknown and wrong', async () => {
  const o = await boot()
  await call(o, 'user.createUser', { id: 'u1', login: 'admin', password: 'correct horse', name: 'Admin' })
  assert.deepEqual(await call(o, 'user.authenticate', { login: 'nobody', password: 'x' }), { ok: false })
  assert.deepEqual(
    await call(o, 'user.authenticate', { login: 'admin', password: 'wrong' }),
    { ok: false },
    'a different shape here is how an attacker learns which logins exist',
  )

  const ok = await call(o, 'user.authenticate', { login: 'admin', password: 'correct horse' })
  assert.equal(ok.ok, true)
  assert.equal(ok.userId, 'u1')
  assert.ok(!JSON.stringify(ok).includes('scrypt'))
  await o.adapter.close()
})

test('user: authenticating yields the company set a session will carry', async () => {
  const o = await boot()
  await call(o, 'partner.savePartner', { id: 'p1', kind: 'company', name: 'Acme' })
  await call(o, 'partner.savePartner', { id: 'p2', kind: 'company', name: 'Globex' })
  await call(o, 'company.saveCompany', { id: 'c1', partnerId: 'p1', currency: 'VND' })
  await call(o, 'company.saveCompany', { id: 'c2', partnerId: 'p2', currency: 'VND' })
  await call(o, 'user.createUser', {
    id: 'u1',
    login: 'admin',
    password: 'correct horse',
    name: 'Admin',
    defaultCompanyId: 'c2',
  })
  await call(o, 'user.grantCompany', { id: 'm1', userId: 'u1', companyId: 'c1' })
  await call(o, 'user.grantCompany', { id: 'm2', userId: 'u1', companyId: 'c2' })

  const s = await call(o, 'user.authenticate', { login: 'admin', password: 'correct horse' })
  assert.deepEqual((s.companies as string[]).sort(), ['c1', 'c2'], 'this becomes scope.companies')
  assert.equal(s.defaultCompanyId, 'c2', 'and this becomes scope.company')

  await call(o, 'user.revokeCompany', { userId: 'u1', companyId: 'c1' })
  assert.deepEqual(
    (await call(o, 'user.authenticate', { login: 'admin', password: 'correct horse' })).companies,
    ['c2'],
  )
  await o.adapter.close()
})

test('user: an archived account cannot authenticate', async () => {
  const o = await boot()
  await call(o, 'user.createUser', { id: 'u1', login: 'admin', password: 'correct horse', name: 'Admin' })
  await call(o, 'user.archiveUser', { id: 'u1', active: false })
  assert.deepEqual(await call(o, 'user.authenticate', { login: 'admin', password: 'correct horse' }), {
    ok: false,
  })
  await o.adapter.close()
})

test('user: changing a password takes the old one, even for your own account', async () => {
  const o = await boot()
  await call(o, 'user.createUser', { id: 'u1', login: 'admin', password: 'correct horse', name: 'Admin' })
  assert.equal(
    (await call(o, 'user.setPassword', { id: 'u1', currentPassword: 'wrong', newPassword: 'battery staple' }))
      .ok,
    false,
  )
  assert.equal(
    (
      await call(o, 'user.setPassword', {
        id: 'u1',
        currentPassword: 'correct horse',
        newPassword: 'battery staple',
      })
    ).ok,
    true,
  )
  assert.equal((await call(o, 'user.authenticate', { login: 'admin', password: 'battery staple' })).ok, true)
  await o.adapter.close()
})

test('user: minting a login is not an agent tool', () => {
  const m = compose(mods)
  assert.equal(
    m.functions['user.createUser']!.agent,
    false,
    'an agent that can mint logins can mint itself one',
  )
  assert.equal(m.functions['user.authenticate']!.agent, false)
})

// ── the hash itself ──────────────────────────────────────────────────────────

test('password: a hash carries its own parameters, so it can be moved on later', async () => {
  const h = await hashPassword('correct horse battery staple')
  const [algo, N, r, p] = h.split('$')
  assert.equal(algo, 'scrypt')
  assert.equal(Number(N), 32768)
  assert.deepEqual([Number(r), Number(p)], [8, 1])
  assert.equal(needsRehash(h), false)
  assert.equal(needsRehash('scrypt$16384$8$1$AA$BB'), true, 'made with parameters we have moved past')
  assert.equal(needsRehash('nonsense'), true)
})

test('password: two hashes of one password differ, and both verify', async () => {
  const a = await hashPassword('same password')
  const b = await hashPassword('same password')
  assert.notEqual(a, b, 'a shared salt would let one rainbow table cover every user')
  assert.equal(await verifyPassword('same password', a), true)
  assert.equal(await verifyPassword('same password', b), true)
  assert.equal(await verifyPassword('other password', a), false)
})

test('password: a corrupt record is false, not a crash a caller could read', async () => {
  for (const bad of ['', 'nonsense', 'scrypt$x$8$1$AA$BB', 'bcrypt$1$2$3$AA$BB', 'scrypt$32768$8$1$AA']) {
    assert.equal(await verifyPassword('x', bad), false, bad)
  }
})
