import { defineModule, eq, from, KetError } from '@ketvietlab/ketjs'
import type { Ctx } from '@ketvietlab/ketjs'
import { targetFunctions } from '../mail/index.ts'
import { withDeliveryStatus } from '../mail_transport/index.ts'

const functions = withDeliveryStatus(
  targetFunctions({
    resModel: 'product.Template',
    targetEffect: 'read:product.Template',
    verify: async (ctx: Ctx, targetId: string) => {
      const T = ctx.table('product.Template')
      const row = await ctx.db.one(from(T).where(eq(T.id, targetId)))
      if (!row)
        throw new KetError({
          code: 'E_PRODUCT_MAIL_TARGET',
          module: 'product_mail_backend',
          message: 'product is missing or unavailable in this tenant',
        })
      return { id: String(row.id), displayName: String(row.name) }
    },
  }),
)

export default defineModule({
  name: 'product_mail_backend',
  version: '0.1.0',
  depends: ['product_backend', 'mail_backend', 'mail_transport'],
  functions,
  fills: {
    'product_backend:template.collaboration': `{% island "mail.chatter" %}`,
  },
})

export { functions }
