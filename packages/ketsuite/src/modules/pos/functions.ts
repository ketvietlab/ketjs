import { defineFn, deleteFrom, eq } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { functions as accountFunctions, quoteTaxLine } from '../account/functions.ts'
import { functions as pricingFunctions } from '../pricing/functions.ts'
import { sellableProduct } from '../product/sellable.ts'
import { functions as stockFunctions } from '../stock/functions.ts'
import { toProductUnit } from '../stock/units.ts'

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
type ProviderFinalizationClaim =
  | { ok: true; order: Row; revision: number; leaseToken: string }
  | ReturnType<typeof invalid>
const PROVIDER_FINALIZATION_LEASE_MS = 5 * 60_000

class AtomicFailure extends Error {
  readonly result: Row

  constructor(result: Row) {
    super('POS command rejected')
    this.result = result
  }
}

const activeAtomicContexts = new WeakSet<Ctx>()

const atomic = async (ctx: Ctx, body: (tx: Ctx) => Promise<Row>): Promise<Row> => {
  try {
    // Composite POS commands reuse the transaction-bound context handed to the
    // outer command. Opening another adapter transaction here would fail on
    // PostgreSQL and would split one retail intent into partial commits.
    if (activeAtomicContexts.has(ctx)) {
      const result = await body(ctx)
      if (result.ok !== true) throw new AtomicFailure(result)
      return result
    }
    return await ctx.tx(async (tx) => {
      activeAtomicContexts.add(tx)
      try {
        const result = await body(tx)
        if (result.ok !== true) throw new AtomicFailure(result)
        return result
      } finally {
        activeAtomicContexts.delete(tx)
      }
    })
  } catch (error) {
    if (error instanceof AtomicFailure) return error.result
    throw error
  }
}

