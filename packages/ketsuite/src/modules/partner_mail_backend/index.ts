import { defineModule, eq, from, KetError } from '@ketvietlab/ketjs'
import type { Ctx } from '@ketvietlab/ketjs'
import { targetFunctions } from '../mail/index.ts'
import { withDeliveryStatus } from '../mail_transport/index.ts'

const functions = withDeliveryStatus(
  targetFunctions({
    resModel: 'partner.Partner',
    targetEffect: 'read:partner.Partner',
    verify: async (ctx: Ctx, targetId: string) => {
      const P = ctx.table('partner.Partner')
      const row = await ctx.db.one(from(P).where(eq(P.id, targetId)))
      if (!row)
        throw new KetError({
          code: 'E_PARTNER_MAIL_TARGET',
          module: 'partner_mail_backend',
          message: 'partner is missing or unavailable in this tenant',
        })
      return { id: String(row.id), displayName: String(row.name) }
    },
  }),
)

export default defineModule({
  name: 'partner_mail_backend',
  version: '0.1.0',
  depends: ['partner_backend', 'mail_backend', 'mail_transport'],
  functions,
  fills: {
    'partner_backend:record.collaboration': `{% island "mail.chatter" %}`,
  },
})

export { functions }
