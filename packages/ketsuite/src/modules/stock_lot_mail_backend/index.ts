import { defineModule, eq, from, KetError } from '@ketvietlab/ketjs'
import type { Ctx } from '@ketvietlab/ketjs'
import { targetFunctions } from '../mail/index.ts'
import { withDeliveryStatus } from '../mail_transport/index.ts'

const functions = withDeliveryStatus(
  targetFunctions({
    resModel: 'stock.Lot',
    targetEffect: 'read:stock.Lot',
    verify: async (ctx: Ctx, targetId: string) => {
      const L = ctx.table('stock.Lot')
      const row = await ctx.db.one(from(L).where(eq(L.id, targetId)))
      if (!row)
        throw new KetError({
          code: 'E_STOCK_LOT_MAIL_TARGET',
          module: 'stock_lot_mail_backend',
          message: 'lot or serial is missing or outside the current company',
        })
      return { id: String(row.id), displayName: String(row.name) }
    },
  }),
)

export default defineModule({
  name: 'stock_lot_mail_backend',
  version: '0.1.0',
  depends: ['stock_backend', 'mail_backend', 'mail_transport'],
  functions,
  fills: {
    'stock_backend:lot.collaboration': `{% island "mail.chatter" %}`,
  },
})

export { functions }
