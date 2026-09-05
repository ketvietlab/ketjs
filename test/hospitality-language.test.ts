import assert from 'node:assert/strict'
import { test } from 'node:test'
import { messages as billingMessages } from '../packages/ketsuite/src/modules/hospitality_billing/messages.ts'
import { messages as coreMessages } from '../packages/ketsuite/src/modules/hospitality_core/messages.ts'

const placeholders = (value: unknown): string[] =>
  [...String(value).matchAll(/\{([^}]+)\}/g)].map((match) => match[1]!).sort()

const assertLocaleParity = (catalogue: Record<string, Record<string, unknown>>): void => {
  assert.deepEqual(Object.keys(catalogue.vi).sort(), Object.keys(catalogue.en).sort())
  for (const key of Object.keys(catalogue.vi))
    assert.deepEqual(placeholders(catalogue.vi[key]), placeholders(catalogue.en[key]), key)
}

test('Hospitality copy stays complete and keeps interpolation compatible across locales', () => {
  assertLocaleParity(coreMessages)
  assertLocaleParity(billingMessages)
})

test('Hospitality operator copy avoids internal implementation language', () => {
  const values = [...Object.values(coreMessages.vi), ...Object.values(coreMessages.en)]
  const internalTerms =
    /\b(canonical|lifecycle|ledger|snapshot|worker|queue|idempotenc\w*|transaction|fulfillment|authority|mapping|replay|dispatch|revision|folio|occurrence|intention|provider|credential\w*|webhook|payload|checkpoint|keyring|nonce)\b/i
  const offenders = values.map(String).filter((value) => internalTerms.test(value))
  assert.deepEqual(offenders, [])

  assert.equal(coreMessages.vi['menu.folios'], 'Phiếu chi phí')
  assert.equal(coreMessages.en['menu.folios'], 'Guest bills')
  assert.equal(billingMessages.vi['screen.title'], 'Hoá đơn và thanh toán')
  assert.equal(billingMessages.en['screen.title'], 'Invoices and payments')
})
