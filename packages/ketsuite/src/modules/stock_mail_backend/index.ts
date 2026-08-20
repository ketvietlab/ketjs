import { defineModule, eq, from, KetError } from 'ketjs'
import type { Ctx } from 'ketjs'
import { targetFunctions } from '../mail/index.ts'
import { withDeliveryStatus } from '../mail_transport/index.ts'

const functions = withDeliveryStatus(
  targetFunctions({
    resModel: 'stock.Picking',
    targetEffect: 'read:stock.Picking',
    verify: async (ctx: Ctx, targetId: string) => {
      const P = ctx.table('stock.Picking')
      const row = await ctx.db.one(from(P).where(eq(P.id, targetId)))
      if (!row)
        throw new KetError({
          code: 'E_STOCK_MAIL_TARGET',
          module: 'stock_mail_backend',
          message: 'transfer is outside the current company or missing',
        })
      return { id: String(row.id), displayName: String(row.name) }
    },
  }),
)

export default defineModule({
  name: 'stock_mail_backend',
  version: '0.1.0',
  depends: ['stock_backend', 'mail_backend', 'mail_transport'],
  install: 'auto',
  functions,
  fills: {
    'stock_backend:picking.collaboration': `{% island "mail.chatter" %}`,
  },
})

export { functions }
