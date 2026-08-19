import { defineFn } from 'ketjs'
import type { Ctx, FnSpec, Row } from 'ketjs'
import { functions as accountFunctions } from '../account/functions.ts'
import { functions as pricingFunctions } from '../pricing/functions.ts'
import { functions as stockFunctions } from '../stock/functions.ts'

export const POS_ORDER_STATES = ['draft', 'cancel', 'paid', 'done'] as const
export const POS_SESSION_STATES = ['opening_control', 'opened', 'closing_control', 'closed'] as const
export const POS_INVOICE_STATUSES = ['invoiced', 'to_invoice'] as const
const invalid = (field: string, message: string) => ({ ok: false, errors: [{ field, message }] })
const n = (value: unknown) => Number(value ?? 0)
const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100
const decimal = (value: number) => String(money(value))
const now = () => new Date().toISOString()

async function currencyOf(ctx: Ctx) {
  if (!ctx.scope.company) throw new Error('point of sale requires an active company')
  const company = (await ctx.db.select('company.Company', { id: ctx.scope.company }))[0]
  if (!company) throw new Error(`company ${ctx.scope.company} does not exist`)
  return String(company.currency)
}
async function productOf(ctx: Ctx, id: unknown) {
  const product = (await ctx.db.select('product.Product', { id }))[0]
  const template = product && (await ctx.db.select('product.Template', { id: product.templateId }))[0]
  return product && template ? { product, template } : null
}
async function nextOrderNumber(ctx: Ctx, sessionId: unknown) {
  const key = String(sessionId)
  await ctx.db.insertIfAbsent('pos.Sequence', { id: key, nextNumber: 1 })
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const row = (await ctx.db.select('pos.Sequence', { id: key }))[0]!
    const current = n(row.nextNumber)
    const changed = await ctx.db.compareAndSet(
      'pos.Sequence',
      { id: key },
      { nextNumber: row.nextNumber },
      { nextNumber: current + 1 },
    )
    if ('dryRun' in changed || changed.matched) return current
  }
  throw new Error('POS order sequence did not settle after concurrent updates')
}
function taxAmounts(tax: Row | null, gross: number, quantity: number) {
  if (!tax) return { untaxed: money(gross), tax: 0, total: money(gross) }
  if (tax.amountType === 'group') throw new Error('group taxes are outside the supported Odoo 19 POS subset')
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
  for (const line of await ctx.db.select('pos.OrderLine', { orderId })) {
    const held = line.taxId ? ((await ctx.db.select('account.Tax', { id: line.taxId }))[0] ?? null) : null
    const amounts = taxAmounts(
      held,
      money(n(line.qty) * n(line.priceUnit) * (1 - n(line.discount) / 100)),
      n(line.qty),
    )
    untaxed = money(untaxed + amounts.untaxed)
    tax = money(tax + amounts.tax)
    await ctx.db.update(
      'pos.OrderLine',
      { id: line.id },
      { priceSubtotal: decimal(amounts.untaxed), priceSubtotalIncl: decimal(amounts.total) },
    )
  }
  const payments = await ctx.db.select('pos.Payment', { orderId }),
    paid = money(payments.reduce((sum, payment) => sum + n(payment.amount), 0))
  await ctx.db.update(
    'pos.Order',
    { id: orderId },
    {
      amountUntaxed: decimal(untaxed),
      amountTax: decimal(tax),
      amountTotal: decimal(untaxed + tax),
      amountPaid: decimal(paid),
      amountReturn: decimal(paid - untaxed - tax),
    },
  )
}
async function createAccounting(ctx: Ctx, order: Row, config: Row, lines: Row[], payments: Row[]) {
  const id = `${String(order.id)}:account`,
    existing = (await ctx.db.select('account.Move', { id }))[0]
  if (existing) return id
  const invoice = Boolean(order.toInvoice),
    refund = n(order.amountTotal) < 0,
    date = String(order.dateOrder),
    total = Math.abs(n(order.amountTotal)),
    untaxed = Math.abs(n(order.amountUntaxed)),
    tax = Math.abs(n(order.amountTax))
  if (invoice && !order.partnerId) throw new Error('a customer is required to invoice a POS order')
  if (tax && !config.taxAccountId) throw new Error('a tax account is required for taxed POS orders')
  await ctx.tx(async (tx) => {
    await tx.db.insert('account.Move', {
      id,
      name: id,
      ref: order.posReference,
      date,
      moveType: invoice ? (refund ? 'out_refund' : 'out_invoice') : 'entry',
      state: 'draft',
      journalId: config.salesJournalId,
      partnerId: order.partnerId ?? null,
      invoiceDate: invoice ? date : null,
      invoiceDateDue: invoice ? date : null,
      paymentTermId: null,
      paymentState: invoice ? 'not_paid' : 'paid',
      currency: order.currency,
      amountUntaxed: decimal(untaxed),
      amountTax: decimal(tax),
      amountTotal: decimal(total),
      postedAt: null,
    })
    let sequence = 10
    for (const line of lines) {
      const base = Math.abs(n(line.priceSubtotal)),
        debitSide = refund
      await tx.db.insert('account.MoveLine', {
        id: `${id}:line:${String(line.id)}`,
        moveId: id,
        name: line.name,
        accountId: config.revenueAccountId,
        partnerId: order.partnerId ?? null,
        productId: line.productId,
        productUomId: line.productUomId,
        quantity: decimal(Math.abs(n(line.qty))),
        priceUnit: line.priceUnit,
        discount: line.discount,
        taxId: line.taxId,
        debit: debitSide ? decimal(base) : '0',
        credit: debitSide ? '0' : decimal(base),
        balance: decimal(debitSide ? base : -base),
        dateMaturity: null,
        displayType: null,
        reconciled: false,
        amountResidual: '0',
        sequence,
        posLineId: line.id,
      })
      sequence += 10
    }
    if (tax)
      await tx.db.insert('account.MoveLine', {
        id: `${id}:tax`,
        moveId: id,
        name: 'Tax',
        accountId: config.taxAccountId,
        partnerId: order.partnerId ?? null,
        productId: null,
        productUomId: null,
        quantity: '1',
        priceUnit: decimal(tax),
        discount: '0',
        taxId: null,
        debit: refund ? decimal(tax) : '0',
        credit: refund ? '0' : decimal(tax),
        balance: decimal(refund ? tax : -tax),
        dateMaturity: null,
        displayType: null,
        reconciled: false,
        amountResidual: '0',
        sequence: 900,
      })
    if (invoice) {
      await tx.db.insert('account.MoveLine', {
        id: `${id}:counterpart`,
        moveId: id,
        name: order.posReference,
        accountId: config.receivableAccountId,
        partnerId: order.partnerId,
        productId: null,
        productUomId: null,
        quantity: '1',
        priceUnit: decimal(total),
        discount: '0',
        taxId: null,
        debit: refund ? '0' : decimal(total),
        credit: refund ? decimal(total) : '0',
        balance: decimal(refund ? -total : total),
        dateMaturity: date,
        displayType: null,
        reconciled: false,
        amountResidual: decimal(total),
        sequence: 1000,
      })
    } else {
      let paymentSequence = 1000
      for (const payment of payments) {
        const method = (await tx.db.select('pos.PaymentMethod', { id: payment.paymentMethodId }))[0]!,
          journal = (await tx.db.select('account.Journal', { id: method.journalId }))[0]!
        const amount = Math.abs(n(payment.amount))
        await tx.db.insert('account.MoveLine', {
          id: `${id}:payment:${String(payment.id)}`,
          moveId: id,
          name: method.name,
          accountId: journal.defaultAccountId,
          partnerId: order.partnerId ?? null,
          productId: null,
          productUomId: null,
          quantity: '1',
          priceUnit: decimal(amount),
          discount: '0',
          taxId: null,
          debit: refund ? '0' : decimal(amount),
          credit: refund ? decimal(amount) : '0',
          balance: decimal(refund ? -amount : amount),
          dateMaturity: null,
          displayType: null,
          reconciled: false,
          amountResidual: '0',
          sequence: paymentSequence,
        })
        paymentSequence += 10
      }
    }
  })
  const posted = (await accountFunctions.postMove!.handler(ctx, { id })) as Row
  if (posted.ok !== true)
    throw new Error(
      String((posted.errors as Row[] | undefined)?.[0]?.message ?? 'POS accounting move could not be posted'),
    )
  if (invoice) {
    for (const payment of payments) {
      const method = (await ctx.db.select('pos.PaymentMethod', { id: payment.paymentMethodId }))[0]!
      const result = (await accountFunctions.registerPayment!.handler(ctx, {
        id: `${String(payment.id)}:account`,
        name: String(order.posReference),
        paymentType: refund ? 'outbound' : 'inbound',
        partnerType: 'customer',
        partnerId: order.partnerId,
        journalId: method.journalId,
        destinationAccountId: config.receivableAccountId,
        amount: decimal(Math.abs(n(payment.amount))),
        date,
        paymentReference: order.posReference,
        reconcileLineId: `${id}:counterpart`,
      })) as Row
      if (result.ok !== true)
        throw new Error(
          String((result.errors as Row[] | undefined)?.[0]?.message ?? 'POS payment could not be posted'),
        )
    }
  }
  return id
}

