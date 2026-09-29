import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'

async function recordAccessDenial(ctx: Ctx, args: Row) {
  // This is an internal server boundary, never an anonymous event-collection endpoint.
  if (!ctx.actor || ctx.actor !== args.userId || !ctx.manifest.functions[String(args.fnKey)])
    return { ok: false }
  if (!(await ctx.db.select('user.User', { id: ctx.actor })).length) return { ok: false }
  return ctx.tx(async (tx) => {
    const previous = (await tx.db.select('user.AccessDenial', { id: ctx.actor }))[0]
    const row = {
      id: ctx.actor,
      fnKey: String(args.fnKey),
      occurredAt: new Date().toISOString(),
      count: previous?.fnKey === args.fnKey ? Math.min(Number(previous.count) + 1, 2147483647) : 1,
      companyId: args.companyId || null,
      branchId: args.branchId || null,
    }
    if (!previous) await tx.db.insertIfAbsent('user.AccessDenial', row)
    else
      await tx.db.compareAndSet(
        'user.AccessDenial',
        { id: ctx.actor },
        { occurredAt: previous.occurredAt, count: previous.count },
        row,
      )
    return { ok: true }
  })
}

export const accessDenialFunctions: Record<string, FnSpec> = {
  recordAccessDenial: defineFn({
    exposure: 'internal',
    input: { userId: 'id', fnKey: 'text', companyId: 'text?', branchId: 'text?' },
    output: { ok: 'bool' },
    effects: ['read:user.User', 'read:user.AccessDenial', 'write:user.AccessDenial'],
    handler: recordAccessDenial,
  }),
}
