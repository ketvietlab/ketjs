import { defineFn } from '@ketvietlab/ketjs'
import type { FnSpec } from '@ketvietlab/ketjs'

export const auditFunctions: Record<string, FnSpec> = {
  listAuditEvents: defineFn({
    input: { subjectType: 'text?', subjectId: 'text?' },
    effects: ['read:account.AuditEvent'],
    agent: true,
    handler: async (ctx, args) =>
      (await ctx.db.select('account.AuditEvent'))
        .filter(
          (row) =>
            (!args.subjectType || row.subjectType === args.subjectType) &&
            (!args.subjectId || row.subjectId === args.subjectId),
        )
        .sort(
          (a, b) =>
            String(a.createdAt).localeCompare(String(b.createdAt)) ||
            String(a.id).localeCompare(String(b.id)),
        ),
  }),
}