const stockEffects = [
  ...(stockFunctions.createPicking!.effects ?? []),
  ...(stockFunctions.addMove!.effects ?? []),
  ...(stockFunctions.confirmPicking!.effects ?? []),
  ...(stockFunctions.reserveMove!.effects ?? []),
  ...(stockFunctions.saveMoveLine!.effects ?? []),
  ...(stockFunctions.completePicking!.effects ?? []),
]
const accountEffects = [
  ...(accountFunctions.postMove!.effects ?? []),
  ...(accountFunctions.registerPayment!.effects ?? []),
]

export const functions: Record<string, FnSpec> = {
  listConfigs: defineFn({
    input: {},
    effects: ['read:pos.Config'],
    agent: true,
    handler: (ctx) => ctx.db.select('pos.Config', { active: true }),
  }),
  saveConfig: defineFn({
    input: {
      id: 'id',
      name: 'text',
      warehouseId: 'id',
      pricelistId: 'id?',
      salesJournalId: 'id',
      revenueAccountId: 'id',
      receivableAccountId: 'id',
      taxAccountId: 'id?',
      maximumDifference: 'decimal?',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:pos.Config',
      'write:pos.Config',
      'read:stock.Warehouse',
      'read:pricing.Pricelist',
      'read:account.Journal',
      'read:account.Account',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      if (!(await ctx.db.select('stock.Warehouse', { id: args.warehouseId }))[0])
        return invalid('warehouseId', 'warehouse does not exist')
      const journal = (await ctx.db.select('account.Journal', { id: args.salesJournalId }))[0]
      if (journal?.type !== 'sale') return invalid('salesJournalId', 'a sales journal is required')
      const revenue = (await ctx.db.select('account.Account', { id: args.revenueAccountId }))[0],
        receivable = (await ctx.db.select('account.Account', { id: args.receivableAccountId }))[0]
      if (!revenue || !String(revenue.accountType).startsWith('income'))
        return invalid('revenueAccountId', 'an income account is required')
      if (receivable?.accountType !== 'asset_receivable')
        return invalid('receivableAccountId', 'a receivable account is required')
      if (args.taxAccountId && !(await ctx.db.select('account.Account', { id: args.taxAccountId }))[0])
        return invalid('taxAccountId', 'tax account does not exist')
      const existing = (await ctx.db.select('pos.Config', { id: args.id }))[0],
        values = {
          name: args.name,
          warehouseId: args.warehouseId,
          pricelistId: args.pricelistId ?? null,
          salesJournalId: args.salesJournalId,
          revenueAccountId: args.revenueAccountId,
          receivableAccountId: args.receivableAccountId,
          taxAccountId: args.taxAccountId ?? null,
          maximumDifference: args.maximumDifference ?? '0',
          active: true,
        }
      if (existing) await ctx.db.update('pos.Config', { id: args.id }, values)
      else await ctx.db.insert('pos.Config', { id: args.id, ...values })
      return { ok: true, id: args.id }
    },
  }),
  listPaymentMethods: defineFn({
    input: {},
    effects: ['read:pos.PaymentMethod'],
    agent: true,
    handler: (ctx) => ctx.db.select('pos.PaymentMethod', { active: true }),
  }),
  savePaymentMethod: defineFn({
    input: { id: 'id', name: 'text', journalId: 'id', isCash: 'bool?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:pos.PaymentMethod', 'write:pos.PaymentMethod', 'read:account.Journal'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const journal = (await ctx.db.select('account.Journal', { id: args.journalId }))[0]
      if (!journal?.defaultAccountId || !['cash', 'bank'].includes(String(journal.type)))
        return invalid('journalId', 'payment method requires a cash or bank journal with a default account')
      const existing = (await ctx.db.select('pos.PaymentMethod', { id: args.id }))[0],
        values = { name: args.name, journalId: args.journalId, isCash: Boolean(args.isCash), active: true }
      if (existing) await ctx.db.update('pos.PaymentMethod', { id: args.id }, values)
      else await ctx.db.insert('pos.PaymentMethod', { id: args.id, ...values })
      return { ok: true, id: args.id }
    },
  }),
  linkPaymentMethod: defineFn({
    input: { id: 'id', configId: 'id', paymentMethodId: 'id' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:pos.Config', 'read:pos.PaymentMethod', 'write:pos.ConfigPaymentMethod'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      if (!(await ctx.db.select('pos.Config', { id: args.configId }))[0])
        return invalid('configId', 'point of sale does not exist')
      if (!(await ctx.db.select('pos.PaymentMethod', { id: args.paymentMethodId }))[0])
        return invalid('paymentMethodId', 'payment method does not exist')
      await ctx.db.insertIfAbsent('pos.ConfigPaymentMethod', args)
      return { ok: true, id: args.id }
    },
  }),
  paymentMethodAvailable: defineFn({
    input: { configId: 'id', paymentMethodId: 'id' },
    output: { ok: 'bool' },
    effects: ['read:pos.ConfigPaymentMethod'],
    agent: true,
    handler: async (ctx, args) => ({
      ok: Boolean(
        (
          await ctx.db.select('pos.ConfigPaymentMethod', {
            configId: args.configId,
            paymentMethodId: args.paymentMethodId,
          })
        )[0],
      ),
    }),
  }),
  listSessions: defineFn({
    input: { state: 'text?' },
    effects: ['read:pos.Session'],
    agent: true,
    handler: (ctx, args) =>
      args.state ? ctx.db.select('pos.Session', { state: args.state }) : ctx.db.select('pos.Session'),
  }),
  getSession: defineFn({
    input: { id: 'id' },
    effects: ['read:pos.Session', 'read:pos.Order', 'read:pos.Payment', 'read:pos.PaymentMethod'],
    agent: true,
    handler: async (ctx, args) => {
      const session = (await ctx.db.select('pos.Session', { id: args.id }))[0]
      if (!session) return null
      const orders = await ctx.db.select('pos.Order', { sessionId: args.id })
      let expectedCash = n(session.cashRegisterBalanceStart)
      for (const order of orders)
        for (const payment of await ctx.db.select('pos.Payment', { orderId: order.id })) {
          const method = (await ctx.db.select('pos.PaymentMethod', { id: payment.paymentMethodId }))[0]
          if (method?.isCash) expectedCash += n(payment.amount)
        }
      return { ...session, cashRegisterBalanceEnd: decimal(expectedCash), orders }
    },
  }),
  createSession: defineFn({
    input: { id: 'id', configId: 'id', userId: 'id', openingCash: 'decimal?', openingNotes: 'text?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:pos.Session', 'write:pos.Session', 'read:pos.Config', 'read:user.User'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const existing = (await ctx.db.select('pos.Session', { id: args.id }))[0]
      if (existing) return { ok: true, id: args.id }
      if (!(await ctx.db.select('pos.Config', { id: args.configId }))[0])
        return invalid('configId', 'point of sale does not exist')
      if (!(await ctx.db.select('user.User', { id: args.userId }))[0])
        return invalid('userId', 'operator does not exist')
      const active = (await ctx.db.select('pos.Session', { configId: args.configId })).find(
        (row) => row.state !== 'closed',
      )
      if (active) return invalid('configId', 'this point of sale already has an active session')
      await ctx.db.insert('pos.Session', {
        id: args.id,
        name: `POS/${String(args.id)}`,
        configId: args.configId,
        userId: args.userId,
        state: 'opening_control',
        startAt: null,
        stopAt: null,
        openingNotes: args.openingNotes ?? null,
        closingNotes: null,
        cashRegisterBalanceStart: args.openingCash ?? '0',
        cashRegisterBalanceEnd: args.openingCash ?? '0',
        cashRegisterBalanceEndReal: args.openingCash ?? '0',
        cashRegisterDifference: '0',
      })
      return { ok: true, id: args.id }
    },
  }),
  openSession: defineFn({
    input: { id: 'id' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:pos.Session', 'write:pos.Session'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const session = (await ctx.db.select('pos.Session', { id: args.id }))[0]
      if (!session || !['opening_control', 'opened'].includes(String(session.state)))
        return invalid('state', 'only opening control can be opened')
      await ctx.db.update(
        'pos.Session',
        { id: args.id },
        { state: 'opened', startAt: session.startAt ?? now() },
      )
      return { ok: true, id: args.id }
    },
  }),
  startClosing: defineFn({
    input: { id: 'id' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:pos.Session', 'read:pos.Order', 'write:pos.Session'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const session = (await ctx.db.select('pos.Session', { id: args.id }))[0]
      if (!session || !['opened', 'closing_control'].includes(String(session.state)))
        return invalid('state', 'only an open session can enter closing control')
      if ((await ctx.db.select('pos.Order', { sessionId: args.id })).some((order) => order.state === 'draft'))
        return invalid('orders', 'pay or cancel every draft order before closing')
      await ctx.db.update('pos.Session', { id: args.id }, { state: 'closing_control' })
      return { ok: true, id: args.id }
    },
  }),
  closeSession: defineFn({
    input: { id: 'id', closingCash: 'decimal', closingNotes: 'text?' },
    output: { ok: 'bool', id: 'id?', difference: 'decimal?', errors: 'json?' },
    effects: [
      'read:pos.Session',
      'write:pos.Session',
      'read:pos.Config',
      'read:pos.Order',
      'read:pos.Payment',
      'read:pos.PaymentMethod',
      'write:pos.Order',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const session = (await ctx.db.select('pos.Session', { id: args.id }))[0]
      if (!session) return invalid('id', 'session does not exist')
      if (session.state === 'closed')
        return { ok: true, id: args.id, difference: session.cashRegisterDifference }
      if (session.state !== 'closing_control') return invalid('state', 'session must be in closing control')
      const config = (await ctx.db.select('pos.Config', { id: session.configId }))[0]!,
        orders = await ctx.db.select('pos.Order', { sessionId: args.id })
      let cash = n(session.cashRegisterBalanceStart)
      for (const order of orders)
        for (const payment of await ctx.db.select('pos.Payment', { orderId: order.id })) {
          const method = (await ctx.db.select('pos.PaymentMethod', { id: payment.paymentMethodId }))[0]
          if (method?.isCash) cash += n(payment.amount)
        }
      const difference = money(n(args.closingCash) - cash)
      if (Math.abs(difference) - n(config.maximumDifference) > 0.000001)
        return invalid('closingCash', 'cash difference exceeds the configured maximum')
      for (const order of orders)
        if (order.state === 'paid') await ctx.db.update('pos.Order', { id: order.id }, { state: 'done' })
      await ctx.db.update(
        'pos.Session',
        { id: args.id },
        {
          state: 'closed',
          stopAt: now(),
          closingNotes: args.closingNotes ?? null,
          cashRegisterBalanceEnd: decimal(cash),
          cashRegisterBalanceEndReal: args.closingCash,
          cashRegisterDifference: decimal(difference),
        },
      )
      return { ok: true, id: args.id, difference: decimal(difference) }
    },
  }),
  listOrders: defineFn({
    input: { state: 'text?', sessionId: 'id?' },
    effects: ['read:pos.Order'],
    agent: true,
    handler: (ctx, args) =>
      ctx.db.select('pos.Order', {
        ...(args.state ? { state: args.state } : {}),
        ...(args.sessionId ? { sessionId: args.sessionId } : {}),
      }),
  }),
  getOrder: defineFn({
    input: { id: 'id' },
    effects: ['read:pos.Order', 'read:pos.OrderLine', 'read:pos.Payment'],
    agent: true,
    handler: async (ctx, args) => {
      const order = (await ctx.db.select('pos.Order', { id: args.id }))[0]
      return order
        ? {
            ...order,
            lines: await ctx.db.select('pos.OrderLine', { orderId: args.id }),
            payments: await ctx.db.select('pos.Payment', { orderId: args.id }),
          }
        : null
    },
  }),
  createOrder: defineFn({
    input: { id: 'id', uuid: 'text?', sessionId: 'id', partnerId: 'id?', toInvoice: 'bool?', note: 'text?' },
    output: { ok: 'bool', id: 'id?', name: 'text?', errors: 'json?' },
    effects: [
      'read:pos.Sequence',
      'write:pos.Sequence',
      'read:pos.Session',
      'read:pos.Config',
      'read:pos.Order',
      'write:pos.Order',
      'read:partner.Partner',
      'read:company.Company',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const existing = (await ctx.db.select('pos.Order', { id: args.id }))[0]
      if (existing) return { ok: true, id: args.id, name: existing.name }
      if (args.uuid) {
        const offline = (await ctx.db.select('pos.Order', { uuid: args.uuid }))[0]
        if (offline) return { ok: true, id: offline.id, name: offline.name }
      }
      const session = (await ctx.db.select('pos.Session', { id: args.sessionId }))[0]
      if (session?.state !== 'opened') return invalid('sessionId', 'orders require an open POS session')
      if (args.partnerId && !(await ctx.db.select('partner.Partner', { id: args.partnerId }))[0])
        return invalid('partnerId', 'customer does not exist')
      if (args.toInvoice && !args.partnerId)
        return invalid('partnerId', 'invoiced POS orders require a customer')
      const sequenceNumber = await nextOrderNumber(ctx, args.sessionId),
        name = `Order ${String(sequenceNumber).padStart(5, '0')}`,
        posReference = `POS/${String(sequenceNumber).padStart(5, '0')}`
      await ctx.db.insert('pos.Order', {
        id: args.id,
        uuid: args.uuid ?? args.id,
        name,
        posReference,
        sequenceNumber,
        sessionId: args.sessionId,
        configId: session.configId,
        partnerId: args.partnerId ?? null,
        state: 'draft',
        invoiceStatus: args.toInvoice ? 'to_invoice' : 'to_invoice',
        isRefund: false,
        refundedOrderId: null,
        dateOrder: now(),
        currency: await currencyOf(ctx),
        amountUntaxed: '0',
        amountTax: '0',
        amountTotal: '0',
        amountPaid: '0',
        amountReturn: '0',
        toInvoice: Boolean(args.toInvoice),
        accountMoveId: null,
        pickingId: null,
        note: args.note ?? null,
      })
      return { ok: true, id: args.id, name }
    },
  }),
  addLine: defineFn({
    input: {
      id: 'id',
      orderId: 'id',
      productId: 'id',
      productUomId: 'id',
      qty: 'decimal',
      priceUnit: 'decimal?',
      discount: 'decimal?',
      taxId: 'id?',
    },
    output: { ok: 'bool', id: 'id?', priceUnit: 'decimal?', errors: 'json?' },
    effects: [
      'read:pos.Order',
      'read:pos.Config',
      'read:pos.OrderLine',
      'write:pos.OrderLine',
      'read:pos.Payment',
      'write:pos.Order',
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
      const order = (await ctx.db.select('pos.Order', { id: args.orderId }))[0]
      if (order?.state !== 'draft' || order.isRefund)
        return invalid('orderId', 'products can only be added to a new non-refund order')
      if (!(n(args.qty) > 0)) return invalid('qty', 'quantity must be positive')
      const product = await productOf(ctx, args.productId)
      if (!product?.template.saleOk) return invalid('productId', 'product is not available for sale')
      if (!(await ctx.db.select('uom.Unit', { id: args.productUomId }))[0])
        return invalid('productUomId', 'unit does not exist')
      const config = (await ctx.db.select('pos.Config', { id: order.configId }))[0]!,
        discount = args.discount ?? '0'
      let priceUnit: unknown = args.priceUnit
      if (priceUnit === undefined && config.pricelistId) {
        const result = (await pricingFunctions.priceFor!.handler(ctx, {
          pricelistId: config.pricelistId,
          productId: args.productId,
          quantity: args.qty,
          uomId: args.productUomId,
          date: order.dateOrder,
        })) as Row
        if (result.ok !== true) return result
        priceUnit = result.price
      }
      priceUnit ??= product.template.listPrice
      if (n(discount) < 0 || n(discount) > 100 || n(priceUnit) < 0)
        return invalid('discount', 'price and discount are invalid')
      const tax = args.taxId ? (await ctx.db.select('account.Tax', { id: args.taxId }))[0] : null
      if (args.taxId && (!tax || !['sale', 'none'].includes(String(tax.typeTaxUse))))
        return invalid('taxId', 'tax use does not match POS sales')
      try {
        taxAmounts(tax, n(args.qty) * n(priceUnit) * (1 - n(discount) / 100), n(args.qty))
      } catch (error) {
        return invalid('taxId', (error as Error).message)
      }
      if (!(await ctx.db.select('pos.OrderLine', { id: args.id }))[0])
        await ctx.db.insert('pos.OrderLine', {
          id: args.id,
          orderId: args.orderId,
          productId: args.productId,
          productUomId: args.productUomId,
          name: product.template.name,
          qty: args.qty,
          priceUnit: String(priceUnit),
          discount: String(discount),
          taxId: args.taxId ?? null,
          priceSubtotal: '0',
          priceSubtotalIncl: '0',
          refundedOrderlineId: null,
          sequence: 10,
        })
      await recompute(ctx, args.orderId)
      return { ok: true, id: args.id, priceUnit: String(priceUnit) }
    },
  }),
  addPayment: defineFn({
    input: { id: 'id', orderId: 'id', paymentMethodId: 'id', amount: 'decimal' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:pos.Order',
      'read:pos.ConfigPaymentMethod',
      'read:pos.PaymentMethod',
      'read:pos.Payment',
      'write:pos.Payment',
      'read:pos.OrderLine',
      'write:pos.OrderLine',
      'write:pos.Order',
      'read:account.Tax',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const order = (await ctx.db.select('pos.Order', { id: args.orderId }))[0]
      if (order?.state !== 'draft') return invalid('orderId', 'payments can only be added to a new order')
      if ((order.isRefund && n(args.amount) >= 0) || (!order.isRefund && n(args.amount) <= 0))
        return invalid(
          'amount',
          order.isRefund ? 'refund payments must be negative' : 'payment must be positive',
        )
      const linked = (
        await ctx.db.select('pos.ConfigPaymentMethod', {
          configId: order.configId,
          paymentMethodId: args.paymentMethodId,
        })
      )[0]
      if (!linked || !(await ctx.db.select('pos.PaymentMethod', { id: args.paymentMethodId }))[0])
        return invalid('paymentMethodId', 'payment method is not configured for this point of sale')
      if (!(await ctx.db.select('pos.Payment', { id: args.id }))[0])
        await ctx.db.insert('pos.Payment', {
          id: args.id,
          orderId: args.orderId,
          paymentMethodId: args.paymentMethodId,
          amount: args.amount,
          paymentDate: now(),
        })
      await recompute(ctx, args.orderId)
      return { ok: true, id: args.id }
    },
  }),
  validateOrder: defineFn({
    input: { id: 'id' },
    output: {
      ok: 'bool',
      id: 'id?',
      state: 'text?',
      pickingId: 'id?',
      accountMoveId: 'id?',
      errors: 'json?',
    },
    effects: [
      'read:pos.Order',
      'write:pos.Order',
      'read:pos.Session',
      'read:pos.Config',
      'read:pos.OrderLine',
      'read:pos.Payment',
      'read:pos.PaymentMethod',
      'read:product.Product',
      'read:product.Template',
      'read:account.Move',
      'write:account.Move',
      'write:account.MoveLine',
      'read:account.Journal',
      'read:account.Account',
      'read:account.Tax',
      ...stockEffects,
      ...accountEffects,
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const order = (await ctx.db.select('pos.Order', { id: args.id }))[0]
      if (!order) return invalid('id', 'POS order does not exist')
      if (['paid', 'done'].includes(String(order.state)))
        return {
          ok: true,
          id: args.id,
          state: order.state,
          pickingId: order.pickingId,
          accountMoveId: order.accountMoveId,
        }
      if (order.state !== 'draft') return invalid('state', 'only a new order can be paid')
      const session = (await ctx.db.select('pos.Session', { id: order.sessionId }))[0]
      if (!session || !['opened', 'closing_control'].includes(String(session.state)))
        return invalid('sessionId', 'session is not open')
      const lines = await ctx.db.select('pos.OrderLine', { orderId: args.id })
      if (!lines.length) return invalid('lines', 'order needs at least one product')
      const payments = await ctx.db.select('pos.Payment', { orderId: args.id })
      if (Math.abs(n(order.amountPaid) - n(order.amountTotal)) > 0.000001)
        return invalid('amountPaid', 'paid amount must equal order total')
      const config = (await ctx.db.select('pos.Config', { id: order.configId }))[0]!
      if (n(order.amountTax) && !config.taxAccountId)
        return invalid('taxAccountId', 'a tax account is required before stock is moved')
      const goods: Row[] = []
      for (const line of lines) {
        const held = await productOf(ctx, line.productId)
        if (held?.template.type !== 'service') {
          if (held && held.template.tracking !== 'none')
            return invalid(
              'tracking',
              'lot/serial selection is required for tracked POS products and is not supported by this retail subset',
            )
          goods.push(line)
        }
      }
      let pickingId: string | null = null
      if (goods.length) {
        pickingId = `${String(order.id)}:picking`
        const suffix = order.isRefund ? 'incoming' : 'outgoing'
        const created = (await stockFunctions.createPicking!.handler(ctx, {
          id: pickingId,
          name: `${order.isRefund ? 'Refund' : 'POS'} ${String(order.posReference)}`,
          pickingTypeId: `${String(config.warehouseId)}:${suffix}`,
          scheduledDate: order.dateOrder,
        })) as Row
        if (created.ok !== true) return created
        for (const line of goods) {
          const moveId = `${String(line.id)}:move`,
            quantity = Math.abs(n(line.qty))
          const moved = (await stockFunctions.addMove!.handler(ctx, {
            id: moveId,
            name: line.name,
            pickingId,
            productId: line.productId,
            productUomId: line.productUomId,
            productUomQty: decimal(quantity),
            origin: order.posReference,
          })) as Row
          if (moved.ok !== true) return moved
          await ctx.db.update('stock.Move', { id: moveId }, { posLineId: line.id })
        }
        const confirmed = (await stockFunctions.confirmPicking!.handler(ctx, { id: pickingId })) as Row
        if (confirmed.ok !== true) return confirmed
        for (const line of goods) {
          const moveId = `${String(line.id)}:move`
          if (order.isRefund) {
            const picking = (await ctx.db.select('stock.Picking', { id: pickingId }))[0]!
            const saved = (await stockFunctions.saveMoveLine!.handler(ctx, {
              id: `${moveId}:line`,
              moveId,
              productUomId: line.productUomId,
              quantity: decimal(Math.abs(n(line.qty))),
              locationId: picking.locationId,
              locationDestId: picking.locationDestId,
              picked: true,
            })) as Row
            if (saved.ok !== true) return saved
          } else {
            const reserved = (await stockFunctions.reserveMove!.handler(ctx, { id: moveId })) as Row
            if (reserved.ok !== true || n(reserved.reserved) + 0.000001 < Math.abs(n(line.qty)))
              return invalid('stock', `insufficient stock for ${String(line.name)}`)
          }
        }
        const completed = (await stockFunctions.completePicking!.handler(ctx, {
          id: pickingId,
          createBackorder: false,
        })) as Row
        if (completed.ok !== true) return completed
      }
      let accountMoveId: string
      try {
        accountMoveId = await createAccounting(ctx, order, config, lines, payments)
      } catch (error) {
        return invalid('accounting', (error as Error).message)
      }
      await ctx.db.update(
        'pos.Order',
        { id: args.id },
        {
          state: 'paid',
          invoiceStatus: order.toInvoice ? 'invoiced' : 'to_invoice',
          pickingId,
          accountMoveId,
        },
      )
      return { ok: true, id: args.id, state: 'paid', ...(pickingId ? { pickingId } : {}), accountMoveId }
    },
  }),
  refundOrder: defineFn({
    input: { id: 'id', uuid: 'text?', originalOrderId: 'id', sessionId: 'id' },
    output: { ok: 'bool', id: 'id?', name: 'text?', errors: 'json?' },
    effects: [
      'read:pos.Order',
      'read:pos.OrderLine',
      'write:pos.Order',
      'write:pos.OrderLine',
      'read:pos.Payment',
      'write:pos.Order',
      'read:account.Tax',
      'read:pos.Sequence',
      'write:pos.Sequence',
      'read:pos.Session',
      'read:pos.Config',
      'read:partner.Partner',
      'read:company.Company',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const existing = (await ctx.db.select('pos.Order', { id: args.id }))[0]
      if (existing) return { ok: true, id: args.id, name: existing.name }
      const original = (await ctx.db.select('pos.Order', { id: args.originalOrderId }))[0]
      if (!original || !['paid', 'done'].includes(String(original.state)) || original.isRefund)
        return invalid('originalOrderId', 'only a paid sale can be refunded')
      const session = (await ctx.db.select('pos.Session', { id: args.sessionId }))[0]
      if (session?.state !== 'opened') return invalid('sessionId', 'refund requires an open session')
      const sequenceNumber = await nextOrderNumber(ctx, args.sessionId),
        name = `Order ${String(sequenceNumber).padStart(5, '0')}`
      await ctx.db.insert('pos.Order', {
        id: args.id,
        uuid: args.uuid ?? args.id,
        name,
        posReference: `POS/${String(sequenceNumber).padStart(5, '0')}`,
        sequenceNumber,
        sessionId: args.sessionId,
        configId: session.configId,
        partnerId: original.partnerId,
        state: 'draft',
        invoiceStatus: 'to_invoice',
        isRefund: true,
        refundedOrderId: original.id,
        dateOrder: now(),
        currency: original.currency,
        amountUntaxed: '0',
        amountTax: '0',
        amountTotal: '0',
        amountPaid: '0',
        amountReturn: '0',
        toInvoice: false,
        accountMoveId: null,
        pickingId: null,
        note: `Refund ${String(original.posReference)}`,
      })
      let sequence = 10
      for (const line of await ctx.db.select('pos.OrderLine', { orderId: original.id })) {
        await ctx.db.insert('pos.OrderLine', {
          id: `${String(args.id)}:${String(line.id)}`,
          orderId: args.id,
          productId: line.productId,
          productUomId: line.productUomId,
          name: line.name,
          qty: decimal(-n(line.qty)),
          priceUnit: line.priceUnit,
          discount: line.discount,
          taxId: line.taxId,
          priceSubtotal: '0',
          priceSubtotalIncl: '0',
          refundedOrderlineId: line.id,
          sequence,
        })
        sequence += 10
      }
      await recompute(ctx, args.id)
      return { ok: true, id: args.id, name }
    },
  }),
  cancelOrder: defineFn({
    input: { id: 'id' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:pos.Order', 'write:pos.Order'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const order = (await ctx.db.select('pos.Order', { id: args.id }))[0]
      if (!order) return invalid('id', 'order does not exist')
      if (order.state !== 'draft' && order.state !== 'cancel')
        return invalid('state', 'paid orders must be refunded, not cancelled')
      await ctx.db.update('pos.Order', { id: args.id }, { state: 'cancel' })
      return { ok: true, id: args.id }
    },
  }),
}
