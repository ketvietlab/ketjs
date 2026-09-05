import { defineJob } from '@ketvietlab/ketjs'
import type { FnSpec, JobContext, JobSpec } from '@ketvietlab/ketjs'
import { orderFunctions } from '../loyalty/order-functions.ts'
import { reconcileOrder } from './functions.ts'

const effectsOf = (...specs: Array<FnSpec | undefined>): string[] => [
  ...new Set(specs.flatMap((spec) => spec?.effects ?? [])),
]

export const jobs: Record<string, JobSpec> = {
  reconcileOrder: defineJob({
    queue: 'maintenance',
    input: { orderId: 'id' },
    effects: [
      'read:pos.Order',
      'write:pos.Order',
      'read:pos.Config',
      'read:pos.OrderLine',
      'read:loyalty.Application',
      ...effectsOf(orderFunctions['order.finalize'], orderFunctions['order.reverse']),
    ],
    idempotent: true,
    maxAttempts: 20,
    handler: async (ctx: JobContext, args) => {
      const result = await reconcileOrder(ctx, String(args.orderId))
      if (result.ok !== true) {
        const code = String(((result.errors as Array<{ code?: unknown }> | undefined) ?? [])[0]?.code ?? '')
        throw new Error(code || 'POS Loyalty reconciliation did not settle')
      }
    },
  }),
}
