import assert from 'node:assert/strict'
import { test } from 'node:test'
import { enforcePolicy } from '@ketvietlab/ketjs'

test('domain policy allows a permitted record and emits no denial audit', async () => {
  let audited = false
  await enforcePolicy({
    policy: 'sale.order-approval',
    allowed: true,
    audit: async () => {
      audited = true
    },
  })
  assert.equal(audited, false)
})

test('domain policy denial uses a stable code and sanitized audit evidence', async () => {
  const evidence: unknown[] = []
  await assert.rejects(
    () =>
      enforcePolicy({
        policy: 'sale.order-approval',
        allowed: false,
        actor: 'approver',
        denialCode: 'E_SALE_SELF_APPROVAL',
        targetDigest: 'sha256:opaque',
        audit: async (item) => {
          evidence.push(item)
        },
      }),
    (error: unknown) => (error as { code?: string }).code === 'E_SALE_SELF_APPROVAL',
  )
  assert.deepEqual(evidence, [
    {
      policy: 'sale.order-approval',
      code: 'E_SALE_SELF_APPROVAL',
      actor: 'approver',
      targetDigest: 'sha256:opaque',
    },
  ])
})

test('domain policy refuses unstable unqualified policy keys', async () => {
  await assert.rejects(
    () => enforcePolicy({ policy: 'approve', allowed: false }),
    (error: unknown) => (error as { code?: string }).code === 'E_POLICY_CONTRACT_INVALID',
  )
})
