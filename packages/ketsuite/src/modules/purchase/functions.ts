import { defineFn, deleteFrom, desc, eq, from, ilike, inArray, or } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { functions as stockFunctions } from '../stock/functions.ts'
import { convertQty, type Unit, UomError } from '../uom/convert.ts'

export const PURCHASE_STATES = ['draft', 'sent', 'to approve', 'purchase', 'cancel'] as const
export const INVOICE_STATUSES = ['no', 'to invoice', 'invoiced'] as const
export const PURCHASE_METHODS = ['purchase', 'receive'] as const

const invalid = (field: string, message: string) => ({ ok: false, errors: [{ field, message }] })
const n = (value: unknown): number => Number(value ?? 0)
const money = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100
const decimal = (value: number): string => String(money(value))
const now = (): string => new Date().toISOString()
const wildcard = (value: unknown): string => String(value ?? '').replace(/[\\%_]/g, '\\$&')

class PurchaseRefused extends Error {
  result: Row
  constructor(result: Row) {
    super('refused')
    this.result = result
  }
}

const claimRevision = async (ctx: Ctx, order: Row, expectedRevision?: unknown): Promise<boolean> => {
  const revision = n(order.revision)
  if (expectedRevision !== undefined && revision !== n(expectedRevision)) return false
  const changed = await ctx.db.compareAndSet(
    'purchase.Order',
    { id: order.id },
    { revision: order.revision ?? null },
    { revision: revision + 1 },
  )
  return 'dryRun' in changed || changed.matched
}

async function currency(ctx: Ctx): Promise<string> {
  if (!ctx.scope.company) throw new Error('purchase requires an active company')
  const company = (await ctx.db.select('company.Company', { id: ctx.scope.company }))[0]
  if (!company) throw new Error(`company ${ctx.scope.company} does not exist`)
  return String(company.currency)
}

/**
 * The next order number for this company.
 *
 * Keyed by the company because `id` is a tenant-wide primary key: the constant
 * `'purchase'` gave the whole tenant one row, so only the first company to raise
 * an order could ever own it. See sale.nextName, which had the same defect.
 */
async function nextName(ctx: Ctx): Promise<string> {
  if (!ctx.scope.company) throw new Error('purchase requires an active company')
  const id = `${ctx.scope.company}:purchase`
  await ctx.db.insertIfAbsent('purchase.Sequence', { id, nextNumber: 1 })
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const row = (await ctx.db.select('purchase.Sequence', { id, companyId: ctx.scope.company }))[0]
    if (!row) throw new Error('purchase sequence row disappeared while assigning a number')
    const current = n(row.nextNumber)
    const changed = await ctx.db.compareAndSet(
      'purchase.Sequence',
      { id },
      { nextNumber: row.nextNumber },
      { nextNumber: current + 1 },
    )
    if ('dryRun' in changed || changed.matched) return `PO${String(current).padStart(5, '0')}`
  }
  throw new Error('purchase sequence did not settle after concurrent updates')
}

const unitOf = async (ctx: Ctx, id: unknown): Promise<Unit | null> => {
  const row = (await ctx.db.select('uom.Unit', { id }))[0]
  return row
    ? {
        id: String(row.id),
        parentPath: String(row.parentPath ?? ''),
        absoluteFactor: n(row.absoluteFactor),
        rounding: n(row.rounding) || 0.01,
      }
    : null
}

/**
 * A vendor sells in their unit and the warehouse counts in the product's. Both
 * numbers are real and they are not the same number, so every quantity that
 * crosses between a purchase line and a stock move is converted rather than
 * copied. Copying is what put two pieces on the shelf for two boxes of twelve.
 */
const inUnit = async (ctx: Ctx, quantity: number, fromId: unknown, toId: unknown): Promise<number | null> => {
  if (String(fromId) === String(toId)) return quantity
  const [from, to] = await Promise.all([unitOf(ctx, fromId), unitOf(ctx, toId)])
  if (!from || !to) return null
  try {
    return convertQty(quantity, from, to)
  } catch (error) {
    if (error instanceof UomError) return null
    throw error
  }
}

async function productContext(ctx: Ctx, productId: unknown) {
  const product = (await ctx.db.select('product.Product', { id: productId }))[0]
  if (!product) return null
  const template = (await ctx.db.select('product.Template', { id: product.templateId }))[0]
  return template ? { product, template } : null
}

/**
 * The vendor's best matching pricelist row, expressed in the unit the buyer is
 * ordering in.
 *
 * A pricelist row carries its own unit, and both comparisons that use the row
 * ignored it: `minQty` was compared against the ordered quantity as if the two
 * numbers shared a unit, and the price was applied per ordered unit as if the
 * vendor had quoted it that way. Order one box of twelve against "80 per piece
 * from 5 pieces" and the row did not even match — twelve pieces read as one —
 * and when a row did match, a per-piece price was charged per box.
 */
async function supplierPrice(
  ctx: Ctx,
  partnerId: unknown,
  productId: unknown,
  quantity: number,
  orderedUomId: unknown,
  at: string,
): Promise<Row | null> {
  const product = await productContext(ctx, productId)
  if (!product) return null
  const rows = (
    await ctx.db.select('purchase.SupplierInfo', {
      partnerId,
      productTemplateId: product.template.id,
    })
  )
    .filter((row) => !row.productId || row.productId === productId)
    .filter(
      (row) => (!row.dateStart || String(row.dateStart) <= at) && (!row.dateEnd || String(row.dateEnd) >= at),
    )
  const matching: Row[] = []
  for (const row of rows) {
    const inRowUnit = await inUnit(ctx, quantity, orderedUomId, row.productUomId)
    if (inRowUnit === null || n(row.minQty) > inRowUnit) continue
    // One ordered unit holds this many of the row's unit, so the row's price
    // scales by the same factor: 80 per piece is 960 per box of twelve.
    const orderedInRow = await inUnit(ctx, 1, orderedUomId, row.productUomId)
    if (orderedInRow === null) continue
    matching.push({ ...row, price: decimal(n(row.price) * orderedInRow), minQtyOrdered: inRowUnit })
  }
  return (
    matching.sort((a, b) => {
      const variant = Number(Boolean(b.productId)) - Number(Boolean(a.productId))
      return variant || n(a.sequence) - n(b.sequence) || n(b.minQty) - n(a.minQty) || n(a.price) - n(b.price)
    })[0] ?? null
  )
}

