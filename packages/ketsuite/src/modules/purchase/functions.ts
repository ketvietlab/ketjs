import { defineFn } from 'ketjs'
import type { Ctx, FnSpec, Row } from 'ketjs'
import { functions as stockFunctions } from '../stock/functions.ts'

export const PURCHASE_STATES = ['draft', 'sent', 'to approve', 'purchase', 'cancel'] as const
export const INVOICE_STATUSES = ['no', 'to invoice', 'invoiced'] as const
export const PURCHASE_METHODS = ['purchase', 'receive'] as const

const invalid = (field: string, message: string) => ({ ok: false, errors: [{ field, message }] })
const n = (value: unknown): number => Number(value ?? 0)
const money = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100
const decimal = (value: number): string => String(money(value))
const now = (): string => new Date().toISOString()

async function currency(ctx: Ctx): Promise<string> {
  if (!ctx.scope.company) throw new Error('purchase requires an active company')
  const company = (await ctx.db.select('company.Company', { id: ctx.scope.company }))[0]
  if (!company) throw new Error(`company ${ctx.scope.company} does not exist`)
  return String(company.currency)
}

async function nextName(ctx: Ctx): Promise<string> {
  const id = 'purchase'
  await ctx.db.insertIfAbsent('purchase.Sequence', { id, nextNumber: 1 })
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const row = (await ctx.db.select('purchase.Sequence', { id }))[0]!
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

async function productContext(ctx: Ctx, productId: unknown) {
  const product = (await ctx.db.select('product.Product', { id: productId }))[0]
  if (!product) return null
  const template = (await ctx.db.select('product.Template', { id: product.templateId }))[0]
  return template ? { product, template } : null
}

async function supplierPrice(
  ctx: Ctx,
  partnerId: unknown,
  productId: unknown,
  quantity: number,
  at: string,
): Promise<Row | null> {
  const product = await productContext(ctx, productId)
  if (!product) return null
  return (
    (
      await ctx.db.select('purchase.SupplierInfo', {
        partnerId,
        productTemplateId: product.template.id,
      })
    )
      .filter((row) => (!row.productId || row.productId === productId) && n(row.minQty) <= quantity)
      .filter(
        (row) =>
          (!row.dateStart || String(row.dateStart) <= at) && (!row.dateEnd || String(row.dateEnd) >= at),
      )
      .sort((a, b) => {
        const variant = Number(Boolean(b.productId)) - Number(Boolean(a.productId))
        return (
          variant || n(a.sequence) - n(b.sequence) || n(b.minQty) - n(a.minQty) || n(a.price) - n(b.price)
        )
      })[0] ?? null
  )
}

function taxAmounts(tax: Row | null, gross: number, quantity: number) {
  if (!tax) return { untaxed: money(gross), tax: 0, total: money(gross) }
  if (tax.amountType === 'group') throw new Error('group taxes are outside the supported Odoo 19 subset')
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
  await ctx.db.update(
    'purchase.Order',
    { id: orderId },
    {
      amountUntaxed: decimal(untaxed),
      amountTax: decimal(tax),
      amountTotal: decimal(untaxed + tax),
    },
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
    billable += method === 'purchase' ? n(line.productQty) : n(line.qtyReceived)
    invoiced += n(line.qtyInvoiced)
  }
  return billable - invoiced > 0.000001 ? 'to invoice' : invoiced > 0 ? 'invoiced' : 'no'
}

async function refreshInvoiceStatus(ctx: Ctx, orderId: unknown) {
  await ctx.db.update('purchase.Order', { id: orderId }, { invoiceStatus: await invoiceStatus(ctx, orderId) })
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
  'write:stock.Move',
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
    const moved = (await stockFunctions.addMove!.handler(ctx, {
      id: moveId,
      name: line.name,
      pickingId,
      productId: line.productId,
      productUomId: line.productUomId,
      productUomQty: line.productQty,
      origin: order.name,
    })) as Row
    if (moved.ok !== true) return moved
    await ctx.db.update('stock.Move', { id: moveId }, { purchaseLineId: line.id })
  }
  return { ok: true, pickingId }
}

