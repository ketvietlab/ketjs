import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { addTimeline, commandKey, invalid, issue, now } from '../crm/index.ts'
import { functions as saleFunctions } from '../sale/functions.ts'

export const quotationEffects = [
  'read:crm.Case',
  'read:crm.SalesDetail',
  'read:crm_sale.OpportunityQuotation',
  'write:crm_sale.OpportunityQuotation',
  'write:crm.TimelineEntry',
  'read:sale.Sequence',
  'write:sale.Sequence',
  'read:sale.Order',
  'write:sale.Order',
  'read:sale.OrderLine',
  'write:sale.OrderLine',
  'read:partner.Partner',
  'read:stock.Warehouse',
  'read:pricing.Pricelist',
  'read:pricing.PricelistItem',
  'read:account.PaymentTerm',
  'read:account.Tax',
  'read:company.Company',
  'read:product.Product',
  'read:product.Template',
  'read:product.Category',
  'read:product.Cost',
  'read:uom.Unit',
] as const

type ProductInput = {
  id?: string
  productId: string
  productUomId: string
  quantity: unknown
  name?: string
  priceUnit?: unknown
  discount?: unknown
  taxId?: string
}

const productsOf = (value: unknown): ProductInput[] | null => {
  if (value == null) return []
  if (!Array.isArray(value)) return null
  const products: ProductInput[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') return null
    const row = item as Record<string, unknown>
    if (!row.productId || !row.productUomId || !(Number(row.quantity) > 0)) return null
    products.push({
      ...(row.id ? { id: String(row.id) } : {}),
      productId: String(row.productId),
      productUomId: String(row.productUomId),
      quantity: row.quantity,
      ...(row.name ? { name: String(row.name) } : {}),
      ...(row.priceUnit != null ? { priceUnit: row.priceUnit } : {}),
      ...(row.discount != null ? { discount: row.discount } : {}),
      ...(row.taxId ? { taxId: String(row.taxId) } : {}),
    })
  }
  return products
}

export async function createQuotationForCase(
  ctx: Ctx,
  input: {
    id: string
    caseId: string
    warehouseId: string
    pricelistId?: string
    paymentTermId?: string
    validityDate?: string
    notes?: string
    products?: unknown
    idempotencyKey: string
  },
): Promise<Row> {
  if (!ctx.actor) return invalid(issue('actor', 'crm.error.actorRequired'))
  if (!commandKey(input.idempotencyKey))
    return invalid(issue('idempotencyKey', 'crm.error.idempotencyRequired'))
  const products = productsOf(input.products)
  if (!products) return invalid(issue('products', 'crm.error.required'))
  return ctx.tx(async (tx) => {
    const held = (await tx.db.select('crm.Case', { id: input.caseId }))[0]
    if (held?.kind !== 'opportunity' || !held.partnerId)
      return invalid(issue('caseId', 'crm_sale.error.opportunityRequired'))
    const existing = (
      await tx.db.select('crm_sale.OpportunityQuotation', {
        salesOrderId: input.id,
      })
    )[0]
    if (existing) {
      if (existing.caseId !== input.caseId) return invalid(issue('id', 'crm.error.idempotencyRequired'))
      const order = (await tx.db.select('sale.Order', { id: input.id }))[0]
      return { ok: true, id: input.id, name: order?.name }
    }
    const created = (await saleFunctions.createOrder!.handler(tx, {
      id: input.id,
      partnerId: held.partnerId,
      warehouseId: input.warehouseId,
      ...(input.pricelistId ? { pricelistId: input.pricelistId } : {}),
      ...(input.paymentTermId ? { paymentTermId: input.paymentTermId } : {}),
      ...(input.validityDate ? { validityDate: input.validityDate } : {}),
      notes: input.notes ?? `CRM opportunity ${input.caseId}`,
      clientOrderRef: `CRM:${input.caseId}`,
    })) as Row
    if (created.ok !== true) return created
    for (const [index, product] of products.entries()) {
      const line = (await saleFunctions.addLine!.handler(tx, {
        id: product.id ?? `${input.id}:line:${index + 1}`,
        orderId: input.id,
        productId: product.productId,
        productUomId: product.productUomId,
        productUomQty: product.quantity,
        ...(product.name ? { name: product.name } : {}),
        ...(product.priceUnit != null ? { priceUnit: product.priceUnit } : {}),
        ...(product.discount != null ? { discount: product.discount } : {}),
        ...(product.taxId ? { taxId: product.taxId } : {}),
        sequence: (index + 1) * 10,
      })) as Row
      if (line.ok !== true) return line
    }
    await tx.db.insert('crm_sale.OpportunityQuotation', {
      id: `crm-quotation:${input.id}`,
      caseId: input.caseId,
      salesOrderId: input.id,
      createdAt: now(),
    })
    await addTimeline(tx, {
      id: `timeline:${input.caseId}:quotation:${input.id}`,
      caseId: input.caseId,
      eventType: 'quotation_created',
      body: String(created.name ?? input.id),
      metadata: { salesOrderId: input.id },
    })
    return { ok: true, id: input.id, name: created.name }
  })
}

export const saleFunctionsPublic: Record<string, FnSpec> = {
  'sale.createQuotation': defineFn({
    input: {
      id: 'id',
      caseId: 'id',
      warehouseId: 'id',
      pricelistId: 'id?',
      paymentTermId: 'id?',
      validityDate: 'datetime?',
      notes: 'text?',
      products: 'json?',
      idempotencyKey: 'text',
    },
    output: { ok: 'bool', id: 'id?', name: 'text?', errors: 'json?' },
    effects: [...quotationEffects],
    idempotent: true,
    agent: true,
    handler: (ctx, args) => createQuotationForCase(ctx, args as never),
  }),
}