function taxAmounts(tax: Row | null, gross: number, quantity: number) {
  if (!tax) return { untaxed: money(gross), tax: 0, total: money(gross) }
  if (tax.amountType === 'group') throw new Error('group taxes are outside the supported subset')
  const amount = n(tax.amount)
  let untaxed = money(gross)
  let taxAmount = 0
  if (tax.amountType === 'fixed') {
    taxAmount = money(amount * quantity)
    if (tax.priceInclude) untaxed = money(gross - taxAmount)
    return { untaxed, tax: taxAmount, total: tax.priceInclude ? money(gross) : money(gross + taxAmount) }
  }
  const rate = amount / 100
  if (tax.amountType === 'division') {
    if (tax.priceInclude) {
      untaxed = money(gross * (1 - rate))
      taxAmount = money(gross - untaxed)
    } else taxAmount = money(gross / (1 - rate) - gross)
  } else if (tax.priceInclude) {
    untaxed = money(gross / (1 + rate))
    taxAmount = money(gross - untaxed)
  } else taxAmount = money(gross * rate)
  return { untaxed, tax: taxAmount, total: money(untaxed + taxAmount) }
}

async function totals(ctx: Ctx, orderId: unknown) {
  let untaxed = 0
  let tax = 0
  for (const line of await ctx.db.select('purchase.OrderLine', { orderId })) {
    const held = line.taxId ? ((await ctx.db.select('account.Tax', { id: line.taxId }))[0] ?? null) : null
    const gross = money(n(line.productQty) * n(line.priceUnit) * (1 - n(line.discount) / 100))
    const amounts = taxAmounts(held, gross, n(line.productQty))
    untaxed = money(untaxed + amounts.untaxed)
    tax = money(tax + amounts.tax)
  }
  const order = (await ctx.db.select('purchase.Order', { id: orderId }))[0]
  if (!order) return
  await ctx.db.update(
    'purchase.Order',
    { id: orderId },
    {
      amountUntaxed: decimal(untaxed),
      amountTax: decimal(tax),
      amountTotal: decimal(untaxed + tax),
      revision: n(order.revision) + 1,
    },
  )
}

/**
 * What a purchase line has actually been billed, read from the bills themselves.
 * The stored counter was incremented when a bill was drafted and never reversed,
 * so cancelling a bill left the order billed for ever and a second bill was
 * refused. Deriving it also settles two bills drafted at the same time: both
 * read the same rows inside their own transaction instead of a stale count.
 */
async function billedQuantity(ctx: Ctx, lineId: unknown): Promise<number> {
  let billed = 0
  for (const moveLine of await ctx.db.select('account.MoveLine', { purchaseLineId: lineId })) {
    if (!moveLine.productId) continue
    const move = (await ctx.db.select('account.Move', { id: moveLine.moveId }))[0]
    if (!move || move.state === 'cancel') continue
    billed += move.moveType === 'in_refund' ? -n(moveLine.quantity) : n(moveLine.quantity)
  }
  return money(billed)
}

async function refreshBilled(ctx: Ctx, orderId: unknown): Promise<void> {
  for (const line of await ctx.db.select('purchase.OrderLine', { orderId }))
    await ctx.db.update(
      'purchase.OrderLine',
      { id: line.id },
      { qtyInvoiced: decimal(await billedQuantity(ctx, line.id)) },
    )
}

/**
 * What the warehouse has received, converted back into the unit the line was
 * ordered in. Stock is told to receive in the product's own unit, so the raw
 * move quantity is not comparable to `productQty`.
 */
async function receivedQuantity(ctx: Ctx, line: Row): Promise<number> {
  const context = await productContext(ctx, line.productId)
  const stockUom = context?.template.uomId ?? line.productUomId
  let received = 0
  for (const move of await ctx.db.select('stock.Move', { purchaseLineId: line.id, state: 'done' }))
    received += n(move.quantity)
  const converted = await inUnit(ctx, received, stockUom, line.productUomId)
  return money(converted ?? received)
}

async function refreshReceived(ctx: Ctx, orderId: unknown): Promise<void> {
  for (const line of await ctx.db.select('purchase.OrderLine', { orderId }))
    await ctx.db.update(
      'purchase.OrderLine',
      { id: line.id },
      { qtyReceived: decimal(await receivedQuantity(ctx, line)) },
    )
}

async function invoiceStatus(ctx: Ctx, orderId: unknown): Promise<string> {
  const order = (await ctx.db.select('purchase.Order', { id: orderId }))[0]
  if (order?.state !== 'purchase') return 'no'
  let billable = 0
  let invoiced = 0
  for (const line of await ctx.db.select('purchase.OrderLine', { orderId })) {
    const context = await productContext(ctx, line.productId)
    const method = String(
      context?.template.purchaseMethod ?? (context?.template.type === 'service' ? 'purchase' : 'receive'),
    )
    billable += method === 'purchase' ? n(line.productQty) : await receivedQuantity(ctx, line)
    invoiced += await billedQuantity(ctx, line.id)
  }
  return billable - invoiced > 0.000001 ? 'to invoice' : invoiced > 0 ? 'invoiced' : 'no'
}

async function refreshInvoiceStatus(ctx: Ctx, orderId: unknown) {
  await ctx.db.update('purchase.Order', { id: orderId }, { invoiceStatus: await invoiceStatus(ctx, orderId) })
}

const lineEffects = [
  'read:purchase.Order',
  'read:purchase.OrderLine',
  'write:purchase.OrderLine',
  'write:purchase.Order',
  'read:purchase.SupplierInfo',
  'read:product.Product',
  'read:product.Template',
  'read:uom.Unit',
  'read:account.Tax',
] as const

/** An RFQ accepts line changes until it is confirmed or locked. */
const editableOrder = async (ctx: Ctx, orderId: unknown): Promise<Row | null> => {
  const order = (await ctx.db.select('purchase.Order', { id: orderId }))[0]
  if (!order || order.locked || !['draft', 'sent'].includes(String(order.state))) return null
  return order
}

type PlannedLine = { values: Record<string, unknown> } | { error: ReturnType<typeof invalid> }

/**
 * Price and validate one line. Shared so adding and correcting a line cannot
 * drift apart — the second was missing entirely, which left a mistyped quantity
 * correctable only by cancelling the whole request.
 */
