// The warehouse counts in the product's own unit.
//
// Quants, reservations, the forecast and every comparison between them assume
// one unit per product. A move that entered the ledger in the vendor's boxes
// put boxes-as-pieces on the shelf: two boxes of twelve counted as two, the
// forecast agreed, and a reservation for one box held one piece. So the unit a
// caller speaks — a purchase line's box, an orderpoint's pallet — is converted
// at the door, and everything behind it stays a single number.

import type { Ctx, Row } from '@ketvietlab/ketjs'
import { convertQty, type Unit, UomError } from '../uom/convert.ts'

const unitOf = async (ctx: Ctx, id: unknown): Promise<Unit | null> => {
  const row = (await ctx.db.select('uom.Unit', { id }))[0]
  return row
    ? {
        id: String(row.id),
        parentPath: String(row.parentPath ?? ''),
        absoluteFactor: Number(row.absoluteFactor ?? 0),
        rounding: Number(row.rounding) || 0.01,
      }
    : null
}

/** The unit the product's own ledger is kept in. */
export const productUnitId = async (ctx: Ctx, productId: unknown): Promise<string | null> => {
  const product = (await ctx.db.select('product.Product', { id: productId }))[0]
  const template = product && (await ctx.db.select('product.Template', { id: product.templateId }))[0]
  return template?.uomId == null ? null : String(template.uomId)
}

/**
 * A caller's quantity expressed in the product's unit, or null when the two
 * units measure different things — kilograms of a product counted in pieces is
 * refused, not approximated.
 */
export const toProductUnit = async (
  ctx: Ctx,
  productId: unknown,
  fromUomId: unknown,
  quantity: number,
): Promise<{ uomId: string; quantity: number } | null> => {
  const baseId = await productUnitId(ctx, productId)
  if (baseId === null) return null
  if (String(fromUomId) === baseId) return { uomId: baseId, quantity }
  const [from, to] = await Promise.all([unitOf(ctx, fromUomId), unitOf(ctx, baseId)])
  if (!from || !to) return null
  try {
    return { uomId: baseId, quantity: convertQty(quantity, from, to) }
  } catch (error) {
    if (error instanceof UomError) return null
    throw error
  }
}

export type { Row }
