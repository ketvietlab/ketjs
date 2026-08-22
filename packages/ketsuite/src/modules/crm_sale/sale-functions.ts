import { asc, defineFn, desc, eq, from, inArray } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { addTimeline, canReadCase, commandKey, invalid, issue, normalized, now } from '../crm/index.ts'
import { functions as saleFunctions } from '../sale/functions.ts'

export const quotationEffects = [
  'read:crm.Case',
  'read:crm.TeamMember',
  'read:user.User',
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
  // An order with no lines is a quotation nobody can send. The backend used to
  // call this without any products at all, so every quotation it created was
  // empty; refusing here is what makes the form ask for one.
  if (!products.length) return invalid(issue('products', 'crm_sale.error.productRequired'))
  return ctx.tx(async (tx) => {
    const held = (await tx.db.select('crm.Case', { id: input.caseId }))[0]
    // Reading the case is the same permission everywhere else in the CRM asks
    // for; quoting one used to skip it entirely.
    if (!held || !(await canReadCase(tx, held))) return invalid(issue('caseId', 'crm.error.notFound'))
    if (held.kind !== 'opportunity') return invalid(issue('caseId', 'crm_sale.error.opportunityRequired'))
    if (!held.partnerId) return invalid(issue('partnerId', 'crm_sale.error.partnerRequired'))
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

/**
 * What a quotation may be written for, as picker rows.
 *
 * `sale.addLine` takes a variant and a unit, so the picker lists variants and
 * carries the unit its template defaults to — otherwise the form would ask a
 * salesperson to name a unit of measure before they can quote anything.
 */
export const saleFunctionsPublic: Record<string, FnSpec> = {
  'sale.listQuotableProducts': defineFn({
    input: { search: 'text?', limit: 'int?' },
    output: { id: 'id', name: 'text', ref: 'text?', uomId: 'id?', listPrice: 'decimal' },
    effects: ['read:product.Product', 'read:product.Template', 'read:uom.Unit'],
    agent: true,
    handler: async (ctx, args) => {
      const T = ctx.table('product.Template')
      const templates = await ctx.db.all(
        from(T).where(eq(T.active, true), eq(T.saleOk, true)).orderBy(asc(T.name)).limit(200),
      )
      if (!templates.length) return []
      const byTemplate = new Map(templates.map((row) => [String(row.id), row]))
      const P = ctx.table('product.Product')
      const variants = await ctx.db.all(
        from(P)
          .where(eq(P.active, true), inArray(P.templateId, [...byTemplate.keys()]))
          .orderBy(asc(P.templateId), asc(P.combinationKey), asc(P.id)),
      )
      const needle = normalized(args.search)
      return variants
        .map((variant) => {
          const template = byTemplate.get(String(variant.templateId))
          const suffix = String(variant.combinationKey ?? '').trim()
          return {
            id: variant.id,
            name: [String(template?.name ?? variant.id), suffix].filter(Boolean).join(' · '),
            ref: variant.defaultCode ? String(variant.defaultCode) : null,
            uomId: template?.uomId ?? null,
            listPrice: template?.listPrice ?? '0',
          }
        })
        .filter(
          (row) => !needle || normalized(row.name).includes(needle) || normalized(row.ref).includes(needle),
        )
        .slice(0, Math.max(1, Math.min(200, Number(args.limit ?? 80) || 80)))
    },
  }),

  /**
   * The quotations already written for a case.
   *
   * `OpportunityQuotation` was written on every quotation and read by nothing,
   * so the sales tab could offer to create a quotation but never showed one.
   */
  'sale.listQuotations': defineFn({
    input: { caseId: 'id' },
    output: {
      id: 'id',
      name: 'text',
      state: 'text',
      amountUntaxed: 'decimal',
      amountTotal: 'decimal',
      currency: 'text',
      createdAt: 'datetime',
    },
    effects: [
      'read:crm.Case',
      'read:crm.TeamMember',
      'read:user.User',
      'read:crm_sale.OpportunityQuotation',
      'read:sale.Order',
    ],
    agent: true,
    handler: async (ctx, args) => {
      const held = (await ctx.db.select('crm.Case', { id: args.caseId }))[0]
      if (!held || !(await canReadCase(ctx, held))) return []
      const links = await ctx.db.select('crm_sale.OpportunityQuotation', { caseId: args.caseId })
      if (!links.length) return []
      const O = ctx.table('sale.Order')
      const orders = await ctx.db.all(
        from(O)
          .where(
            inArray(
              O.id,
              links.map((link) => link.salesOrderId),
            ),
          )
          .orderBy(desc(O.dateOrder), asc(O.id)),
      )
      const createdBy = new Map(links.map((link) => [String(link.salesOrderId), link.createdAt]))
      return orders.map((order) => ({
        id: order.id,
        name: order.name,
        state: order.state,
        amountUntaxed: order.amountUntaxed,
        amountTotal: order.amountTotal,
        currency: order.currency,
        createdAt: createdBy.get(String(order.id)) ?? order.dateOrder,
      }))
    },
  }),

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
