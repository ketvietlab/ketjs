import { defineModule, eq, from, KetError } from '@ketvietlab/ketjs'
import type { Ctx } from '@ketvietlab/ketjs'
import { targetFunctions } from '../mail/index.ts'
import { withDeliveryStatus } from '../mail_transport/index.ts'

const functions = withDeliveryStatus(
  targetFunctions({
    resModel: 'product.Product',
    targetEffect: 'read:product.Product',
    verify: async (ctx: Ctx, targetId: string) => {
      const P = ctx.table('product.Product')
      const row = await ctx.db.one(from(P).where(eq(P.id, targetId)))
      if (!row)
        throw new KetError({
          code: 'E_PRODUCT_VARIANT_MAIL_TARGET',
          module: 'product_variant_mail_backend',
          message: 'product variant is missing or unavailable in this tenant',
        })
      return { id: String(row.id), displayName: String(row.defaultCode || row.id) }
    },
  }),
)

export default defineModule({
  name: 'product_variant_mail_backend',
  group: 'commerce',
  version: '0.1.0',
  depends: ['product_backend', 'mail_backend', 'mail_transport'],
  install: 'auto',
  functions,
  fills: {
    'product_backend:variant.collaboration': `{% island "mail.chatter" %}`,
  },
})

export { functions }
