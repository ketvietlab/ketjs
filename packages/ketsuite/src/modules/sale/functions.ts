import {
  dateBucket,
  defineFn,
  deleteFrom,
  desc,
  eq,
  from,
  gte,
  ilike,
  inArray,
  localDayRange,
  lt,
  or,
} from '@ketvietlab/ketjs'
import type { Ctx, Expr, FnSpec, Row } from '@ketvietlab/ketjs'
import { quoteTaxLine, quoteTaxLineForPosting, type TaxShare } from '../account/functions.ts'
import { functions as pricingFunctions } from '../pricing/functions.ts'
import { sellableProduct } from '../product/sellable.ts'
import { functions as stockFunctions } from '../stock/functions.ts'
import { company, companyKey, ours } from './scope.ts'

export const SALE_STATES = ['draft', 'sent', 'sale', 'cancel'] as const
export const SALE_INVOICE_STATUSES = ['upselling', 'invoiced', 'to invoice', 'no'] as const
export const INVOICE_POLICIES = ['order', 'delivery'] as const
const invalid = (field: string, message: string) => ({ ok: false, errors: [{ field, message }] })
const n = (value: unknown) => Number(value ?? 0)
const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100
const decimal = (value: number) => String(money(value))
const now = () => new Date().toISOString()
const wildcard = (value: unknown): string => String(value ?? '').replace(/[\\%_]/g, '\\$&')

async function companyCurrency(ctx: Ctx) {
  const row = (await ctx.db.select('company.Company', { id: company(ctx) }))[0]
  if (!row) throw new Error(`company ${company(ctx)} does not exist`)
  return String(row.currency)
}
/**
 * The next order number for this company.
 *
 * The sequence row is keyed by the company because `id` is a tenant-wide primary
 * key: keyed by the constant `'sale'`, the first company to raise an order owned
 * the only row there could ever be, and every other company either read a row it
 * could never write — the update pins the active company, so it matched nothing
 * and span out blaming concurrency — or found none at all and dereferenced
 * undefined. Numbers stay per-company, which the `(companyId, name)` index on
 * Order already assumed.
 */
async function nextName(ctx: Ctx) {
  const id = companyKey(ctx, 'sale')
  await ctx.db.insertIfAbsent('sale.Sequence', { id, nextNumber: 1 })
  // Every order in the company funnels through this one row, so a bulk import
  // running in parallel is a stampede by design. Losing the compare-and-set is
  // normal there; what must not happen is giving up while the row is live —
  // that turns a perfectly valid order into a spurious failure. Retries back
  // off with jitter so the herd spreads out instead of colliding again.
  for (let attempt = 0; attempt < 64; attempt += 1) {
    const row = (await ours(ctx, 'sale.Sequence', { id }))[0]
    if (!row) throw new Error('sale sequence row disappeared while assigning a number')
    const current = n(row.nextNumber)
    const changed = await ctx.db.compareAndSet(
      'sale.Sequence',
      { id },
      { nextNumber: row.nextNumber },
      { nextNumber: current + 1 },
    )
    if ('dryRun' in changed || changed.matched) return `S${String(current).padStart(5, '0')}`
    if (attempt >= 2)
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(100, 2 ** (attempt - 2)) * (0.5 + Math.random())),
      )
  }
  throw new Error('sale sequence did not settle after concurrent updates')
}
/**
 * When an invoice on this payment term falls due.
 *
 * `account` computes the same thing for the invoices it raises (its `dueDate`),
 * walking the term's lines and taking the latest maturity. Sale used to write the
 * invoice date into both date fields while still storing the term on the move,
 * so a thirty-day term produced an invoice that was overdue on the day it was
 * issued.
 */
async function paymentTermDue(ctx: Ctx, paymentTermId: unknown, date: Date): Promise<string> {
  if (!paymentTermId) return date.toISOString()
  const lines = (await ctx.db.select('account.PaymentTermLine', { paymentId: paymentTermId })).sort(
    (a, b) => n(a.sequence) - n(b.sequence),
  )
  let latest = new Date(date)
  for (const line of lines) {
    const due = new Date(date)
    const days = n(line.nbDays)
    if (line.delayType === 'days_after') due.setUTCDate(due.getUTCDate() + days)
    else if (line.delayType === 'days_after_end_of_month') {
      due.setUTCMonth(due.getUTCMonth() + 1, 0)
      due.setUTCDate(due.getUTCDate() + days)
    } else if (line.delayType === 'days_after_end_of_next_month') {
      due.setUTCMonth(due.getUTCMonth() + 2, 0)
      due.setUTCDate(due.getUTCDate() + days)
    } else {
      due.setUTCDate(due.getUTCDate() + days)
      due.setUTCMonth(due.getUTCMonth() + 1, Math.max(1, Math.min(31, n(line.daysNextMonth) || 1)))
    }
    if (due > latest) latest = due
  }
  return latest.toISOString()
}

