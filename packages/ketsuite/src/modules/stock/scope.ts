import type { Ctx, Row } from '@ketvietlab/ketjs'

/**
 * The company this operation writes to.
 *
 * Every model in `stock` is company-scoped, so there is no meaningful stock
 * operation without one; failing here beats writing a row the engine will refuse
 * or, worse, reading one it will never let us write back.
 */
export const company = (ctx: Ctx): string => {
  if (!ctx.scope.company) throw new Error('stock operation requires a company in scope')
  return ctx.scope.company
}

/**
 * Stock rows belonging to the company being written to, and no other.
 *
 * A read spans every company in `scope.companies` while a write is pinned to
 * `scope.company`. Left unnarrowed, a picker offers another legal entity's
 * warehouse and a validation accepts it as a reference — the row is then stamped
 * with this company while pointing into that one, and nothing downstream can
 * reconcile the two. Passing `companyId` explicitly narrows the readable set to
 * the writable one, so what a caller can see is what it can act on.
 */
export const ours = (ctx: Ctx, model: string, where: Row = {}): Promise<Row[]> =>
  ctx.db.select(model, { ...where, companyId: company(ctx) })

/** The single row a stock id names, or undefined when it belongs elsewhere. */
export const ourRow = async (ctx: Ctx, model: string, id: unknown): Promise<Row | undefined> =>
  (await ours(ctx, model, { id }))[0]
