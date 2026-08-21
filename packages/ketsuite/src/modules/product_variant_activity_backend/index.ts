import { defineModule, eq, from, KetError } from '@ketvietlab/ketjs'
import type { Ctx } from '@ketvietlab/ketjs'
import { targetActivityFunctions } from '../activity/index.ts'

const functions = targetActivityFunctions({
  resModel: 'product.Product',
  targetEffect: 'read:product.Product',
  verify: async (ctx: Ctx, targetId: string) => {
    const P = ctx.table('product.Product')
    const row = await ctx.db.one(from(P).where(eq(P.id, targetId), eq(P.active, true)))
    if (!row)
      throw new KetError({
        code: 'E_PRODUCT_VARIANT_ACTIVITY_TARGET',
        module: 'product_variant_activity_backend',
        message: 'product variant is archived, missing, or unavailable in this tenant',
      })
    return { id: String(row.id), displayName: String(row.defaultCode || row.id) }
  },
})

export default defineModule({
  name: 'product_variant_activity_backend',
  version: '0.1.0',
  depends: ['product_backend', 'product_variant_mail_backend', 'activity_backend'],
  install: 'auto',
  functions,
  fills: {
    'product_backend:variant.collaboration': `{% island "activity.record" %}`,
  },
})

export { functions }
