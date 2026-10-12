import assert from 'node:assert/strict'
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
