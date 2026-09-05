import type { Ctx, Row } from '@ketvietlab/ketjs'

export type SellableUom = {
  id: string
  name: string
  barcode: string | null
  relativeFactor: string
  rounding: string
}

export type SellableProduct = {
  product: Row
  template: Row
  uoms: SellableUom[]
}

export type SellableProductResult =
  | { ok: true; value: SellableProduct }
  | { ok: false; field: 'productId' | 'uomId'; message: string }

const active = (value: unknown): boolean => value !== false && value !== 0
const rootOf = (unit: Row): string =>
  String(unit.parentPath ?? '')
    .split('/')
    .filter(Boolean)[0] ?? ''

/** Resolve product and explicitly enabled UOMs for every selling aggregate. */
export async function sellableProduct(
  ctx: Ctx,
  productId: unknown,
  requestedUomId?: unknown,
  options: { allowMeasurementTreeUom?: boolean } = {},
): Promise<SellableProductResult> {
  const product = (await ctx.db.select('product.Product', { id: productId }))[0]
  if (!product || !active(product.active))
    return { ok: false, field: 'productId', message: 'product variant is missing or inactive' }

  const template = (await ctx.db.select('product.Template', { id: product.templateId }))[0]
  if (!template || !active(template.active) || template.saleOk !== true)
    return { ok: false, field: 'productId', message: 'product is not available for sale' }
  if (!template.uomId) return { ok: false, field: 'uomId', message: 'product has no default unit of measure' }

  const allowed = new Map<string, string | null>([[String(template.uomId), null]])
  for (const link of await ctx.db.select('product.TemplateUom', { templateId: template.id }))
    allowed.set(String(link.uomId), allowed.get(String(link.uomId)) ?? null)
  for (const link of await ctx.db.select('product.ProductUom', { productId: product.id }))
    if (!ctx.scope.company || String(link.companyId) === ctx.scope.company)
      allowed.set(String(link.uomId), link.barcode == null ? null : String(link.barcode))

  const units = await Promise.all(
    [...allowed.entries()].map(async ([id, barcode]) => ({
      row: (await ctx.db.select('uom.Unit', { id }))[0],
      barcode,
    })),
  )
  const primary = units.find(({ row }) => String(row?.id) === String(template.uomId))?.row
  if (!primary) return { ok: false, field: 'uomId', message: 'product default unit does not exist' }
  const root = rootOf(primary)
  const uoms = units
    .filter(({ row }) => row && active(row.active) && rootOf(row) === root)
    .map(({ row, barcode }) => ({
      id: String(row!.id),
      name: String(row!.name),
      barcode,
      relativeFactor: String(row!.relativeFactor),
      rounding: String(row!.rounding),
    }))
    .sort((a, b) => a.id.localeCompare(b.id))

  if (requestedUomId != null && !uoms.some((unit) => unit.id === String(requestedUomId))) {
    const requested = (await ctx.db.select('uom.Unit', { id: requestedUomId }))[0]
    if (!options.allowMeasurementTreeUom || !requested || rootOf(requested) !== root)
      return { ok: false, field: 'uomId', message: 'unit of measure is not enabled for this product' }
    // Sales historically accepts every unit in the product measurement tree. Keep that public
    // behaviour while POS catalog discovery remains restricted to explicitly enabled units.
    uoms.push({
      id: String(requested.id),
      name: String(requested.name),
      barcode: null,
      relativeFactor: String(requested.relativeFactor),
      rounding: String(requested.rounding),
    })
    uoms.sort((a, b) => a.id.localeCompare(b.id))
  }

  return { ok: true, value: { product, template, uoms } }
}