async function contextOf(ctx: Ctx, productId: unknown) {
  const product = (await ctx.db.select('product.Product', { id: productId }))[0]
  if (!product) return null
  const template = (await ctx.db.select('product.Template', { id: product.templateId }))[0]
  return template ? { product, template } : null
}
async function recompute(ctx: Ctx, orderId: unknown) {
  const lines = await ours(ctx, 'sale.OrderLine', { orderId })
  const amounts = await Promise.all(
    lines.map(async (line) => {
      if (line.priceSubtotalIncl != null)
        return { untaxed: n(line.priceSubtotal), total: n(line.priceSubtotalIncl) }
      // Rows written before Wave 1B have no stored inclusive total. Re-quote them through the same
      // account boundary; explicit [] preserves a historically tax-free line instead of applying a
      // product default that may have been configured later.
      const quote = await quoteTaxLine(ctx, {
        productId: line.productId,
        taxIds: line.taxIds ?? (line.taxId ? [line.taxId] : []),
        quantity: line.productUomQty,
        priceUnit: line.priceUnit,
        discount: line.discount,
      })
      if (quote.ok !== true) return { untaxed: n(line.priceSubtotal), total: n(line.priceSubtotal) }
      return { untaxed: n(quote.amountUntaxed), total: n(quote.amountTotal) }
    }),
  )
  const untaxed = money(amounts.reduce((sum, line) => sum + line.untaxed, 0))
  const total = money(amounts.reduce((sum, line) => sum + line.total, 0))
  const tax = money(total - untaxed)
  const order = (await ours(ctx, 'sale.Order', { id: orderId }))[0]
  if (!order) return
  await ctx.db.update(
    'sale.Order',
    { id: orderId },
    {
      amountUntaxed: decimal(untaxed),
      amountTax: decimal(tax),
      amountTotal: decimal(total),
      revision: n(order.revision) + 1,
    },
  )
}
/**
 * The stock moves and invoice lines behind an order's lines.
 *
 * Both used to be found by reading the whole table and filtering in JS. A
 * tenant that has imported a real order history holds hundreds of thousands of
 * moves, so an order-detail page was reading the entire ledger to find the
 * handful of rows that belong to one order. The `saleLineId` relation is
 * auto-indexed, so these are index lookups now.
 */
async function movesOf(ctx: Ctx, lineIds: string[]): Promise<Row[]> {
  if (!lineIds.length) return []
  const M = ctx.table('stock.Move')
  return ctx.db.all(from(M).where(inArray(M.saleLineId, lineIds)))
}
async function invoiceLinesOf(ctx: Ctx, lineIds: string[]): Promise<Row[]> {
  if (!lineIds.length) return []
  const L = ctx.table('account.MoveLine')
  return ctx.db.all(from(L).where(inArray(L.saleLineId, lineIds)))
}

async function statusOf(ctx: Ctx, orderId: unknown) {
  const order = (await ours(ctx, 'sale.Order', { id: orderId }))[0]
  if (order?.state !== 'sale') return 'no'
  let billable = 0,
    invoiced = 0,
    ordered = 0
  for (const line of await ours(ctx, 'sale.OrderLine', { orderId })) {
    const context = await contextOf(ctx, line.productId)
    const policy = String(context?.template.invoicePolicy ?? 'order')
    ordered += n(line.productUomQty)
    billable += policy === 'delivery' ? n(line.qtyDelivered) : n(line.productUomQty)
    invoiced += n(line.qtyInvoiced)
  }
  if (invoiced > ordered + 0.000001) return 'upselling'
  return billable - invoiced > 0.000001 ? 'to invoice' : invoiced > 0 ? 'invoiced' : 'no'
}
async function refreshStatus(ctx: Ctx, orderId: unknown) {
  await ctx.db.update('sale.Order', { id: orderId }, { invoiceStatus: await statusOf(ctx, orderId) })
}

type OrderLifecyclePhase = 'confirmed' | 'shipped' | 'delivered' | 'cancelled'

/**
 * Append one durable lifecycle fact for an order.
 *
 * The deterministic id and unique domain key make this safe to call from both
 * the mutation path and an idempotent replay. Downstream modules consume the
 * ledger independently; Sale does not know which bridges are installed.
 */
async function recordOrderLifecycle(
  ctx: Ctx,
  orderId: unknown,
  phase: OrderLifecyclePhase,
  occurredAt = now(),
) {
  const order = (await ours(ctx, 'sale.Order', { id: orderId }))[0]
  if (!order) return
  await ctx.db.insertIfAbsent('sale.OrderLifecycleEvent', {
    id: companyKey(ctx, 'sale-order-lifecycle', String(orderId), phase),
    orderId,
    phase,
    orderRevision: order.revision ?? null,
    occurredAt,
    createdAt: now(),
  })
}

const confirmEffects = [
  'read:sale.Order',
  'read:sale.OrderLine',
  'write:sale.Order',
  'read:sale.OrderLifecycleEvent',
  'write:sale.OrderLifecycleEvent',
  'read:product.Product',
  'read:product.Template',
  'read:uom.Unit',
  'read:stock.Warehouse',
  'read:stock.PickingType',
  'read:stock.Picking',
  'write:stock.Picking',
  'write:stock.Move',
] as const
/**
 * A refusal thrown so the transaction it happened inside rolls back.
 *
 * `adapter.tx` commits on a normal return, so a soft error returned from inside
 * one would commit the half-built delivery it is refusing over.
 */
class SaleRefused extends Error {
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
    'sale.Order',
    { id: order.id },
    { revision: order.revision ?? null },
    { revision: revision + 1 },
  )
  return 'dryRun' in changed || changed.matched
}

