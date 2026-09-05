import { defineModule, eq, from, KetError } from '@ketvietlab/ketjs'
import type { Ctx } from '@ketvietlab/ketjs'
import { targetActivityFunctions } from '../activity/index.ts'

const functions = targetActivityFunctions({
  resModel: 'account.Move',
  targetEffect: 'read:account.Move',
  verify: async (ctx: Ctx, targetId: string) => {
    const M = ctx.table('account.Move')
    const row = await ctx.db.one(from(M).where(eq(M.id, targetId)))
    if (!row)
      throw new KetError({
        code: 'E_ACCOUNT_ACTIVITY_TARGET',
        module: 'account_activity_backend',
        message: 'account move is outside the current company or missing',
      })
    return { id: String(row.id), displayName: String(row.name) }
  },
})

export default defineModule({
  name: 'account_activity_backend',
  version: '0.1.0',
  depends: ['account_backend', 'account_mail_backend', 'activity_backend'],
  functions,
  fills: { 'account_backend:move.collaboration': `{% island "activity.record" %}` },
})

export { functions }
