import { eq, KetError } from '@ketvietlab/ketjs'
import type { Ctx, Row, Query } from '@ketvietlab/ketjs'

/** A Commerce grant belongs to the active workplace, not to every company membership. */
export const currentCompanyContext = (ctx: Ctx): Ctx => {
  const company = ctx.scope.company
  if (!company)
    throw new KetError({ code: 'E_NO_COMPANY_IN_SCOPE', message: 'Commerce requires an active company' })
  const scoped = (model: string) => ctx.manifest.models[model]?.scope !== 'shared'
  const where = (model: string, values: Row = {}) =>
    scoped(model) ? { ...values, companyId: company } : values
  const query = (q: Query) => (scoped(q.model) ? q.where(eq(ctx.table(q.model).companyId, company)) : q)
  return {
    ...ctx,
    db: {
      ...ctx.db,
      select: (model, values) => ctx.db.select(model, where(model, values)),
      all: (q) => ctx.db.all(query(q)),
      one: (q) => ctx.db.one(query(q)),
      count: (q) => ctx.db.count(query(q)),
      group: (q) => ctx.db.group(query(q)),
      del: (q) => ctx.db.del(query(q)),
      update: (model, values, patch) => ctx.db.update(model, where(model, values), patch),
      compareAndSet: (model, values, expected, patch) =>
        ctx.db.compareAndSet(model, where(model, values), expected, patch),
      commit: (change, values) => ctx.db.commit(change, values ? where(change.model, values) : values),
    },
    tx: (run) => ctx.tx((tx) => run(currentCompanyContext(tx))),
  }
}
