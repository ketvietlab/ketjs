import { defineModule, eq, from, KetError } from '@ketvietlab/ketjs'
import type { Ctx } from '@ketvietlab/ketjs'
import { targetFunctions } from '../mail/index.ts'
import { withDeliveryStatus } from '../mail_transport/index.ts'

const functions = withDeliveryStatus(
  targetFunctions({
    resModel: 'account.Move',
    targetEffect: 'read:account.Move',
    verify: async (ctx: Ctx, targetId: string) => {
      const M = ctx.table('account.Move')
      const row = await ctx.db.one(from(M).where(eq(M.id, targetId)))
      if (!row)
        throw new KetError({
          code: 'E_ACCOUNT_MAIL_TARGET',
          module: 'account_mail_backend',
          message: 'account move is outside the current company or missing',
        })
      return { id: String(row.id), displayName: String(row.name) }
    },
  }),
)

export default defineModule({
  name: 'account_mail_backend',
  group: 'accounting',
  version: '0.1.0',
  depends: ['account_backend', 'mail_backend', 'mail_transport'],
  install: 'auto',
  functions,
  fills: { 'account_backend:move.collaboration': `{% island "mail.chatter" %}` },
})

export { functions }