async function confirm(ctx: Ctx, id: unknown, expectedRevision?: unknown) {
  const order = (await ours(ctx, 'sale.Order', { id }))[0]
  if (!order) return invalid('id', 'sales order does not exist')
  if (expectedRevision !== undefined && n(order.revision) !== n(expectedRevision))
    return invalid('expectedRevision', 'sales order changed')
  if (order.state === 'sale') {
    await recordOrderLifecycle(ctx, id, 'confirmed')
    return { ok: true, id, state: 'sale' }
  }
  if (!['draft', 'sent'].includes(String(order.state)))
    return invalid('state', 'only a quotation can be confirmed')
  const lines = await ours(ctx, 'sale.OrderLine', { orderId: id })
  if (!lines.length) return invalid('lines', 'a quotation needs at least one product line')
  const goods: Row[] = []
  for (const line of lines) {
    const context = await contextOf(ctx, line.productId)
    if (context && context.template.type !== 'service') goods.push(line)
  }
  // One transaction for the picking, its moves, their links and the state
  // change. Unwrapped, a crash between `addMove` and the `saleLineId` update
  // left a move with no link back to its line — and `cancelOrder`, which finds
  // an order's moves by that link, could never cancel it: an orphan demanding
  // stock forever, on an order still reading draft.
  let pickingId: string | undefined
  try {
    await ctx.tx(async (tx) => {
      const current = (await ours(tx, 'sale.Order', { id }))[0]
      if (!current || !(await claimRevision(tx, current, expectedRevision)))
        throw new SaleRefused(invalid('expectedRevision', 'sales order changed'))
      if (goods.length) {
        pickingId = `${String(id)}:delivery`
        const created = (await stockFunctions.createPicking!.handler(tx, {
          id: pickingId,
          name: `Delivery ${String(order.name)}`,
          pickingTypeId: `${String(order.warehouseId)}:outgoing`,
          scheduledDate: order.dateOrder,
        })) as Row
        if (created.ok !== true) throw new SaleRefused(created)
        for (const line of goods) {
          const moveId = `${String(line.id)}:delivery`
          const moved = (await stockFunctions.addMove!.handler(tx, {
            id: moveId,
            name: line.name,
            pickingId,
            productId: line.productId,
            productUomId: line.productUomId,
            productUomQty: line.productUomQty,
            origin: order.name,
          })) as Row
          if (moved.ok !== true) throw new SaleRefused(moved)
          await tx.db.update('stock.Move', { id: moveId }, { saleLineId: line.id })
        }
      }
      // The order keeps the date it was raised with. Stamping now() here wrote
      // migration day onto every imported historical order the moment it was
      // confirmed, and revenue-by-date was silently wrong from then on.
      await tx.db.update('sale.Order', { id }, { state: 'sale' })
      await recordOrderLifecycle(tx, id, 'confirmed')
    })
  } catch (error) {
    if (error instanceof SaleRefused) return error.result
    throw error
  }
  await refreshStatus(ctx, id)
  return { ok: true, id, state: 'sale', ...(pickingId ? { pickingId } : {}) }
}

