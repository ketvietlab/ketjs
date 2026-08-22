import { defineModule, eq, from, KetError } from '@ketvietlab/ketjs'
import type { Ctx } from '@ketvietlab/ketjs'
import { targetActivityFunctions } from '../activity/index.ts'

const functions = targetActivityFunctions({
  resModel: 'product.Template',
  targetEffect: 'read:product.Template',
  verify: async (ctx: Ctx, targetId: string) => {
    const T = ctx.table('product.Template')
    const row = await ctx.db.one(from(T).where(eq(T.id, targetId)))
    if (!row)
      throw new KetError({
        code: 'E_PRODUCT_ACTIVITY_TARGET',
        module: 'product_activity_backend',
        message: 'product is missing or unavailable in this tenant',
      })
    return { id: String(row.id), displayName: String(row.name) }
  },
})

export default defineModule({
  name: 'product_activity_backend',
  version: '0.1.0',
  depends: ['product_backend', 'product_mail_backend', 'activity_backend'],
  install: 'auto',
  functions,
  fills: {
    'product_backend:template.collaboration': `{% island "activity.record" %}`,
  },
})

export { functions }