async function planLine(ctx: Ctx, args: Record<string, unknown>): Promise<PlannedLine> {
  const order = await editableOrder(ctx, args.orderId)
  if (!order) return { error: invalid('orderId', 'lines can only be added to an unlocked RFQ') }
  if (!(n(args.productQty) > 0)) return { error: invalid('productQty', 'ordered quantity must be positive') }
  const context = await productContext(ctx, args.productId)
  if (!context?.template.purchaseOk) return { error: invalid('productId', 'product is not purchasable') }
  if (!(await ctx.db.select('uom.Unit', { id: args.productUomId }))[0])
    return { error: invalid('productUomId', 'unit of measure does not exist') }
  // A unit that measures something else is not a unit for this product. Without
  // this an order could be placed in kilograms for a product counted in pieces.
  if ((await inUnit(ctx, 1, args.productUomId, context.template.uomId)) === null)
    return { error: invalid('productUomId', 'unit does not measure the same thing as the product') }
  const price = await supplierPrice(
    ctx,
    order.partnerId,
    args.productId,
    n(args.productQty),
    args.productUomId,
    String(order.dateOrder),
  )
  const priceUnit = args.priceUnit ?? price?.price ?? '0'
  const discount = args.discount ?? price?.discount ?? '0'
  if (n(priceUnit) < 0 || n(discount) < 0 || n(discount) > 100)
    return { error: invalid('priceUnit', 'unit price and discount are invalid') }
  const tax = args.taxId ? (await ctx.db.select('account.Tax', { id: args.taxId }))[0] : null
  if (args.taxId && (!tax || !['purchase', 'none'].includes(String(tax.typeTaxUse))))
    return { error: invalid('taxId', 'tax use does not match a purchase order') }
  const datePlanned = String(
    args.datePlanned ??
      new Date(new Date(String(order.dateOrder)).getTime() + n(price?.delay ?? 1) * 86400000).toISOString(),
  )
  const gross = money(n(args.productQty) * n(priceUnit) * (1 - n(discount) / 100))
  let subtotal: number
  try {
    subtotal = taxAmounts(tax ?? null, gross, n(args.productQty)).untaxed
  } catch (error) {
    return { error: invalid('taxId', (error as Error).message) }
  }
  return {
    values: {
      productId: args.productId,
      name: args.name ?? price?.productName ?? context.template.name,
      productQty: String(args.productQty),
      productUomId: args.productUomId,
      priceUnit: String(priceUnit),
      discount: String(discount),
      taxId: args.taxId ?? null,
      datePlanned,
      priceSubtotal: decimal(subtotal),
    },
  }
}

const confirmEffects = [
  'read:purchase.Order',
  'read:purchase.OrderLine',
  'write:purchase.Order',
  'read:product.Product',
  'read:product.Template',
  'read:uom.Unit',
  'read:stock.PickingType',
  'read:stock.Picking',
  'write:stock.Picking',
  'read:stock.Move',
  'write:stock.Move',
  // Confirming settles the invoice status, which is read from the bills.
  'read:account.Move',
  'read:account.MoveLine',
] as const

async function createReceipt(ctx: Ctx, order: Row) {
  const goods: Row[] = []
  for (const line of await ctx.db.select('purchase.OrderLine', { orderId: order.id })) {
    const context = await productContext(ctx, line.productId)
    if (context && context.template.type !== 'service') goods.push(line)
  }
  if (!goods.length) return { ok: true }
  const pickingId = `${String(order.id)}:receipt`
  const created = (await stockFunctions.createPicking!.handler(ctx, {
    id: pickingId,
    name: `Receipt ${String(order.name)}`,
    pickingTypeId: order.pickingTypeId,
    scheduledDate: order.datePlanned,
  })) as Row
  if (created.ok !== true) return created
  for (const line of goods) {
    const moveId = `${String(line.id)}:receipt`
    const context = await productContext(ctx, line.productId)
    const stockUom = context?.template.uomId ?? line.productUomId
    const quantity = await inUnit(ctx, n(line.productQty), line.productUomId, stockUom)
    if (quantity === null) return invalid('productUomId', 'ordered unit does not convert to the product unit')
    const moved = (await stockFunctions.addMove!.handler(ctx, {
      id: moveId,
      name: line.name,
      pickingId,
      productId: line.productId,
      productUomId: stockUom,
      productUomQty: decimal(quantity),
      origin: order.name,
    })) as Row
    if (moved.ok !== true) return moved
    await ctx.db.update('stock.Move', { id: moveId }, { purchaseLineId: line.id })
  }
  return { ok: true, pickingId }
}

async function confirm(ctx: Ctx, id: unknown, approval: boolean, expectedRevision?: unknown) {
  const order = (await ctx.db.select('purchase.Order', { id }))[0]
  if (!order) return invalid('id', 'purchase order does not exist')
  if (expectedRevision !== undefined && n(order.revision) !== n(expectedRevision))
    return invalid('expectedRevision', 'purchase order changed')
  if (order.state === 'purchase') return { ok: true, id, state: order.state }
  if (!['draft', 'sent', 'to approve'].includes(String(order.state)))
    return invalid('state', 'only an RFQ can be confirmed')
  if (!(await ctx.db.select('purchase.OrderLine', { orderId: id })).length)
    return invalid('lines', 'an RFQ needs at least one product line')
  try {
    let pickingId: unknown
    await ctx.tx(async (tx) => {
      const current = (await tx.db.select('purchase.Order', { id }))[0]
      if (!current || !(await claimRevision(tx, current, expectedRevision)))
        throw new PurchaseRefused(invalid('expectedRevision', 'purchase order changed'))
      if (approval) {
        await tx.db.update('purchase.Order', { id }, { state: 'to approve' })
        return
      }
      // The receipt is a picking plus one move per line plus the order's own
      // state. A domain refusal rolls the entire graph back.
      const receipt = (await createReceipt(tx, current)) as Row
      if (receipt.ok !== true) throw new PurchaseRefused(receipt)
      pickingId = receipt.pickingId
      await tx.db.update('purchase.Order', { id }, { state: 'purchase', dateApprove: now() })
      await refreshInvoiceStatus(tx, id)
    })
    return {
      ok: true,
      id,
      state: approval ? 'to approve' : 'purchase',
      ...(pickingId ? { pickingId } : {}),
    }
  } catch (error) {
    if (error instanceof PurchaseRefused) return error.result
    throw error
  }
}