export const functions: Record<string, FnSpec> = {
  listInvoicePolicies: defineFn({
    input: {},
    effects: ['read:product.Template'],
    agent: true,
    handler: (ctx) => ctx.db.select('product.Template', { saleOk: true }),
  }),
  setInvoicePolicy: defineFn({
    input: { templateId: 'id', invoicePolicy: 'text' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:product.Template', 'write:product.Template'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      if (!INVOICE_POLICIES.includes(args.invoicePolicy as never))
        return invalid('invoicePolicy', 'must be order or delivery')
      if (!(await ctx.db.select('product.Template', { id: args.templateId }))[0])
        return invalid('templateId', 'product template does not exist')
      await ctx.db.update('product.Template', { id: args.templateId }, { invoicePolicy: args.invoicePolicy })
      return { ok: true, id: args.templateId }
    },
  }),
  listOrders: defineFn({
    input: {
      state: 'text?',
      states: 'json?',
      partnerId: 'id?',
      search: 'text?',
      // A caller reporting on a window wants that window, not the history in
      // front of it. Without these it had to page until the table ran out and
      // discard the rest in memory, which is the cost this list was bounded to
      // avoid in the first place.
      dateFrom: 'datetime?',
      dateTo: 'datetime?',
      limit: 'int?',
      offset: 'int?',
    },
    effects: ['read:sale.Order'],
    agent: true,
    // Bounded and newest-first. Unbounded, a tenant with an imported order
    // history handed the whole table to every caller — the quotations screen
    // was loading six figures of rows to show a page.
    handler: async (ctx, args) => {
      const O = ctx.table('sale.Order')
      const states = Array.isArray(args.states) ? args.states.map(String) : []
      const limit = Math.max(1, Math.min(Math.trunc(Number(args.limit) || 500), 2_000))
      return ctx.db.all(
        from(O)
          .where(
            eq(O.companyId, company(ctx)),
            ...(args.state ? [eq(O.state, String(args.state))] : []),
            ...(states.length ? [inArray(O.state, states)] : []),
            ...(args.partnerId ? [eq(O.partnerId, String(args.partnerId))] : []),
            ...(args.dateFrom ? [gte(O.dateOrder, String(args.dateFrom))] : []),
            ...(args.dateTo ? [lt(O.dateOrder, String(args.dateTo))] : []),
            ...(args.search
              ? [
                  or(
                    ilike(O.name, `%${wildcard(args.search)}%`, true),
                    ilike(O.clientOrderRef, `%${wildcard(args.search)}%`, true),
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
  /**
   * The dashboard's numbers, counted where the rows live.
   *
   * The dashboard used to load every order to count four subsets of them. At
   * import scale that is six figures of rows materialised per view — and once
   * the list is bounded, counting a page would simply be wrong.
   */
  countOrders: defineFn({
    input: { timezone: 'text?' },
    output: {
      draft: 'int',
      sent: 'int',
      sale: 'int',
      toInvoice: 'int',
      draftToday: 'int',
      sentTotal: 'decimal',
      saleTotal: 'decimal',
      toInvoiceTotal: 'decimal',
      currency: 'text',
    },
    effects: ['read:sale.Order', 'read:company.Company'],
    agent: true,
    handler: async (ctx, args) => {
      const O = ctx.table('sale.Order')
      const mine = eq(O.companyId, company(ctx))
      const currency = await companyCurrency(ctx)
      // Amounts are summed for the company's own currency and no other. Every
      // order takes that currency when it is raised, so in practice this is all
      // of them; what it rules out is a company that changed currency later
      // having its old đồng added to its new dollars and shown as one figure.
      const priced = eq(O.currency, currency)
      // "Today" is the reader's today. The timezone is the viewer's, so a
      // quotation raised at nine in Ho Chi Minh City counts on the day it was
      // raised rather than on the day it was in London.
      const timezone = String(args.timezone ?? 'UTC')
      const [dayStart, dayEnd] = localDayRange(dateBucket(now(), 'day', timezone) ?? '1970-01-01', timezone)
      const total = (rows: Array<{ aggregates: Record<string, unknown> }>) =>
        decimal(rows.reduce((sum, row) => sum + n(row.aggregates.total), 0))
      const summed = (condition: Expr) =>
        ctx.db.group(
          from(O)
            .where(mine, priced, condition)
            .groupBy({ col: O.currency })
            .aggregate({ fn: 'sum', col: O.amountTotal, as: 'total' }),
        )
      const [draft, sent, sale, toInvoice, draftToday, sentTotal, saleTotal, toInvoiceTotal] =
        await Promise.all([
          ctx.db.count(from(O).where(mine, eq(O.state, 'draft'))),
          ctx.db.count(from(O).where(mine, eq(O.state, 'sent'))),
          ctx.db.count(from(O).where(mine, eq(O.state, 'sale'))),
          ctx.db.count(from(O).where(mine, eq(O.invoiceStatus, 'to invoice'))),
          ctx.db.count(
            from(O).where(mine, eq(O.state, 'draft'), gte(O.dateOrder, dayStart), lt(O.dateOrder, dayEnd)),
          ),
          summed(eq(O.state, 'sent')),
          summed(eq(O.state, 'sale')),
          summed(eq(O.invoiceStatus, 'to invoice')),
        ])
      return {
        draft,
        sent,
        sale,
        toInvoice,
        draftToday,
        sentTotal: total(sentTotal),
        saleTotal: total(saleTotal),
        toInvoiceTotal: total(toInvoiceTotal),
        currency,
      }
    },
  }),
  getOrder: defineFn({
    input: { id: 'id' },
    effects: [
      'read:sale.Order',
      'read:sale.OrderLine',
      'read:stock.Move',
      'read:stock.Picking',
      'read:account.MoveLine',
      'read:account.Move',
    ],
    agent: true,
    handler: async (ctx, args) => {
      const order = (await ours(ctx, 'sale.Order', { id: args.id }))[0]
      if (!order) return null
      const lines = await ours(ctx, 'sale.OrderLine', { orderId: args.id })
      const lineIds = lines.map((line) => String(line.id))
      const moves = await movesOf(ctx, lineIds)
      const pickingIds = [
        ...new Set(moves.flatMap((move) => (move.pickingId ? [String(move.pickingId)] : []))),
      ]
      const invoiceLines = await invoiceLinesOf(ctx, lineIds)
      const ids = [...new Set(invoiceLines.map((line) => String(line.moveId)))]
      const A = ctx.table('account.Move')
      const P = ctx.table('stock.Picking')
      return {
        ...order,
        lines,
        moves,
        pickings: pickingIds.length ? await ctx.db.all(from(P).where(inArray(P.id, pickingIds))) : [],
        invoices: ids.length ? await ctx.db.all(from(A).where(inArray(A.id, ids))) : [],
      }
    },
  }),
  createOrder: defineFn({
    input: {
      id: 'id',
      partnerId: 'id',
      clientOrderRef: 'text?',
      warehouseId: 'id',
      pricelistId: 'id?',
      paymentTermId: 'id?',
      dateOrder: 'datetime?',
      validityDate: 'datetime?',
      notes: 'text?',
    },
    output: { ok: 'bool', id: 'id?', name: 'text?', errors: 'json?' },
    effects: [
      'read:sale.Sequence',
      'write:sale.Sequence',
      'read:sale.Order',
      'write:sale.Order',
      'read:partner.Partner',
      'read:stock.Warehouse',
      'read:pricing.Pricelist',
      'read:account.PaymentTerm',
      'read:company.Company',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const existing = (await ours(ctx, 'sale.Order', { id: args.id }))[0]
      if (existing) return { ok: true, id: args.id, name: existing.name }
      if (!(await ctx.db.select('partner.Partner', { id: args.partnerId }))[0])
        return invalid('partnerId', 'customer does not exist')
      if (!(await ctx.db.select('stock.Warehouse', { id: args.warehouseId }))[0])
        return invalid('warehouseId', 'warehouse does not exist')
      if (args.pricelistId && !(await ctx.db.select('pricing.Pricelist', { id: args.pricelistId }))[0])
        return invalid('pricelistId', 'pricelist does not exist')
      const name = await nextName(ctx),
        dateOrder = String(args.dateOrder ?? now())
      // Two callers deciding on the same order at the same moment — a scheduled
      // import and a webhook delivering the same external order — both pass the
      // existence check above. The primary key settles it; the loser reads the
      // winner's row and answers ok, which is what `idempotent` promises. The
      // loser's sequence number is burned, which is the cheaper casualty.
      const inserted = await ctx.db.insertIfAbsent('sale.Order', {
        id: args.id,
        name,
        partnerId: args.partnerId,
        clientOrderRef: args.clientOrderRef ?? null,
        state: 'draft',
        locked: false,
        dateOrder,
        validityDate: args.validityDate ?? null,
        warehouseId: args.warehouseId,
        pricelistId: args.pricelistId ?? null,
        paymentTermId: args.paymentTermId ?? null,
        currency: await companyCurrency(ctx),
        invoiceStatus: 'no',
        amountUntaxed: '0',
        amountTax: '0',
        amountTotal: '0',
        notes: args.notes ?? null,
        revision: 0,
      })
      if (!('dryRun' in inserted) && !inserted.inserted) {
        const winner = (await ours(ctx, 'sale.Order', { id: args.id }))[0]
        return { ok: true, id: args.id, name: winner?.name ?? name }
      }
      return { ok: true, id: args.id, name }
    },
  }),
  addLine: defineFn({
    input: {
      id: 'id',
      orderId: 'id',
      productId: 'id',
      name: 'text?',
      productUomQty: 'decimal',
      productUomId: 'id',
      priceUnit: 'decimal?',
      discount: 'decimal?',
      taxId: 'id?',
      taxIds: 'json?',
      quoteRevision: 'text?',
      sequence: 'int?',
    },
    output: { ok: 'bool', id: 'id?', priceUnit: 'decimal?', errors: 'json?' },
    effects: [
      'read:sale.Order',
      'read:sale.OrderLine',
      'write:sale.OrderLine',
      'write:sale.Order',
      'read:product.Product',
      'read:product.Template',
      'read:product.TemplateUom',
      'read:product.ProductUom',
      'read:product.Category',
      'read:product.Cost',
      'read:uom.Unit',
      'read:pricing.Pricelist',
      'read:pricing.PricelistItem',
      'read:account.Tax',
      'read:account.ProductTax',
      'read:company.Company',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const order = (await ours(ctx, 'sale.Order', { id: args.orderId }))[0]
      if (!order || !['draft', 'sent'].includes(String(order.state)) || order.locked)
        return invalid('orderId', 'lines can only be added to an unlocked quotation')
      if (!(n(args.productUomQty) > 0)) return invalid('productUomQty', 'ordered quantity must be positive')
      const sellable = await sellableProduct(ctx, args.productId, args.productUomId, {
        allowMeasurementTreeUom: true,
      })
      if (!sellable.ok)
        return invalid(sellable.field === 'uomId' ? 'productUomId' : sellable.field, sellable.message)
      const context = sellable.value
      let priceUnit: unknown = args.priceUnit
      if (priceUnit === undefined && order.pricelistId) {
        const priced = (await pricingFunctions.priceFor!.handler(ctx, {
          pricelistId: order.pricelistId,
          productId: args.productId,
          quantity: args.productUomQty,
          uomId: args.productUomId,
          date: order.dateOrder,
        })) as Row
        if (priced.ok !== true) return priced
        priceUnit = priced.price
      }
      priceUnit ??= context.template.listPrice
      const discount = args.discount ?? '0'
      if (n(priceUnit) < 0 || n(discount) < 0 || n(discount) > 100)
        return invalid('priceUnit', 'unit price and discount are invalid')
      // Keep the established Sales contract: omitting tax means tax-free. POS resolves the product
      // default explicitly through its own quote boundary before creating a line.
      const taxIds = args.taxIds !== undefined ? args.taxIds : args.taxId ? [args.taxId] : []
      const quote = await quoteTaxLine(ctx, {
        productId: args.productId,
        taxIds,
        quantity: args.productUomQty,
        priceUnit,
        discount,
      })
      if (quote.ok !== true) return quote
      if (!(await ours(ctx, 'sale.OrderLine', { id: args.id }))[0])
        await ctx.db.insert('sale.OrderLine', {
          id: args.id,
          orderId: args.orderId,
          productId: args.productId,
          name: args.name ?? context.template.name,
          productUomQty: args.productUomQty,
          productUomId: args.productUomId,
          priceUnit: String(priceUnit),
          discount: String(discount),
          taxId: quote.taxIds[0] ?? null,
          taxIds: quote.taxIds,
          taxEvidence: { currency: quote.currency, scale: quote.scale, taxes: quote.taxes },
          quoteRevision: args.quoteRevision ?? null,
          qtyDelivered: '0',
          qtyInvoiced: '0',
          priceSubtotal: quote.amountUntaxed,
          priceSubtotalIncl: quote.amountTotal,
          sequence: args.sequence ?? 10,
        })
      await recompute(ctx, args.orderId)
      return { ok: true, id: args.id, priceUnit: String(priceUnit) }
    },
  }),
  saveDraft: defineFn({
    input: {
      id: 'id',
      partnerId: 'id',
      warehouseId: 'id',
      clientOrderRef: 'text?',
      notes: 'text?',
      lines: 'json',
      create: 'bool?',
      expectedRevision: 'int?',
    },
    output: { ok: 'bool', id: 'id?', revision: 'int?', errors: 'json?' },
    effects: [
      'read:sale.Sequence',
      'write:sale.Sequence',
      'read:sale.Order',
      'write:sale.Order',
      'read:sale.OrderLine',
      'write:sale.OrderLine',
      'read:partner.Partner',
      'read:partner.Role',
      'read:stock.Warehouse',
      'read:product.Product',
      'read:product.Template',
      'read:product.TemplateUom',
      'read:product.ProductUom',
      'read:product.Category',
      'read:product.Cost',
      'read:uom.Unit',
      'read:pricing.Pricelist',
      'read:pricing.PricelistItem',
      'read:account.PaymentTerm',
      'read:account.Tax',
      'read:account.ProductTax',
      'read:company.Company',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const lines = Array.isArray(args.lines) ? (args.lines as Row[]) : []
      if (!args.create && args.expectedRevision === undefined)
        return invalid('expectedRevision', 'sales order version is required')
      if (!lines.length || lines.length > 100) return invalid('lines', 'a draft needs 1 to 100 lines')
      if (
        lines.some(
          (line) =>
            !line ||
            typeof line !== 'object' ||
            !line.id ||
            !line.productId ||
            !line.productUomId ||
            !(n(line.productUomQty) > 0),
        )
      )
        return invalid('lines', 'every line needs a product, unit and positive quantity')

      try {
        await ctx.tx(async (tx) => {
          let order = (await ours(tx, 'sale.Order', { id: args.id }))[0]
          if (args.create && order) return
          if (!order) {
            if (!args.create) throw new SaleRefused(invalid('id', 'sales order does not exist'))
            const created = (await functions.createOrder!.handler(tx, {
              id: args.id,
              partnerId: args.partnerId,
              warehouseId: args.warehouseId,
              clientOrderRef: args.clientOrderRef,
              notes: args.notes,
            })) as Row
            if (created.ok !== true) throw new SaleRefused(created)
            order = (await ours(tx, 'sale.Order', { id: args.id }))[0]
          } else {
            if (order.state !== 'draft' || order.locked)
              throw new SaleRefused(invalid('state', 'only an unlocked quotation can be updated'))
            if (!(await claimRevision(tx, order, args.expectedRevision)))
              throw new SaleRefused(invalid('expectedRevision', 'sales order changed'))
          }
          if (!order) throw new SaleRefused(invalid('id', 'sales order does not exist'))
          if (!(await tx.db.select('partner.Partner', { id: args.partnerId }))[0])
            throw new SaleRefused(invalid('partnerId', 'customer does not exist'))
          if (!(await tx.db.select('partner.Role', { partnerId: args.partnerId, role: 'customer' }))[0])
            throw new SaleRefused(invalid('partnerId', 'partner is not an active customer'))
          if (!(await tx.db.select('stock.Warehouse', { id: args.warehouseId }))[0])
            throw new SaleRefused(invalid('warehouseId', 'warehouse does not exist'))

          await tx.db.update(
            'sale.Order',
            { id: args.id },
            {
              partnerId: args.partnerId,
              warehouseId: args.warehouseId,
              clientOrderRef: args.clientOrderRef ?? null,
              notes: args.notes ?? null,
            },
          )
          const L = tx.table('sale.OrderLine')
          await tx.db.del(deleteFrom(L).where(eq(L.orderId, String(args.id))))
          for (const [index, line] of lines.entries()) {
            const added = (await functions.addLine!.handler(tx, {
              id: line.id,
              orderId: args.id,
              productId: line.productId,
              productUomQty: line.productUomQty,
              productUomId: line.productUomId,
              sequence: (index + 1) * 10,
            })) as Row
            if (added.ok !== true) throw new SaleRefused(added)
          }
        })
      } catch (error) {
        if (error instanceof SaleRefused) return error.result
        throw error
      }
      const order = (await ours(ctx, 'sale.Order', { id: args.id }))[0]
      return { ok: true, id: args.id, revision: n(order?.revision) }
    },
  }),
  removeLine: defineFn({
    input: { id: 'id' },
    output: { ok: 'bool', id: 'id?', orderId: 'id?', errors: 'json?' },
    effects: [
      'read:sale.Order',
      'read:sale.OrderLine',
      'write:sale.OrderLine',
      'write:sale.Order',
      'read:account.Tax',
      'read:company.Company',
    ],
    idempotent: true,
    agent: true,
    // A line could be added and never taken back. A quotation with the wrong
    // product on it had to be abandoned and raised again under a new number,
    // because nothing in `sale` — function or route — could remove a line.
    handler: async (ctx, args) => {
      const line = (await ours(ctx, 'sale.OrderLine', { id: args.id }))[0]
      if (!line) return { ok: true, id: args.id }
      const order = (await ours(ctx, 'sale.Order', { id: line.orderId }))[0]
      if (!order || !['draft', 'sent'].includes(String(order.state)) || order.locked)
        return invalid('id', 'lines can only be removed from an unlocked quotation')
      const L = ctx.table('sale.OrderLine')
      await ctx.db.del(deleteFrom(L).where(eq(L.id, String(args.id))))
      await recompute(ctx, line.orderId)
      return { ok: true, id: args.id, orderId: line.orderId }
    },
  }),
  resetOrder: defineFn({
    input: { id: 'id' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:sale.Order', 'write:sale.Order'],
    idempotent: true,
    agent: true,
    // Cancelling was terminal: a cancelled order rendered no actions at all, so
    // one mis-click spent an order number and stranded its lines forever. Only a
    // cancelled order comes back, and it comes back as a draft — a confirmed
    // order has deliveries behind it and must be cancelled first.
    handler: async (ctx, args) => {
      const order = (await ours(ctx, 'sale.Order', { id: args.id }))[0]
      if (!order) return invalid('id', 'sales order does not exist')
      if (order.state !== 'cancel') return invalid('state', 'only a cancelled order can return to draft')
      await ctx.db.update(
        'sale.Order',
        { id: args.id },
        { state: 'draft', locked: false, revision: n(order.revision) + 1 },
      )
      return { ok: true, id: args.id }
    },
  }),
  sendQuotation: defineFn({
    input: { id: 'id' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:sale.Order', 'write:sale.Order'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const order = (await ours(ctx, 'sale.Order', { id: args.id }))[0]
      if (!order || !['draft', 'sent'].includes(String(order.state)))
        return invalid('state', 'only a draft quotation can be sent')
      await ctx.db.update('sale.Order', { id: args.id }, { state: 'sent', revision: n(order.revision) + 1 })
      return { ok: true, id: args.id }
    },
  }),
  confirmOrder: defineFn({
    input: { id: 'id', expectedRevision: 'int?' },
    output: { ok: 'bool', id: 'id?', state: 'text?', pickingId: 'id?', errors: 'json?' },
    effects: [...confirmEffects],
    idempotent: true,
    agent: true,
    handler: (ctx, args) => confirm(ctx, args.id, args.expectedRevision),
  }),
  syncDeliveries: defineFn({
    input: { id: 'id' },
    output: { ok: 'bool', id: 'id?', invoiceStatus: 'text?', errors: 'json?' },
    effects: [
      'read:sale.Order',
      'read:sale.OrderLine',
      'write:sale.OrderLine',
      'write:sale.Order',
      'read:sale.OrderLifecycleEvent',
      'write:sale.OrderLifecycleEvent',
      'read:stock.Move',
      'read:product.Product',
      'read:product.Template',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      if (!(await ours(ctx, 'sale.Order', { id: args.id }))[0])
        return invalid('id', 'sales order does not exist')
      for (const line of await ours(ctx, 'sale.OrderLine', { orderId: args.id })) {
        const moves = await ctx.db.select('stock.Move', { saleLineId: line.id, state: 'done' })
        await ctx.db.update(
          'sale.OrderLine',
          { id: line.id },
          { qtyDelivered: decimal(moves.reduce((sum, move) => sum + n(move.quantity), 0)) },
        )
      }
      await refreshStatus(ctx, args.id)
      const order = (await ours(ctx, 'sale.Order', { id: args.id }))[0]
      if (order?.state === 'sale') {
        const lines = await ours(ctx, 'sale.OrderLine', { orderId: args.id })
        const required = lines.reduce((sum, line) => sum + n(line.productUomQty), 0)
        const delivered = lines.reduce((sum, line) => sum + n(line.qtyDelivered), 0)
        if (required > 0 && delivered + 0.000001 >= required)
          await recordOrderLifecycle(ctx, args.id, 'delivered')
        else if (delivered > 0) await recordOrderLifecycle(ctx, args.id, 'shipped')
      }
      return { ok: true, id: args.id, invoiceStatus: await statusOf(ctx, args.id) }
    },
  }),
  createInvoice: defineFn({
    input: {
      id: 'id',
      orderId: 'id',
      journalId: 'id',
      revenueAccountId: 'id',
      receivableAccountId: 'id',
      taxAccountId: 'id?',
      invoiceDate: 'datetime?',
    },
    output: { ok: 'bool', id: 'id?', amountTotal: 'decimal?', errors: 'json?' },
    effects: [
      'read:sale.Order',
      'read:sale.OrderLine',
      'write:sale.Order',
      'write:sale.OrderLine',
      'read:product.Product',
      'read:product.Template',
      'read:account.Journal',
      'read:account.Account',
      'read:account.Tax',
      'read:account.ProductTax',
      // paymentTermDue walks the term's lines to work out when this falls due.
      'read:account.PaymentTermLine',
      'read:account.Move',
      'read:company.Company',
      'write:account.Move',
      'write:account.MoveLine',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const order = (await ours(ctx, 'sale.Order', { id: args.orderId }))[0]
      if (order?.state !== 'sale') return invalid('orderId', 'only a confirmed sales order can be invoiced')
      const existing = (await ctx.db.select('account.Move', { id: args.id }))[0]
      if (existing) return { ok: true, id: args.id, amountTotal: existing.amountTotal }
      const journal = (await ctx.db.select('account.Journal', { id: args.journalId }))[0],
        revenue = (await ctx.db.select('account.Account', { id: args.revenueAccountId }))[0],
        receivable = (await ctx.db.select('account.Account', { id: args.receivableAccountId }))[0]
      if (journal?.type !== 'sale') return invalid('journalId', 'customer invoices require a sales journal')
      if (!revenue || !String(revenue.accountType).startsWith('income'))
        return invalid('revenueAccountId', 'an income account is required')
      if (receivable?.accountType !== 'asset_receivable')
        return invalid('receivableAccountId', 'a receivable account is required')
      const billable: Array<{
        line: Row
        quantity: number
        subtotal: number
        taxAmount: number
        shares: TaxShare[]
      }> = []
      // A soft error raised once the transaction has started writing has to
      // unwind it: `adapter.tx` commits on a normal return and rolls back only on
      // a throw, so returning the error would leave a half-written invoice behind.
      class Refused extends Error {
        result: Record<string, unknown>
        constructor(result: Record<string, unknown>) {
          super('refused')
          this.result = result
        }
      }
      const build = async (tx: Ctx) => {
        billable.length = 0
        for (const line of await ours(tx, 'sale.OrderLine', { orderId: args.orderId })) {
          const context = await contextOf(tx, line.productId),
            policy = String(context?.template.invoicePolicy ?? 'order')
          const basis = policy === 'delivery' ? n(line.qtyDelivered) : n(line.productUomQty),
            quantity = money(basis - n(line.qtyInvoiced))
          if (quantity <= 0) continue
          const quote = await quoteTaxLineForPosting(tx, {
            productId: line.productId,
            taxIds: line.taxIds ?? (line.taxId ? [line.taxId] : undefined),
            quantity,
            priceUnit: line.priceUnit,
            discount: line.discount,
          })
          if (quote.ok !== true) throw new Refused(quote)
          for (const share of quote.shares) {
            const accountId = (quote.shares.length === 1 ? args.taxAccountId : null) ?? share.accountId
            if (!accountId || !(await tx.db.select('account.Account', { id: accountId }))[0])
              throw new Refused(invalid('taxAccountId', 'a valid tax account is required'))
          }
          billable.push({
            line,
            quantity,
            subtotal: n(quote.amountUntaxed),
            taxAmount: n(quote.amountTax),
            shares: quote.shares,
          })
        }
        if (!billable.length)
          throw new Refused(invalid('lines', 'there is no ordered or delivered quantity left to invoice'))
      }
      const invoiceDate = String(args.invoiceDate ?? now())
      // The payment term decides when this is due; `account` computes it the same
      // way for the invoices it raises itself. Writing the invoice date into both
      // fields made every order-sourced invoice due on the day it was issued, so
      // ageing showed it overdue from the start.
      const due = await paymentTermDue(ctx, order.paymentTermId, new Date(invoiceDate))
      let untaxed = 0,
        tax = 0,
        total = 0
      try {
        await ctx.tx(async (tx) => {
          await build(tx)
          untaxed = money(billable.reduce((sum, item) => sum + item.subtotal, 0))
          tax = money(billable.reduce((sum, item) => sum + item.taxAmount, 0))
          total = money(untaxed + tax)
          await tx.db.insert('account.Move', {
            id: args.id,
            name: String(args.id),
            ref: order.name,
            date: invoiceDate,
            moveType: 'out_invoice',
            state: 'draft',
            journalId: args.journalId,
            partnerId: order.partnerId,
            invoiceDate,
            invoiceDateDue: due,
            paymentTermId: order.paymentTermId,
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
              accountId: args.revenueAccountId,
              partnerId: order.partnerId,
              productId: item.line.productId,
              productUomId: item.line.productUomId,
              quantity: decimal(item.quantity),
              priceUnit: item.line.priceUnit,
              discount: item.line.discount,
              taxId: item.line.taxId,
              debit: '0',
              credit: decimal(item.subtotal),
              balance: decimal(-item.subtotal),
              dateMaturity: null,
              displayType: null,
              reconciled: false,
              amountResidual: '0',
              sequence,
              saleLineId: item.line.id,
            })
            sequence += 10
            for (const share of item.shares) {
              if (!share.amount) continue
              const accountId = (item.shares.length === 1 ? args.taxAccountId : null) ?? share.accountId
              await tx.db.insert('account.MoveLine', {
                id: `${baseId}:tax:${String(share.taxId)}`,
                moveId: args.id,
                name: share.name,
                accountId,
                partnerId: order.partnerId,
                productId: null,
                productUomId: null,
                quantity: '1',
                priceUnit: decimal(share.amount),
                discount: '0',
                taxId: share.taxId,
                debit: '0',
                credit: decimal(share.amount),
                balance: decimal(-share.amount),
                dateMaturity: null,
                displayType: null,
                reconciled: false,
                amountResidual: '0',
                sequence: sequence++,
                saleLineId: item.line.id,
              })
            }
            await tx.db.update(
              'sale.OrderLine',
              { id: item.line.id },
              { qtyInvoiced: decimal(n(item.line.qtyInvoiced) + item.quantity) },
            )
          }
          await tx.db.insert('account.MoveLine', {
            id: `${String(args.id)}:counterpart`,
            moveId: args.id,
            name: order.name,
            accountId: args.receivableAccountId,
            partnerId: order.partnerId,
            productId: null,
            productUomId: null,
            quantity: '1',
            priceUnit: decimal(total),
            discount: '0',
            taxId: null,
            debit: decimal(total),
            credit: '0',
            balance: decimal(total),
            dateMaturity: due,
            displayType: null,
            reconciled: false,
            amountResidual: decimal(total),
            sequence: sequence + 10,
            saleLineId: null,
          })
        })
      } catch (error) {
        if (error instanceof Refused) return error.result
        throw error
      }
      await refreshStatus(ctx, args.orderId)
      return { ok: true, id: args.id, amountTotal: decimal(total) }
    },
  }),
  lockOrder: defineFn({
    input: { id: 'id', locked: 'bool' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:sale.Order', 'write:sale.Order'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const order = (await ours(ctx, 'sale.Order', { id: args.id }))[0]
      if (order?.state !== 'sale') return invalid('state', 'only a sales order can be locked')
      await ctx.db.update(
        'sale.Order',
        { id: args.id },
        { locked: args.locked, revision: n(order.revision) + 1 },
      )
      return { ok: true, id: args.id }
    },
  }),
  cancelOrder: defineFn({
    input: { id: 'id', expectedRevision: 'int?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:sale.Order',
      'read:sale.OrderLine',
      'read:stock.Move',
      'write:stock.Move',
      'read:stock.Picking',
      'write:stock.Picking',
      'read:account.MoveLine',
      'write:sale.Order',
      'read:sale.OrderLifecycleEvent',
      'write:sale.OrderLifecycleEvent',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const order = (await ours(ctx, 'sale.Order', { id: args.id }))[0]
      if (!order) return invalid('id', 'sales order does not exist')
      if (args.expectedRevision !== undefined && n(order.revision) !== n(args.expectedRevision))
        return invalid('expectedRevision', 'sales order changed')
      if (order.state === 'cancel') return { ok: true, id: args.id }
      try {
        await ctx.tx(async (tx) => {
          const current = (await ours(tx, 'sale.Order', { id: args.id }))[0]
          if (!current || !(await claimRevision(tx, current, args.expectedRevision)))
            throw new SaleRefused(invalid('expectedRevision', 'sales order changed'))
          const lines = await ours(tx, 'sale.OrderLine', { orderId: args.id })
          const lineIds = lines.map((line) => String(line.id))
          const moves = await movesOf(tx, lineIds)
          if (moves.some((move) => move.state === 'done'))
            throw new SaleRefused(invalid('state', 'a delivered order cannot be cancelled'))
          if ((await invoiceLinesOf(tx, lineIds)).length)
            throw new SaleRefused(invalid('state', 'an invoiced order cannot be cancelled'))
          for (const move of moves) await tx.db.update('stock.Move', { id: move.id }, { state: 'cancel' })
          for (const pickingId of [...new Set(moves.map((move) => move.pickingId).filter(Boolean))])
            await tx.db.update('stock.Picking', { id: pickingId }, { state: 'cancel' })
          await tx.db.update('sale.Order', { id: args.id }, { state: 'cancel' })
          // A draft quotation has no fulfillment to cancel. Only an order that
          // had entered the sale state publishes a cancellation fact.
          if (current.state === 'sale') await recordOrderLifecycle(tx, args.id, 'cancelled')
        })
      } catch (error) {
        if (error instanceof SaleRefused) return error.result
        throw error
      }
      return { ok: true, id: args.id }
    },
  }),
}
