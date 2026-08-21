import { defineFn } from 'ketjs'
import type { Ctx, FnSpec, Row } from 'ketjs'
import { functions as pricingFunctions } from '../pricing/functions.ts'
import { functions as stockFunctions } from '../stock/functions.ts'

export const SALE_STATES = ['draft', 'sent', 'sale', 'cancel'] as const
export const SALE_INVOICE_STATUSES = ['upselling', 'invoiced', 'to invoice', 'no'] as const
export const INVOICE_POLICIES = ['order', 'delivery'] as const
const invalid = (field: string, message: string) => ({ ok: false, errors: [{ field, message }] })
const n = (value: unknown) => Number(value ?? 0)
const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100
const decimal = (value: number) => String(money(value))
const now = () => new Date().toISOString()

async function companyCurrency(ctx: Ctx) {
  if (!ctx.scope.company) throw new Error('sale requires an active company')
  const company = (await ctx.db.select('company.Company', { id: ctx.scope.company }))[0]
  if (!company) throw new Error(`company ${ctx.scope.company} does not exist`)
  return String(company.currency)
}
async function nextName(ctx: Ctx) {
  await ctx.db.insertIfAbsent('sale.Sequence', { id: 'sale', nextNumber: 1 })
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const row = (await ctx.db.select('sale.Sequence', { id: 'sale' }))[0]!
    const current = n(row.nextNumber)
    const changed = await ctx.db.compareAndSet(
      'sale.Sequence',
      { id: 'sale' },
      { nextNumber: row.nextNumber },
      { nextNumber: current + 1 },
    )
    if ('dryRun' in changed || changed.matched) return `S${String(current).padStart(5, '0')}`
  }
  throw new Error('sale sequence did not settle after concurrent updates')
}
async function contextOf(ctx: Ctx, productId: unknown) {
  const product = (await ctx.db.select('product.Product', { id: productId }))[0]
  if (!product) return null
  const template = (await ctx.db.select('product.Template', { id: product.templateId }))[0]
  return template ? { product, template } : null
}
function taxAmounts(tax: Row | null, gross: number, quantity: number) {
  if (!tax) return { untaxed: money(gross), tax: 0, total: money(gross) }
  if (tax.amountType === 'group') throw new Error('group taxes are outside the supported Odoo 19 subset')
  const amount = n(tax.amount),
    rate = amount / 100
  let untaxed = money(gross),
    taxAmount = 0
  if (tax.amountType === 'fixed') {
    taxAmount = money(amount * quantity)
    if (tax.priceInclude) untaxed = money(gross - taxAmount)
    return { untaxed, tax: taxAmount, total: tax.priceInclude ? money(gross) : money(gross + taxAmount) }
  }
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
async function recompute(ctx: Ctx, orderId: unknown) {
  let untaxed = 0,
    tax = 0
  for (const line of await ctx.db.select('sale.OrderLine', { orderId })) {
    const held = line.taxId ? ((await ctx.db.select('account.Tax', { id: line.taxId }))[0] ?? null) : null
    const gross = money(n(line.productUomQty) * n(line.priceUnit) * (1 - n(line.discount) / 100))
    const amounts = taxAmounts(held, gross, n(line.productUomQty))
    untaxed = money(untaxed + amounts.untaxed)
    tax = money(tax + amounts.tax)
  }
  await ctx.db.update(
    'sale.Order',
    { id: orderId },
    { amountUntaxed: decimal(untaxed), amountTax: decimal(tax), amountTotal: decimal(untaxed + tax) },
  )
}
async function statusOf(ctx: Ctx, orderId: unknown) {
  const order = (await ctx.db.select('sale.Order', { id: orderId }))[0]
  if (order?.state !== 'sale') return 'no'
  let billable = 0,
    invoiced = 0,
    ordered = 0
  for (const line of await ctx.db.select('sale.OrderLine', { orderId })) {
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

const confirmEffects = [
  'read:sale.Order',
  'read:sale.OrderLine',
  'write:sale.Order',
  'read:product.Product',
  'read:product.Template',
  'read:uom.Unit',
  'read:stock.Warehouse',
  'read:stock.PickingType',
  'read:stock.Picking',
  'write:stock.Picking',
  'write:stock.Move',
] as const
async function confirm(ctx: Ctx, id: unknown) {
  const order = (await ctx.db.select('sale.Order', { id }))[0]
  if (!order) return invalid('id', 'sales order does not exist')
  if (order.state === 'sale') return { ok: true, id, state: 'sale' }
  if (!['draft', 'sent'].includes(String(order.state)))
    return invalid('state', 'only a quotation can be confirmed')
  const lines = await ctx.db.select('sale.OrderLine', { orderId: id })
  if (!lines.length) return invalid('lines', 'a quotation needs at least one product line')
  const goods: Row[] = []
  for (const line of lines) {
    const context = await contextOf(ctx, line.productId)
    if (context && context.template.type !== 'service') goods.push(line)
  }
  let pickingId: string | undefined
  if (goods.length) {
    pickingId = `${String(id)}:delivery`
    const created = (await stockFunctions.createPicking!.handler(ctx, {
      id: pickingId,
      name: `Delivery ${String(order.name)}`,
      pickingTypeId: `${String(order.warehouseId)}:outgoing`,
      scheduledDate: order.dateOrder,
    })) as Row
    if (created.ok !== true) return created
    for (const line of goods) {
      const moveId = `${String(line.id)}:delivery`
      const moved = (await stockFunctions.addMove!.handler(ctx, {
        id: moveId,
        name: line.name,
        pickingId,
        productId: line.productId,
        productUomId: line.productUomId,
        productUomQty: line.productUomQty,
        origin: order.name,
      })) as Row
      if (moved.ok !== true) return moved
      await ctx.db.update('stock.Move', { id: moveId }, { saleLineId: line.id })
    }
  }
  await ctx.db.update('sale.Order', { id }, { state: 'sale', dateOrder: now() })
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
    input: { state: 'text?', partnerId: 'id?' },
    effects: ['read:sale.Order'],
    agent: true,
    handler: (ctx, args) =>
      ctx.db.select('sale.Order', {
        ...(args.state ? { state: args.state } : {}),
        ...(args.partnerId ? { partnerId: args.partnerId } : {}),
      }),
  }),
  getOrder: defineFn({
    input: { id: 'id' },
    effects: [
      'read:sale.Order',
      'read:sale.OrderLine',
      'read:stock.Move',
      'read:account.MoveLine',
      'read:account.Move',
    ],
    agent: true,
    handler: async (ctx, args) => {
      const order = (await ctx.db.select('sale.Order', { id: args.id }))[0]
      if (!order) return null
      const lines = await ctx.db.select('sale.OrderLine', { orderId: args.id })
      const moves = (await ctx.db.select('stock.Move')).filter((move) =>
        lines.some((line) => line.id === move.saleLineId),
      )
      const invoiceLines = (await ctx.db.select('account.MoveLine')).filter((line) =>
        lines.some((held) => held.id === line.saleLineId),
      )
      const ids = [...new Set(invoiceLines.map((line) => String(line.moveId)))]
      return {
        ...order,
        lines,
        moves,
        invoices: (await ctx.db.select('account.Move')).filter((move) => ids.includes(String(move.id))),
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
      const existing = (await ctx.db.select('sale.Order', { id: args.id }))[0]
      if (existing) return { ok: true, id: args.id, name: existing.name }
      if (!(await ctx.db.select('partner.Partner', { id: args.partnerId }))[0])
        return invalid('partnerId', 'customer does not exist')
      if (!(await ctx.db.select('stock.Warehouse', { id: args.warehouseId }))[0])
        return invalid('warehouseId', 'warehouse does not exist')
      if (args.pricelistId && !(await ctx.db.select('pricing.Pricelist', { id: args.pricelistId }))[0])
        return invalid('pricelistId', 'pricelist does not exist')
      const name = await nextName(ctx),
        dateOrder = String(args.dateOrder ?? now())
      await ctx.db.insert('sale.Order', {
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
      })
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
      'read:product.Category',
      'read:product.Cost',
      'read:uom.Unit',
      'read:pricing.Pricelist',
      'read:pricing.PricelistItem',
      'read:account.Tax',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const order = (await ctx.db.select('sale.Order', { id: args.orderId }))[0]
      if (!order || !['draft', 'sent'].includes(String(order.state)) || order.locked)
        return invalid('orderId', 'lines can only be added to an unlocked quotation')
      if (!(n(args.productUomQty) > 0)) return invalid('productUomQty', 'ordered quantity must be positive')
      const context = await contextOf(ctx, args.productId)
      if (!context?.template.saleOk) return invalid('productId', 'product is not sellable')
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
      const tax = args.taxId ? (await ctx.db.select('account.Tax', { id: args.taxId }))[0] : null
      if (args.taxId && (!tax || !['sale', 'none'].includes(String(tax.typeTaxUse))))
        return invalid('taxId', 'tax use does not match a sales order')
      const gross = money(n(args.productUomQty) * n(priceUnit) * (1 - n(discount) / 100))
      let subtotal: number
      try {
        subtotal = taxAmounts(tax, gross, n(args.productUomQty)).untaxed
      } catch (error) {
        return invalid('taxId', (error as Error).message)
      }
      if (!(await ctx.db.select('sale.OrderLine', { id: args.id }))[0])
        await ctx.db.insert('sale.OrderLine', {
          id: args.id,
          orderId: args.orderId,
          productId: args.productId,
          name: args.name ?? context.template.name,
          productUomQty: args.productUomQty,
          productUomId: args.productUomId,
          priceUnit: String(priceUnit),
          discount: String(discount),
          taxId: args.taxId ?? null,
          qtyDelivered: '0',
          qtyInvoiced: '0',
          priceSubtotal: decimal(subtotal),
          sequence: args.sequence ?? 10,
        })
      await recompute(ctx, args.orderId)
      return { ok: true, id: args.id, priceUnit: String(priceUnit) }
    },
  }),
  sendQuotation: defineFn({
    input: { id: 'id' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:sale.Order', 'write:sale.Order'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const order = (await ctx.db.select('sale.Order', { id: args.id }))[0]
      if (!order || !['draft', 'sent'].includes(String(order.state)))
        return invalid('state', 'only a draft quotation can be sent')
      await ctx.db.update('sale.Order', { id: args.id }, { state: 'sent' })
      return { ok: true, id: args.id }
    },
  }),
  confirmOrder: defineFn({
    input: { id: 'id' },
    output: { ok: 'bool', id: 'id?', state: 'text?', pickingId: 'id?', errors: 'json?' },
    effects: [...confirmEffects],
    idempotent: true,
    agent: true,
    handler: (ctx, args) => confirm(ctx, args.id),
  }),
  syncDeliveries: defineFn({
    input: { id: 'id' },
    output: { ok: 'bool', id: 'id?', invoiceStatus: 'text?', errors: 'json?' },
    effects: [
      'read:sale.Order',
      'read:sale.OrderLine',
      'write:sale.OrderLine',
      'write:sale.Order',
      'read:stock.Move',
      'read:product.Product',
      'read:product.Template',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      if (!(await ctx.db.select('sale.Order', { id: args.id }))[0])
        return invalid('id', 'sales order does not exist')
      for (const line of await ctx.db.select('sale.OrderLine', { orderId: args.id })) {
        const moves = await ctx.db.select('stock.Move', { saleLineId: line.id, state: 'done' })
        await ctx.db.update(
          'sale.OrderLine',
          { id: line.id },
          { qtyDelivered: decimal(moves.reduce((sum, move) => sum + n(move.quantity), 0)) },
        )
      }
      await refreshStatus(ctx, args.id)
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
      'read:account.Move',
      'read:company.Company',
      'write:account.Move',
      'write:account.MoveLine',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const order = (await ctx.db.select('sale.Order', { id: args.orderId }))[0]
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
        tax: Row | null
        taxAmount: number
      }> = []
      for (const line of await ctx.db.select('sale.OrderLine', { orderId: args.orderId })) {
        const context = await contextOf(ctx, line.productId),
          policy = String(context?.template.invoicePolicy ?? 'order')
        const basis = policy === 'delivery' ? n(line.qtyDelivered) : n(line.productUomQty),
          quantity = money(basis - n(line.qtyInvoiced))
        if (quantity <= 0) continue
        const gross = money(quantity * n(line.priceUnit) * (1 - n(line.discount) / 100)),
          tax = line.taxId ? ((await ctx.db.select('account.Tax', { id: line.taxId }))[0] ?? null) : null
        const amounts = taxAmounts(tax, gross, quantity)
        if (
          amounts.tax &&
          (!args.taxAccountId || !(await ctx.db.select('account.Account', { id: args.taxAccountId }))[0])
        )
          return invalid('taxAccountId', 'a valid tax account is required')
        billable.push({ line, quantity, subtotal: amounts.untaxed, tax, taxAmount: amounts.tax })
      }
      if (!billable.length)
        return invalid('lines', 'there is no ordered or delivered quantity left to invoice')
      const untaxed = money(billable.reduce((sum, item) => sum + item.subtotal, 0)),
        tax = money(billable.reduce((sum, item) => sum + item.taxAmount, 0)),
        total = money(untaxed + tax),
        invoiceDate = String(args.invoiceDate ?? now())
      await ctx.tx(async (tx) => {
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
          invoiceDateDue: invoiceDate,
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
              debit: '0',
              credit: decimal(item.taxAmount),
              balance: decimal(-item.taxAmount),
              dateMaturity: null,
              displayType: null,
              reconciled: false,
              amountResidual: '0',
              sequence: sequence++,
              saleLineId: item.line.id,
            })
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
          dateMaturity: invoiceDate,
          displayType: null,
          reconciled: false,
          amountResidual: decimal(total),
          sequence: sequence + 10,
          saleLineId: null,
        })
      })
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
      const order = (await ctx.db.select('sale.Order', { id: args.id }))[0]
      if (order?.state !== 'sale') return invalid('state', 'only a sales order can be locked')
      await ctx.db.update('sale.Order', { id: args.id }, { locked: args.locked })
      return { ok: true, id: args.id }
    },
  }),
  cancelOrder: defineFn({
    input: { id: 'id' },
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
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const order = (await ctx.db.select('sale.Order', { id: args.id }))[0]
      if (!order) return invalid('id', 'sales order does not exist')
      const lines = await ctx.db.select('sale.OrderLine', { orderId: args.id }),
        moves = (await ctx.db.select('stock.Move')).filter((move) =>
          lines.some((line) => line.id === move.saleLineId),
        )
      if (moves.some((move) => move.state === 'done'))
        return invalid('state', 'a delivered order cannot be cancelled')
      if (
        (await ctx.db.select('account.MoveLine')).some((line) =>
          lines.some((held) => held.id === line.saleLineId),
        )
      )
        return invalid('state', 'an invoiced order cannot be cancelled')
      for (const move of moves) await ctx.db.update('stock.Move', { id: move.id }, { state: 'cancel' })
      for (const pickingId of [...new Set(moves.map((move) => move.pickingId).filter(Boolean))])
        await ctx.db.update('stock.Picking', { id: pickingId }, { state: 'cancel' })
      await ctx.db.update('sale.Order', { id: args.id }, { state: 'cancel' })
      return { ok: true, id: args.id }
    },
  }),
}
