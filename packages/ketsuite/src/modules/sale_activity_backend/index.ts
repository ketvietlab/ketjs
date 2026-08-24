import { defineModule, eq, from, KetError } from '@ketvietlab/ketjs'
import type { Ctx } from '@ketvietlab/ketjs'
import { targetActivityFunctions } from '../activity/index.ts'

const functions = targetActivityFunctions({
  resModel: 'sale.Order',
  targetEffect: 'read:sale.Order',
  verify: async (ctx: Ctx, targetId: string) => {
    const O = ctx.table('sale.Order')
    const row = await ctx.db.one(from(O).where(eq(O.id, targetId)))
    if (!row)
      throw new KetError({
        code: 'E_SALE_ACTIVITY_TARGET',
        module: 'sale_activity_backend',
        message: 'sales order is outside the current company or missing',
      })
    return { id: String(row.id), displayName: String(row.name) }
  },
})

export default defineModule({
  name: 'sale_activity_backend',
  group: 'commerce',
  version: '0.1.0',
  depends: ['sale_backend', 'sale_mail_backend', 'activity_backend'],
  install: 'auto',
  functions,
  fills: {
    'sale_backend:order.collaboration': `{% island "activity.record" %}`,
  },
})

export { functions }