export async function claimDraftRevision(
  ctx: Ctx,
  id: unknown,
  expectedRevision?: unknown,
): Promise<RevisionClaim> {
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

async function providerSettlementReplay(ctx: Ctx, args: Row): Promise<Row | null> {
  const attemptId = String(args.providerAttemptId ?? '').trim()
  const [byId, byAttempt, order, reservation] = await Promise.all([
    ctx.db.select('pos.Payment', { id: args.id }),
    ctx.db.select('pos.Payment', { providerAttemptId: attemptId }),
    ctx.db.select('pos.Order', { id: args.orderId }),
    ctx.db.select('pos.ProviderPaymentLock', { id: attemptId }),
  ])
  if (byId[0] && byAttempt[0] && byId[0].id !== byAttempt[0].id)
    return invalid('providerAttemptId', 'provider attempt is already linked to another tender')
  const existing = byId[0] ?? byAttempt[0]
  if (!existing) return null
  const currentOrder = order[0]
  const lock = reservation[0]
  const same =
    Boolean(currentOrder) &&
    existing.id === args.id &&
    existing.orderId === args.orderId &&
    existing.paymentMethodId === args.paymentMethodId &&
    existing.kind === 'provider' &&
    (existing.state ?? 'captured') === 'captured' &&
    existing.reversalOfId == null &&
    n(existing.appliedAmount ?? existing.amount) === n(args.amount) &&
    String(existing.providerAttemptId ?? '') === attemptId &&
    String(existing.reference ?? '') === String(args.providerReference ?? '').trim() &&
    currentOrder.currency === String(args.currency) &&
    String(currentOrder.paymentLockId ?? '') === attemptId &&
    lock?.orderId === args.orderId &&
    lock.paymentMethodId === args.paymentMethodId &&
    n(lock.amount) === n(args.amount) &&
    lock.currency === String(args.currency) &&
    ['settled', 'finalizing', 'finalized'].includes(String(lock.state)) &&
    lock.settledPaymentId === existing.id
  return same
    ? {
        ok: true,
        id: existing.id,
        revision: n(currentOrder!.revision),
        appliedAmount: existing.appliedAmount ?? existing.amount,
        providerAttemptId: attemptId,
      }
    : invalid('id', 'provider tender id is already used by a different settlement')
}

async function claimProviderFinalization(
  ctx: Ctx,
  id: unknown,
  providerAttemptId: string,
  expectedRevision?: unknown,
): Promise<ProviderFinalizationClaim> {
  return (await atomic(ctx, async (tx) => {
    const order = (await tx.db.select('pos.Order', { id }))[0]
    if (!order) return invalid('orderId', 'order does not exist')
    if (order.state !== 'draft') return invalid('state', 'only a draft order can be finalized')
    const current = n(order.revision)
    const reservation = (await tx.db.select('pos.ProviderPaymentLock', { id: providerAttemptId }))[0]
    const payment = (await tx.db.select('pos.Payment', { providerAttemptId }))[0]
    if (
      String(order.paymentLockId ?? '') !== providerAttemptId ||
      !reservation ||
      !['settled', 'finalizing'].includes(String(reservation.state)) ||
      reservation.orderId !== order.id ||
      reservation.paymentMethodId !== order.paymentLockMethodId ||
      n(reservation.amount) !== n(order.paymentLockAmount) ||
      reservation.currency !== order.currency ||
      reservation.settledPaymentId !== payment?.id ||
      payment?.orderId !== order.id ||
      payment.paymentMethodId !== reservation.paymentMethodId ||
      payment.kind !== 'provider' ||
      payment.state !== 'captured' ||
      payment.reversalOfId != null
    )
      return invalid('paymentLockId', 'external payment is still pending reconciliation')
    if (reservation.state === 'finalizing') {
      const leaseAge = Date.now() - Date.parse(String(reservation.updatedAt ?? ''))
      if (!Number.isFinite(leaseAge) || leaseAge < PROVIDER_FINALIZATION_LEASE_MS)
        return invalid('paymentLockId', 'external payment finalization is already in progress')
      if (
        expectedRevision !== undefined &&
        ![current, Math.max(0, current - 1)].includes(n(expectedRevision))
      )
        return invalid('expectedRevision', 'the order changed; reload it before continuing')
      const leaseToken = now()
      const resumed = await tx.db.compareAndSet(
        'pos.ProviderPaymentLock',
        { id: providerAttemptId },
        { state: 'finalizing', updatedAt: reservation.updatedAt },
        { updatedAt: leaseToken },
      )
      if (!('dryRun' in resumed) && !resumed.matched)
        return invalid('paymentLockId', 'external payment finalization recovery was already claimed')
      return { ok: true, order, revision: current, leaseToken }
    }
    if (expectedRevision !== undefined && n(expectedRevision) !== current)
      return invalid('expectedRevision', 'the order changed; reload it before continuing')
    const leaseToken = now()
    const lockChanged = await tx.db.compareAndSet(
      'pos.ProviderPaymentLock',
      { id: providerAttemptId },
      { state: 'settled' },
      { state: 'finalizing', updatedAt: leaseToken },
    )
    if (!('dryRun' in lockChanged) && !lockChanged.matched)
      return invalid('paymentLockId', 'external payment reconciliation changed before finalization')
    const orderChanged = await tx.db.compareAndSet(
      'pos.Order',
      { id: order.id },
      { revision: order.revision ?? null },
      { revision: current + 1 },
    )
    if (!('dryRun' in orderChanged) && !orderChanged.matched)
      return invalid('expectedRevision', 'the order changed; reload it before continuing')
    return { ok: true, order, revision: current + 1, leaseToken }
  })) as ProviderFinalizationClaim
}

async function claimOrderRevision(ctx: Ctx, id: unknown, expectedRevision?: unknown): Promise<RevisionClaim> {
  const order = (await ctx.db.select('pos.Order', { id }))[0]
  if (!order) return invalid('orderId', 'order does not exist')
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

async function trackingAvailability(ctx: Ctx, order: Row, line: Row): Promise<Row> {
  const config = (await ctx.db.select('pos.Config', { id: order.configId }))[0]
  if (!config) throw new Error(`POS configuration ${String(order.configId)} does not exist`)
  const based = await toProductUnit(ctx, line.productId, line.productUomId, Math.abs(n(line.qty)))
  if (!based) throw new Error(`POS line ${String(line.id)} has an incompatible unit`)
  const availability = (await stockFunctions.trackedAvailability!.handler(ctx, {
    productId: line.productId,
    warehouseId: config.warehouseId,
    at: order.dateOrder,
  })) as Row
  return {
    orderId: String(order.id),
    lineId: String(line.id),
    productId: String(line.productId),
    tracking: String(availability.tracking ?? 'none'),
    requiredQuantity: String(based.quantity),
    selections: Array.isArray(line.lotSelections) ? line.lotSelections : [],
    lots: Array.isArray(availability.lots) ? availability.lots : [],
  }
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

const scaledTaxEvidence = (evidence: unknown, factor: number): Row | null => {
  if (!evidence || typeof evidence !== 'object' || !Array.isArray((evidence as Row).taxes)) return null
  const source = evidence as Row
  return {
    ...source,
    taxes: (source.taxes as Row[]).map((tax) => ({
      ...tax,
      share: decimal(n(tax.share) * factor),
    })),
  }
}

const returnTaxEvidence = (
  evidence: unknown,
  previousLines: Row[],
  ratio: number,
  exhaustsLine: boolean,
): Row | null => {
  if (!exhaustsLine) return scaledTaxEvidence(evidence, ratio * -1)
  if (!evidence || typeof evidence !== 'object' || !Array.isArray((evidence as Row).taxes)) return null
  const source = evidence as Row
  const previousTaxes = previousLines.flatMap((line) => {
    const held = line.taxEvidence
    return held && typeof held === 'object' && Array.isArray((held as Row).taxes)
      ? ((held as Row).taxes as Row[])
      : []
  })
  return {
    ...source,
    taxes: (source.taxes as Row[]).map((tax) => ({
      ...tax,
      share: decimal(
        -(
          n(tax.share) +
          previousTaxes
            .filter((previous) => String(previous.taxId ?? '') === String(tax.taxId ?? ''))
            .reduce((sum, previous) => sum + n(previous.share), 0)
        ),
      ),
    })),
  }
}

const taxGroupKey = (line: Row): string =>
  JSON.stringify(
    (Array.isArray(line.taxIds) ? line.taxIds : line.taxId ? [line.taxId] : []).map(String).sort(),
  )

type ReturnableLine = {
  line: Row
  purchasedQuantity: number
  refundedQuantity: number
  remainingQuantity: number
}

async function returnableLines(ctx: Ctx, original: Row): Promise<ReturnableLine[]> {
  const originalLines = await ctx.db.select('pos.OrderLine', { orderId: original.id })
  const refunds = (await ctx.db.select('pos.Order', { refundedOrderId: original.id })).filter(
    (order) => order.state !== 'cancel',
  )
  const returned = new Map<string, number>()
  for (const refund of refunds)
    for (const line of await ctx.db.select('pos.OrderLine', { orderId: refund.id })) {
      if (!line.refundedOrderlineId) continue
      const key = String(line.refundedOrderlineId)
      returned.set(key, (returned.get(key) ?? 0) + Math.abs(n(line.qty)))
    }
  return originalLines
    .filter((line) => String(line.lineKind ?? 'product') !== 'reward')
    .map((line) => {
      const purchasedQuantity = Math.abs(n(line.qty))
      const refundedQuantity = Math.min(purchasedQuantity, returned.get(String(line.id)) ?? 0)
      return {
        line,
        purchasedQuantity,
        refundedQuantity,
        remainingQuantity: Math.max(0, purchasedQuantity - refundedQuantity),
      }
    })
}

async function completedLotSelections(
  ctx: Ctx,
  originalLine: Row,
  requestedQuantity: number,
): Promise<Row[] | ReturnType<typeof invalid>> {
  if (String(originalLine.tracking ?? 'none') === 'none') return []
  const based = await toProductUnit(ctx, originalLine.productId, originalLine.productUomId, requestedQuantity)
  if (!based) return invalid('quantity', 'return quantity uses an incompatible product unit')
  const move = (await ctx.db.select('stock.Move', { posLineId: originalLine.id }))[0]
  const moveLines = move ? await ctx.db.select('stock.MoveLine', { moveId: move.id }) : []
  const delivered = new Map<string, number>()
  for (const line of moveLines) {
    if (!line.lotId || line.picked === false || !(n(line.quantity) > 0)) continue
    const lotId = String(line.lotId)
    delivered.set(lotId, (delivered.get(lotId) ?? 0) + n(line.quantity))
  }
  if (!delivered.size)
    return invalid('originalOrderId', `tracked line ${String(originalLine.id)} has no completed lot evidence`)

  const previous = new Map<string, number>()
  const refunds = await ctx.db.select('pos.Order', { refundedOrderId: originalLine.orderId })
  for (const refund of refunds.filter((order) => order.state !== 'cancel'))
    for (const line of await ctx.db.select('pos.OrderLine', { orderId: refund.id })) {
      if (String(line.refundedOrderlineId ?? '') !== String(originalLine.id)) continue
      for (const selection of (Array.isArray(line.lotSelections) ? line.lotSelections : []) as Row[]) {
        const lotId = String(selection.lotId)
        previous.set(lotId, (previous.get(lotId) ?? 0) + n(selection.quantity))
      }
    }

  let remaining = based.quantity
  const selections: Row[] = []
  for (const [lotId, deliveredQuantity] of [...delivered.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const available = Math.max(0, deliveredQuantity - (previous.get(lotId) ?? 0))
    const quantity = Math.min(available, remaining)
    if (quantity > 0) selections.push({ lotId, quantity: decimal(quantity), stockRevision: null })
    remaining -= quantity
    if (remaining <= 0.000001) break
  }
  if (remaining > 0.000001)
    return invalid(
      'quantity',
      `return quantity exceeds delivered lot/serial evidence for ${String(originalLine.id)}`,
    )
  if (
    String(originalLine.tracking) === 'serial' &&
    selections.some((selection) => Math.abs(n(selection.quantity) - 1) > 0.000001)
  )
    return invalid('quantity', 'serial returns must select complete serial numbers')
  return selections
}

const stockEffects = [
  ...(stockFunctions.createPicking!.effects ?? []),
  ...(stockFunctions.addMove!.effects ?? []),
  ...(stockFunctions.confirmPicking!.effects ?? []),
  ...(stockFunctions.reserveMoves!.effects ?? []),
  ...(stockFunctions.saveMoveLine!.effects ?? []),
  ...(stockFunctions.completePicking!.effects ?? []),
]
const trackingAvailabilityEffects = stockFunctions.trackedAvailability!.effects ?? []
const accountEffects = [
  ...(accountFunctions.postMove!.effects ?? []),
  ...(accountFunctions.registerPayment!.effects ?? []),
]
const createOrderEffects = [
  'read:pos.Sequence',
  'write:pos.Sequence',
  'read:pos.Session',
  'read:pos.Config',
  'read:pos.Order',
  'write:pos.Order',
  'read:partner.Partner',
  'read:company.Company',
] as const
const refundOrderEffects = [
  'read:pos.Order',
  'read:pos.OrderLine',
  'write:pos.Order',
  'write:pos.OrderLine',
  'read:pos.Payment',
  'read:pos.Sequence',
  'write:pos.Sequence',
  'read:pos.Session',
  'read:pos.Config',
  'read:partner.Partner',
  'read:company.Company',
  'read:stock.Move',
  'read:stock.MoveLine',
  'read:product.Product',
  'read:product.Template',
  'read:product.TemplateUom',
  'read:product.ProductUom',
  'read:uom.Unit',
] as const

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
    effects: [
      'read:pos.Session',
      'read:pos.Order',
      'read:pos.Payment',
      'read:pos.PaymentMethod',
      'read:pos.CashMovement',
    ],
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
      const cashMovements = await ctx.db.select('pos.CashMovement', { sessionId: args.id })
      expectedCash += cashMovements.reduce(
        (sum, movement) => sum + (movement.direction === 'in' ? n(movement.amount) : -n(movement.amount)),
        0,
      )
      return { ...session, cashRegisterBalanceEnd: decimal(expectedCash), orders, cashMovements }
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
  recordCashMovement: defineFn({
    input: {
      id: 'id',
      sessionId: 'id',
      direction: 'text',
      amount: 'decimal',
      reason: 'text',
      note: 'text?',
      actorId: 'text',
      deviceId: 'text?',
      expectedRevision: 'int',
    },
    output: { ok: 'bool', id: 'id?', revision: 'int?', errors: 'json?' },
    effects: ['read:pos.Session', 'write:pos.Session', 'read:pos.CashMovement', 'write:pos.CashMovement'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      if (!['in', 'out'].includes(String(args.direction)))
        return invalid('direction', 'cash movement direction must be in or out')
      if (!(n(args.amount) > 0)) return invalid('amount', 'cash movement amount must be positive')
      if (!String(args.reason).trim()) return invalid('reason', 'cash movement requires a reason')
      const session = (await ctx.db.select('pos.Session', { id: args.sessionId }))[0]
      if (session?.state !== 'opened') return invalid('state', 'cash movement requires an open shift')
      const existing = (await ctx.db.select('pos.CashMovement', { id: args.id }))[0]
      if (existing) {
        const same =
          existing.sessionId === args.sessionId &&
          existing.direction === args.direction &&
          n(existing.amount) === n(args.amount)
        return same
          ? { ok: true, id: args.id, revision: n(session.revision) }
          : invalid('id', 'cash movement id is already used by a different command')
      }
      const claim = await claimSessionRevision(ctx, args.sessionId, args.expectedRevision)
      if (claim.ok !== true) return claim
      await ctx.db.insert('pos.CashMovement', {
        id: args.id,
        sessionId: args.sessionId,
        direction: args.direction,
        amount: decimal(n(args.amount)),
        reason: String(args.reason),
        note: args.note ?? null,
        actorId: args.actorId,
        deviceId: args.deviceId ?? null,
        occurredAt: now(),
        reversalOfId: null,
      })
      return { ok: true, id: args.id, revision: claim.revision }
    },
  }),
  reverseCashMovement: defineFn({
    input: {
      id: 'id',
      sessionId: 'id',
      movementId: 'id',
      expectedRevision: 'int',
      reason: 'text',
      note: 'text?',
      actorId: 'text',
      deviceId: 'text?',
    },
    output: { ok: 'bool', id: 'id?', revision: 'int?', errors: 'json?' },
    effects: ['read:pos.Session', 'write:pos.Session', 'read:pos.CashMovement', 'write:pos.CashMovement'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      if (!String(args.reason).trim()) return invalid('reason', 'cash movement reversal requires a reason')
      const session = (await ctx.db.select('pos.Session', { id: args.sessionId }))[0]
      if (session?.state !== 'opened')
        return invalid('state', 'cash movement reversal requires an open shift')
      const original = (await ctx.db.select('pos.CashMovement', { id: args.movementId }))[0]
      if (!original || original.sessionId !== args.sessionId)
        return invalid('movementId', 'cash movement does not belong to this shift')
      if (original.reversalOfId) return invalid('movementId', 'a reversal cannot itself be reversed')
      const prior = (await ctx.db.select('pos.CashMovement', { reversalOfId: args.movementId }))[0]
      if (prior)
        return prior.id === args.id
          ? { ok: true, id: prior.id, revision: n(session.revision) }
          : invalid('movementId', 'cash movement is already reversed')
      const claim = await claimSessionRevision(ctx, args.sessionId, args.expectedRevision)
      if (claim.ok !== true) return claim
      await ctx.db.insert('pos.CashMovement', {
        id: args.id,
        sessionId: args.sessionId,
        direction: original.direction === 'in' ? 'out' : 'in',
        amount: original.amount,
        reason: String(args.reason),
        note: args.note ?? null,
        actorId: args.actorId,
        deviceId: args.deviceId ?? null,
        occurredAt: now(),
        reversalOfId: original.id,
      })
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
      'read:pos.CashMovement',
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
      cash += (await ctx.db.select('pos.CashMovement', { sessionId: args.id })).reduce(
        (sum, movement) => sum + (movement.direction === 'in' ? n(movement.amount) : -n(movement.amount)),
        0,
      )
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
    effects: ['read:pos.Order', 'read:pos.OrderLine', 'read:pos.Payment', 'read:pos.Exchange'],
    agent: true,
    handler: async (ctx, args) => {
      const order = (await ctx.db.select('pos.Order', { id: args.id }))[0]
      return order
        ? {
            ...order,
            lines: await ctx.db.select('pos.OrderLine', { orderId: args.id }),
            payments: await ctx.db.select('pos.Payment', { orderId: args.id }),
            exchange: order.exchangeId
              ? ((await ctx.db.select('pos.Exchange', { id: order.exchangeId }))[0] ?? null)
              : null,
          }
        : null
    },
  }),
  getLineTrackingAvailability: defineFn({
    input: { orderId: 'id', lineId: 'id' },
    effects: [
      'read:pos.Order',
      'read:pos.OrderLine',
      'read:pos.Config',
      'read:uom.Unit',
      ...trackingAvailabilityEffects,
    ],
    agent: true,
    handler: async (ctx, args) => {
      const order = (await ctx.db.select('pos.Order', { id: args.orderId }))[0]
      const line = (await ctx.db.select('pos.OrderLine', { id: args.lineId }))[0]
      return order && line?.orderId === order.id ? trackingAvailability(ctx, order, line) : null
    },
  }),
  setLineLotSelections: defineFn({
    input: { orderId: 'id', lineId: 'id', expectedRevision: 'int', selections: 'json' },
    output: { ok: 'bool', id: 'id?', revision: 'int?', errors: 'json?' },
    effects: [
      'read:pos.Order',
      'write:pos.Order',
      'read:pos.OrderLine',
      'write:pos.OrderLine',
      'read:pos.Config',
      'read:uom.Unit',
      ...trackingAvailabilityEffects,
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const order = (await ctx.db.select('pos.Order', { id: args.orderId }))[0]
      const line = (await ctx.db.select('pos.OrderLine', { id: args.lineId }))[0]
      if (!order || !line || line.orderId !== order.id)
        return invalid('lineId', 'line does not belong to this order')
      if (order.state !== 'draft' || order.isRefund)
        return invalid('orderId', 'lot/serial selection is only editable on a new sale')
      if (order.paymentLockId) return invalid('orderId', 'order is locked by an external payment attempt')
      if (!Array.isArray(args.selections)) return invalid('selections', 'selections must be an array')
      const availability = await trackingAvailability(ctx, order, line)
      const tracking = String(availability.tracking)
      if (tracking === 'none') return invalid('lineId', 'this product does not use lot/serial tracking')
      if (String(line.tracking ?? 'none') !== tracking)
        return invalid('tracking', 'product tracking changed; remove and add the line again')
      const selections = (args.selections as Row[]).map((selection) => ({
        lotId: String(selection.lotId ?? ''),
        quantity: n(selection.quantity),
        stockRevision: String(selection.stockRevision ?? ''),
      }))
      if (
        selections.some(
          (selection) => !selection.lotId || !(selection.quantity > 0) || !selection.stockRevision,
        )
      )
        return invalid('selections', 'every selection needs lotId, positive quantity and stockRevision')
      if (new Set(selections.map((selection) => selection.lotId)).size !== selections.length)
        return invalid('selections', 'a lot/serial can only be selected once per line')
      if (tracking === 'serial' && selections.some((selection) => selection.quantity !== 1))
        return invalid('selections', 'every selected serial must have quantity 1')
      if (
        Math.abs(
          selections.reduce((sum, selection) => sum + selection.quantity, 0) -
            n(availability.requiredQuantity),
        ) > 0.000001
      )
        return invalid('selections', 'selected quantity must equal line quantity in the product unit')
      const lots = new Map((availability.lots as Row[]).map((lot) => [String(lot.lotId), lot] as const))
      for (const selection of selections) {
        const lot = lots.get(selection.lotId)
        if (lot?.selectable !== true)
          return invalid('lotId', `lot/serial ${selection.lotId} is not selectable`)
        if (String(lot.stockRevision) !== selection.stockRevision)
          return invalid('stockRevision', 'stock position changed; reload lot availability')
        if (n(lot.availableQuantity) + 0.000001 < selection.quantity)
          return invalid('quantity', `insufficient stock for lot/serial ${selection.lotId}`)
      }
      const claim = await claimDraftRevision(ctx, args.orderId, args.expectedRevision)
      if (claim.ok !== true) return claim
      await ctx.db.update('pos.OrderLine', { id: args.lineId }, { lotSelections: selections })
      return { ok: true, id: args.lineId, revision: claim.revision }
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
    effects: [...createOrderEffects],
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
      if (order.paymentLockId) return invalid('orderId', 'order is locked by an external payment attempt')
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
        tracking: String(product.template.tracking ?? 'none'),
        lotSelections: [],
        affectsStock: product.template.type !== 'service',
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
      const order = (await ctx.db.select('pos.Order', { id: args.id }))[0]
      if (order?.paymentLockId) return invalid('id', 'order is locked by an external payment attempt')
      if (order?.isRefund && (args.partnerId || args.clearPartner))
        return invalid('partnerId', 'a return must keep the original invoice customer')
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
      if (order.paymentLockId) return invalid('orderId', 'order is locked by an external payment attempt')
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
      const order = (await ctx.db.select('pos.Order', { id: args.orderId }))[0]
      if (order?.isRefund) return invalid('orderId', 'return lines are immutable')
      if (order?.paymentLockId) return invalid('orderId', 'order is locked by an external payment attempt')
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
      const order = (await ctx.db.select('pos.Order', { id: args.id }))[0]
      if (order?.isRefund) return invalid('id', 'return lines are immutable')
      if (order?.paymentLockId) return invalid('id', 'order is locked by an external payment attempt')
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
      if (order.paymentLockId) return invalid('orderId', 'order is locked by an external payment attempt')
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
          n(existing.tenderedAmount ?? existing.amount) === tendered &&
          String(existing.reference ?? '') === String(args.reference ?? '')
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
        providerAttemptId: null,
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
  lockProviderPayment: defineFn({
    exposure: 'internal',
    input: {
      orderId: 'id',
      paymentMethodId: 'id',
      amount: 'decimal',
      providerAttemptId: 'text',
      expectedRevision: 'int',
    },
    output: {
      ok: 'bool',
      orderId: 'id?',
      revision: 'int?',
      amount: 'decimal?',
      currency: 'text?',
      configId: 'id?',
      errors: 'json?',
    },
    effects: [
      'read:pos.Order',
      'write:pos.Order',
      'read:pos.ProviderPaymentLock',
      'write:pos.ProviderPaymentLock',
      'read:pos.ConfigPaymentMethod',
      'read:pos.PaymentMethod',
      'read:pos.Payment',
    ],
    idempotent: true,
    handler: (ctx, args) =>
      atomic(ctx, async (tx) => {
        const attemptId = String(args.providerAttemptId ?? '').trim()
        if (!attemptId) return invalid('providerAttemptId', 'provider attempt id is required')
        const order = (await tx.db.select('pos.Order', { id: args.orderId }))[0]
        if (!order) return invalid('orderId', 'order does not exist')
        const amount = n(args.amount)
        if ((order.isRefund && amount >= 0) || (!order.isRefund && amount <= 0))
          return invalid(
            'amount',
            order.isRefund ? 'refund amount must be negative' : 'amount must be positive',
          )
        const reservation = (await tx.db.select('pos.ProviderPaymentLock', { id: attemptId }))[0]
        if (reservation) {
          const same =
            reservation.orderId === args.orderId &&
            reservation.paymentMethodId === args.paymentMethodId &&
            n(reservation.amount) === amount &&
            reservation.currency === order.currency
          if (!same)
            return invalid('providerAttemptId', 'provider attempt is bound to another payment intent')
          if (!['locked', 'settled', 'finalizing', 'finalized'].includes(String(reservation.state)))
            return invalid('providerAttemptId', 'provider attempt can no longer lock this order')
          if (String(order.paymentLockId ?? '') !== attemptId)
            return invalid('providerAttemptId', 'provider attempt lock membership is inconsistent')
          return {
            ok: true,
            orderId: order.id,
            revision: n(order.revision),
            amount: decimal(amount),
            currency: order.currency,
            configId: order.configId,
          }
        }
        if (order.state !== 'draft') return invalid('orderId', 'only a draft order can be locked')
        if (order.paymentLockId) {
          return invalid('providerAttemptId', 'order is already locked by another payment attempt')
        }
        const linked = (
          await tx.db.select('pos.ConfigPaymentMethod', {
            configId: order.configId,
            paymentMethodId: args.paymentMethodId,
          })
        )[0]
        const method = (await tx.db.select('pos.PaymentMethod', { id: args.paymentMethodId }))[0]
        if (!linked || !method || method.isCash || method.active === false)
          return invalid('paymentMethodId', 'provider payment requires a configured non-cash method')
        const captured = (await tx.db.select('pos.Payment', { orderId: args.orderId })).filter(
          (payment) => (payment.state ?? 'captured') === 'captured',
        )
        const remaining = Math.max(
          0,
          Math.abs(n(order.amountTotal)) -
            captured.reduce((sum, payment) => sum + Math.abs(n(payment.appliedAmount ?? payment.amount)), 0),
        )
        if (remaining <= 0.000001 || Math.abs(Math.abs(amount) - remaining) > 0.000001)
          return invalid('amount', 'provider attempt must cover the exact remaining payable')
        const createdAt = now()
        const inserted = await tx.db.insertIfAbsent('pos.ProviderPaymentLock', {
          id: attemptId,
          orderId: args.orderId,
          paymentMethodId: args.paymentMethodId,
          amount: decimal(amount),
          currency: order.currency,
          state: 'locked',
          settledPaymentId: null,
          reversalPaymentId: null,
          createdAt,
          updatedAt: createdAt,
        })
        if (!('dryRun' in inserted) && !inserted.inserted) {
          const winner = (await tx.db.select('pos.ProviderPaymentLock', { id: attemptId }))[0]
          const currentOrder = (await tx.db.select('pos.Order', { id: args.orderId }))[0]
          const same =
            winner?.orderId === args.orderId &&
            winner.paymentMethodId === args.paymentMethodId &&
            n(winner.amount) === amount &&
            winner.currency === order.currency &&
            ['locked', 'settled', 'finalizing', 'finalized'].includes(String(winner.state)) &&
            String(currentOrder?.paymentLockId ?? '') === attemptId
          return same
            ? {
                ok: true,
                orderId: currentOrder!.id,
                revision: n(currentOrder!.revision),
                amount: decimal(amount),
                currency: order.currency,
                configId: currentOrder!.configId,
              }
            : invalid('providerAttemptId', 'provider attempt is bound to another payment intent')
        }
        const claim = await claimDraftRevision(tx, args.orderId, args.expectedRevision)
        if (claim.ok !== true) return claim
        await tx.db.update(
          'pos.Order',
          { id: args.orderId },
          {
            paymentLockId: attemptId,
            paymentLockMethodId: args.paymentMethodId,
            paymentLockAmount: decimal(amount),
          },
        )
        return {
          ok: true,
          orderId: order.id,
          revision: claim.revision,
          amount: decimal(amount),
          currency: order.currency,
          configId: order.configId,
        }
      }),
  }),
  unlockProviderPayment: defineFn({
    exposure: 'internal',
    input: { orderId: 'id', providerAttemptId: 'text', expectedRevision: 'int' },
    output: { ok: 'bool', orderId: 'id?', revision: 'int?', errors: 'json?' },
    effects: [
      'read:pos.Order',
      'write:pos.Order',
      'read:pos.ProviderPaymentLock',
      'write:pos.ProviderPaymentLock',
      'read:pos.Payment',
    ],
    idempotent: true,
    handler: (ctx, args) =>
      atomic(ctx, async (tx) => {
        const attemptId = String(args.providerAttemptId ?? '').trim()
        if (!attemptId) return invalid('providerAttemptId', 'provider attempt id is required')
        const order = (await tx.db.select('pos.Order', { id: args.orderId }))[0]
        if (!order) return invalid('orderId', 'order does not exist')
        const reservation = (await tx.db.select('pos.ProviderPaymentLock', { id: attemptId }))[0]
        if (!order.paymentLockId) {
          return reservation?.orderId === args.orderId && reservation.state === 'released'
            ? { ok: true, orderId: order.id, revision: n(order.revision) }
            : invalid('providerAttemptId', 'payment attempt does not own an active order lock')
        }
        if (String(order.paymentLockId) !== attemptId)
          return invalid('providerAttemptId', 'payment attempt does not own the order lock')
        if (
          !reservation ||
          reservation.orderId !== args.orderId ||
          reservation.state !== 'locked' ||
          reservation.paymentMethodId !== order.paymentLockMethodId ||
          n(reservation.amount) !== n(order.paymentLockAmount) ||
          reservation.currency !== order.currency
        )
          return invalid('providerAttemptId', 'provider attempt lock membership is inconsistent')
        if ((await tx.db.select('pos.Payment', { providerAttemptId: attemptId }))[0])
          return invalid('providerAttemptId', 'a settled provider payment cannot be unlocked')
        const claim = await claimDraftRevision(tx, args.orderId, args.expectedRevision)
        if (claim.ok !== true) return claim
        await tx.db.update(
          'pos.Order',
          { id: args.orderId },
          { paymentLockId: null, paymentLockMethodId: null, paymentLockAmount: null },
        )
        await tx.db.update(
          'pos.ProviderPaymentLock',
          { id: attemptId },
          { state: 'released', updatedAt: now() },
        )
        return { ok: true, orderId: order.id, revision: claim.revision }
      }),
  }),
  settleProviderPayment: defineFn({
    exposure: 'internal',
    input: {
      id: 'id',
      orderId: 'id',
      paymentMethodId: 'id',
      amount: 'decimal',
      currency: 'text',
      providerAttemptId: 'text',
      providerReference: 'text',
      operatorId: 'text?',
      deviceId: 'text?',
      expectedRevision: 'int',
    },
    output: {
      ok: 'bool',
      id: 'id?',
      revision: 'int?',
      appliedAmount: 'decimal?',
      providerAttemptId: 'text?',
      errors: 'json?',
    },
    effects: [
      'read:pos.Order',
      'read:pos.ConfigPaymentMethod',
      'read:pos.PaymentMethod',
      'read:pos.Payment',
      'write:pos.Payment',
      'read:pos.ProviderPaymentLock',
      'write:pos.ProviderPaymentLock',
      'read:pos.OrderLine',
      'write:pos.Order',
    ],
    idempotent: true,
    handler: (ctx, args) =>
      atomic(ctx, async (tx) => {
        const attemptId = String(args.providerAttemptId ?? '').trim()
        const reference = String(args.providerReference ?? '').trim()
        if (!attemptId) return invalid('providerAttemptId', 'provider attempt id is required')
        if (!reference) return invalid('providerReference', 'provider settlement reference is required')
        const order = (await tx.db.select('pos.Order', { id: args.orderId }))[0]
        if (!order) return invalid('orderId', 'order does not exist')
        if (String(args.currency) !== String(order.currency))
          return invalid('currency', 'provider settlement currency does not match the locked order')
        const amount = n(args.amount)
        if ((order.isRefund && amount >= 0) || (!order.isRefund && amount <= 0))
          return invalid(
            'amount',
            order.isRefund ? 'provider refunds must be negative' : 'provider payments must be positive',
          )
        const replay = await providerSettlementReplay(tx, args)
        if (replay) return replay
        if (order.state !== 'draft') return invalid('orderId', 'payments can only settle a new order')
        const linked = (
          await tx.db.select('pos.ConfigPaymentMethod', {
            configId: order.configId,
            paymentMethodId: args.paymentMethodId,
          })
        )[0]
        const method = (await tx.db.select('pos.PaymentMethod', { id: args.paymentMethodId }))[0]
        if (!linked || !method || method.isCash || method.active === false)
          return invalid('paymentMethodId', 'provider settlement requires a configured non-cash method')
        const reservation = (await tx.db.select('pos.ProviderPaymentLock', { id: attemptId }))[0]
        if (
          String(order.paymentLockId ?? '') !== attemptId ||
          String(order.paymentLockMethodId ?? '') !== String(args.paymentMethodId) ||
          n(order.paymentLockAmount) !== amount ||
          !reservation ||
          reservation.orderId !== args.orderId ||
          reservation.paymentMethodId !== args.paymentMethodId ||
          n(reservation.amount) !== amount ||
          reservation.currency !== args.currency ||
          reservation.state !== 'locked'
        )
          return invalid('providerAttemptId', 'provider attempt does not own the current order lock')
        const captured = (await tx.db.select('pos.Payment', { orderId: args.orderId })).filter(
          (payment) => (payment.state ?? 'captured') === 'captured',
        )
        const remaining = Math.max(
          0,
          Math.abs(n(order.amountTotal)) -
            captured.reduce((sum, payment) => sum + Math.abs(n(payment.appliedAmount ?? payment.amount)), 0),
        )
        if (remaining <= 0.000001) return invalid('amount', 'the order is already fully covered')
        if (Math.abs(Math.abs(amount) - remaining) > 0.000001)
          return invalid('amount', 'provider settlement must equal the locked remaining payable')
        const claim = await claimDraftRevision(tx, args.orderId, args.expectedRevision)
        if (claim.ok !== true) {
          const converged = await providerSettlementReplay(tx, args)
          return converged?.ok === true ? converged : claim
        }
        await tx.db.insert('pos.Payment', {
          id: args.id,
          orderId: args.orderId,
          paymentMethodId: args.paymentMethodId,
          amount: decimal(amount),
          tenderedAmount: decimal(amount),
          appliedAmount: decimal(amount),
          state: 'captured',
          kind: 'provider',
          reference,
          providerAttemptId: attemptId,
          reversalOfId: null,
          operatorId: args.operatorId ?? null,
          deviceId: args.deviceId ?? null,
          paymentDate: now(),
        })
        await recompute(tx, args.orderId)
        await tx.db.update(
          'pos.ProviderPaymentLock',
          { id: attemptId },
          { state: 'settled', settledPaymentId: args.id, updatedAt: now() },
        )
        return {
          ok: true,
          id: args.id,
          revision: claim.revision,
          appliedAmount: decimal(amount),
          providerAttemptId: attemptId,
        }
      }),
  }),
  reviewProviderPayment: defineFn({
    exposure: 'internal',
    input: {
      orderId: 'id',
      providerAttemptId: 'text',
      state: 'text',
      expectedRevision: 'int',
    },
    output: { ok: 'bool', orderId: 'id?', revision: 'int?', state: 'text?', errors: 'json?' },
    effects: [
      'read:pos.Order',
      'write:pos.Order',
      'read:pos.Payment',
      'read:pos.ProviderPaymentLock',
      'write:pos.ProviderPaymentLock',
    ],
    idempotent: true,
    handler: (ctx, args) =>
      atomic(ctx, async (tx) => {
        const attemptId = String(args.providerAttemptId ?? '').trim()
        const targetState = String(args.state ?? '').trim()
        if (!attemptId) return invalid('providerAttemptId', 'provider attempt id is required')
        if (!['needs_review', 'reversing'].includes(targetState))
          return invalid('state', 'provider review state must be needs_review or reversing')
        const order = (await tx.db.select('pos.Order', { id: args.orderId }))[0]
        if (!order) return invalid('orderId', 'order does not exist')
        const reservation = (await tx.db.select('pos.ProviderPaymentLock', { id: attemptId }))[0]
        const payment = (await tx.db.select('pos.Payment', { providerAttemptId: attemptId }))[0]
        if (
          order.state !== 'draft' ||
          String(order.paymentLockId ?? '') !== attemptId ||
          !reservation ||
          reservation.orderId !== order.id ||
          reservation.paymentMethodId !== order.paymentLockMethodId ||
          n(reservation.amount) !== n(order.paymentLockAmount) ||
          reservation.currency !== order.currency ||
          reservation.settledPaymentId !== payment?.id ||
          payment?.orderId !== order.id ||
          payment.paymentMethodId !== reservation.paymentMethodId ||
          payment.kind !== 'provider' ||
          payment.state !== 'captured' ||
          payment.reversalOfId != null
        )
          return invalid('providerAttemptId', 'captured provider settlement is not reviewable')
        if (reservation.state === targetState)
          return {
            ok: true,
            orderId: order.id,
            revision: n(order.revision),
            state: targetState,
          }
        const allowed =
          (targetState === 'needs_review' && reservation.state === 'settled') ||
          (targetState === 'reversing' && reservation.state === 'needs_review')
        if (!allowed)
          return invalid('state', 'provider payment review state cannot move backwards or be reopened')
        const claim = await claimDraftRevision(tx, order.id, args.expectedRevision)
        if (claim.ok !== true) return claim
        const changed = await tx.db.compareAndSet(
          'pos.ProviderPaymentLock',
          { id: attemptId },
          { state: reservation.state },
          { state: targetState, updatedAt: now() },
        )
        if (!('dryRun' in changed) && !changed.matched)
          return invalid('state', 'provider payment reconciliation changed; reload it before continuing')
        return { ok: true, orderId: order.id, revision: claim.revision, state: targetState }
      }),
  }),
  reverseProviderPayment: defineFn({
    exposure: 'internal',
    input: {
      id: 'id',
      orderId: 'id',
      providerAttemptId: 'text',
      providerReversalId: 'text',
      amount: 'decimal',
      currency: 'text',
      reversalReference: 'text',
      expectedRevision: 'int',
      operatorId: 'text?',
    },
    output: {
      ok: 'bool',
      id: 'id?',
      revision: 'int?',
      reversedPaymentId: 'id?',
      appliedAmount: 'decimal?',
      errors: 'json?',
    },
    effects: [
      'read:pos.Order',
      'write:pos.Order',
      'read:pos.Payment',
      'write:pos.Payment',
      'read:pos.ProviderPaymentLock',
      'write:pos.ProviderPaymentLock',
      'read:pos.OrderLine',
    ],
    idempotent: true,
    handler: (ctx, args) =>
      atomic(ctx, async (tx) => {
        const attemptId = String(args.providerAttemptId ?? '').trim()
        const reversalId = String(args.providerReversalId ?? '').trim()
        const reference = String(args.reversalReference ?? '').trim()
        if (!attemptId) return invalid('providerAttemptId', 'provider attempt id is required')
        if (!reversalId || reversalId === attemptId)
          return invalid('providerReversalId', 'provider reversal id must be distinct and non-empty')
        if (!reference) return invalid('reversalReference', 'provider reversal reference is required')
        const order = (await tx.db.select('pos.Order', { id: args.orderId }))[0]
        if (!order) return invalid('orderId', 'order does not exist')
        if (String(args.currency) !== String(order.currency))
          return invalid('currency', 'provider reversal currency does not match the order')
        const original = (await tx.db.select('pos.Payment', { providerAttemptId: attemptId }))[0]
        if (
          !original ||
          original.orderId !== args.orderId ||
          original.kind !== 'provider' ||
          original.reversalOfId != null
        )
          return invalid('providerAttemptId', 'captured provider tender does not belong to this order')
        const amount = n(args.amount)
        if (amount === 0 || n(original.appliedAmount ?? original.amount) !== amount)
          return invalid('amount', 'provider reversal must exactly match the captured tender')
        const byId = (await tx.db.select('pos.Payment', { id: args.id }))[0]
        const byOriginal = (await tx.db.select('pos.Payment', { reversalOfId: original.id }))[0]
        if (byId && byOriginal && byId.id !== byOriginal.id)
          return invalid('id', 'provider tender is already linked to another reversal')
        const existing = byId ?? byOriginal
        const reservation = (await tx.db.select('pos.ProviderPaymentLock', { id: attemptId }))[0]
        if (existing) {
          const same =
            existing.id === args.id &&
            existing.orderId === args.orderId &&
            existing.paymentMethodId === original.paymentMethodId &&
            existing.kind === 'provider_reversal' &&
            existing.state === 'reversed' &&
            n(existing.appliedAmount ?? existing.amount) === -amount &&
            existing.providerAttemptId === reversalId &&
            existing.reference === reference &&
            existing.reversalOfId === original.id &&
            original.state === 'reversed' &&
            reservation?.state === 'reversed' &&
            reservation.reversalPaymentId === existing.id &&
            order.paymentLockId == null
          return same
            ? {
                ok: true,
                id: existing.id,
                revision: n(order.revision),
                reversedPaymentId: original.id,
                appliedAmount: existing.appliedAmount ?? existing.amount,
              }
            : invalid('id', 'provider reversal id is already used by another command')
        }
        if (order.state !== 'draft')
          return invalid('orderId', 'only a captured tender on a draft order can be compensated')
        if (
          original.state !== 'captured' ||
          String(order.paymentLockId ?? '') !== attemptId ||
          reservation?.orderId !== args.orderId ||
          reservation.paymentMethodId !== original.paymentMethodId ||
          n(reservation.amount) !== amount ||
          reservation.currency !== args.currency ||
          reservation.state !== 'reversing' ||
          reservation.settledPaymentId !== original.id
        )
          return invalid('providerAttemptId', 'provider settlement is not eligible for compensation')
        const collision = (await tx.db.select('pos.Payment', { providerAttemptId: reversalId }))[0]
        if (collision) return invalid('providerReversalId', 'provider reversal id is already in use')
        const claim = await claimDraftRevision(tx, args.orderId, args.expectedRevision)
        if (claim.ok !== true) return claim
        const reversedAmount = decimal(-amount)
        await tx.db.insert('pos.Payment', {
          id: args.id,
          orderId: args.orderId,
          paymentMethodId: original.paymentMethodId,
          amount: reversedAmount,
          tenderedAmount: reversedAmount,
          appliedAmount: reversedAmount,
          state: 'reversed',
          kind: 'provider_reversal',
          reference,
          providerAttemptId: reversalId,
          reversalOfId: original.id,
          operatorId: args.operatorId ?? null,
          deviceId: original.deviceId ?? null,
          paymentDate: now(),
        })
        await tx.db.update('pos.Payment', { id: original.id }, { state: 'reversed' })
        await tx.db.update(
          'pos.Order',
          { id: args.orderId },
          { paymentLockId: null, paymentLockMethodId: null, paymentLockAmount: null },
        )
        await tx.db.update(
          'pos.ProviderPaymentLock',
          { id: attemptId },
          { state: 'reversed', reversalPaymentId: args.id, updatedAt: now() },
        )
        await recompute(tx, args.orderId)
        return {
          ok: true,
          id: args.id,
          revision: claim.revision,
          reversedPaymentId: original.id,
          appliedAmount: reversedAmount,
        }
      }),
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
      if (String(payment.kind).startsWith('provider'))
        return invalid('id', 'provider tenders must be reversed through their payment rail')
      const order = (await ctx.db.select('pos.Order', { id: args.orderId }))[0]
      if (payment.state === 'voided') {
        return { ok: true, id: args.id, revision: n(order?.revision) }
      }
      if (order?.paymentLockId)
        return invalid('orderId', 'manual tenders cannot change while an external payment is pending')
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
      'read:pos.Exchange',
      'read:pos.Session',
      'read:pos.Config',
      'read:pos.OrderLine',
      'read:pos.Payment',
      'read:pos.ProviderPaymentLock',
      'write:pos.ProviderPaymentLock',
      'read:pos.PaymentMethod',
      'read:product.Product',
      'read:product.Template',
      'read:uom.Unit',
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
      const providerAttemptId = order.paymentLockId ? String(order.paymentLockId) : null
      if (providerAttemptId) {
        const settled = (
          await ctx.db.select('pos.Payment', {
            providerAttemptId: order.paymentLockId,
          })
        )[0]
        const reservation = (await ctx.db.select('pos.ProviderPaymentLock', { id: order.paymentLockId }))[0]
        if (
          settled?.kind !== 'provider' ||
          settled.state !== 'captured' ||
          settled.reversalOfId != null ||
          settled.orderId !== order.id ||
          settled.paymentMethodId !== order.paymentLockMethodId ||
          n(settled.appliedAmount ?? settled.amount) !== n(order.paymentLockAmount) ||
          reservation?.orderId !== order.id ||
          reservation.paymentMethodId !== order.paymentLockMethodId ||
          n(reservation.amount) !== n(order.paymentLockAmount) ||
          reservation.currency !== order.currency ||
          !['settled', 'finalizing'].includes(String(reservation.state)) ||
          reservation.settledPaymentId !== settled.id
        )
          return invalid('paymentLockId', 'external payment is still pending reconciliation')
      }
      if (order.exchangeRole === 'replacement') {
        const exchange = order.exchangeId
          ? (await ctx.db.select('pos.Exchange', { id: order.exchangeId }))[0]
          : null
        const exchangeReturn = exchange
          ? (await ctx.db.select('pos.Order', { id: exchange.returnOrderId }))[0]
          : null
        if (
          !exchange ||
          !exchangeReturn ||
          exchange.replacementOrderId !== order.id ||
          exchangeReturn.exchangeRole !== 'return' ||
          exchangeReturn.exchangeId !== exchange.id ||
          exchangeReturn.isRefund !== true
        )
          return invalid('exchangeId', 'replacement sale is not linked to a valid return')
        if (!['paid', 'done'].includes(String(exchangeReturn.state)))
          return invalid('exchangeId', 'exchange return must be completed before its replacement sale')
      }
      const session = (await ctx.db.select('pos.Session', { id: order.sessionId }))[0]
      if (!session || !['opened', 'closing_control'].includes(String(session.state)))
        return invalid('sessionId', 'session is not open')
      const lines = await ctx.db.select('pos.OrderLine', { orderId: args.id })
      if (!lines.length) return invalid('lines', 'order needs at least one product')
      if (lines.some((line) => (order.isRefund ? !(n(line.qty) < -0.000001) : !(n(line.qty) > 0.000001))))
        return invalid('lines', 'sale and return orders cannot mix quantity directions')
      const payments = (await ctx.db.select('pos.Payment', { orderId: args.id })).filter(
        (payment) => (payment.state ?? 'captured') === 'captured',
      )
      if (Math.abs(n(order.amountPaid) - n(order.amountTotal)) > 0.000001)
        return invalid('amountPaid', 'paid amount must equal order total')
      const config = (await ctx.db.select('pos.Config', { id: order.configId }))[0]!
      if (n(order.amountTax) && !config.taxAccountId)
        return invalid('taxAccountId', 'a tax account is required before stock is moved')
      const goods: Row[] = []
      const selectedLots = new Set<string>()
      for (const line of lines) {
        if (line.affectsStock === false) continue
        const held = await productOf(ctx, line.productId)
        if (held?.template.type !== 'service') {
          const tracking = String(held?.template.tracking ?? 'none')
          if (tracking !== String(line.tracking ?? 'none'))
            return invalid('tracking', 'product tracking changed; remove and add the line again')
          if (tracking !== 'none') {
            const based = await toProductUnit(ctx, line.productId, line.productUomId, Math.abs(n(line.qty)))
            if (!based) return invalid('productUomId', 'line unit is incompatible with the product unit')
            const selections = Array.isArray(line.lotSelections) ? (line.lotSelections as Row[]) : []
            if (
              !selections.length ||
              Math.abs(
                selections.reduce((sum, selection) => sum + n(selection.quantity), 0) - based.quantity,
              ) > 0.000001
            )
              return invalid('lotSelections', 'selected lot/serial quantity must equal line quantity')
            if (new Set(selections.map((selection) => String(selection.lotId))).size !== selections.length)
              return invalid('lotSelections', 'a lot/serial can only be selected once per line')
            for (const selection of selections) {
              const lotId = String(selection.lotId)
              if (selectedLots.has(lotId))
                return invalid('lotSelections', 'a lot/serial can only be selected on one order line')
              selectedLots.add(lotId)
            }
            if (tracking === 'serial') {
              for (const selection of selections) {
                if (Math.abs(n(selection.quantity) - 1) > 0.000001)
                  return invalid('lotSelections', 'every selected serial must have quantity 1')
              }
            }
            if (!order.isRefund) {
              const availability = await trackingAvailability(ctx, order, line)
              const lots = new Map(
                (availability.lots as Row[]).map((lot) => [String(lot.lotId), lot] as const),
              )
              for (const selection of selections) {
                const lot = lots.get(String(selection.lotId))
                if (lot?.selectable !== true)
                  return invalid('lotSelections', `lot/serial ${String(selection.lotId)} is not selectable`)
                if (String(lot.stockRevision) !== String(selection.stockRevision))
                  return invalid('stockRevision', 'stock position changed; reload lot availability')
                if (n(lot.availableQuantity) + 0.000001 < n(selection.quantity))
                  return invalid('stock', `insufficient stock for lot/serial ${String(selection.lotId)}`)
              }
            }
          }
          goods.push({ ...line, tracking })
        }
      }
      const claim = providerAttemptId
        ? await claimProviderFinalization(ctx, args.id, providerAttemptId, args.expectedRevision)
        : await claimDraftRevision(ctx, args.id, args.expectedRevision)
      if (claim.ok !== true) return claim
      const providerLeaseToken = 'leaseToken' in claim ? claim.leaseToken : null
      let finalizationCommitted = false
      try {
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
          if (order.isRefund) {
            for (const line of goods) {
              const moveId = `${String(line.id)}:move`
              const picking = (await ctx.db.select('stock.Picking', { id: pickingId }))[0]!
              const based = await toProductUnit(ctx, line.productId, line.productUomId, Math.abs(n(line.qty)))
              if (!based) return invalid('productUomId', 'line unit is incompatible with the product unit')
              const selections =
                String(line.tracking) === 'none'
                  ? [{ lotId: null, quantity: based.quantity }]
                  : (line.lotSelections as Row[])
              for (const [index, selection] of selections.entries()) {
                const saved = (await stockFunctions.saveMoveLine!.handler(ctx, {
                  id: `${moveId}:line:${String(index + 1)}`,
                  moveId,
                  productUomId: line.productUomId,
                  quantity: decimal(n(selection.quantity)),
                  locationId: picking.locationId,
                  locationDestId: picking.locationDestId,
                  ...(selection.lotId ? { lotId: selection.lotId } : {}),
                  picked: true,
                })) as Row
                if (saved.ok !== true) return saved
              }
            }
          } else {
            const reserved = (await stockFunctions.reserveMoves!.handler(ctx, {
              requireFull: true,
              moves: goods.map((line) => ({
                id: `${String(line.id)}:move`,
                ...(String(line.tracking) === 'none' ? {} : { selections: line.lotSelections }),
              })),
            })) as Row
            if (reserved.ok !== true) return reserved
            const results = Array.isArray(reserved.results) ? (reserved.results as Row[]) : []
            for (const line of goods) {
              const result = results.find((entry) => String(entry.id) === `${String(line.id)}:move`)
              const based = await toProductUnit(ctx, line.productId, line.productUomId, Math.abs(n(line.qty)))
              if (!based || !result || n(result.reserved) + 0.000001 < based.quantity)
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
        await ctx.tx(async (tx) => {
          if (providerAttemptId) {
            const finalized = await tx.db.compareAndSet(
              'pos.ProviderPaymentLock',
              { id: providerAttemptId },
              { state: 'finalizing', updatedAt: providerLeaseToken },
              { state: 'finalized', updatedAt: now() },
            )
            if (!('dryRun' in finalized) && !finalized.matched)
              throw new Error('external payment finalization claim was lost')
          }
          await tx.db.update(
            'pos.Order',
            { id: args.id },
            {
              state: 'paid',
              invoiceStatus: 'invoiced',
              pickingId,
              accountMoveId,
            },
          )
        })
        finalizationCommitted = true
        return {
          ok: true,
          id: args.id,
          state: 'paid',
          revision: claim.revision,
          ...(pickingId ? { pickingId } : {}),
          accountMoveId,
        }
      } finally {
        if (providerAttemptId && !finalizationCommitted) {
          await ctx.db.compareAndSet(
            'pos.ProviderPaymentLock',
            { id: providerAttemptId },
            { state: 'finalizing', updatedAt: providerLeaseToken },
            { state: 'needs_review', updatedAt: now() },
          )
        }
      }
    },
  }),
  getReturnEligibility: defineFn({
    input: { id: 'id' },
    output: {
      ok: 'bool',
      originalOrderId: 'id?',
      revision: 'int?',
      refundable: 'bool?',
      requiresFullReturn: 'bool?',
      standaloneAllowed: 'bool?',
      lines: 'json?',
      errors: 'json?',
    },
    effects: ['read:pos.Order', 'read:pos.OrderLine'],
    agent: true,
    handler: async (ctx, args) => {
      const original = (await ctx.db.select('pos.Order', { id: args.id }))[0]
      if (!original || !['paid', 'done'].includes(String(original.state)) || original.isRefund)
        return invalid('id', 'only a paid sale can be returned')
      const lines = await returnableLines(ctx, original)
      const allLines = await ctx.db.select('pos.OrderLine', { orderId: original.id })
      const requiresFullReturn = allLines.some(
        (line) => line.lineKind === 'reward' && line.affectsStock !== false,
      )
      return {
        ok: true,
        originalOrderId: String(original.id),
        revision: n(original.revision),
        refundable: lines.some((entry) => entry.remainingQuantity > 0.000001),
        requiresFullReturn,
        standaloneAllowed: false,
        lines: lines.map((entry) => ({
          lineId: String(entry.line.id),
          productId: String(entry.line.productId),
          name: String(entry.line.name),
          uomId: String(entry.line.productUomId),
          purchasedQuantity: decimal(entry.purchasedQuantity),
          refundedQuantity: decimal(entry.refundedQuantity),
          remainingQuantity: decimal(entry.remainingQuantity),
          unitPrice: String(entry.line.priceUnit),
          amountTotal: String(entry.line.priceSubtotalIncl),
          tracking: String(entry.line.tracking ?? 'none'),
        })),
      }
    },
  }),
  refundOrder: defineFn({
    input: {
      id: 'id',
      uuid: 'text?',
      originalOrderId: 'id',
      sessionId: 'id',
      expectedRevision: 'int?',
      lines: 'json?',
      reason: 'text?',
      operatorId: 'text?',
      deviceId: 'text?',
    },
    output: {
      ok: 'bool',
      id: 'id?',
      name: 'text?',
      revision: 'int?',
      originalRevision: 'int?',
      errors: 'json?',
    },
    effects: [...refundOrderEffects],
    idempotent: true,
    agent: true,
    handler: (ctx, args) =>
      atomic(ctx, async (tx) => {
        const existing = (await tx.db.select('pos.Order', { id: args.id }))[0]
        if (existing) {
          if (
            !existing.isRefund ||
            String(existing.refundedOrderId ?? '') !== String(args.originalOrderId) ||
            String(existing.sessionId) !== String(args.sessionId) ||
            (args.uuid !== undefined && String(existing.uuid) !== String(args.uuid)) ||
            (args.reason !== undefined && String(existing.note ?? '') !== String(args.reason).trim())
          )
            return invalid('id', 'return id is already used by a different command')
          if (Array.isArray(args.lines)) {
            const requested = new Map(
              (args.lines as Row[]).map((line) => [String(line.lineId), n(line.quantity)] as const),
            )
            const held = (await tx.db.select('pos.OrderLine', { orderId: existing.id })).filter(
              (line) => line.refundedOrderlineId && line.lineKind !== 'reward',
            )
            if (
              held.length !== requested.size ||
              held.some(
                (line) =>
                  Math.abs(Math.abs(n(line.qty)) - (requested.get(String(line.refundedOrderlineId)) ?? -1)) >
                  0.000001,
              )
            )
              return invalid('id', 'return id is already used by a different selection')
          }
          return { ok: true, id: args.id, name: existing.name, revision: n(existing.revision) }
        }
        if (args.uuid) {
          const duplicate = (await tx.db.select('pos.Order', { uuid: args.uuid }))[0]
          if (duplicate) return invalid('uuid', 'return uuid is already used by a different command')
        }

        const original = (await tx.db.select('pos.Order', { id: args.originalOrderId }))[0]
        if (!original || !['paid', 'done'].includes(String(original.state)) || original.isRefund)
          return invalid('originalOrderId', 'only a paid sale can be returned')
        if (args.expectedRevision !== undefined && n(args.expectedRevision) !== n(original.revision))
          return invalid('expectedRevision', 'the order changed; reload it before continuing')
        const session = (await tx.db.select('pos.Session', { id: args.sessionId }))[0]
        if (session?.state !== 'opened') return invalid('sessionId', 'return requires an open session')
        if (String(session.configId) !== String(original.configId))
          return invalid('sessionId', 'return shift must use the original POS configuration and warehouse')
        const claim = await claimOrderRevision(tx, original.id, args.expectedRevision)
        if (claim.ok !== true) return claim

        const eligibility = await returnableLines(tx, original)
        const eligible = new Map(eligibility.map((entry) => [String(entry.line.id), entry] as const))
        const rawLines =
          args.lines === undefined
            ? eligibility
                .filter((entry) => entry.remainingQuantity > 0.000001)
                .map((entry) => ({ lineId: String(entry.line.id), quantity: entry.remainingQuantity }))
            : Array.isArray(args.lines)
              ? (args.lines as Row[])
              : null
        if (!rawLines?.length) return invalid('lines', 'return needs at least one refundable line')
        const requested = rawLines.map((selection) => ({
          lineId: String(selection.lineId ?? ''),
          quantity: n(selection.quantity),
        }))
        if (
          requested.some((selection) => !selection.lineId || !(selection.quantity > 0)) ||
          new Set(requested.map((selection) => selection.lineId)).size !== requested.length
        )
          return invalid('lines', 'return lines must be unique with positive quantities')
        for (const selection of requested) {
          const line = eligible.get(selection.lineId)
          if (!line) return invalid('lineId', `line ${selection.lineId} is not refundable merchandise`)
          if (selection.quantity > line.remainingQuantity + 0.000001)
            return invalid(
              'quantity',
              `return quantity exceeds the remaining quantity for ${selection.lineId}`,
            )
        }

        const originalLines = await tx.db.select('pos.OrderLine', { orderId: original.id })
        const linkedRefunds = (await tx.db.select('pos.Order', { refundedOrderId: original.id })).filter(
          (order) => order.state !== 'cancel',
        )
        const previousRefundLines: Row[] = []
        for (const refund of linkedRefunds)
          previousRefundLines.push(...(await tx.db.select('pos.OrderLine', { orderId: refund.id })))
        const completesReturn = eligibility.every((entry) => {
          const selected = requested.find((selection) => selection.lineId === String(entry.line.id))
          return (
            entry.remainingQuantity <= 0.000001 ||
            (selected?.quantity ?? 0) + 0.000001 >= entry.remainingQuantity
          )
        })
        const productReward = originalLines.some(
          (line) => line.lineKind === 'reward' && line.affectsStock !== false,
        )
        if (productReward && (!completesReturn || linkedRefunds.length))
          return invalid('lines', 'orders with a product reward require one complete return')

        const merchandiseTotal = eligibility.reduce(
          (sum, entry) => sum + Math.abs(n(entry.line.priceSubtotalIncl)),
          0,
        )
        const returnedMerchandiseTotal = requested.reduce((sum, selection) => {
          const entry = eligible.get(selection.lineId)!
          return (
            sum + Math.abs(n(entry.line.priceSubtotalIncl)) * (selection.quantity / entry.purchasedQuantity)
          )
        }, 0)
        const quantityBasis = eligibility.reduce((sum, entry) => sum + entry.purchasedQuantity, 0)
        const returnedQuantity = requested.reduce((sum, selection) => sum + selection.quantity, 0)
        const returnPortion = Math.min(
          1,
          merchandiseTotal > 0
            ? returnedMerchandiseTotal / merchandiseTotal
            : returnedQuantity / Math.max(quantityBasis, returnedQuantity),
        )

        const materialized: Array<{
          source: Row
          quantity: number
          ratio: number
          exhausts: boolean
          selections: Row[]
        }> = []
        for (const selection of requested) {
          const entry = eligible.get(selection.lineId)!
          const lotSelections = await completedLotSelections(tx, entry.line, selection.quantity)
          if (!Array.isArray(lotSelections)) return lotSelections
          materialized.push({
            source: entry.line,
            quantity: selection.quantity,
            ratio: selection.quantity / entry.purchasedQuantity,
            exhausts: selection.quantity + 0.000001 >= entry.remainingQuantity,
            selections: lotSelections,
          })
        }
        for (const reward of originalLines.filter((line) => line.lineKind === 'reward')) {
          const group = eligibility.filter((entry) => taxGroupKey(entry.line) === taxGroupKey(reward))
          const basis = group.length ? group : eligibility
          const groupTotal = basis.reduce((sum, entry) => sum + Math.abs(n(entry.line.priceSubtotalIncl)), 0)
          const groupReturned = requested.reduce((sum, selection) => {
            const entry = eligible.get(selection.lineId)!
            if (!basis.includes(entry)) return sum
            return (
              sum + Math.abs(n(entry.line.priceSubtotalIncl)) * (selection.quantity / entry.purchasedQuantity)
            )
          }, 0)
          const groupComplete = basis.every((entry) => {
            const selected = requested.find((selection) => selection.lineId === String(entry.line.id))
            return (
              entry.remainingQuantity <= 0.000001 ||
              (selected?.quantity ?? 0) + 0.000001 >= entry.remainingQuantity
            )
          })
          const ratio = productReward
            ? 1
            : Math.min(1, groupTotal > 0 ? groupReturned / groupTotal : returnPortion)
          if (ratio <= 0.000001) continue
          const lotSelections = await completedLotSelections(tx, reward, Math.abs(n(reward.qty)) * ratio)
          if (!Array.isArray(lotSelections)) return lotSelections
          materialized.push({
            source: reward,
            quantity: Math.abs(n(reward.qty)) * ratio,
            ratio,
            exhausts: productReward || groupComplete,
            selections: lotSelections,
          })
        }

        const sequenceNumber = await nextOrderNumber(tx, args.sessionId)
        const name = `Order ${String(sequenceNumber).padStart(5, '0')}`
        await tx.db.insert('pos.Order', {
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
          returnPortion: decimal(returnPortion),
          returnComplete: completesReturn,
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
          note: args.reason ? String(args.reason).trim() : `Return ${String(original.posReference)}`,
          revision: 0,
          operatorId: args.operatorId ?? null,
          deviceId: args.deviceId ?? session.deviceId ?? null,
          priceBookRevision: original.priceBookRevision ?? null,
        })
        let sequence = 10
        for (const item of materialized) {
          const line = item.source
          const previous = previousRefundLines.filter(
            (entry) => String(entry.refundedOrderlineId ?? '') === String(line.id),
          )
          const exhaustsLine = item.exhausts
          const subtotal = exhaustsLine
            ? -(n(line.priceSubtotal) + previous.reduce((sum, entry) => sum + n(entry.priceSubtotal), 0))
            : -n(line.priceSubtotal) * item.ratio
          const total = exhaustsLine
            ? -(
                n(line.priceSubtotalIncl) +
                previous.reduce((sum, entry) => sum + n(entry.priceSubtotalIncl), 0)
              )
            : -n(line.priceSubtotalIncl) * item.ratio
          await tx.db.insert('pos.OrderLine', {
            id: `${String(args.id)}:${String(line.id)}`,
            orderId: args.id,
            productId: line.productId,
            productUomId: line.productUomId,
            name: line.name,
            qty: decimal(-item.quantity),
            priceUnit: line.priceUnit,
            discount: line.discount,
            taxId: line.taxId,
            taxIds: line.taxIds ?? (line.taxId ? [line.taxId] : []),
            taxEvidence: returnTaxEvidence(line.taxEvidence, previous, item.ratio, exhaustsLine),
            quoteRevision: line.quoteRevision ?? null,
            tracking: line.tracking ?? 'none',
            lotSelections: item.selections,
            affectsStock: line.affectsStock ?? null,
            priceSubtotal: decimal(subtotal),
            priceSubtotalIncl: decimal(total),
            refundedOrderlineId: line.id,
            sequence,
            ...(line.lineKind
              ? {
                  lineKind: line.lineKind,
                  loyaltyApplicationId: line.loyaltyApplicationId ?? null,
                  loyaltyRewardId: line.loyaltyRewardId ?? null,
                  loyaltyPointsCost: line.loyaltyPointsCost ?? null,
                }
              : {}),
          })
          sequence += 10
        }
        await recompute(tx, args.id)
        return {
          ok: true,
          id: args.id,
          name,
          revision: 0,
          originalRevision: claim.revision,
        }
      }),
  }),
  createExchange: defineFn({
    input: {
      id: 'id',
      uuid: 'text?',
      originalOrderId: 'id',
      sessionId: 'id',
      expectedRevision: 'int',
      lines: 'json',
      reason: 'text',
      replacementPriceBookRevision: 'text',
      replacementNote: 'text?',
      operatorId: 'text?',
      deviceId: 'text?',
    },
    output: {
      ok: 'bool',
      id: 'id?',
      uuid: 'text?',
      originalOrderId: 'id?',
      returnOrderId: 'id?',
      replacementOrderId: 'id?',
      originalRevision: 'int?',
      returnRevision: 'int?',
      replacementRevision: 'int?',
      reason: 'text?',
      createdAt: 'datetime?',
      errors: 'json?',
    },
    effects: [...refundOrderEffects, ...createOrderEffects, 'read:pos.Exchange', 'write:pos.Exchange'],
    idempotent: true,
    agent: true,
    handler: (ctx, args) =>
      atomic(ctx, async (tx) => {
        const reason = String(args.reason ?? '').trim()
        if (!reason) return invalid('reason', 'exchange reason is required')
        const uuid = String(args.uuid ?? args.id)
        const byId = (await tx.db.select('pos.Exchange', { id: args.id }))[0]
        const byUuid = (await tx.db.select('pos.Exchange', { uuid }))[0]
        if (byId && byUuid && byId.id !== byUuid.id)
          return invalid('uuid', 'exchange uuid is already used by a different command')
        const existing = byId ?? byUuid
        if (existing) {
          const returned = (await tx.db.select('pos.Order', { id: existing.returnOrderId }))[0]
          const replacement = (await tx.db.select('pos.Order', { id: existing.replacementOrderId }))[0]
          if (
            !returned ||
            !replacement ||
            String(existing.originalOrderId) !== String(args.originalOrderId) ||
            String(existing.uuid) !== uuid ||
            String(existing.reason ?? '') !== reason ||
            String(returned.sessionId) !== String(args.sessionId) ||
            String(replacement.sessionId) !== String(args.sessionId) ||
            returned.exchangeRole !== 'return' ||
            replacement.exchangeRole !== 'replacement' ||
            returned.exchangeId !== existing.id ||
            replacement.exchangeId !== existing.id ||
            String(replacement.priceBookRevision ?? '') !== String(args.replacementPriceBookRevision) ||
            (args.replacementNote !== undefined &&
              String(replacement.note ?? '') !== String(args.replacementNote))
          )
            return invalid('id', 'exchange id is already used by a different command')
          const replayedReturn = (await functions.refundOrder!.handler(tx, {
            id: returned.id,
            uuid: returned.uuid,
            originalOrderId: args.originalOrderId,
            sessionId: args.sessionId,
            expectedRevision: args.expectedRevision,
            lines: args.lines,
            reason,
            operatorId: args.operatorId,
            deviceId: args.deviceId,
          })) as Row
          if (replayedReturn.ok !== true) return replayedReturn
          return {
            ok: true,
            id: existing.id,
            uuid: existing.uuid,
            originalOrderId: existing.originalOrderId,
            returnOrderId: existing.returnOrderId,
            replacementOrderId: existing.replacementOrderId,
            originalRevision: n(existing.originalRevision),
            returnRevision: n(returned.revision),
            replacementRevision: n(replacement.revision),
            reason: existing.reason,
            createdAt: existing.createdAt,
          }
        }

        const returnOrderId = `${String(args.id)}:return`
        const replacementOrderId = `${String(args.id)}:replacement`
        if (
          (await tx.db.select('pos.Order', { id: returnOrderId }))[0] ||
          (await tx.db.select('pos.Order', { id: replacementOrderId }))[0]
        )
          return invalid('id', 'an exchange child order id is already in use')
        const original = (await tx.db.select('pos.Order', { id: args.originalOrderId }))[0]
        if (!original || original.isRefund || !['paid', 'done'].includes(String(original.state)))
          return invalid('originalOrderId', 'only a paid sale can be exchanged')

        const returned = (await functions.refundOrder!.handler(tx, {
          id: returnOrderId,
          uuid: `${uuid}:return`,
          originalOrderId: args.originalOrderId,
          sessionId: args.sessionId,
          expectedRevision: args.expectedRevision,
          lines: args.lines,
          reason,
          operatorId: args.operatorId,
          deviceId: args.deviceId,
        })) as Row
        if (returned.ok !== true) return returned
        const replacement = (await functions.createOrder!.handler(tx, {
          id: replacementOrderId,
          uuid: `${uuid}:replacement`,
          sessionId: args.sessionId,
          partnerId: original.partnerId ?? undefined,
          note: args.replacementNote ?? `Exchange replacement for ${String(original.posReference)}`,
          operatorId: args.operatorId,
          deviceId: args.deviceId,
          priceBookRevision: args.replacementPriceBookRevision,
        })) as Row
        if (replacement.ok !== true) return replacement

        const createdAt = now()
        await tx.db.insert('pos.Exchange', {
          id: args.id,
          uuid,
          originalOrderId: original.id,
          returnOrderId,
          replacementOrderId,
          originalRevision: returned.originalRevision,
          reason,
          createdAt,
        })
        await tx.db.update(
          'pos.Order',
          { id: returnOrderId },
          { exchangeId: args.id, exchangeRole: 'return' },
        )
        await tx.db.update(
          'pos.Order',
          { id: replacementOrderId },
          { exchangeId: args.id, exchangeRole: 'replacement' },
        )
        return {
          ok: true,
          id: args.id,
          uuid,
          originalOrderId: original.id,
          returnOrderId,
          replacementOrderId,
          originalRevision: n(returned.originalRevision),
          returnRevision: n(returned.revision),
          replacementRevision: n(replacement.revision),
          reason,
          createdAt,
        }
      }),
  }),
  cancelOrder: defineFn({
    input: { id: 'id', expectedRevision: 'int?' },
    output: { ok: 'bool', id: 'id?', revision: 'int?', errors: 'json?' },
    effects: ['read:pos.Order', 'write:pos.Order', 'read:pos.Payment'],
    idempotent: true,
    agent: true,
    handler: (ctx, args) =>
      atomic(ctx, async (tx) => {
        const order = (await tx.db.select('pos.Order', { id: args.id }))[0]
        if (!order) return invalid('id', 'order does not exist')
        if (order.state === 'cancel') return { ok: true, id: args.id, revision: n(order.revision) }
        if (order.state !== 'draft') return invalid('state', 'paid orders must be refunded, not cancelled')
        if (order.paymentLockId)
          return invalid('paymentLockId', 'external payment must be reconciled before cancellation')
        const providerPayment = (await tx.db.select('pos.Payment', { orderId: args.id })).find(
          (payment) => payment.kind === 'provider' && (payment.state ?? 'captured') === 'captured',
        )
        if (providerPayment) return invalid('state', 'provider tenders must be reversed before cancellation')
        const claim = await claimDraftRevision(tx, args.id, args.expectedRevision)
        if (claim.ok !== true) return claim
        if (order.isRefund && order.refundedOrderId) {
          const released = await claimOrderRevision(tx, order.refundedOrderId)
          if (released.ok !== true) return released
        }
        await tx.db.update('pos.Order', { id: args.id }, { state: 'cancel' })
        return { ok: true, id: args.id, revision: claim.revision }
      }),
  }),
}