async function confirm(ctx: Ctx, id: unknown, approval: boolean) {
  const order = (await ctx.db.select('purchase.Order', { id }))[0]
  if (!order) return invalid('id', 'purchase order does not exist')
  if (order.state === 'purchase') return { ok: true, id, state: order.state }
  if (!['draft', 'sent', 'to approve'].includes(String(order.state)))
    return invalid('state', 'only an RFQ can be confirmed')
  if (!(await ctx.db.select('purchase.OrderLine', { orderId: id })).length)
    return invalid('lines', 'an RFQ needs at least one product line')
  if (approval) {
    await ctx.db.update('purchase.Order', { id }, { state: 'to approve' })
    return { ok: true, id, state: 'to approve' }
  }
  const receipt = await createReceipt(ctx, order)
  if ((receipt as Row).ok !== true) return receipt
  await ctx.db.update('purchase.Order', { id }, { state: 'purchase', dateApprove: now() })
  await refreshInvoiceStatus(ctx, id)
  return {
    ok: true,
    id,
    state: 'purchase',
    ...((receipt as Row).pickingId ? { pickingId: (receipt as Row).pickingId } : {}),
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
      if (
        n(args.minQty) < 0 ||
        n(args.price) < 0 ||
        n(args.discount) < 0 ||
        n(args.discount) > 100 ||
        n(args.delay) < 0
      )
        return invalid('price', 'quantity, price, discount and lead time must be valid non-negative values')
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
    input: { state: 'text?', partnerId: 'id?' },
    effects: ['read:purchase.Order'],
    agent: true,
    handler: (ctx, args) =>
      ctx.db.select('purchase.Order', {
        ...(args.state ? { state: args.state } : {}),
        ...(args.partnerId ? { partnerId: args.partnerId } : {}),
      }),
  }),
  getOrder: defineFn({
    input: { id: 'id' },
    effects: [
      'read:purchase.Order',
      'read:purchase.OrderLine',
      'read:stock.Move',
      'read:stock.Picking',
      'read:account.MoveLine',
      'read:account.Move',
    ],
    agent: true,
    handler: async (ctx, args) => {
      const order = (await ctx.db.select('purchase.Order', { id: args.id }))[0]
      if (!order) return null
      const lines = await ctx.db.select('purchase.OrderLine', { orderId: args.id })
      const moves = (await ctx.db.select('stock.Move')).filter((move) =>
        lines.some((line) => line.id === move.purchaseLineId),
      )
      const billLines = (await ctx.db.select('account.MoveLine')).filter((line) =>
        lines.some((held) => held.id === line.purchaseLineId),
      )
      const billIds = [...new Set(billLines.map((line) => String(line.moveId)))]
      const bills = (await ctx.db.select('account.Move')).filter((move) => billIds.includes(String(move.id)))
      return { ...order, lines, moves, bills }
    },
  }),
  createOrder: defineFn({
    input: {
      id: 'id',
      partnerId: 'id',
      partnerRef: 'text',
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
      if (!String(args.partnerRef).trim())
        return invalid('partnerRef', 'vendor reference is required in Odoo 19')
      const dateOrder = String(args.dateOrder ?? now())
      const name = await nextName(ctx)
      await ctx.db.insert('purchase.Order', {
        id: args.id,
        name,
        partnerId: args.partnerId,
        partnerRef: args.partnerRef,
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
      productQty: 'decimal',
      productUomId: 'id',
      priceUnit: 'decimal?',
      discount: 'decimal?',
      taxId: 'id?',
      datePlanned: 'datetime?',
      sequence: 'int?',
    },
    output: { ok: 'bool', id: 'id?', priceUnit: 'decimal?', errors: 'json?' },
    effects: [
      'read:purchase.Order',
      'read:purchase.OrderLine',
      'write:purchase.OrderLine',
      'write:purchase.Order',
      'read:purchase.SupplierInfo',
      'read:product.Product',
      'read:product.Template',
      'read:uom.Unit',
      'read:account.Tax',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const order = (await ctx.db.select('purchase.Order', { id: args.orderId }))[0]
      if (!order || !['draft', 'sent'].includes(String(order.state)) || order.locked)
        return invalid('orderId', 'lines can only be added to an unlocked RFQ')
      if (!(n(args.productQty) > 0)) return invalid('productQty', 'ordered quantity must be positive')
      const context = await productContext(ctx, args.productId)
      if (!context?.template.purchaseOk) return invalid('productId', 'product is not purchasable')
      if (!(await ctx.db.select('uom.Unit', { id: args.productUomId }))[0])
        return invalid('productUomId', 'unit of measure does not exist')
      const price = await supplierPrice(
        ctx,
        order.partnerId,
        args.productId,
        n(args.productQty),
        String(order.dateOrder),
      )
      const priceUnit = args.priceUnit ?? price?.price ?? '0'
      const discount = args.discount ?? price?.discount ?? '0'
      if (n(priceUnit) < 0 || n(discount) < 0 || n(discount) > 100)
        return invalid('priceUnit', 'unit price and discount are invalid')
      const tax = args.taxId ? (await ctx.db.select('account.Tax', { id: args.taxId }))[0] : null
      if (args.taxId && (!tax || !['purchase', 'none'].includes(String(tax.typeTaxUse))))
        return invalid('taxId', 'tax use does not match a purchase order')
      const datePlanned = String(
        args.datePlanned ??
          new Date(
            new Date(String(order.dateOrder)).getTime() + n(price?.delay ?? 1) * 86400000,
          ).toISOString(),
      )
      const gross = money(n(args.productQty) * n(priceUnit) * (1 - n(discount) / 100))
      let subtotal: number
      try {
        subtotal = taxAmounts(tax, gross, n(args.productQty)).untaxed
      } catch (error) {
        return invalid('taxId', (error as Error).message)
      }
      const existing = (await ctx.db.select('purchase.OrderLine', { id: args.id }))[0]
      if (!existing)
        await ctx.db.insert('purchase.OrderLine', {
          id: args.id,
          orderId: args.orderId,
          productId: args.productId,
          name: args.name ?? price?.productName ?? context.template.name,
          productQty: args.productQty,
          productUomId: args.productUomId,
          priceUnit: String(priceUnit),
          discount: String(discount),
          taxId: args.taxId ?? null,
          datePlanned,
          qtyReceived: '0',
          qtyInvoiced: '0',
          priceSubtotal: decimal(subtotal),
          sequence: args.sequence ?? 10,
        })
      await totals(ctx, args.orderId)
      return { ok: true, id: args.id, priceUnit: String(priceUnit) }
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
    input: { id: 'id', requiresApproval: 'bool?' },
    output: { ok: 'bool', id: 'id?', state: 'text?', pickingId: 'id?', errors: 'json?' },
    effects: [...confirmEffects],
    idempotent: true,
    agent: true,
    handler: (ctx, args) => confirm(ctx, args.id, args.requiresApproval === true),
  }),
  approveOrder: defineFn({
    input: { id: 'id' },
    output: { ok: 'bool', id: 'id?', state: 'text?', pickingId: 'id?', errors: 'json?' },
    effects: [...confirmEffects],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const order = (await ctx.db.select('purchase.Order', { id: args.id }))[0]
      if (order?.state !== 'to approve') return invalid('state', 'order is not waiting for approval')
      return confirm(ctx, args.id, false)
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
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const order = (await ctx.db.select('purchase.Order', { id: args.id }))[0]
      if (!order) return invalid('id', 'purchase order does not exist')
      for (const line of await ctx.db.select('purchase.OrderLine', { orderId: args.id })) {
        const moves = await ctx.db.select('stock.Move', { purchaseLineId: line.id, state: 'done' })
        await ctx.db.update(
          'purchase.OrderLine',
          { id: line.id },
          { qtyReceived: decimal(moves.reduce((sum, move) => sum + n(move.quantity), 0)) },
        )
      }
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
      'read:company.Company',
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
      const billable: Array<{
        line: Row
        quantity: number
        subtotal: number
        tax: Row | null
        taxAmount: number
      }> = []
      for (const line of await ctx.db.select('purchase.OrderLine', { orderId: args.orderId })) {
        const context = await productContext(ctx, line.productId)
        const method = String(
          context?.template.purchaseMethod ?? (context?.template.type === 'service' ? 'purchase' : 'receive'),
        )
        const basis = method === 'purchase' ? n(line.productQty) : n(line.qtyReceived)
        const quantity = money(basis - n(line.qtyInvoiced))
        if (quantity <= 0) continue
        const gross = money(quantity * n(line.priceUnit) * (1 - n(line.discount) / 100))
        const tax = line.taxId ? ((await ctx.db.select('account.Tax', { id: line.taxId }))[0] ?? null) : null
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
          (!args.taxAccountId || !(await ctx.db.select('account.Account', { id: args.taxAccountId }))[0])
        )
          return invalid('taxAccountId', 'a valid tax account is required')
        billable.push({ line, quantity, subtotal: amounts.untaxed, tax, taxAmount: amounts.tax })
      }
      if (!billable.length) return invalid('lines', 'there is no received or ordered quantity left to bill')
      const untaxed = money(billable.reduce((sum, item) => sum + item.subtotal, 0))
      const tax = money(billable.reduce((sum, item) => sum + item.taxAmount, 0))
      const total = money(untaxed + tax)
      const invoiceDate = String(args.invoiceDate ?? now())
      await ctx.tx(async (tx) => {
        await tx.db.insert('account.Move', {
          id: args.id,
          name: String(args.id),
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
          await tx.db.update(
            'purchase.OrderLine',
            { id: item.line.id },
            { qtyInvoiced: decimal(n(item.line.qtyInvoiced) + item.quantity) },
          )
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
      })
      await refreshInvoiceStatus(ctx, args.orderId)
      return { ok: true, id: args.id, amountTotal: decimal(total) }
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
    input: { id: 'id' },
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
      const lines = await ctx.db.select('purchase.OrderLine', { orderId: args.id })
      const moves = (await ctx.db.select('stock.Move')).filter((move) =>
        lines.some((line) => line.id === move.purchaseLineId),
      )
      if (moves.some((move) => move.state === 'done'))
        return invalid('state', 'a received order cannot be cancelled')
      if (
        (await ctx.db.select('account.MoveLine')).some((line) =>
          lines.some((held) => held.id === line.purchaseLineId),
        )
      )
        return invalid('state', 'a billed order cannot be cancelled')
      for (const move of moves) await ctx.db.update('stock.Move', { id: move.id }, { state: 'cancel' })
      for (const pickingId of [...new Set(moves.map((move) => move.pickingId).filter(Boolean))])
        await ctx.db.update('stock.Picking', { id: pickingId }, { state: 'cancel' })
      await ctx.db.update('purchase.Order', { id: args.id }, { state: 'cancel' })
      return { ok: true, id: args.id }
    },
  }),
}
