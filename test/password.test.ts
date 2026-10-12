import assert from 'node:assert/strict'
import { scryptSync } from 'node:crypto'
import { test } from 'node:test'
import { hashPassword, verifyPassword } from '@ketvietlab/ketjs'

test('passwords: salted Unicode credentials round-trip without normalization', async () => {
  const password = 'A long e\u0301 credential 🔑'
  const first = await hashPassword(password)
  assert.notEqual(first, await hashPassword(password))
  assert.equal(await verifyPassword(password, first), true)
  assert.equal(await verifyPassword(password.normalize('NFC'), first), false)
  assert.equal(await verifyPassword('a different credential', first), false)
  assert.equal(await verifyPassword(password, null), false)
})

test('passwords: malformed work factors and oversized inputs are bounded', async () => {
  const encoded = await hashPassword('Another long credential')
  assert.equal(
    await verifyPassword('Another long credential', encoded.replace('$32768$', '$2147483648$')),
    false,
  )
  assert.equal(await verifyPassword('Another long credential', encoded + 'x'), false)
  assert.equal(await verifyPassword('x'.repeat(1025), encoded), false)
  await assert.rejects(hashPassword(''), RangeError)
  await assert.rejects(hashPassword('🔑'.repeat(257)), RangeError)
})

test('passwords: allowed stored work factors are verified independently of the current default', async () => {
  const password = 'Existing stronger password hash'
  const salt = Buffer.alloc(16, 7)
  let encoded = ''
  for (const profile of [
    { N: 65536, r: 8, p: 2, maxmem: 96 * 1024 * 1024 },
    { N: 131072, r: 8, p: 1, maxmem: 160 * 1024 * 1024 },
  ]) {
    const key = scryptSync(password, salt, 32, profile)
    encoded = `scrypt$${profile.N}$${profile.r}$${profile.p}$${salt.toString('base64url')}$${key.toString('base64url')}`
    assert.equal(await verifyPassword(password, encoded), true)
    assert.equal(await verifyPassword('incorrect', encoded), false)
  }
  for (const prefix of ['scrypt$65536$8$99$', 'scrypt$32768$8$1$', 'scrypt$065536$8$2$']) {
    assert.equal(await verifyPassword(password, prefix + encoded.split('$').slice(4).join('$')), false)
  }
})
