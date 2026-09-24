import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import {
  callFn,
  compose,
  migrateOne,
  registerFunctions,
  sqliteAdapter,
  tableNameFor,
} from '@ketvietlab/ketjs'
import type { Adapter, Row } from '@ketvietlab/ketjs'
import { address, paperTheme, partner, website } from '@ketvietlab/ketsuite'

const modules = [address, partner, website, paperTheme]
const manifest = compose(modules)
const scope = { company: 'default', branches: null }

const call = (adapter: Adapter, name: string, input: Record<string, unknown> = {}) =>
  callFn(name, input, { adapter, manifest, scope }).then((r) => r.value as Row)

const boot = async (t: TestContext) => {
  const adapter = sqliteAdapter()
  await adapter.open()
  t.after(() => adapter.close())
  await migrateOne(adapter, manifest)
  registerFunctions(modules)
  await call(adapter, 'website.saveSite', {
    id: 'care',
    name: 'Care',
    title: 'Care',
    defaultLocale: 'vi',
    theme: 'theme_paper',
  })
  const realm = await call(adapter, 'website.customerRealmForSite', { siteId: 'care' })
  await call(adapter, 'partner.savePartner', { id: 'cuc', kind: 'person', name: 'Võ Thị Kim Cúc' })
  return { adapter, realmId: String(realm.id) }
}

test('staff issue a phone account and the customer signs in with any spelling of the number', async (t) => {
  const { adapter, realmId } = await boot(t)
  const issued = await call(adapter, 'website.issueCustomerAccess', {
    realmId,
    partnerId: 'cuc',
    phone: '0708 580 468',
  })
  assert.equal(issued.ok, true, JSON.stringify(issued.errors))
  assert.equal(issued.created, true)
  const password = String(issued.password)
  assert.match(password, /^[A-Za-z2-9]{12}$/, 'a generated password is returned once')
  assert.equal((issued.account as Row).displayName, 'Võ Thị Kim Cúc', 'the name defaults to the partner')

  for (const phone of ['0708580468', '+84708580468', '84 708 580 468']) {
    const signedIn = await call(adapter, 'website.authenticateCustomer', { realmId, phone, password })
    assert.equal(signedIn.ok, true, phone)
    assert.equal((signedIn.account as Row).partnerId, 'cuc')
  }
  const wrong = await call(adapter, 'website.authenticateCustomer', {
    realmId,
    phone: '0708580468',
    password: 'not-the-password',
  })
  assert.equal(wrong.ok, false)

  // A phone-only account has no email to sign in with, and its internal key is not one.
  const byKey = await call(adapter, 'website.authenticateCustomer', {
    realmId,
    email: 'phone:+84708580468',
    password,
  })
  assert.equal(byKey.ok, false)
})

test('issuing again resets the password and signs out every device', async (t) => {
  const { adapter, realmId } = await boot(t)
  const first = await call(adapter, 'website.issueCustomerAccess', {
    realmId,
    partnerId: 'cuc',
    phone: '0708580468',
    password: 'first-password-set',
  })
  assert.equal(first.password, null, 'a password staff chose is not echoed back')
  const account = first.account as Row
  await call(adapter, 'website.startCustomerSession', {
    id: 'session-1',
    accountId: account.id,
    tokenDigest: 'a'.repeat(64),
  })

  const again = await call(adapter, 'website.issueCustomerAccess', {
    realmId,
    partnerId: 'cuc',
    phone: '0708580468',
  })
  assert.equal(again.ok, true)
  assert.equal(again.created, false)
  assert.equal((again.account as Row).id, account.id, 'one account per customer')
  const [session] = await adapter.all(
    `SELECT "revokedAt" FROM ${adapter.quoteIdent(tableNameFor('website.CustomerSession'))} WHERE id = ?`,
    ['session-1'],
  )
  assert.ok(session?.revokedAt, 'the old device is signed out')
  const old = await call(adapter, 'website.authenticateCustomer', {
    realmId,
    phone: '0708580468',
    password: 'first-password-set',
  })
  assert.equal(old.ok, false, 'the old password no longer works')

  const disabled = await call(adapter, 'website.disableCustomerAccess', { partnerId: 'cuc' })
  assert.equal(disabled.ok, true)
  const blocked = await call(adapter, 'website.authenticateCustomer', {
    realmId,
    phone: '0708580468',
    password: String(again.password),
  })
  assert.equal(blocked.ok, false, 'a disabled account cannot sign in')
})

test('a number that belongs to another customer, or no number at all, is refused', async (t) => {
  const { adapter, realmId } = await boot(t)
  await call(adapter, 'partner.savePartner', { id: 'other', kind: 'person', name: 'Khách khác' })
  await call(adapter, 'website.issueCustomerAccess', { realmId, partnerId: 'cuc', phone: '0708580468' })
  const taken = await call(adapter, 'website.issueCustomerAccess', {
    realmId,
    partnerId: 'other',
    phone: '+84708580468',
  })
  assert.deepEqual(taken.errors, [{ field: 'phone', message: 'website.customer.error.phoneInUse' }])
  const none = await call(adapter, 'website.issueCustomerAccess', { realmId, partnerId: 'other' })
  assert.deepEqual(none.errors, [{ field: 'phone', message: 'website.customer.error.loginRequired' }])
  const bad = await call(adapter, 'website.issueCustomerAccess', {
    realmId,
    partnerId: 'other',
    phone: '12345',
  })
  assert.deepEqual(bad.errors, [{ field: 'phone', message: 'website.customer.error.invalidPhone' }])
})

test('a realm that hands out accounts refuses self sign-up', async (t) => {
  const { adapter, realmId } = await boot(t)
  const open = await call(adapter, 'website.registerCustomer', {
    realmId,
    displayName: 'Khách',
    email: 'open@example.test',
    password: 'a-long-enough-password',
  })
  assert.equal(open.ok, true, 'a realm without the switch keeps taking sign-ups')
  await adapter.run(
    `UPDATE ${adapter.quoteIdent(tableNameFor('website.CustomerRealm'))} SET "selfSignup" = 0 WHERE id = ?`,
    [realmId],
  )
  const closed = await call(adapter, 'website.registerCustomer', {
    realmId,
    displayName: 'Khách',
    email: 'closed@example.test',
    password: 'a-long-enough-password',
  })
  assert.deepEqual(closed.errors, [{ field: 'realm', message: 'website.customer.error.signupClosed' }])
})
