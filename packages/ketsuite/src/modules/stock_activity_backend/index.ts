import { defineModule, eq, from, KetError } from '@ketvietlab/ketjs'
import type { Ctx } from '@ketvietlab/ketjs'
import { targetActivityFunctions } from '../activity/index.ts'

const functions = targetActivityFunctions({
  resModel: 'stock.Picking',
  targetEffect: 'read:stock.Picking',
  verify: async (ctx: Ctx, targetId: string) => {
    const P = ctx.table('stock.Picking')
    const row = await ctx.db.one(from(P).where(eq(P.id, targetId)))
    if (!row)
      throw new KetError({
        code: 'E_STOCK_ACTIVITY_TARGET',
        module: 'stock_activity_backend',
        message: 'transfer is outside the current company or missing',
      })
    return { id: String(row.id), displayName: String(row.name) }
  },
})

export default defineModule({
  name: 'stock_activity_backend',
  group: 'commerce',
  version: '0.1.0',
  depends: ['stock_backend', 'stock_mail_backend', 'activity_backend'],
  install: 'auto',
  functions,
  fills: {
    'stock_backend:picking.collaboration': `{% island "activity.record" %}`,
  },
})

export { functions }
