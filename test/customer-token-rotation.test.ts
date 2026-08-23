import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test, type TestContext } from 'node:test'
import { callFn, compose, migrateOne, registerFunctions, sqliteAdapter } from '@ketvietlab/ketjs'
import type { Adapter, Row } from '@ketvietlab/ketjs'
import { address, paperTheme, partner, website } from '@ketvietlab/ketsuite'

const modules = [address, partner, website, paperTheme]
const manifest = compose(modules)
const scope = { company: 'default', branches: null }
const digest = (value: string) => createHash('sha256').update(value).digest('hex')

const call = (adapter: Adapter, name: string, input: Record<string, unknown> = {}) =>
  callFn(name, input, { adapter, manifest, scope }).then((r) => r.value as Row | null)

const boot = async (t: TestContext) => {
  const adapter = sqliteAdapter()
  await adapter.open()
  t.after(() => adapter.close())
  await migrateOne(adapter, manifest)
  registerFunctions(modules)
  await call(adapter, 'website.saveSite', {
    id: 'shop',
    name: 'Shop',
    title: 'Shop',
    defaultLocale: 'vi',
    theme: 'theme_paper',
  })
  const realm = (await call(adapter, 'website.customerRealmForSite', { siteId: 'shop' }))!
  const registered = (await call(adapter, 'website.registerCustomer', {
    realmId: realm.id,
    displayName: 'Khách',
    email: 'shopper@example.test',
    password: 'a-long-enough-password',
  }))!
  const account = (registered as { account: Row }).account
  const first = 'refresh-token-issued-at-sign-in'
  await call(adapter, 'website.issueCustomerTokenGrant', {
    id: 'grant-1',
    accountId: account.id,
    accessDigest: digest('access-token-issued-at-sign-in'),
    refreshDigest: digest(first),
  })
  return { adapter, first }
}

const rotate = (adapter: Adapter, token: string, requestKey: string) =>
  call(adapter, 'website.rotateCustomerTokenGrant', { refreshDigest: digest(token), requestKey })

test('token rotation: the next pair is not computable from the token that produced it', async (t) => {
  const { adapter, first } = await boot(t)
  const rotated = (await rotate(adapter, first, 'key-1'))!
  assert.ok(rotated.refreshToken, 'rotation returned a refresh token')

  // The old derivation was sha256 over the old token and the key, so anyone
  // holding both could compute this. The grant's secret is what they lack.
  const guessable = Buffer.from(digest(`refresh:1\n${first}\nkey-1`), 'hex').toString('base64url')
  assert.notEqual(rotated.refreshToken, guessable)
  assert.notEqual(rotated.refreshToken, first)

  // Two grants given the same visible inputs still diverge, because the secret differs.
  const other = sqliteAdapter()
  await other.open()
  t.after(() => other.close())
  await migrateOne(other, manifest)
  const second = await boot(t)
  const elsewhere = (await rotate(second.adapter, second.first, 'key-1'))!
  assert.notEqual(elsewhere.refreshToken, rotated.refreshToken)
})

test('token rotation: a lost response is retried into the same pair', async (t) => {
  const { adapter, first } = await boot(t)
  const once = (await rotate(adapter, first, 'same-key'))!
  // The client never saw that answer, so it asks again with the token it still holds.
  const again = (await rotate(adapter, first, 'same-key'))!
  assert.equal(again.refreshToken, once.refreshToken)
  assert.equal(again.accessToken, once.accessToken)
  assert.equal(again.reused, undefined, 'a retry is not theft')
})

test('token rotation: replaying a spent token outside the grace revokes the grant', async (t) => {
  const { adapter, first } = await boot(t)
  const rotated = (await rotate(adapter, first, 'key-1'))!
  assert.ok(rotated.refreshToken)

  // Age the rotation past the grace window: the same request now reads as a
  // stolen token being presented, not as a retry.
  await adapter.run(`UPDATE website_customer_token_grant SET "lastRotatedAt" = ? WHERE id = ?`, [
    new Date(Date.now() - 10 * 60_000).toISOString(),
    'grant-1',
  ])
  const replay = (await rotate(adapter, first, 'key-1'))!
  assert.equal(replay.reused, true)
  assert.equal(replay.account, undefined, 'reuse hands back no credentials')

  const grant = (
    await adapter.all(`SELECT "revokedAt", "revokeReason" FROM website_customer_token_grant`)
  )[0]!
  assert.ok(grant.revokedAt, 'the family is revoked')
  assert.equal(grant.revokeReason, 'refresh-token-reuse')

  // And the token the thief rotated to is dead along with it.
  assert.equal(await rotate(adapter, String(rotated.refreshToken), 'key-2'), null)
})
