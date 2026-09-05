import type { Ctx, Row } from '@ketvietlab/ketjs'

/**
 * The company this operation writes to.
 *
 * Every model in `sale` is company-scoped, so there is no meaningful sales
 * operation without one; failing here beats writing a row the engine will refuse
 * or, worse, reading one it will never let us write back.
 */
export const company = (ctx: Ctx): string => {
  if (!ctx.scope.company) throw new Error('sale requires an active company')
  return ctx.scope.company
}

/**
 * Sale rows belonging to the company being written to, and no other.
 *
 * A read spans every company in `scope.companies` while a write is pinned to
 * `scope.company`. Left unnarrowed, the order list shows another legal entity's
 * orders and `createOrder` accepts their warehouse as a reference — the order is
 * then stamped with this company while its delivery points into that one, and
 * `reserveMove`, which keys quants by the active company, finds nothing to
 * reserve. `stock` carries the same helper for the same reason.
 */
export const ours = (ctx: Ctx, model: string, where: Row = {}): Promise<Row[]> =>
  ctx.db.select(model, { ...where, companyId: company(ctx) })

/**
 * A key that names the company it belongs to.
 *
 * `id` is a tenant-wide primary key, so a company-scoped row keyed by a constant
 * can only ever exist once across the whole tenant. The sequence row was keyed
 * `'sale'`, which meant the first company to raise an order owned it and every
 * other company's `nextName` either read a row it could never write or found
 * nothing at all.
 */
export const companyKey = (ctx: Ctx, ...parts: string[]): string => [company(ctx), ...parts].join(':')