export const functions: Record<string, FnSpec> = {
  listSupplierInfo: defineFn({
    input: { partnerId: 'id?', productId: 'id?' },
    effects: ['read:purchase.SupplierInfo'],
    agent: true,
    handler: (ctx, args) =>
      ctx.db.select('purchase.SupplierInfo', {
        ...(args.partnerId ? { partnerId: args.partnerId } : {}),
        ...(args.productId ? { productId: args.productId } : {}),
      }),
  }),
  saveSupplierInfo: defineFn({
    input: {
      id: 'id',
      partnerId: 'id',
      productTemplateId: 'id',
      productId: 'id?',
      productUomId: 'id',
      productName: 'text?',
      productCode: 'text?',
      minQty: 'decimal?',
      price: 'decimal',
      discount: 'decimal?',
      delay: 'int?',
      sequence: 'int?',
      dateStart: 'datetime?',
      dateEnd: 'datetime?',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:partner.Partner',
      'read:product.Template',
      'read:product.Product',
      'read:uom.Unit',
      'read:purchase.SupplierInfo',
      'write:purchase.SupplierInfo',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      if (!(await ctx.db.select('partner.Partner', { id: args.partnerId }))[0])
        return invalid('partnerId', 'vendor does not exist')
      const template = (await ctx.db.select('product.Template', { id: args.productTemplateId }))[0]
      if (!template) return invalid('productTemplateId', 'product template does not exist')
      if (args.productId) {
        const product = (await ctx.db.select('product.Product', { id: args.productId }))[0]
        if (!product || product.templateId !== args.productTemplateId)
          return invalid('productId', 'variant does not belong to the template')
      }
      if (!(await ctx.db.select('uom.Unit', { id: args.productUomId }))[0])
        return invalid('productUomId', 'unit of measure does not exist')
      // A price per kilogram for a product counted in pieces can never be
      // applied to an order line, so the row would sit in the pricelist and
      // silently match nothing.
      if ((await inUnit(ctx, 1, args.productUomId, template.uomId)) === null)
        return invalid('productUomId', 'unit does not measure the same thing as the product')
      if (
        n(args.minQty) < 0 ||
        n(args.price) < 0 ||
        n(args.discount) < 0 ||
        n(args.discount) > 100 ||
        n(args.delay) < 0
      )
        return invalid('price', 'quantity, price, discount and lead time must be valid non-negative values')
      if (args.dateStart && args.dateEnd && String(args.dateEnd) < String(args.dateStart))
        return invalid('dateEnd', 'the validity period ends before it starts')
      const existing = (await ctx.db.select('purchase.SupplierInfo', { id: args.id }))[0]
      const values = {
        ...args,
        minQty: args.minQty ?? '0',
        discount: args.discount ?? '0',
        delay: args.delay ?? 1,
        sequence: args.sequence ?? 1,
      }
      const cs = ctx
        .change('purchase.SupplierInfo', values, existing ?? null)
        .cast([
          'id',
          'partnerId',
          'productTemplateId',
          'productId',
          'productUomId',
          'productName',
          'productCode',
          'minQty',
          'price',
          'discount',
          'delay',
          'sequence',
          'dateStart',
          'dateEnd',
        ])
        .required(['partnerId', 'productTemplateId', 'productUomId', 'price'])
      if (!cs.valid) return { ok: false, errors: cs.errors }
      await ctx.db.commit(cs, existing ? { id: args.id } : undefined)
      return { ok: true, id: args.id }
    },
  }),
  setPurchaseMethod: defineFn({
    input: { templateId: 'id', purchaseMethod: 'text' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:product.Template', 'write:product.Template'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      if (!PURCHASE_METHODS.includes(args.purchaseMethod as never))
        return invalid('purchaseMethod', 'must be purchase or receive')
      if (!(await ctx.db.select('product.Template', { id: args.templateId }))[0])
        return invalid('templateId', 'product template does not exist')
      await ctx.db.update(
        'product.Template',
        { id: args.templateId },
        { purchaseMethod: args.purchaseMethod },
      )
      return { ok: true, id: args.templateId }
    },
  }),
  listOrders: defineFn({
    input: {
      state: 'text?',
      states: 'json?',
      partnerId: 'id?',
      search: 'text?',
      limit: 'int?',
      offset: 'int?',
    },
    effects: ['read:purchase.Order'],
    agent: true,
    handler: (ctx, args) => {
      const O = ctx.table('purchase.Order')
      const states = Array.isArray(args.states) ? args.states.map(String) : []
      const limit = Math.max(1, Math.min(Math.trunc(Number(args.limit) || 500), 2_000))
      return ctx.db.all(
        from(O)
          .where(
            eq(O.companyId, ctx.scope.company),
            ...(args.state ? [eq(O.state, String(args.state))] : []),
            ...(states.length ? [inArray(O.state, states)] : []),
            ...(args.partnerId ? [eq(O.partnerId, String(args.partnerId))] : []),
            ...(args.search
              ? [
                  or(
                    ilike(O.name, `%${wildcard(args.search)}%`, true),
                    ilike(O.partnerRef, `%${wildcard(args.search)}%`, true),
                  ),
                ]
              : []),
          )
          .orderBy(desc(O.dateOrder), desc(O.id))
          .limit(limit)
          .offset(Math.max(0, Math.trunc(Number(args.offset) || 0))),
      )
    },
  }),
  getOrder: defineFn({
    input: { id: 'id' },
    effects: [
      'read:purchase.Order',
      'read:purchase.OrderLine',
      'read:stock.Move',
      'read:stock.MoveLine',
      'read:stock.Picking',
      'read:account.MoveLine',
      'read:account.Move',
      'read:product.Product',
      'read:product.Template',
      'read:uom.Unit',
    ],
    agent: true,
    handler: async (ctx, args) => {
      const order = (await ctx.db.select('purchase.Order', { id: args.id }))[0]
      if (!order) return null
      const stored = await ctx.db.select('purchase.OrderLine', { orderId: args.id })
      // Received and billed are read from the warehouse and the ledger rather
      // than from the columns caching them, so the order is right whether or not
      // anyone has pressed a sync button since the goods arrived.
      const lines: Row[] = []
      const moves: Row[] = []
      const billLines: Row[] = []
      for (const line of stored) {
        moves.push(...(await ctx.db.select('stock.Move', { purchaseLineId: line.id })))
        billLines.push(...(await ctx.db.select('account.MoveLine', { purchaseLineId: line.id })))
        lines.push({
          ...line,
          qtyReceived: decimal(await receivedQuantity(ctx, line)),
          qtyInvoiced: decimal(await billedQuantity(ctx, line.id)),
        })
      }
      const bills: Row[] = []
      for (const id of new Set(billLines.map((line) => String(line.moveId)))) {
        const bill = (await ctx.db.select('account.Move', { id }))[0]
        if (bill) bills.push(bill)
      }
      const detailedMoves: Row[] = await Promise.all(
        moves.map(async (move) => ({
          ...move,
          tracking: String((await productContext(ctx, move.productId))?.template.tracking ?? 'none'),
          lines: await ctx.db.select('stock.MoveLine', { moveId: move.id }),
        })),
      )
      const pickingIds = [
        ...new Set(detailedMoves.flatMap((move) => (move.pickingId ? [String(move.pickingId)] : []))),
      ]
      const P = ctx.table('stock.Picking')
      const pickings = pickingIds.length
        ? (await ctx.db.all(from(P).where(inArray(P.id, pickingIds)))).map((picking) => ({
            ...picking,
            moves: detailedMoves.filter((move) => String(move.pickingId) === String(picking.id)),
          }))
        : []
      return {
        ...order,
        invoiceStatus: await invoiceStatus(ctx, args.id),
        lines,
        moves: detailedMoves,
        pickings,
        bills,
      }
    },
  }),
  createOrder: defineFn({
    input: {
      id: 'id',
      partnerId: 'id',
      partnerRef: 'text?',
      pickingTypeId: 'id',
      dateOrder: 'datetime?',
      datePlanned: 'datetime?',
      notes: 'text?',
    },
    output: { ok: 'bool', id: 'id?', name: 'text?', errors: 'json?' },
    effects: [
      'read:purchase.Sequence',
      'write:purchase.Sequence',
      'read:purchase.Order',
      'write:purchase.Order',
      'read:partner.Partner',
      'read:stock.PickingType',
      'read:company.Company',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const existing = (await ctx.db.select('purchase.Order', { id: args.id }))[0]
      if (existing) return { ok: true, id: args.id, name: existing.name }
      if (!(await ctx.db.select('partner.Partner', { id: args.partnerId }))[0])
        return invalid('partnerId', 'vendor does not exist')
      if (!(await ctx.db.select('stock.PickingType', { id: args.pickingTypeId }))[0])
        return invalid('pickingTypeId', 'receipt operation type does not exist')
      const dateOrder = String(args.dateOrder ?? now())
      const name = await nextName(ctx)
      await ctx.db.insert('purchase.Order', {
        id: args.id,
        name,
        partnerId: args.partnerId,
        // The vendor's own quotation number arrives with their reply, so it
        // cannot be a condition of asking them for one.
        partnerRef: String(args.partnerRef ?? '').trim(),
        state: 'draft',
        locked: false,
        dateOrder,
        dateApprove: null,
        datePlanned: args.datePlanned ?? dateOrder,
        pickingTypeId: args.pickingTypeId,
        currency: await currency(ctx),
        invoiceStatus: 'no',
        amountUntaxed: '0',
        amountTax: '0',
        amountTotal: '0',
        notes: args.notes ?? null,
        revision: 0,
      })
      return { ok: true, id: args.id, name }
    },
  }),
  saveDraft: defineFn({
    input: {
      id: 'id',
      partnerId: 'id',
      pickingTypeId: 'id?',
      lines: 'json',
      create: 'bool?',
      expectedRevision: 'int?',
    },
    output: { ok: 'bool', id: 'id?', revision: 'int?', errors: 'json?' },
    effects: [
      'read:purchase.Sequence',
      'write:purchase.Sequence',
      'read:purchase.Order',
      'write:purchase.Order',
      'read:purchase.OrderLine',
      'write:purchase.OrderLine',
      'read:purchase.SupplierInfo',
      'read:partner.Partner',
      'read:partner.Role',
      'read:stock.PickingType',
      'read:product.Product',
      'read:product.Template',
      'read:uom.Unit',
      'read:account.Tax',
      'read:company.Company',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const lines = Array.isArray(args.lines) ? (args.lines as Row[]) : []
      if (!args.create && args.expectedRevision === undefined)
        return invalid('expectedRevision', 'purchase order version is required')
      if (!lines.length || lines.length > 100) return invalid('lines', 'an RFQ needs 1 to 100 lines')
      if (
        lines.some(
          (line) =>
            !line ||
            typeof line !== 'object' ||
            !line.id ||
            !line.productId ||
            !line.productUomId ||
            !(n(line.productQty) > 0),
        )
      )
        return invalid('lines', 'every line needs a product, unit and positive quantity')

      try {
        await ctx.tx(async (tx) => {
          let order = (await tx.db.select('purchase.Order', { id: args.id }))[0]
          if (args.create && order) return
          if (!order) {
            if (!args.create) throw new PurchaseRefused(invalid('id', 'purchase order does not exist'))
            if (!args.pickingTypeId)
              throw new PurchaseRefused(invalid('pickingTypeId', 'receipt operation type is required'))
            const created = (await functions.createOrder!.handler(tx, {
              id: args.id,
              partnerId: args.partnerId,
              pickingTypeId: args.pickingTypeId,
            })) as Row
            if (created.ok !== true) throw new PurchaseRefused(created)
            order = (await tx.db.select('purchase.Order', { id: args.id }))[0]
          } else {
            if (order.state !== 'draft' || order.locked)
              throw new PurchaseRefused(invalid('state', 'only an unlocked RFQ can be updated'))
            if (!(await claimRevision(tx, order, args.expectedRevision)))
              throw new PurchaseRefused(invalid('expectedRevision', 'purchase order changed'))
          }
          if (!order) throw new PurchaseRefused(invalid('id', 'purchase order does not exist'))
          if (!(await tx.db.select('partner.Partner', { id: args.partnerId }))[0])
            throw new PurchaseRefused(invalid('partnerId', 'vendor does not exist'))
          if (!(await tx.db.select('partner.Role', { partnerId: args.partnerId, role: 'supplier' }))[0])
            throw new PurchaseRefused(invalid('partnerId', 'partner is not an active vendor'))

          await tx.db.update('purchase.Order', { id: args.id }, { partnerId: args.partnerId })
          const L = tx.table('purchase.OrderLine')
          await tx.db.del(deleteFrom(L).where(eq(L.orderId, String(args.id))))
          for (const [index, line] of lines.entries()) {
            const added = (await functions.addLine!.handler(tx, {
              id: line.id,
              orderId: args.id,
              productId: line.productId,
              productQty: line.productQty,
              productUomId: line.productUomId,
              sequence: (index + 1) * 10,
            })) as Row
            if (added.ok !== true) throw new PurchaseRefused(added)
          }
        })
      } catch (error) {
        if (error instanceof PurchaseRefused) return error.result
        throw error
      }
      const order = (await ctx.db.select('purchase.Order', { id: args.id }))[0]
      return { ok: true, id: args.id, revision: n(order?.revision) }
    },
  }),
  addLine: defineFn({
    input: {
      id: 'id',
      orderId: 'id',
      productId: 'id',
      name: 'text?',
      productQty: 'decimal',
      productUomId: 'id',
      priceUnit: 'decimal?',
      discount: 'decimal?',
      taxId: 'id?',
      datePlanned: 'datetime?',
      sequence: 'int?',
    },
    output: { ok: 'bool', id: 'id?', priceUnit: 'decimal?', existing: 'bool?', errors: 'json?' },
    effects: [...lineEffects],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const existing = (await ctx.db.select('purchase.OrderLine', { id: args.id }))[0]
      // A retry must report what the line holds, not what this call would have
      // written. Returning a freshly computed price for a line that was never
      // touched is what made an edit look like it had worked.
      if (existing) return { ok: true, id: args.id, priceUnit: String(existing.priceUnit), existing: true }
      const planned = await planLine(ctx, args)
      if ('error' in planned) return planned.error
      const inserted = await ctx.db.insertIfAbsent('purchase.OrderLine', {
        ...planned.values,
        id: args.id,
        orderId: args.orderId,
        qtyReceived: '0',
        qtyInvoiced: '0',
        sequence: args.sequence ?? 10,
      })
      if (!('dryRun' in inserted) && !inserted.inserted) {
        // A concurrent retry won the insert; report the line it wrote.
        const raced = (await ctx.db.select('purchase.OrderLine', { id: args.id }))[0]
        return { ok: true, id: args.id, priceUnit: String(raced?.priceUnit ?? ''), existing: true }
      }
      await totals(ctx, args.orderId)
      return { ok: true, id: args.id, priceUnit: planned.values.priceUnit, existing: false }
    },
  }),
  updateLine: defineFn({
    input: {
      id: 'id',
      productQty: 'decimal',
      name: 'text?',
      priceUnit: 'decimal?',
      discount: 'decimal?',
      taxId: 'id?',
      productUomId: 'id?',
      datePlanned: 'datetime?',
      sequence: 'int?',
    },
    output: { ok: 'bool', id: 'id?', priceUnit: 'decimal?', errors: 'json?' },
    effects: [...lineEffects],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const line = (await ctx.db.select('purchase.OrderLine', { id: args.id }))[0]
      if (!line) return invalid('id', 'order line does not exist')
      const editable = await editableOrder(ctx, line.orderId)
      if (!editable) return invalid('id', 'lines can only be changed on an unlocked RFQ')
      const planned = await planLine(ctx, {
        ...args,
        orderId: line.orderId,
        productId: line.productId,
        productUomId: args.productUomId ?? line.productUomId,
        name: args.name ?? line.name,
        priceUnit: args.priceUnit ?? line.priceUnit,
        discount: args.discount ?? line.discount,
        taxId: args.taxId === undefined ? line.taxId : args.taxId,
        datePlanned: args.datePlanned ?? line.datePlanned,
      })
      if ('error' in planned) return planned.error
      await ctx.db.update(
        'purchase.OrderLine',
        { id: args.id },
        {
          ...planned.values,
          ...(args.sequence === undefined ? {} : { sequence: args.sequence }),
        },
      )
      await totals(ctx, line.orderId)
      return { ok: true, id: args.id, priceUnit: planned.values.priceUnit }
    },
  }),
  removeLine: defineFn({
    input: { id: 'id' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:purchase.Order',
      'read:purchase.OrderLine',
      'write:purchase.OrderLine',
      'write:purchase.Order',
      'read:account.Tax',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const line = (await ctx.db.select('purchase.OrderLine', { id: args.id }))[0]
      if (!line) return { ok: true, id: args.id }
      if (!(await editableOrder(ctx, line.orderId)))
        return invalid('id', 'lines can only be removed from an unlocked RFQ')
      const table = ctx.table('purchase.OrderLine')
      await ctx.db.del(deleteFrom(table).where(eq(table.id, args.id)))
      await totals(ctx, line.orderId)
      return { ok: true, id: args.id }
    },
  }),
  sendRfq: defineFn({
    input: { id: 'id' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:purchase.Order', 'write:purchase.Order'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const order = (await ctx.db.select('purchase.Order', { id: args.id }))[0]
      if (!order || !['draft', 'sent'].includes(String(order.state)))
        return invalid('state', 'only a draft RFQ can be sent')
      await ctx.db.update('purchase.Order', { id: args.id }, { state: 'sent' })
      return { ok: true, id: args.id }
    },
  }),
  confirmOrder: defineFn({
    input: { id: 'id', requiresApproval: 'bool?', expectedRevision: 'int?' },
    output: { ok: 'bool', id: 'id?', state: 'text?', pickingId: 'id?', errors: 'json?' },
    effects: [...confirmEffects],
    idempotent: true,
    agent: true,
    handler: (ctx, args) => confirm(ctx, args.id, args.requiresApproval === true, args.expectedRevision),
  }),
  approveOrder: defineFn({
    input: { id: 'id', expectedRevision: 'int?' },
    output: { ok: 'bool', id: 'id?', state: 'text?', pickingId: 'id?', errors: 'json?' },
    effects: [...confirmEffects],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const order = (await ctx.db.select('purchase.Order', { id: args.id }))[0]
      if (order?.state !== 'to approve') return invalid('state', 'order is not waiting for approval')
      return confirm(ctx, args.id, false, args.expectedRevision)
    },
  }),
  receiveOrderReceipt: defineFn({
    input: { id: 'id', receiptId: 'id', expectedRevision: 'int?' },
    output: {
      ok: 'bool',
      id: 'id?',
      receiptId: 'id?',
      receivedAt: 'datetime?',
      lineCount: 'int?',
      errors: 'json?',
    },
    effects: [
      ...(stockFunctions.completePicking!.effects ?? []),
      'read:purchase.Order',
      'write:purchase.Order',
      'read:purchase.OrderLine',
      'write:purchase.OrderLine',
      'read:account.Move',
      'read:account.MoveLine',
      'read:uom.Unit',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const order = (await ctx.db.select('purchase.Order', { id: args.id }))[0]
      if (!order) return invalid('id', 'purchase order does not exist')
      if (args.expectedRevision !== undefined && n(order.revision) !== n(args.expectedRevision))
        return invalid('expectedRevision', 'purchase order changed')
      if (order.state !== 'purchase') return invalid('state', 'only a purchase order can be received')
      const lines = await ctx.db.select('purchase.OrderLine', { orderId: args.id })
      const moves: Row[] = []
      for (const line of lines)
        moves.push(...(await ctx.db.select('stock.Move', { purchaseLineId: line.id })))
      const receiptMoves = moves.filter((move) => String(move.pickingId) === String(args.receiptId))
      const picking = (await ctx.db.select('stock.Picking', { id: args.receiptId }))[0]
      if (!picking || !receiptMoves.length)
        return invalid('receiptId', 'receipt does not belong to the purchase order')
      if (picking.state === 'cancel') return invalid('state', 'a cancelled receipt cannot be received')
      const quantities: Array<{ moveLineId: string; quantity: number }> = []
      for (const move of receiptMoves) {
        const prepared = await ctx.db.select('stock.MoveLine', { moveId: move.id })
        const quantity = prepared.reduce((sum, row) => sum + n(row.quantity), 0)
        if (!prepared.length || Math.abs(quantity - n(move.productUomQty)) > 0.000001)
          return invalid('receiptId', 'receipt quantities need warehouse review before mobile receipt')
        const context = await productContext(ctx, move.productId)
        const tracking = String(context?.template.tracking ?? 'none')
        if (tracking !== 'none' && prepared.some((row) => !row.lotId))
          return invalid('receiptId', 'tracked receipt lines need lot or serial review')
        for (const row of prepared) quantities.push({ moveLineId: String(row.id), quantity: n(row.quantity) })
      }
      const current = (await ctx.db.select('purchase.Order', { id: args.id }))[0]
      if (!current || !(await claimRevision(ctx, current, args.expectedRevision)))
        return invalid('expectedRevision', 'purchase order changed')
      // completePicking owns its own atomic stock transaction. Claim the order
      // version immediately before entering it instead of nesting transactions,
      // which is not portable across SQLite and PostgreSQL adapters.
      const completed = (await stockFunctions.completePicking!.handler(ctx, {
        id: args.receiptId,
        quantities,
        createBackorder: false,
      })) as Row
      if (completed.ok !== true) return completed
      await refreshReceived(ctx, args.id)
      await refreshInvoiceStatus(ctx, args.id)
      const receipt = (await ctx.db.select('stock.Picking', { id: args.receiptId }))[0]
      return {
        ok: true,
        id: args.id,
        receiptId: args.receiptId,
        receivedAt: receipt?.dateDone ?? now(),
        lineCount: quantities.length,
      }
    },
  }),
  syncReceipts: defineFn({
    input: { id: 'id' },
    output: { ok: 'bool', id: 'id?', invoiceStatus: 'text?', errors: 'json?' },
    effects: [
      'read:purchase.Order',
      'read:purchase.OrderLine',
      'write:purchase.OrderLine',
      'write:purchase.Order',
      'read:stock.Move',
      'read:product.Product',
      'read:product.Template',
      'read:uom.Unit',
      'read:account.Move',
      'read:account.MoveLine',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const order = (await ctx.db.select('purchase.Order', { id: args.id }))[0]
      if (!order) return invalid('id', 'purchase order does not exist')
      await refreshReceived(ctx, args.id)
      await refreshBilled(ctx, args.id)
      await refreshInvoiceStatus(ctx, args.id)
      return { ok: true, id: args.id, invoiceStatus: await invoiceStatus(ctx, args.id) }
    },
  }),
  createVendorBill: defineFn({
    input: {
      id: 'id',
      orderId: 'id',
      journalId: 'id',
      expenseAccountId: 'id',
      payableAccountId: 'id',
      taxAccountId: 'id?',
      invoiceDate: 'datetime?',
      paymentTermId: 'id?',
    },
    output: { ok: 'bool', id: 'id?', amountTotal: 'decimal?', errors: 'json?' },
    effects: [
      'read:purchase.Order',
      'read:purchase.OrderLine',
      'write:purchase.Order',
      'write:purchase.OrderLine',
      'read:product.Product',
      'read:product.Template',
      'read:account.Journal',
      'read:account.Account',
      'read:account.Tax',
      'read:account.Move',
      'read:account.MoveLine',
      'read:company.Company',
      'read:stock.Move',
      'read:uom.Unit',
      'write:account.Move',
      'write:account.MoveLine',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const order = (await ctx.db.select('purchase.Order', { id: args.orderId }))[0]
      if (order?.state !== 'purchase')
        return invalid('orderId', 'only a confirmed purchase order can be billed')
      const existing = (await ctx.db.select('account.Move', { id: args.id }))[0]
      if (existing) return { ok: true, id: args.id, amountTotal: existing.amountTotal }
      const journal = (await ctx.db.select('account.Journal', { id: args.journalId }))[0]
      const expense = (await ctx.db.select('account.Account', { id: args.expenseAccountId }))[0]
      const payable = (await ctx.db.select('account.Account', { id: args.payableAccountId }))[0]
      if (journal?.type !== 'purchase') return invalid('journalId', 'vendor bills require a purchase journal')
      if (!expense || !String(expense.accountType).startsWith('expense'))
        return invalid('expenseAccountId', 'an expense account is required')
      if (payable?.accountType !== 'liability_payable')
        return invalid('payableAccountId', 'a payable account is required')
      type Billable = { line: Row; quantity: number; subtotal: number; tax: Row | null; taxAmount: number }
      const collect = async (scoped: Ctx): Promise<Billable[] | ReturnType<typeof invalid>> => {
        const billable: Billable[] = []
        for (const line of await scoped.db.select('purchase.OrderLine', { orderId: args.orderId })) {
          const context = await productContext(scoped, line.productId)
          const method = String(
            context?.template.purchaseMethod ??
              (context?.template.type === 'service' ? 'purchase' : 'receive'),
          )
          const basis = method === 'purchase' ? n(line.productQty) : await receivedQuantity(scoped, line)
          // Read what the bills say rather than a counter, so two drafts prepared
          // at once cannot both bill the same quantity.
          const quantity = money(basis - (await billedQuantity(scoped, line.id)))
          if (quantity <= 0) continue
          const gross = money(quantity * n(line.priceUnit) * (1 - n(line.discount) / 100))
          const tax = line.taxId
            ? ((await scoped.db.select('account.Tax', { id: line.taxId }))[0] ?? null)
            : null
          if (tax && !['purchase', 'none'].includes(String(tax.typeTaxUse)))
            return invalid('taxId', 'tax use does not match a vendor bill')
          let amounts: ReturnType<typeof taxAmounts>
          try {
            amounts = taxAmounts(tax, gross, quantity)
          } catch (error) {
            return invalid('taxId', (error as Error).message)
          }
          if (
            amounts.tax &&
            (!args.taxAccountId || !(await scoped.db.select('account.Account', { id: args.taxAccountId }))[0])
          )
            return invalid('taxAccountId', 'a valid tax account is required')
          billable.push({ line, quantity, subtotal: amounts.untaxed, tax, taxAmount: amounts.tax })
        }
        return billable
      }
      const preview = await collect(ctx)
      if (!Array.isArray(preview)) return preview
      if (!preview.length) return invalid('lines', 'there is no received or ordered quantity left to bill')
      const invoiceDate = String(args.invoiceDate ?? now())
      let total = 0
      const written = await ctx.tx(async (tx) => {
        const billable = await collect(tx)
        if (!Array.isArray(billable)) return billable
        if (!billable.length) return invalid('lines', 'there is no received or ordered quantity left to bill')
        const untaxed = money(billable.reduce((sum, item) => sum + item.subtotal, 0))
        const tax = money(billable.reduce((sum, item) => sum + item.taxAmount, 0))
        total = money(untaxed + tax)
        // Accounting stamps its journal sequence when the bill is posted; until
        // then a draft showed its raw identifier, so the buyer's own screen
        // listed a UUID where a document number belongs. An order can be billed
        // more than once — after a cancellation, or in instalments — and a move
        // name is unique per journal, so the draft is numbered within its order.
        const draftNumber =
          (await tx.db.select('account.Move', { ref: order.name, journalId: args.journalId })).length + 1
        await tx.db.insert('account.Move', {
          id: args.id,
          name: `${String(order.name)}/${String(draftNumber)}`,
          ref: order.name,
          date: invoiceDate,
          moveType: 'in_invoice',
          state: 'draft',
          journalId: args.journalId,
          partnerId: order.partnerId,
          invoiceDate,
          invoiceDateDue: invoiceDate,
          paymentTermId: args.paymentTermId ?? null,
          paymentState: 'not_paid',
          currency: order.currency,
          amountUntaxed: decimal(untaxed),
          amountTax: decimal(tax),
          amountTotal: decimal(total),
          postedAt: null,
        })
        let sequence = 10
        for (const item of billable) {
          const baseId = `${String(args.id)}:${String(item.line.id)}`
          await tx.db.insert('account.MoveLine', {
            id: baseId,
            moveId: args.id,
            name: item.line.name,
            accountId: args.expenseAccountId,
            partnerId: order.partnerId,
            productId: item.line.productId,
            productUomId: item.line.productUomId,
            quantity: decimal(item.quantity),
            priceUnit: item.line.priceUnit,
            discount: item.line.discount,
            taxId: item.line.taxId,
            debit: decimal(item.subtotal),
            credit: '0',
            balance: decimal(item.subtotal),
            dateMaturity: null,
            displayType: null,
            reconciled: false,
            amountResidual: '0',
            sequence,
            purchaseLineId: item.line.id,
          })
          sequence += 10
          if (item.taxAmount)
            await tx.db.insert('account.MoveLine', {
              id: `${baseId}:tax`,
              moveId: args.id,
              name: item.tax?.name ?? 'Tax',
              accountId: args.taxAccountId,
              partnerId: order.partnerId,
              productId: null,
              productUomId: null,
              quantity: '1',
              priceUnit: decimal(item.taxAmount),
              discount: '0',
              taxId: null,
              debit: decimal(item.taxAmount),
              credit: '0',
              balance: decimal(item.taxAmount),
              dateMaturity: null,
              displayType: null,
              reconciled: false,
              amountResidual: '0',
              sequence: sequence++,
              purchaseLineId: item.line.id,
            })
        }
        await tx.db.insert('account.MoveLine', {
          id: `${String(args.id)}:counterpart`,
          moveId: args.id,
          name: order.name,
          accountId: args.payableAccountId,
          partnerId: order.partnerId,
          productId: null,
          productUomId: null,
          quantity: '1',
          priceUnit: decimal(total),
          discount: '0',
          taxId: null,
          debit: '0',
          credit: decimal(total),
          balance: decimal(-total),
          dateMaturity: invoiceDate,
          displayType: null,
          reconciled: false,
          amountResidual: decimal(total),
          sequence: sequence + 10,
          purchaseLineId: null,
        })
        await refreshBilled(tx, args.orderId)
        await refreshInvoiceStatus(tx, args.orderId)
        return { ok: true }
      })
      if ((written as Row).ok !== true) return written
      return { ok: true, id: args.id, amountTotal: decimal(total) }
    },
  }),
  resetToDraft: defineFn({
    input: { id: 'id' },
    output: { ok: 'bool', id: 'id?', state: 'text?', errors: 'json?' },
    effects: ['read:purchase.Order', 'write:purchase.Order'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const order = (await ctx.db.select('purchase.Order', { id: args.id }))[0]
      if (!order) return invalid('id', 'purchase order does not exist')
      if (order.state === 'draft') return { ok: true, id: args.id, state: 'draft' }
      // An approver who wants the request changed had only one button, and it
      // destroyed the request. Sending it back is the ordinary answer; a
      // confirmed order is past that point because a receipt already exists.
      if (!['sent', 'to approve'].includes(String(order.state)))
        return invalid('state', 'only a request awaiting sending or approval can go back to draft')
      await ctx.db.update('purchase.Order', { id: args.id }, { state: 'draft' })
      return { ok: true, id: args.id, state: 'draft' }
    },
  }),
  lockOrder: defineFn({
    input: { id: 'id', locked: 'bool' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:purchase.Order', 'write:purchase.Order'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const order = (await ctx.db.select('purchase.Order', { id: args.id }))[0]
      if (order?.state !== 'purchase') return invalid('state', 'only a purchase order can be locked')
      await ctx.db.update('purchase.Order', { id: args.id }, { locked: args.locked })
      return { ok: true, id: args.id }
    },
  }),
  cancelOrder: defineFn({
    input: { id: 'id', expectedRevision: 'int?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:purchase.Order',
      'read:purchase.OrderLine',
      'read:stock.Move',
      'write:stock.Move',
      'read:stock.Picking',
      'write:stock.Picking',
      'read:account.MoveLine',
      'write:purchase.Order',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const order = (await ctx.db.select('purchase.Order', { id: args.id }))[0]
      if (!order) return invalid('id', 'purchase order does not exist')
      if (args.expectedRevision !== undefined && n(order.revision) !== n(args.expectedRevision))
        return invalid('expectedRevision', 'purchase order changed')
      if (order.state === 'cancel') return { ok: true, id: args.id }
      try {
        await ctx.tx(async (tx) => {
          const current = (await tx.db.select('purchase.Order', { id: args.id }))[0]
          if (!current || !(await claimRevision(tx, current, args.expectedRevision)))
            throw new PurchaseRefused(invalid('expectedRevision', 'purchase order changed'))
          // Locking is the operator saying "no more changes"; cancellation is
          // the largest change there is.
          if (current.locked)
            throw new PurchaseRefused(invalid('state', 'a locked order cannot be cancelled'))
          const lines = await tx.db.select('purchase.OrderLine', { orderId: args.id })
          const moves: Row[] = []
          for (const line of lines)
            moves.push(...(await tx.db.select('stock.Move', { purchaseLineId: line.id })))
          if (moves.some((move) => move.state === 'done'))
            throw new PurchaseRefused(invalid('state', 'a received order cannot be cancelled'))
          for (const line of lines)
            if ((await tx.db.select('account.MoveLine', { purchaseLineId: line.id })).length)
              throw new PurchaseRefused(invalid('state', 'a billed order cannot be cancelled'))
          for (const move of moves) await tx.db.update('stock.Move', { id: move.id }, { state: 'cancel' })
          for (const pickingId of [...new Set(moves.map((move) => move.pickingId).filter(Boolean))])
            await tx.db.update('stock.Picking', { id: pickingId }, { state: 'cancel' })
          await tx.db.update('purchase.Order', { id: args.id }, { state: 'cancel' })
        })
        return { ok: true, id: args.id }
      } catch (error) {
        if (error instanceof PurchaseRefused) return error.result
        throw error
      }
    },
  }),
}
