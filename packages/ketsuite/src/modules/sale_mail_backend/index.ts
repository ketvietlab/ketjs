import { defineModule, eq, from, KetError } from '@ketvietlab/ketjs'
import type { Ctx } from '@ketvietlab/ketjs'
import { targetFunctions } from '../mail/index.ts'
import { withDeliveryStatus } from '../mail_transport/index.ts'

const functions = withDeliveryStatus(
  targetFunctions({
    resModel: 'sale.Order',
    targetEffect: 'read:sale.Order',
    verify: async (ctx: Ctx, targetId: string) => {
      const O = ctx.table('sale.Order')
      const row = await ctx.db.one(from(O).where(eq(O.id, targetId)))
      if (!row)
        throw new KetError({
          code: 'E_SALE_MAIL_TARGET',
          module: 'sale_mail_backend',
          message: 'sales order is outside the current company or missing',
        })
      return { id: String(row.id), displayName: String(row.name) }
    },
  }),
)

export default defineModule({
  name: 'sale_mail_backend',
  group: 'commerce',
  version: '0.1.0',
  depends: ['sale_backend', 'mail_backend', 'mail_transport'],
  install: 'auto',
  functions,
  fills: {
    'sale_backend:order.collaboration': `{% island "mail.chatter" %}`,
  },
})

export { functions }
