import { defineModule, eq, from, KetError } from '@ketvietlab/ketjs'
import type { Ctx } from '@ketvietlab/ketjs'
import { targetActivityFunctions } from '../activity/index.ts'

const functions = targetActivityFunctions({
  resModel: 'stock.Lot',
  targetEffect: 'read:stock.Lot',
  verify: async (ctx: Ctx, targetId: string) => {
    const L = ctx.table('stock.Lot')
    const row = await ctx.db.one(from(L).where(eq(L.id, targetId)))
    if (!row)
      throw new KetError({
        code: 'E_STOCK_LOT_ACTIVITY_TARGET',
        module: 'stock_lot_activity_backend',
        message: 'lot or serial is missing or outside the current company',
      })
    return { id: String(row.id), displayName: String(row.name) }
  },
})

export default defineModule({
  name: 'stock_lot_activity_backend',
  group: 'commerce',
  version: '0.1.0',
  depends: ['stock_backend', 'stock_lot_mail_backend', 'activity_backend'],
  install: 'auto',
  functions,
  fills: {
    'stock_backend:lot.collaboration': `{% island "activity.record" %}`,
  },
})

export { functions }
