import { defineFn, deleteFrom, eq } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { functions as accountFunctions, quoteTaxLine } from '../account/functions.ts'
import { functions as pricingFunctions } from '../pricing/functions.ts'
import { sellableProduct } from '../product/sellable.ts'
import { functions as stockFunctions } from '../stock/functions.ts'

export const POS_ORDER_STATES = ['draft', 'cancel', 'paid', 'done'] as const
export const POS_SESSION_STATES = [
  'opening_control',
  'opened',
  'closing_control',
  'pending_approval',
  'closed',
] as const
export const POS_TENDER_STATES = ['captured', 'voided'] as const
export const POS_INVOICE_STATUSES = ['invoiced', 'to_invoice'] as const
const invalid = (field: string, message: string) => ({ ok: false as const, errors: [{ field, message }] })
const n = (value: unknown) => Number(value ?? 0)
const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100
const decimal = (value: number) => String(money(value))
const now = () => new Date().toISOString()

type RevisionClaim = { ok: true; order: Row; revision: number } | ReturnType<typeof invalid>

async function claimDraftRevision(ctx: Ctx, id: unknown, expectedRevision?: unknown): Promise<RevisionClaim> {
  const order = (await ctx.db.select('pos.Order', { id }))[0]
  if (!order) return invalid('orderId', 'order does not exist')
  if (order.state !== 'draft') return invalid('state', 'only a draft order can be changed')
  const current = n(order.revision)
  if (expectedRevision !== undefined && n(expectedRevision) !== current)
    return invalid('expectedRevision', 'the order changed; reload it before continuing')
  const changed = await ctx.db.compareAndSet(
    'pos.Order',
    { id: order.id },
    { revision: order.revision ?? null },
    { revision: current + 1 },
  )
  if (!('dryRun' in changed) && !changed.matched)
    return invalid('expectedRevision', 'the order changed; reload it before continuing')
  return { ok: true, order, revision: current + 1 }
}

async function claimSessionRevision(
  ctx: Ctx,
  id: unknown,
  expectedRevision?: unknown,
): Promise<{ ok: true; session: Row; revision: number } | ReturnType<typeof invalid>> {
  const session = (await ctx.db.select('pos.Session', { id }))[0]
  if (!session) return invalid('id', 'session does not exist')
  const current = n(session.revision)
  if (expectedRevision !== undefined && n(expectedRevision) !== current)
    return invalid('expectedRevision', 'the shift changed; reload it before continuing')
  const changed = await ctx.db.compareAndSet(
    'pos.Session',
    { id: session.id },
    { revision: session.revision ?? null },
    { revision: current + 1 },
  )
  if (!('dryRun' in changed) && !changed.matched)
    return invalid('expectedRevision', 'the shift changed; reload it before continuing')
  return { ok: true, session, revision: current + 1 }
}

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
async function recompute(ctx: Ctx, orderId: unknown) {
  const lines = await ctx.db.select('pos.OrderLine', { orderId })
  const untaxed = money(lines.reduce((sum, line) => sum + n(line.priceSubtotal), 0))
  const total = money(lines.reduce((sum, line) => sum + n(line.priceSubtotalIncl), 0))
  const tax = money(total - untaxed)
  const payments = await ctx.db.select('pos.Payment', { orderId }),
    captured = payments.filter((payment) => (payment.state ?? 'captured') === 'captured'),
    paid = money(captured.reduce((sum, payment) => sum + n(payment.appliedAmount ?? payment.amount), 0)),
    returned = money(
      captured.reduce(
        (sum, payment) =>
          sum + n(payment.tenderedAmount ?? payment.amount) - n(payment.appliedAmount ?? payment.amount),
        0,
      ),
    )
  await ctx.db.update(
    'pos.Order',
    { id: orderId },
    {
      amountUntaxed: decimal(untaxed),
      amountTax: decimal(tax),
      amountExact: decimal(total),
      amountRounding: '0',
      amountTotal: decimal(total),
      amountPaid: decimal(paid),
      amountReturn: decimal(returned),
    },
  )
}

