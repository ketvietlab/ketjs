import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { compareDecimals, subtractDecimals } from '../../account/money.ts'
import { ours } from '../scope.ts'

const invalid = (field: string, key: string) => ({
  ok: false,
  errors: [{ field, message: `stock.error.${key}` }],
})
/** A count is expressed in the product's stock unit. Preview never mutates a quant. */
async function previewInventoryCount(ctx: Ctx, args: Row) {
  const product = (await ctx.db.select('product.Product', { id: args.productId }))[0]
  const template = product ? (await ctx.db.select('product.Template', { id: product.templateId }))[0] : null
  if (!template?.isStorable) return invalid('productId', 'countStorable')
  const location = (await ours(ctx, 'stock.Location', { id: args.locationId }))[0]
  if (!location || !['internal', 'transit'].includes(String(location.usage)))
    return invalid('locationId', 'countLocation')
  if (compareDecimals(args.countedQuantity, '0') < 0) return invalid('countedQuantity', 'countPositive')
  if (template.tracking !== 'none' && template.tracking != null && !args.lotId)
    return invalid('lotId', 'countLot')
  if (template.tracking === 'serial' && compareDecimals(args.countedQuantity, '1') > 0)
    return invalid('countedQuantity', 'countSerial')
  if (args.lotId) {
    const lot = (await ours(ctx, 'stock.Lot', { id: args.lotId }))[0]
    if (lot?.productId !== args.productId) return invalid('lotId', 'countLot')
  }
  const quant = (
    await ours(ctx, 'stock.Quant', {
      productId: args.productId,
      locationId: args.locationId,
      lotKey: args.lotId ?? '',
    })
  )[0]
  const onHand = String(quant?.quantity ?? '0')
  const reserved = String(quant?.reservedQuantity ?? '0')
  if (compareDecimals(args.countedQuantity, reserved) < 0) return invalid('countedQuantity', 'countReserved')
  const unit = (await ctx.db.select('uom.Unit', { id: template.uomId }))[0]
  return {
    ok: true,
    onHand,
    reserved,
    difference: subtractDecimals(args.countedQuantity, onHand),
    unit: String(unit?.name ?? template.uomId),
    input: {
      productId: args.productId,
      locationId: args.locationId,
      countedQuantity: args.countedQuantity,
      productUomId: template.uomId,
      ...(args.lotId ? { lotId: args.lotId } : {}),
      expectedQuantRevision: quant ? Number(quant.version) : -1,
    },
  }
}
export const inventoryPreviewFunctions = {
  previewInventoryCount: defineFn({
    input: { productId: 'id', locationId: 'id', countedQuantity: 'decimal', lotId: 'id?' },
    effects: [
      'read:stock.Quant',
      'read:stock.Location',
      'read:stock.Lot',
      'read:product.Product',
      'read:product.Template',
      'read:uom.Unit',
    ],
    handler: previewInventoryCount,
  }),
}