async function consumerPartner(ctx: Ctx): Promise<Row> {
  const name = 'Bán cho người tiêu dùng'
  const existing = (await ctx.db.select('partner.Partner', { name })).find((row) => row.active !== false)
  if (existing) return existing
  const id = `pos-consumer-${String(ctx.scope.company)}`
  await ctx.db.insertIfAbsent('partner.Partner', {
    id,
    kind: 'person',
    name,
    parentId: null,
    vat: null,
    ref: null,
    email: null,
    phone: null,
    lang: 'vi',
    active: true,
  })
  return (await ctx.db.select('partner.Partner', { id }))[0]!
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
      // Revenue follows the signed line subtotal. A negative Loyalty line is a
      // contra-revenue debit on a sale, and becomes a credit when a refund
      // reverses it. Looking only at the order direction would overstate revenue.
      const balance = -n(line.priceSubtotal),
        debit = Math.max(0, balance),
        credit = Math.max(0, -balance)
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
        debit: decimal(debit),
        credit: decimal(credit),
        balance: decimal(balance),
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

async function createCashAdjustmentAccounting(
  ctx: Ctx,
  session: Row,
  config: Row,
  adjustmentId: string,
  difference: number,
) {
  if (!config.cashOverShortAccountId)
    throw new Error('a cash over/short clearing account is required before approving variance')
  const links = await ctx.db.select('pos.ConfigPaymentMethod', { configId: config.id })
  let method: Row | undefined
  for (const link of links) {
    const held = (await ctx.db.select('pos.PaymentMethod', { id: link.paymentMethodId }))[0]
    if (held?.isCash) {
      method = held
      break
    }
  }
  if (!method) throw new Error('the POS configuration needs a cash payment method')
  const journal = (await ctx.db.select('account.Journal', { id: method.journalId }))[0]
  if (!journal?.defaultAccountId) throw new Error('the cash journal needs a default account')
  const moveId = `${adjustmentId}:account`
  if (!(await ctx.db.select('account.Move', { id: moveId }))[0]) {
    const amount = Math.abs(difference)
    await ctx.db.insert('account.Move', {
      id: moveId,
      name: moveId,
      ref: `POS cash variance ${String(session.name)}`,
      date: now(),
      moveType: 'entry',
      state: 'draft',
      journalId: method.journalId,
      partnerId: null,
      invoiceDate: null,
      invoiceDateDue: null,
      paymentTermId: null,
      paymentState: 'paid',
      currency: await currencyOf(ctx),
      amountUntaxed: '0',
      amountTax: '0',
      amountTotal: '0',
      postedAt: null,
    })
    await ctx.db.insert('account.MoveLine', {
      id: `${moveId}:cash`,
      moveId,
      name: method.name,
      accountId: journal.defaultAccountId,
      partnerId: null,
      productId: null,
      productUomId: null,
      quantity: '1',
      priceUnit: decimal(amount),
      discount: '0',
      taxId: null,
      debit: difference > 0 ? decimal(amount) : '0',
      credit: difference < 0 ? decimal(amount) : '0',
      balance: decimal(difference),
      dateMaturity: null,
      displayType: null,
      reconciled: false,
      amountResidual: '0',
      sequence: 10,
    })
    await ctx.db.insert('account.MoveLine', {
      id: `${moveId}:clearing`,
      moveId,
      name: 'Cash over/short',
      accountId: config.cashOverShortAccountId,
      partnerId: null,
      productId: null,
      productUomId: null,
      quantity: '1',
      priceUnit: decimal(amount),
      discount: '0',
      taxId: null,
      debit: difference < 0 ? decimal(amount) : '0',
      credit: difference > 0 ? decimal(amount) : '0',
      balance: decimal(-difference),
      dateMaturity: null,
      displayType: null,
      reconciled: false,
      amountResidual: '0',
      sequence: 20,
    })
  }
  const posted = (await accountFunctions.postMove!.handler(ctx, { id: moveId })) as Row
  if (posted.ok !== true) throw new Error('cash variance accounting move could not be posted')
  return moveId
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
      cashOverShortAccountId: 'id?',
      cashRoundingIncrement: 'decimal?',
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
      if (
        args.cashOverShortAccountId &&
        !(await ctx.db.select('account.Account', { id: args.cashOverShortAccountId }))[0]
      )
        return invalid('cashOverShortAccountId', 'cash over/short account does not exist')
      if (n(args.cashRoundingIncrement) !== 0)
        return invalid('cashRoundingIncrement', 'cash rounding is modeled but disabled for the pilot')
      const existing = (await ctx.db.select('pos.Config', { id: args.id }))[0],
        values = {
          name: args.name,
          warehouseId: args.warehouseId,
          pricelistId: args.pricelistId ?? null,
          salesJournalId: args.salesJournalId,
          revenueAccountId: args.revenueAccountId,
          receivableAccountId: args.receivableAccountId,
          taxAccountId: args.taxAccountId ?? null,
          cashOverShortAccountId: args.cashOverShortAccountId ?? existing?.cashOverShortAccountId ?? null,
          cashRoundingIncrement: args.cashRoundingIncrement ?? existing?.cashRoundingIncrement ?? '0',
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
          if ((payment.state ?? 'captured') !== 'captured') continue
          const method = (await ctx.db.select('pos.PaymentMethod', { id: payment.paymentMethodId }))[0]
          if (method?.isCash) expectedCash += n(payment.appliedAmount ?? payment.amount)
        }
      return { ...session, cashRegisterBalanceEnd: decimal(expectedCash), orders }
    },
  }),
  createSession: defineFn({
    input: {
      id: 'id',
      configId: 'id',
      userId: 'id',
      deviceId: 'text?',
      openingCash: 'decimal?',
      openingNotes: 'text?',
    },
    output: { ok: 'bool', id: 'id?', revision: 'int?', errors: 'json?' },
    effects: [
      'read:pos.Session',
      'write:pos.Session',
      'read:pos.SessionLock',
      'write:pos.SessionLock',
      'read:pos.Config',
      'read:user.User',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const existing = (await ctx.db.select('pos.Session', { id: args.id }))[0]
      if (existing) {
        const same =
          existing.configId === args.configId &&
          existing.userId === args.userId &&
          (args.deviceId === undefined || existing.deviceId === args.deviceId)
        return same
          ? { ok: true, id: args.id, revision: n(existing.revision) }
          : invalid('id', 'session id is already used by a different command')
      }
      if (!(await ctx.db.select('pos.Config', { id: args.configId }))[0])
        return invalid('configId', 'point of sale does not exist')
      if (!(await ctx.db.select('user.User', { id: args.userId }))[0])
        return invalid('userId', 'operator does not exist')
      let lock = (await ctx.db.select('pos.SessionLock', { id: args.configId }))[0]
      if (!lock) {
        await ctx.db.insertIfAbsent('pos.SessionLock', { id: args.configId, sessionId: args.id })
        lock = (await ctx.db.select('pos.SessionLock', { id: args.configId }))[0]
      }
      if (lock?.sessionId !== args.id) {
        const active = (await ctx.db.select('pos.Session', { id: lock?.sessionId }))[0]
        if (active && !['closed', 'pending_approval'].includes(String(active.state)))
          return invalid('configId', 'this point of sale already has an active session')
        const changed = await ctx.db.compareAndSet(
          'pos.SessionLock',
          { id: args.configId },
          { sessionId: lock?.sessionId },
          { sessionId: args.id },
        )
        if (!('dryRun' in changed) && !changed.matched)
          return invalid('configId', 'this point of sale already has an active session')
      }
      await ctx.db.insert('pos.Session', {
        id: args.id,
        name: `POS/${String(args.id)}`,
        configId: args.configId,
        userId: args.userId,
        deviceId: args.deviceId ?? null,
        state: 'opening_control',
        startAt: null,
        stopAt: null,
        openingNotes: args.openingNotes ?? null,
        closingNotes: null,
        cashRegisterBalanceStart: args.openingCash ?? '0',
        cashRegisterBalanceEnd: args.openingCash ?? '0',
        cashRegisterBalanceEndReal: args.openingCash ?? '0',
        cashRegisterDifference: '0',
        varianceStatus: 'none',
        varianceReason: null,
        varianceNote: null,
        varianceApprovedBy: null,
        varianceApprovedAt: null,
        cashAdjustmentId: null,
        revision: 0,
      })
      return { ok: true, id: args.id, revision: 0 }
    },
  }),
  openSession: defineFn({
    input: { id: 'id', expectedRevision: 'int?' },
    output: { ok: 'bool', id: 'id?', revision: 'int?', errors: 'json?' },
    effects: ['read:pos.Session', 'write:pos.Session'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const held = (await ctx.db.select('pos.Session', { id: args.id }))[0]
      if (held?.state === 'opened') return { ok: true, id: args.id, revision: n(held.revision) }
      if (held?.state !== 'opening_control') return invalid('state', 'only opening control can be opened')
      const claim = await claimSessionRevision(ctx, args.id, args.expectedRevision)
      if (claim.ok !== true) return claim
      await ctx.db.update('pos.Session', { id: args.id }, { state: 'opened', startAt: held.startAt ?? now() })
      return { ok: true, id: args.id, revision: claim.revision }
    },
  }),
  startClosing: defineFn({
    input: { id: 'id', expectedRevision: 'int?' },
    output: { ok: 'bool', id: 'id?', revision: 'int?', errors: 'json?' },
    effects: ['read:pos.Session', 'read:pos.Order', 'write:pos.Session'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const session = (await ctx.db.select('pos.Session', { id: args.id }))[0]
      if (session?.state === 'closing_control')
        return { ok: true, id: args.id, revision: n(session.revision) }
      if (session?.state !== 'opened')
        return invalid('state', 'only an open session can enter closing control')
      if ((await ctx.db.select('pos.Order', { sessionId: args.id })).some((order) => order.state === 'draft'))
        return invalid('orders', 'pay or cancel every draft order before closing')
      const claim = await claimSessionRevision(ctx, args.id, args.expectedRevision)
      if (claim.ok !== true) return claim
      await ctx.db.update('pos.Session', { id: args.id }, { state: 'closing_control' })
      return { ok: true, id: args.id, revision: claim.revision }
    },
  }),
  closeSession: defineFn({
    input: {
      id: 'id',
      closingCash: 'decimal',
      closingNotes: 'text?',
      varianceReason: 'text?',
      varianceNote: 'text?',
      expectedRevision: 'int?',
    },
    output: {
      ok: 'bool',
      id: 'id?',
      revision: 'int?',
      difference: 'decimal?',
      pendingApproval: 'bool?',
      errors: 'json?',
    },
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
      if (['closed', 'pending_approval'].includes(String(session.state)))
        return {
          ok: true,
          id: args.id,
          revision: n(session.revision),
          difference: session.cashRegisterDifference,
          pendingApproval: session.state === 'pending_approval',
        }
      if (session.state !== 'closing_control') return invalid('state', 'session must be in closing control')
      const config = (await ctx.db.select('pos.Config', { id: session.configId }))[0]!,
        orders = await ctx.db.select('pos.Order', { sessionId: args.id })
      let cash = n(session.cashRegisterBalanceStart)
      for (const order of orders)
        for (const payment of await ctx.db.select('pos.Payment', { orderId: order.id })) {
          if ((payment.state ?? 'captured') !== 'captured') continue
          const method = (await ctx.db.select('pos.PaymentMethod', { id: payment.paymentMethodId }))[0]
          if (method?.isCash) cash += n(payment.appliedAmount ?? payment.amount)
        }
      const difference = money(n(args.closingCash) - cash)
      const pendingApproval = Math.abs(difference) - n(config.maximumDifference) > 0.000001
      if (pendingApproval && !String(args.varianceReason ?? '').trim())
        return invalid('varianceReason', 'cash difference requires a reason before sealing the shift')
      const claim = await claimSessionRevision(ctx, args.id, args.expectedRevision)
      if (claim.ok !== true) return claim
      for (const order of orders)
        if (order.state === 'paid') await ctx.db.update('pos.Order', { id: order.id }, { state: 'done' })
      await ctx.db.update(
        'pos.Session',
        { id: args.id },
        {
          state: pendingApproval ? 'pending_approval' : 'closed',
          stopAt: now(),
          closingNotes: args.closingNotes ?? null,
          cashRegisterBalanceEnd: decimal(cash),
          cashRegisterBalanceEndReal: args.closingCash,
          cashRegisterDifference: decimal(difference),
          varianceStatus: pendingApproval ? 'pending' : 'none',
          varianceReason: pendingApproval ? String(args.varianceReason) : null,
          varianceNote: pendingApproval ? (args.varianceNote ?? null) : null,
        },
      )
      return {
        ok: true,
        id: args.id,
        revision: claim.revision,
        difference: decimal(difference),
        pendingApproval,
      }
    },
  }),
  recountSession: defineFn({
    input: { id: 'id', countedCash: 'decimal', expectedRevision: 'int', reviewedBy: 'text', note: 'text?' },
    output: {
      ok: 'bool',
      id: 'id?',
      revision: 'int?',
      difference: 'decimal?',
      pendingApproval: 'bool?',
      errors: 'json?',
    },
    effects: ['read:pos.Session', 'write:pos.Session', 'read:pos.Config'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const session = (await ctx.db.select('pos.Session', { id: args.id }))[0]
      if (session?.state !== 'pending_approval')
        return invalid('state', 'only a sealed variance can be recounted')
      const config = (await ctx.db.select('pos.Config', { id: session.configId }))[0]!
      const difference = money(n(args.countedCash) - n(session.cashRegisterBalanceEnd))
      const pendingApproval = Math.abs(difference) - n(config.maximumDifference) > 0.000001
      const claim = await claimSessionRevision(ctx, args.id, args.expectedRevision)
      if (claim.ok !== true) return claim
      await ctx.db.update(
        'pos.Session',
        { id: args.id },
        {
          state: pendingApproval ? 'pending_approval' : 'closed',
          cashRegisterBalanceEndReal: args.countedCash,
          cashRegisterDifference: decimal(difference),
          varianceStatus: pendingApproval ? 'pending' : 'corrected',
          varianceNote: args.note ?? session.varianceNote ?? null,
          varianceApprovedBy: pendingApproval ? null : args.reviewedBy,
          varianceApprovedAt: pendingApproval ? null : now(),
        },
      )
      return {
        ok: true,
        id: args.id,
        revision: claim.revision,
        difference: decimal(difference),
        pendingApproval,
      }
    },
  }),
  approveSessionVariance: defineFn({
    input: { id: 'id', expectedRevision: 'int', approvedBy: 'text', note: 'text?' },
    output: {
      ok: 'bool',
      id: 'id?',
      revision: 'int?',
      adjustmentId: 'id?',
      accountMoveId: 'id?',
      errors: 'json?',
    },
    effects: [
      'read:pos.Session',
      'write:pos.Session',
      'read:pos.Config',
      'read:pos.ConfigPaymentMethod',
      'read:pos.PaymentMethod',
      'read:pos.CashAdjustment',
      'write:pos.CashAdjustment',
      'read:account.Journal',
      'read:account.Move',
      'write:account.Move',
      'write:account.MoveLine',
      'read:company.Company',
      ...accountEffects,
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const session = (await ctx.db.select('pos.Session', { id: args.id }))[0]
      if (!session) return invalid('id', 'session does not exist')
      if (session.varianceStatus === 'approved') {
        const adjustment = (await ctx.db.select('pos.CashAdjustment', { sessionId: args.id }))[0]
        return {
          ok: true,
          id: args.id,
          revision: n(session.revision),
          adjustmentId: adjustment?.id,
          accountMoveId: adjustment?.accountMoveId,
        }
      }
      if (session.state !== 'pending_approval')
        return invalid('state', 'only a sealed variance can be approved')
      const config = (await ctx.db.select('pos.Config', { id: session.configId }))[0]!
      const claim = await claimSessionRevision(ctx, args.id, args.expectedRevision)
      if (claim.ok !== true) return claim
      const adjustmentId = `${String(args.id)}:variance`
      let accountMoveId: string
      try {
        accountMoveId = await createCashAdjustmentAccounting(
          ctx,
          session,
          config,
          adjustmentId,
          n(session.cashRegisterDifference),
        )
      } catch (error) {
        return invalid('accounting', (error as Error).message)
      }
      await ctx.db.insertIfAbsent('pos.CashAdjustment', {
        id: adjustmentId,
        sessionId: args.id,
        amount: session.cashRegisterDifference,
        reason: session.varianceReason,
        note: args.note ?? session.varianceNote ?? null,
        approvedBy: args.approvedBy,
        approvedAt: now(),
        accountMoveId,
      })
      await ctx.db.update(
        'pos.Session',
        { id: args.id },
        {
          state: 'closed',
          varianceStatus: 'approved',
          varianceNote: args.note ?? session.varianceNote ?? null,
          varianceApprovedBy: args.approvedBy,
          varianceApprovedAt: now(),
          cashAdjustmentId: adjustmentId,
        },
      )
      return { ok: true, id: args.id, revision: claim.revision, adjustmentId, accountMoveId }
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
    input: {
      id: 'id',
      uuid: 'text?',
      sessionId: 'id',
      partnerId: 'id?',
      toInvoice: 'bool?',
      note: 'text?',
      operatorId: 'text?',
      deviceId: 'text?',
      priceBookRevision: 'text?',
    },
    output: { ok: 'bool', id: 'id?', name: 'text?', revision: 'int?', errors: 'json?' },
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
      if (existing) {
        const same =
          existing.sessionId === args.sessionId &&
          (args.uuid === undefined || existing.uuid === args.uuid) &&
          (args.deviceId === undefined || existing.deviceId === args.deviceId)
        return same
          ? { ok: true, id: args.id, name: existing.name, revision: n(existing.revision) }
          : invalid('id', 'order id is already used by a different command')
      }
      if (args.uuid) {
        const offline = (await ctx.db.select('pos.Order', { uuid: args.uuid }))[0]
        if (offline) {
          const same =
            offline.sessionId === args.sessionId &&
            (args.deviceId === undefined || offline.deviceId === args.deviceId)
          return same
            ? { ok: true, id: offline.id, name: offline.name, revision: n(offline.revision) }
            : invalid('uuid', 'order uuid is already used by a different command')
        }
      }
      const session = (await ctx.db.select('pos.Session', { id: args.sessionId }))[0]
      if (session?.state !== 'opened') return invalid('sessionId', 'orders require an open POS session')
      if (args.partnerId && !(await ctx.db.select('partner.Partner', { id: args.partnerId }))[0])
        return invalid('partnerId', 'customer does not exist')
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
        amountExact: '0',
        amountRounding: '0',
        amountTotal: '0',
        amountPaid: '0',
        amountReturn: '0',
        toInvoice: true,
        accountMoveId: null,
        pickingId: null,
        note: args.note ?? null,
        revision: 0,
        operatorId: args.operatorId ?? null,
        deviceId: args.deviceId ?? null,
        priceBookRevision: args.priceBookRevision ?? null,
      })
      return { ok: true, id: args.id, name, revision: 0 }
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
      taxIds: 'json?',
      quoteRevision: 'text?',
      expectedRevision: 'int?',
    },
    output: { ok: 'bool', id: 'id?', priceUnit: 'decimal?', revision: 'int?', errors: 'json?' },
    effects: [
      'read:pos.Order',
      'read:pos.Config',
      'read:pos.OrderLine',
      'write:pos.OrderLine',
      'read:pos.Payment',
      'write:pos.Order',
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
      const order = (await ctx.db.select('pos.Order', { id: args.orderId }))[0]
      if (order?.state !== 'draft' || order.isRefund)
        return invalid('orderId', 'products can only be added to a new non-refund order')
      if (!(n(args.qty) > 0)) return invalid('qty', 'quantity must be positive')
      const sellable = await sellableProduct(ctx, args.productId, args.productUomId)
      if (!sellable.ok)
        return invalid(sellable.field === 'uomId' ? 'productUomId' : sellable.field, sellable.message)
      const product = sellable.value
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
      const taxIds = args.taxIds !== undefined ? args.taxIds : args.taxId ? [args.taxId] : undefined
      const quote = await quoteTaxLine(ctx, {
        productId: args.productId,
        taxIds,
        quantity: args.qty,
        priceUnit,
        discount,
      })
      if (quote.ok !== true) return quote
      const existing = (await ctx.db.select('pos.OrderLine', { id: args.id }))[0]
      if (existing) {
        const same =
          existing.orderId === args.orderId &&
          existing.productId === args.productId &&
          existing.productUomId === args.productUomId &&
          n(existing.qty) === n(args.qty) &&
          n(existing.priceUnit) === n(priceUnit) &&
          n(existing.discount) === n(discount) &&
          JSON.stringify(existing.taxIds ?? []) === JSON.stringify(quote.taxIds)
        return same
          ? { ok: true, id: args.id, priceUnit: String(priceUnit), revision: n(order.revision) }
          : invalid('id', 'line id is already used by a different command')
      }
      const claim = await claimDraftRevision(ctx, args.orderId, args.expectedRevision)
      if (claim.ok !== true) return claim
      await ctx.db.insert('pos.OrderLine', {
        id: args.id,
        orderId: args.orderId,
        productId: args.productId,
        productUomId: args.productUomId,
        name: product.template.name,
        qty: args.qty,
        priceUnit: String(priceUnit),
        discount: String(discount),
        taxId: quote.taxIds[0] ?? null,
        taxIds: quote.taxIds,
        taxEvidence: { currency: quote.currency, scale: quote.scale, taxes: quote.taxes },
        quoteRevision: args.quoteRevision ?? null,
        priceSubtotal: quote.amountUntaxed,
        priceSubtotalIncl: quote.amountTotal,
        refundedOrderlineId: null,
        sequence: 10,
      })
      await recompute(ctx, args.orderId)
      return { ok: true, id: args.id, priceUnit: String(priceUnit), revision: claim.revision }
    },
  }),
  updateOrder: defineFn({
    input: {
      id: 'id',
      expectedRevision: 'int',
      partnerId: 'id?',
      clearPartner: 'bool?',
      note: 'text?',
    },
    output: { ok: 'bool', id: 'id?', revision: 'int?', errors: 'json?' },
    effects: ['read:pos.Order', 'write:pos.Order', 'read:partner.Partner'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      if (args.partnerId && !(await ctx.db.select('partner.Partner', { id: args.partnerId }))[0])
        return invalid('partnerId', 'customer does not exist')
      const claim = await claimDraftRevision(ctx, args.id, args.expectedRevision)
      if (claim.ok !== true) return claim
      await ctx.db.update(
        'pos.Order',
        { id: args.id },
        {
          ...(args.clearPartner ? { partnerId: null } : args.partnerId ? { partnerId: args.partnerId } : {}),
          ...(args.note !== undefined ? { note: args.note } : {}),
        },
      )
      return { ok: true, id: args.id, revision: claim.revision }
    },
  }),
  updateLine: defineFn({
    input: {
      id: 'id',
      orderId: 'id',
      expectedRevision: 'int',
      qty: 'decimal',
      priceUnit: 'decimal?',
      discount: 'decimal?',
      taxIds: 'json?',
      quoteRevision: 'text?',
      sequence: 'int?',
      overrideReason: 'text?',
      overrideBy: 'text?',
    },
    output: { ok: 'bool', id: 'id?', priceUnit: 'decimal?', revision: 'int?', errors: 'json?' },
    effects: [
      'read:pos.Order',
      'write:pos.Order',
      'read:pos.OrderLine',
      'write:pos.OrderLine',
      'read:pos.Payment',
      'read:pos.Config',
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
      const order = (await ctx.db.select('pos.Order', { id: args.orderId }))[0]
      const line = (await ctx.db.select('pos.OrderLine', { id: args.id }))[0]
      if (!line || line.orderId !== args.orderId) return invalid('id', 'line does not belong to this order')
      if (order?.state !== 'draft' || order.isRefund)
        return invalid('orderId', 'only a new non-refund order can be changed')
      if (!(n(args.qty) > 0)) return invalid('qty', 'quantity must be positive')
      const sellable = await sellableProduct(ctx, line.productId, line.productUomId)
      if (!sellable.ok) return invalid(sellable.field, sellable.message)
      const config = (await ctx.db.select('pos.Config', { id: order.configId }))[0]!
      let priceUnit: unknown = args.priceUnit
      if (priceUnit === undefined && config.pricelistId) {
        const priced = (await pricingFunctions.priceFor!.handler(ctx, {
          pricelistId: config.pricelistId,
          productId: line.productId,
          quantity: args.qty,
          uomId: line.productUomId,
          date: order.dateOrder,
        })) as Row
        if (priced.ok !== true) return priced
        priceUnit = priced.price
      }
      priceUnit ??= sellable.value.template.listPrice
      const discount = args.discount ?? line.discount
      const taxIds = args.taxIds !== undefined ? args.taxIds : (line.taxIds ?? [])
      const quote = await quoteTaxLine(ctx, {
        productId: line.productId,
        taxIds,
        quantity: args.qty,
        priceUnit,
        discount,
      })
      if (quote.ok !== true) return quote
      const claim = await claimDraftRevision(ctx, args.orderId, args.expectedRevision)
      if (claim.ok !== true) return claim
      await ctx.db.update(
        'pos.OrderLine',
        { id: args.id },
        {
          qty: args.qty,
          priceUnit: String(priceUnit),
          discount: String(discount),
          taxId: quote.taxIds[0] ?? null,
          taxIds: quote.taxIds,
          taxEvidence: { currency: quote.currency, scale: quote.scale, taxes: quote.taxes },
          quoteRevision: args.quoteRevision ?? line.quoteRevision ?? null,
          overrideReason:
            args.priceUnit !== undefined || args.discount !== undefined
              ? (args.overrideReason ?? line.overrideReason ?? null)
              : (line.overrideReason ?? null),
          overrideBy:
            args.priceUnit !== undefined || args.discount !== undefined
              ? (args.overrideBy ?? line.overrideBy ?? null)
              : (line.overrideBy ?? null),
          priceSubtotal: quote.amountUntaxed,
          priceSubtotalIncl: quote.amountTotal,
          sequence: args.sequence ?? line.sequence,
        },
      )
      await recompute(ctx, args.orderId)
      return { ok: true, id: args.id, priceUnit: String(priceUnit), revision: claim.revision }
    },
  }),
  removeLine: defineFn({
    input: { id: 'id', orderId: 'id', expectedRevision: 'int' },
    output: { ok: 'bool', id: 'id?', revision: 'int?', errors: 'json?' },
    effects: [
      'read:pos.Order',
      'write:pos.Order',
      'read:pos.OrderLine',
      'write:pos.OrderLine',
      'read:pos.Payment',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const line = (await ctx.db.select('pos.OrderLine', { id: args.id }))[0]
      if (!line) return invalid('id', 'line does not exist')
      if (line.orderId !== args.orderId) return invalid('id', 'line does not belong to this order')
      const claim = await claimDraftRevision(ctx, args.orderId, args.expectedRevision)
      if (claim.ok !== true) return claim
      const L = ctx.table('pos.OrderLine')
      await ctx.db.del(deleteFrom(L).where(eq(L.id, String(args.id))))
      await recompute(ctx, args.orderId)
      return { ok: true, id: args.id, revision: claim.revision }
    },
  }),
  reorderLines: defineFn({
    input: { id: 'id', expectedRevision: 'int', lineIds: 'json' },
    output: { ok: 'bool', id: 'id?', revision: 'int?', errors: 'json?' },
    effects: ['read:pos.Order', 'write:pos.Order', 'read:pos.OrderLine', 'write:pos.OrderLine'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      if (!Array.isArray(args.lineIds)) return invalid('lineIds', 'lineIds must be an array')
      const lines = await ctx.db.select('pos.OrderLine', { orderId: args.id })
      const wanted = args.lineIds.map(String)
      if (
        new Set(wanted).size !== wanted.length ||
        lines.length !== wanted.length ||
        lines.some((line) => !wanted.includes(String(line.id)))
      )
        return invalid('lineIds', 'lineIds must contain every line exactly once')
      const claim = await claimDraftRevision(ctx, args.id, args.expectedRevision)
      if (claim.ok !== true) return claim
      for (const [index, lineId] of wanted.entries())
        await ctx.db.update('pos.OrderLine', { id: lineId }, { sequence: (index + 1) * 10 })
      return { ok: true, id: args.id, revision: claim.revision }
    },
  }),
  addPayment: defineFn({
    input: {
      id: 'id',
      orderId: 'id',
      paymentMethodId: 'id',
      amount: 'decimal?',
      tenderedAmount: 'decimal?',
      reference: 'text?',
      operatorId: 'text?',
      deviceId: 'text?',
      expectedRevision: 'int?',
    },
    output: {
      ok: 'bool',
      id: 'id?',
      revision: 'int?',
      appliedAmount: 'decimal?',
      change: 'decimal?',
      errors: 'json?',
    },
    effects: [
      'read:pos.Order',
      'read:pos.ConfigPaymentMethod',
      'read:pos.PaymentMethod',
      'read:pos.Payment',
      'write:pos.Payment',
      'read:pos.OrderLine',
      'write:pos.Order',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const order = (await ctx.db.select('pos.Order', { id: args.orderId }))[0]
      if (order?.state !== 'draft') return invalid('orderId', 'payments can only be added to a new order')
      const tendered = n(args.tenderedAmount ?? args.amount)
      if ((order.isRefund && tendered >= 0) || (!order.isRefund && tendered <= 0))
        return invalid(
          'tenderedAmount',
          order.isRefund ? 'refund payments must be negative' : 'payment must be positive',
        )
      const linked = (
        await ctx.db.select('pos.ConfigPaymentMethod', {
          configId: order.configId,
          paymentMethodId: args.paymentMethodId,
        })
      )[0]
      const method = (await ctx.db.select('pos.PaymentMethod', { id: args.paymentMethodId }))[0]
      if (!linked || !method)
        return invalid('paymentMethodId', 'payment method is not configured for this point of sale')
      if (!method.isCash && !String(args.reference ?? '').trim())
        return invalid('reference', 'manual non-cash tender requires a reference')
      const existing = (await ctx.db.select('pos.Payment', { id: args.id }))[0]
      if (existing) {
        const same =
          existing.orderId === args.orderId &&
          existing.paymentMethodId === args.paymentMethodId &&
          n(existing.tenderedAmount ?? existing.amount) === tendered
        return same
          ? {
              ok: true,
              id: args.id,
              revision: n(order.revision),
              appliedAmount: existing.appliedAmount ?? existing.amount,
              change: decimal(
                n(existing.tenderedAmount ?? existing.amount) - n(existing.appliedAmount ?? existing.amount),
              ),
            }
          : invalid('id', 'tender id is already used by a different command')
      }
      const captured = (await ctx.db.select('pos.Payment', { orderId: args.orderId })).filter(
        (payment) => (payment.state ?? 'captured') === 'captured',
      )
      const remaining = Math.max(
        0,
        Math.abs(n(order.amountTotal)) -
          captured.reduce((sum, payment) => sum + Math.abs(n(payment.appliedAmount ?? payment.amount)), 0),
      )
      if (remaining <= 0.000001) return invalid('amount', 'the order is already fully covered')
      const tenderedAbsolute = Math.abs(tendered)
      if (!method.isCash && tenderedAbsolute - remaining > 0.000001)
        return invalid('tenderedAmount', 'manual non-cash tender cannot exceed the remaining payable')
      const appliedAbsolute = method.isCash ? Math.min(tenderedAbsolute, remaining) : tenderedAbsolute
      const direction = order.isRefund ? -1 : 1
      const applied = money(direction * appliedAbsolute)
      const claim = await claimDraftRevision(ctx, args.orderId, args.expectedRevision)
      if (claim.ok !== true) return claim
      await ctx.db.insert('pos.Payment', {
        id: args.id,
        orderId: args.orderId,
        paymentMethodId: args.paymentMethodId,
        amount: decimal(applied),
        tenderedAmount: decimal(tendered),
        appliedAmount: decimal(applied),
        state: 'captured',
        kind: method.isCash ? 'cash' : 'manual',
        reference: args.reference ?? null,
        operatorId: args.operatorId ?? null,
        deviceId: args.deviceId ?? null,
        paymentDate: now(),
      })
      await recompute(ctx, args.orderId)
      return {
        ok: true,
        id: args.id,
        revision: claim.revision,
        appliedAmount: decimal(applied),
        change: decimal(tendered - applied),
      }
    },
  }),
  voidPayment: defineFn({
    input: { id: 'id', orderId: 'id', expectedRevision: 'int', reason: 'text', operatorId: 'text?' },
    output: { ok: 'bool', id: 'id?', revision: 'int?', errors: 'json?' },
    effects: [
      'read:pos.Order',
      'write:pos.Order',
      'read:pos.OrderLine',
      'read:pos.Payment',
      'write:pos.Payment',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      if (!String(args.reason).trim()) return invalid('reason', 'voiding a tender requires a reason')
      const payment = (await ctx.db.select('pos.Payment', { id: args.id }))[0]
      if (!payment || payment.orderId !== args.orderId)
        return invalid('id', 'tender does not belong to this order')
      if (payment.state === 'voided') {
        const order = (await ctx.db.select('pos.Order', { id: args.orderId }))[0]
        return { ok: true, id: args.id, revision: n(order?.revision) }
      }
      const claim = await claimDraftRevision(ctx, args.orderId, args.expectedRevision)
      if (claim.ok !== true) return claim
      await ctx.db.update('pos.Payment', { id: args.id }, { state: 'voided' })
      await recompute(ctx, args.orderId)
      return { ok: true, id: args.id, revision: claim.revision }
    },
  }),
  validateOrder: defineFn({
    input: { id: 'id', expectedRevision: 'int?' },
    output: {
      ok: 'bool',
      id: 'id?',
      state: 'text?',
      pickingId: 'id?',
      accountMoveId: 'id?',
      revision: 'int?',
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
      'read:partner.Partner',
      'write:partner.Partner',
      'read:account.Move',
      'write:account.Move',
      'write:account.MoveLine',
      'read:account.Journal',
      'read:account.Account',
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
          revision: n(order.revision),
        }
      if (order.state !== 'draft') return invalid('state', 'only a new order can be paid')
      const session = (await ctx.db.select('pos.Session', { id: order.sessionId }))[0]
      if (!session || !['opened', 'closing_control'].includes(String(session.state)))
        return invalid('sessionId', 'session is not open')
      const lines = await ctx.db.select('pos.OrderLine', { orderId: args.id })
      if (!lines.length) return invalid('lines', 'order needs at least one product')
      const payments = (await ctx.db.select('pos.Payment', { orderId: args.id })).filter(
        (payment) => (payment.state ?? 'captured') === 'captured',
      )
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
      const claim = await claimDraftRevision(ctx, args.id, args.expectedRevision)
      if (claim.ok !== true) return claim
      const partner = order.partnerId
        ? (await ctx.db.select('partner.Partner', { id: order.partnerId }))[0]
        : await consumerPartner(ctx)
      if (!partner) return invalid('partnerId', 'invoice customer does not exist')
      const effectiveOrder = { ...order, partnerId: partner.id, toInvoice: true }
      await ctx.db.update('pos.Order', { id: args.id }, { partnerId: partner.id, toInvoice: true })
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
        accountMoveId = await createAccounting(ctx, effectiveOrder, config, lines, payments)
      } catch (error) {
        return invalid('accounting', (error as Error).message)
      }
      await ctx.db.update(
        'pos.Order',
        { id: args.id },
        {
          state: 'paid',
          invoiceStatus: 'invoiced',
          pickingId,
          accountMoveId,
        },
      )
      return {
        ok: true,
        id: args.id,
        state: 'paid',
        revision: claim.revision,
        ...(pickingId ? { pickingId } : {}),
        accountMoveId,
      }
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
        amountExact: '0',
        amountRounding: '0',
        amountTotal: '0',
        amountPaid: '0',
        amountReturn: '0',
        toInvoice: true,
        accountMoveId: null,
        pickingId: null,
        note: `Refund ${String(original.posReference)}`,
        revision: 0,
        operatorId: null,
        deviceId: session.deviceId ?? null,
        priceBookRevision: original.priceBookRevision ?? null,
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
          taxIds: line.taxIds ?? (line.taxId ? [line.taxId] : []),
          taxEvidence: line.taxEvidence ?? null,
          quoteRevision: line.quoteRevision ?? null,
          priceSubtotal: decimal(-n(line.priceSubtotal)),
          priceSubtotalIncl: decimal(-n(line.priceSubtotalIncl)),
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
    input: { id: 'id', expectedRevision: 'int?' },
    output: { ok: 'bool', id: 'id?', revision: 'int?', errors: 'json?' },
    effects: ['read:pos.Order', 'write:pos.Order'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const order = (await ctx.db.select('pos.Order', { id: args.id }))[0]
      if (!order) return invalid('id', 'order does not exist')
      if (order.state === 'cancel') return { ok: true, id: args.id, revision: n(order.revision) }
      if (order.state !== 'draft') return invalid('state', 'paid orders must be refunded, not cancelled')
      const claim = await claimDraftRevision(ctx, args.id, args.expectedRevision)
      if (claim.ok !== true) return claim
      await ctx.db.update('pos.Order', { id: args.id }, { state: 'cancel' })
      return { ok: true, id: args.id, revision: claim.revision }
    },
  }),
}
