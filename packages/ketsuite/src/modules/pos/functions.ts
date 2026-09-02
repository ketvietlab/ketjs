import { createHash } from 'node:crypto'
import {
  and,
  defineFn,
  deleteFrom,
  desc,
  eq,
  from,
  gte,
  inArray,
  isNull,
  localDateTimeToUtc,
  lt,
  or,
} from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { addCivilDays } from '../account/date.ts'
import {
  functions as accountFunctions,
  insertDraftMove,
  ledgerOf,
  quoteTaxLine,
} from '../account/functions.ts'
import {
  absDecimalText,
  compareDecimals,
  minorText,
  moneyMinor,
  scaleOf,
  sumMoneyMinor,
} from '../account/money.ts'
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
export const POS_PAYMENT_SETTLEMENT_KINDS = ['liquidity', 'stored_value'] as const
const invalid = (field: string, message: string) => ({ ok: false as const, errors: [{ field, message }] })
const n = (value: unknown) => Number(value ?? 0)
const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100
const decimal = (value: number) => String(money(value))
const now = () => new Date().toISOString()

type AuditInput = {
  id: string
  subjectType: 'session' | 'order' | 'payment' | 'cash_movement' | 'exchange'
  subjectId: string
  configId: unknown
  sessionId: unknown
  action: string
  actorId?: unknown
  deviceId?: unknown
  reason?: unknown
  relatedId?: unknown
  details?: Row
  occurredAt?: string
}

const traceHash = (kind: string, value: unknown): string | null => {
  const held = String(value ?? '').trim()
  return held ? createHash('sha256').update(`pos:${kind}\n${held}`).digest('hex') : null
}

/**
 * Sensitive POS commands are retryable, so their audit identity must be retryable too.
 * Callers derive the id from the command/domain identity and this helper never updates
 * an existing event.
 */
const appendAudit = (ctx: Ctx, event: AuditInput) =>
  ctx.db.insertIfAbsent('pos.AuditEvent', {
    id: event.id,
    subjectType: event.subjectType,
    subjectId: event.subjectId,
    configId: event.configId,
    sessionId: event.sessionId,
    action: event.action,
    actorId: event.actorId ?? ctx.actor ?? null,
    deviceId: event.deviceId ?? null,
    reason: event.reason == null ? null : String(event.reason).trim().slice(0, 500),
    relatedId: event.relatedId ?? null,
    details: event.details ?? {},
    correlationHash: traceHash('correlation', ctx.correlationId),
    actorHash: traceHash('actor', event.actorId),
    subjectHash: traceHash(event.subjectType, event.subjectId),
    relatedHash: traceHash('related', event.relatedId),
    sessionHash: traceHash('session', event.sessionId),
    deviceHash: traceHash('device', event.deviceId),
    occurredAt: event.occurredAt ?? now(),
  })

const projectedAudit = (event: Row) => ({
  id: traceHash('audit-event', event.id),
  subjectType: String(event.subjectType ?? 'unknown'),
  subjectHash: event.subjectHash ?? traceHash(String(event.subjectType ?? 'unknown'), event.subjectId),
  action: String(event.action ?? ''),
  actorHash: event.actorHash ?? traceHash('actor', event.actorId),
  correlationHash: event.correlationHash ?? null,
  relatedHash: event.relatedHash ?? traceHash('related', event.relatedId),
  sessionHash: event.sessionHash ?? traceHash('session', event.sessionId),
  deviceHash: event.deviceHash ?? traceHash('device', event.deviceId),
  reason: event.reason ?? null,
  occurredAt: String(event.occurredAt),
})

const POS_OPERATIONS_MAX_DAYS = 31
const DAY_MS = 86_400_000

const operationsWindow = (dateFrom: unknown, dateTo: unknown, timezone: string) => {
  const startDay = String(dateFrom)
  const endDay = String(dateTo)
  const start = Date.parse(`${startDay}T00:00:00.000Z`)
  const end = Date.parse(`${endDay}T00:00:00.000Z`) + DAY_MS
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
    return invalid('dateTo', 'operations report end date must not precede its start date')
  if (end - start > POS_OPERATIONS_MAX_DAYS * DAY_MS)
    return invalid('dateTo', `operations report is limited to ${POS_OPERATIONS_MAX_DAYS} days`)
  return {
    ok: true as const,
    from: localDateTimeToUtc(`${startDay}T00:00`, timezone),
    to: localDateTimeToUtc(`${addCivilDays(endDay, 1)}T00:00`, timezone),
  }
}

const aggregateDecimal = (value: unknown): string => String(value ?? '0')

type RevisionClaim = { ok: true; order: Row; revision: number } | ReturnType<typeof invalid>
type ProviderFinalizationClaim =
  | { ok: true; order: Row; revision: number; leases: Array<{ id: string; token: string }> }
  | ReturnType<typeof invalid>
const PROVIDER_FINALIZATION_LEASE_MS = 5 * 60_000

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.entries(value as Row)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, held]) => `${JSON.stringify(key)}:${stableJson(held)}`)
      .join(',')}}`
  return JSON.stringify(value) ?? 'null'
}

const receiptHash = (document: Row): string => createHash('sha256').update(stableJson(document)).digest('hex')

const receiptDocumentFor = async (
  ctx: Ctx,
  order: Row,
  config: Row,
  session: Row,
  customer: Row,
  lines: Row[],
  payments: Row[],
  accountMoveId: string,
  issuedAt: string,
): Promise<Row> => {
  const methodIds = [...new Set(payments.map((payment) => String(payment.paymentMethodId)))]
  const methods = new Map(
    (
      await Promise.all(
        methodIds.map(async (id) => (await ctx.db.select('pos.PaymentMethod', { id }))[0] ?? null),
      )
    )
      .filter(Boolean)
      .map((method) => [String(method!.id), method!] as const),
  )
  return {
    schema: 'ketviet.pos.receipt.v1',
    company: { id: String(ctx.scope.company ?? '') },
    config: { id: String(config.id), name: String(config.name) },
    shift: { id: String(session.id), name: String(session.name) },
    cashier: { id: String(order.operatorId ?? session.userId) },
    customer: { id: String(customer.id), name: String(customer.name) },
    order: {
      id: String(order.id),
      name: String(order.name),
      reference: String(order.posReference),
      orderedAt: String(order.dateOrder),
      isReturn: order.isRefund === true,
      originalOrderId: order.refundedOrderId == null ? null : String(order.refundedOrderId),
    },
    currency: String(order.currency),
    lines: [...lines]
      .sort(
        (left, right) =>
          n(left.sequence) - n(right.sequence) || String(left.id).localeCompare(String(right.id)),
      )
      .map((line) => {
        const evidence =
          line.taxEvidence && typeof line.taxEvidence === 'object' ? (line.taxEvidence as Row) : null
        return {
          id: String(line.id),
          productId: String(line.productId),
          uomId: String(line.productUomId),
          name: String(line.name),
          quantity: String(line.qty),
          unitPrice: String(line.priceUnit),
          discount: String(line.discount),
          amountUntaxed: String(line.priceSubtotal),
          amountTax: decimal(n(line.priceSubtotalIncl) - n(line.priceSubtotal)),
          amountTotal: String(line.priceSubtotalIncl),
          taxes: (Array.isArray(evidence?.taxes) ? (evidence!.taxes as Row[]) : []).map((tax) => ({
            id: String(tax.taxId ?? ''),
            name: String(tax.name ?? tax.taxId ?? ''),
            amount: String(tax.share ?? '0'),
          })),
        }
      }),
    tenders: payments
      .filter((payment) => (payment.state ?? 'captured') === 'captured')
      .sort(
        (left, right) =>
          String(left.paymentDate).localeCompare(String(right.paymentDate)) ||
          String(left.id).localeCompare(String(right.id)),
      )
      .map((payment) => ({
        paymentMethodId: String(payment.paymentMethodId),
        paymentMethodName: String(methods.get(String(payment.paymentMethodId))?.name ?? ''),
        tenderedAmount: String(payment.tenderedAmount ?? payment.amount),
        appliedAmount: String(payment.appliedAmount ?? payment.amount),
        change: decimal(
          n(payment.tenderedAmount ?? payment.amount) - n(payment.appliedAmount ?? payment.amount),
        ),
        paidAt: String(payment.paymentDate),
      })),
    totals: {
      untaxed: String(order.amountUntaxed),
      tax: String(order.amountTax),
      exact: String(order.amountExact),
      rounding: String(order.amountRounding),
      total: String(order.amountTotal),
      paid: String(order.amountPaid),
      change: String(order.amountReturn),
    },
    invoice: { id: accountMoveId },
    issuedAt,
  }
}

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

async function providerFinalizationLocks(
  ctx: Ctx,
  order: Row,
): Promise<{ ok: true; locks: Row[] } | ReturnType<typeof invalid>> {
  const [locks, payments] = await Promise.all([
    ctx.db.select('pos.ProviderPaymentLock', { orderId: order.id }),
    ctx.db.select('pos.Payment', { orderId: order.id }),
  ])
  const captured = payments.filter(
    (payment) =>
      payment.kind === 'provider' &&
      (payment.state ?? 'captured') === 'captured' &&
      payment.reversalOfId == null,
  )
  const active = locks
    .filter((lock) => !['released', 'reversed'].includes(String(lock.state)))
    .sort((left, right) => String(left.id).localeCompare(String(right.id)))
  if (active.some((lock) => !['settled', 'finalizing'].includes(String(lock.state))))
    return invalid('paymentLockId', 'external payment is still pending reconciliation')
  if (captured.length !== active.length)
    return invalid('paymentLockId', 'external payment membership is incomplete')
  for (const lock of active) {
    const payment = captured.find(
      (candidate) => String(candidate.providerAttemptId ?? '') === String(lock.id),
    )
    if (
      !payment ||
      lock.orderId !== order.id ||
      lock.paymentMethodId !== payment.paymentMethodId ||
      n(lock.amount) !== n(payment.appliedAmount ?? payment.amount) ||
      lock.currency !== order.currency ||
      lock.settledPaymentId !== payment.id
    )
      return invalid('paymentLockId', 'external payment membership is inconsistent')
  }
  return { ok: true, locks: active }
}

async function claimProviderFinalization(
  ctx: Ctx,
  id: unknown,
  expectedRevision?: unknown,
): Promise<ProviderFinalizationClaim> {
  return (await atomic(ctx, async (tx) => {
    const order = (await tx.db.select('pos.Order', { id }))[0]
    if (!order) return invalid('orderId', 'order does not exist')
    if (order.state !== 'draft') return invalid('state', 'only a draft order can be finalized')
    const current = n(order.revision)
    const membership = await providerFinalizationLocks(tx, order)
    if (membership.ok !== true) return membership
    if (!membership.locks.length) return invalid('paymentLockId', 'provider payment lock is missing')
    const finalizing = membership.locks.filter((lock) => lock.state === 'finalizing')
    if (finalizing.length) {
      if (finalizing.length !== membership.locks.length)
        return invalid('paymentLockId', 'external payment finalization membership is inconsistent')
      const previousToken = String(finalizing[0]!.updatedAt ?? '')
      if (finalizing.some((lock) => String(lock.updatedAt ?? '') !== previousToken))
        return invalid('paymentLockId', 'external payment finalization membership is inconsistent')
      const leaseAge = Date.now() - Date.parse(previousToken)
      if (!Number.isFinite(leaseAge) || leaseAge < PROVIDER_FINALIZATION_LEASE_MS)
        return invalid('paymentLockId', 'external payment finalization is already in progress')
      if (
        expectedRevision !== undefined &&
        ![current, Math.max(0, current - 1)].includes(n(expectedRevision))
      )
        return invalid('expectedRevision', 'the order changed; reload it before continuing')
      const token = now()
      for (const lock of finalizing) {
        const resumed = await tx.db.compareAndSet(
          'pos.ProviderPaymentLock',
          { id: lock.id },
          { state: 'finalizing', updatedAt: previousToken },
          { updatedAt: token },
        )
        if (!('dryRun' in resumed) && !resumed.matched)
          return invalid('paymentLockId', 'external payment finalization recovery was already claimed')
      }
      return {
        ok: true,
        order,
        revision: current,
        leases: finalizing.map((lock) => ({ id: String(lock.id), token })),
      }
    }
    if (expectedRevision !== undefined && n(expectedRevision) !== current)
      return invalid('expectedRevision', 'the order changed; reload it before continuing')
    const token = now()
    for (const lock of membership.locks) {
      const lockChanged = await tx.db.compareAndSet(
        'pos.ProviderPaymentLock',
        { id: lock.id },
        { state: 'settled' },
        { state: 'finalizing', updatedAt: token },
      )
      if (!('dryRun' in lockChanged) && !lockChanged.matched)
        return invalid('paymentLockId', 'external payment reconciliation changed before finalization')
    }
    const orderChanged = await tx.db.compareAndSet(
      'pos.Order',
      { id: order.id },
      { revision: order.revision ?? null },
      { revision: current + 1 },
    )
    if (!('dryRun' in orderChanged) && !orderChanged.matched)
      return invalid('expectedRevision', 'the order changed; reload it before continuing')
    return {
      ok: true,
      order,
      revision: current + 1,
      leases: membership.locks.map((lock) => ({ id: String(lock.id), token })),
    }
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
const absoluteMinor = (value: bigint) => (value < 0n ? -value : value)

async function sessionCashMinor(ctx: Ctx, session: Row, scale: number): Promise<bigint> {
  let expected = moneyMinor(session.cashRegisterBalanceStart, scale)
  const orders = await ctx.db.select('pos.Order', { sessionId: session.id })
  for (const order of orders)
    for (const payment of await ctx.db.select('pos.Payment', { orderId: order.id })) {
      if ((payment.state ?? 'captured') !== 'captured') continue
      const method = (await ctx.db.select('pos.PaymentMethod', { id: payment.paymentMethodId }))[0]
      if (method?.isCash) expected += moneyMinor(payment.appliedAmount ?? payment.amount, scale)
    }
  for (const movement of await ctx.db.select('pos.CashMovement', { sessionId: session.id })) {
    const amount = moneyMinor(movement.amount, scale)
    expected += movement.direction === 'in' ? amount : -amount
  }
  return expected
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
  const order = (await ctx.db.select('pos.Order', { id: orderId }))[0]
  if (!order) throw new Error(`POS order ${String(orderId)} does not exist`)
  const scale = scaleOf(order.currency)
  const lines = await ctx.db.select('pos.OrderLine', { orderId })
  const untaxed = sumMoneyMinor(
    lines.map((line) => line.priceSubtotal),
    scale,
  )
  const total = sumMoneyMinor(
    lines.map((line) => line.priceSubtotalIncl),
    scale,
  )
  const tax = total - untaxed
  const payments = await ctx.db.select('pos.Payment', { orderId }),
    captured = payments.filter((payment) => (payment.state ?? 'captured') === 'captured'),
    paid = sumMoneyMinor(
      captured.map((payment) => payment.appliedAmount ?? payment.amount),
      scale,
    ),
    returned = captured.reduce(
      (sum, payment) =>
        sum +
        moneyMinor(payment.tenderedAmount ?? payment.amount, scale) -
        moneyMinor(payment.appliedAmount ?? payment.amount, scale),
      0n,
    )
  await ctx.db.update(
    'pos.Order',
    { id: orderId },
    {
      amountUntaxed: minorText(untaxed, scale),
      amountTax: minorText(tax, scale),
      amountExact: minorText(total, scale),
      amountRounding: minorText(0n, scale),
      amountTotal: minorText(total, scale),
      amountPaid: minorText(paid, scale),
      amountReturn: minorText(returned, scale),
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
  const invoice = Boolean(order.toInvoice)
  const date = String(order.dateOrder)
  const scale = scaleOf(order.currency)
  const signedTotal = moneyMinor(order.amountTotal, scale)
  const refund = signedTotal < 0n
  const total = refund ? -signedTotal : signedTotal
  const signedUntaxed = moneyMinor(order.amountUntaxed, scale)
  const untaxed = signedUntaxed < 0n ? -signedUntaxed : signedUntaxed
  const signedTax = moneyMinor(order.amountTax, scale)
  const tax = signedTax < 0n ? -signedTax : signedTax
  if (invoice && !order.partnerId) throw new Error('a customer is required to invoice a POS order')
  if (tax > 0n && !config.taxAccountId) throw new Error('a tax account is required for taxed POS orders')
  await ctx.tx(async (tx) => {
    const zero = minorText(0n, scale)
    const totalText = minorText(total, scale)
    const move: Row = {
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
      amountUntaxed: minorText(untaxed, scale),
      amountTax: minorText(tax, scale),
      amountTotal: totalText,
      postedAt: null,
      revision: 0,
    }
    const moveLines: Row[] = []
    let sequence = 10
    for (const line of lines) {
      // Revenue follows the signed line subtotal. A negative Loyalty line is a
      // contra-revenue debit on a sale, and becomes a credit when a refund
      // reverses it. Looking only at the order direction would overstate revenue.
      const subtotal = moneyMinor(line.priceSubtotal, scale)
      const balance = -subtotal
      const debit = balance > 0n ? balance : 0n
      const credit = balance < 0n ? -balance : 0n
      moveLines.push({
        id: `${id}:line:${String(line.id)}`,
        moveId: id,
        name: line.name,
        accountId: config.revenueAccountId,
        partnerId: order.partnerId ?? null,
        productId: line.productId,
        productUomId: line.productUomId,
        quantity: absDecimalText(line.qty),
        priceUnit: line.priceUnit,
        discount: line.discount,
        taxId: line.taxId,
        debit: minorText(debit, scale),
        credit: minorText(credit, scale),
        balance: minorText(balance, scale),
        dateMaturity: null,
        displayType: null,
        reconciled: false,
        amountResidual: zero,
        sequence,
        posLineId: line.id,
      })
      sequence += 10
    }
    if (tax > 0n)
      moveLines.push({
        id: `${id}:tax`,
        moveId: id,
        name: 'Tax',
        accountId: config.taxAccountId,
        partnerId: order.partnerId ?? null,
        productId: null,
        productUomId: null,
        quantity: '1',
        priceUnit: minorText(tax, scale),
        discount: '0',
        taxId: null,
        debit: refund ? minorText(tax, scale) : zero,
        credit: refund ? zero : minorText(tax, scale),
        balance: minorText(refund ? tax : -tax, scale),
        dateMaturity: null,
        displayType: null,
        reconciled: false,
        amountResidual: zero,
        sequence: 900,
      })
    if (invoice) {
      moveLines.push({
        id: `${id}:counterpart`,
        moveId: id,
        name: order.posReference,
        accountId: config.receivableAccountId,
        partnerId: order.partnerId,
        productId: null,
        productUomId: null,
        quantity: '1',
        priceUnit: totalText,
        discount: '0',
        taxId: null,
        debit: refund ? zero : totalText,
        credit: refund ? totalText : zero,
        balance: minorText(refund ? -total : total, scale),
        dateMaturity: date,
        displayType: null,
        reconciled: false,
        amountResidual: totalText,
        sequence: 1000,
      })
    } else {
      let paymentSequence = 1000
      for (const payment of payments) {
        const method = (await tx.db.select('pos.PaymentMethod', { id: payment.paymentMethodId }))[0]!,
          journal = (await tx.db.select('account.Journal', { id: method.journalId }))[0]!
        const signedAmount = moneyMinor(payment.amount, scale)
        const amount = signedAmount < 0n ? -signedAmount : signedAmount
        moveLines.push({
          id: `${id}:payment:${String(payment.id)}`,
          moveId: id,
          name: method.name,
          accountId: journal.defaultAccountId,
          partnerId: order.partnerId ?? null,
          productId: null,
          productUomId: null,
          quantity: '1',
          priceUnit: minorText(amount, scale),
          discount: '0',
          taxId: null,
          debit: refund ? zero : minorText(amount, scale),
          credit: refund ? minorText(amount, scale) : zero,
          balance: minorText(refund ? -amount : amount, scale),
          dateMaturity: null,
          displayType: null,
          reconciled: false,
          amountResidual: zero,
          sequence: paymentSequence,
        })
        paymentSequence += 10
      }
    }
    await insertDraftMove(tx, { move, lines: moveLines })
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
        amount: minorText(
          (() => {
            const held = moneyMinor(payment.amount, scale)
            return held < 0n ? -held : held
          })(),
          scale,
        ),
        date,
        paymentReference: order.posReference,
        settlementKind: method.settlementKind ?? 'liquidity',
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
  difference: unknown,
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
    const currency = await currencyOf(ctx)
    const scale = scaleOf(currency)
    const signed = moneyMinor(difference, scale)
    const amount = signed < 0n ? -signed : signed
    const zero = minorText(0n, scale)
    const amountText = minorText(amount, scale)
    await ctx.tx(async (tx) => {
      const move: Row = {
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
        currency,
        amountUntaxed: amountText,
        amountTax: zero,
        amountTotal: amountText,
        postedAt: null,
        revision: 0,
      }
      const lines: Row[] = [
        {
          id: `${moveId}:cash`,
          moveId,
          name: method.name,
          accountId: journal.defaultAccountId,
          partnerId: null,
          productId: null,
          productUomId: null,
          quantity: '1',
          priceUnit: amountText,
          discount: '0',
          taxId: null,
          debit: signed > 0n ? amountText : zero,
          credit: signed < 0n ? amountText : zero,
          balance: minorText(signed, scale),
          dateMaturity: null,
          displayType: null,
          reconciled: false,
          amountResidual: zero,
          sequence: 10,
        },
        {
          id: `${moveId}:clearing`,
          moveId,
          name: 'Cash over/short',
          accountId: config.cashOverShortAccountId,
          partnerId: null,
          productId: null,
          productUomId: null,
          quantity: '1',
          priceUnit: amountText,
          discount: '0',
          taxId: null,
          debit: signed < 0n ? amountText : zero,
          credit: signed > 0n ? amountText : zero,
          balance: minorText(-signed, scale),
          dateMaturity: null,
          displayType: null,
          reconciled: false,
          amountResidual: zero,
          sequence: 20,
        },
      ]
      await insertDraftMove(tx, { move, lines })
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
  'write:pos.AuditEvent',
] as const

export const functions: Record<string, FnSpec> = {
  listAuditEvents: defineFn({
    input: {
      subjectType: 'text?',
      subjectId: 'text?',
      configId: 'id?',
      sessionId: 'id?',
      action: 'text?',
      from: 'datetime?',
      to: 'datetime?',
      limit: 'int?',
    },
    effects: ['read:pos.AuditEvent'],
    agent: true,
    handler: async (ctx, args) => {
      const event = ctx.table('pos.AuditEvent')
      const filters = [
        ...(args.subjectType ? [eq(event.subjectType, args.subjectType)] : []),
        ...(args.subjectId ? [eq(event.subjectId, args.subjectId)] : []),
        ...(args.configId ? [eq(event.configId, args.configId)] : []),
        ...(args.sessionId ? [eq(event.sessionId, args.sessionId)] : []),
        ...(args.action ? [eq(event.action, args.action)] : []),
        ...(args.from ? [gte(event.occurredAt, args.from)] : []),
        ...(args.to ? [lt(event.occurredAt, args.to)] : []),
      ]
      const base = from(event)
        .orderBy(desc(event.occurredAt), desc(event.id))
        .limit(Math.max(1, Math.min(200, Math.trunc(n(args.limit ?? 100)) || 100)))
      return ctx.db.all(filters.length ? base.where(and(...filters)) : base)
    },
  }),
  operationsReport: defineFn({
    input: { dateFrom: 'date', dateTo: 'date', configId: 'id?', auditLimit: 'int?' },
    output: { ok: 'bool', report: 'json?', errors: 'json?' },
    effects: [
      'read:pos.Config',
      'read:pos.Order',
      'read:pos.Payment',
      'read:pos.CashMovement',
      'read:pos.AuditEvent',
      'read:company.Company',
    ],
    agent: true,
    handler: async (ctx, args) => {
      const ledger = await ledgerOf(ctx)
      const window = operationsWindow(args.dateFrom, args.dateTo, ledger.timezone)
      if (window.ok !== true) return window
      if (args.configId && !(await ctx.db.select('pos.Config', { id: args.configId }))[0])
        return invalid('configId', 'point of sale configuration does not exist')

      const order = ctx.table('pos.Order')
      const payment = ctx.table('pos.Payment')
      const movement = ctx.table('pos.CashMovement')
      const event = ctx.table('pos.AuditEvent')
      const orderScope = args.configId ? [eq(order.configId, args.configId)] : []
      const financialOrderBase = from(order).where(
        inArray(order.state, ['paid', 'done']),
        or(
          and(gte(order.finalizedAt, window.from), lt(order.finalizedAt, window.to)),
          and(isNull(order.finalizedAt), gte(order.dateOrder, window.from), lt(order.dateOrder, window.to)),
        ),
        ...orderScope,
      )
      const missingFinalizedAt = from(order).where(
        inArray(order.state, ['paid', 'done']),
        isNull(order.finalizedAt),
        ...(args.configId ? [eq(order.configId, args.configId)] : []),
      )
      const paymentWindow = from(payment).where(
        gte(payment.paymentDate, window.from),
        lt(payment.paymentDate, window.to),
      )
      const paymentBase = args.configId
        ? paymentWindow.where(eq(payment.configId, args.configId))
        : paymentWindow
      const movementWindow = from(movement).where(
        gte(movement.occurredAt, window.from),
        lt(movement.occurredAt, window.to),
      )
      const movementBase = args.configId
        ? movementWindow.where(eq(movement.configId, args.configId))
        : movementWindow
      const auditWindow = from(event).where(
        gte(event.occurredAt, window.from),
        lt(event.occurredAt, window.to),
      )
      const auditBase = args.configId ? auditWindow.where(eq(event.configId, args.configId)) : auditWindow
      const auditLimit = Math.max(1, Math.min(200, Math.trunc(n(args.auditLimit ?? 100)) || 100))
      const [
        orderGroups,
        paymentGroups,
        movementGroups,
        auditGroups,
        auditRows,
        missingPaymentScope,
        missingPaymentCurrency,
        missingMovementScope,
        missingAuditScope,
        missingOrderFinalizedAt,
        auditTotal,
        auditTraceGaps,
      ] = await Promise.all([
        ctx.db.group(
          financialOrderBase
            .groupBy({ col: order.isRefund }, { col: order.currency })
            .aggregate({ fn: 'sum', col: order.amountTotal, as: 'amount' }),
        ),
        ctx.db.group(
          paymentBase
            .groupBy({ col: payment.state }, { col: payment.kind }, { col: payment.currency })
            .aggregate({ fn: 'sum', col: payment.appliedAmount, as: 'amount' }),
        ),
        ctx.db.group(
          movementBase
            .groupBy({ col: movement.direction })
            .aggregate({ fn: 'sum', col: movement.amount, as: 'amount' }),
        ),
        ctx.db.group(auditBase.groupBy({ col: event.action })),
        ctx.db.all(auditBase.orderBy(desc(event.occurredAt), desc(event.id)).limit(auditLimit + 1)),
        ctx.db.count(paymentWindow.where(isNull(payment.configId))),
        ctx.db.count(paymentWindow.where(isNull(payment.currency))),
        ctx.db.count(movementWindow.where(isNull(movement.configId))),
        ctx.db.count(auditWindow.where(isNull(event.configId))),
        ctx.db.count(missingFinalizedAt),
        ctx.db.count(auditBase),
        ctx.db.count(auditBase.where(isNull(event.correlationHash))),
      ])
      const currency = ledger.currency

      const orderCurrencies = new Map<
        string,
        { currency: string; sales: string[]; refunds: string[]; saleCount: number; returnCount: number }
      >()
      for (const group of orderGroups) {
        const [isRefund, heldCurrency] = group.key
        const code = String(heldCurrency)
        const current = orderCurrencies.get(code) ?? {
          currency: code,
          sales: [],
          refunds: [],
          saleCount: 0,
          returnCount: 0,
        }
        if (isRefund === true) {
          current.refunds.push(aggregateDecimal(group.aggregates.amount))
          current.returnCount += group.count
        } else {
          current.sales.push(aggregateDecimal(group.aggregates.amount))
          current.saleCount += group.count
        }
        orderCurrencies.set(code, current)
      }
      const sales = [...orderCurrencies.values()].map((row) => {
        const scale = scaleOf(row.currency)
        const gross = sumMoneyMinor(row.sales, scale)
        const refunds = sumMoneyMinor(row.refunds, scale)
        return {
          currency: row.currency,
          saleCount: row.saleCount,
          returnCount: row.returnCount,
          grossSales: minorText(gross, scale),
          refunds: minorText(refunds, scale),
          netSales: minorText(gross + refunds, scale),
        }
      })
      const tenderMap = new Map<
        string,
        { state: string; kind: string; currency: string; count: number; amount: bigint }
      >()
      for (const group of paymentGroups) {
        const state = String(group.key[0])
        const kind = String(group.key[1])
        const code = group.key[2] == null ? currency : String(group.key[2])
        const key = `${state}\0${kind}\0${code}`
        const held = tenderMap.get(key) ?? { state, kind, currency: code, count: 0, amount: 0n }
        held.count += group.count
        held.amount += moneyMinor(aggregateDecimal(group.aggregates.amount), scaleOf(code))
        tenderMap.set(key, held)
      }
      const tenders = [...tenderMap.values()].map((row) => ({
        state: row.state,
        kind: row.kind,
        currency: row.currency,
        count: row.count,
        amount: minorText(row.amount, scaleOf(row.currency)),
      }))
      const cashScale = scaleOf(currency)
      let cashIn = 0n
      let cashOut = 0n
      let cashCount = 0
      for (const group of movementGroups) {
        const amount = moneyMinor(aggregateDecimal(group.aggregates.amount), cashScale)
        cashCount += group.count
        if (group.key[0] === 'in') cashIn += amount
        else if (group.key[0] === 'out') cashOut += amount
      }
      const actions = Object.fromEntries(auditGroups.map((group) => [String(group.key[0]), group.count]))
      const unscopedAudit = args.configId ? missingAuditScope : 0
      const coreAuditTotal = auditTotal + unscopedAudit
      const coreTraceGaps = auditTraceGaps + unscopedAudit
      const traceRatio = coreAuditTotal
        ? Number(((coreAuditTotal - coreTraceGaps) / coreAuditTotal).toFixed(6))
        : 1
      return {
        ok: true,
        report: {
          scope: {
            companyId: String(ctx.scope.company ?? ''),
            configId: args.configId ?? null,
            dateFrom: String(args.dateFrom),
            dateTo: String(args.dateTo),
            from: window.from,
            toExclusive: window.to,
            timezone: ledger.timezone,
          },
          scopeCoverage: {
            complete:
              missingPaymentScope === 0 &&
              missingPaymentCurrency === 0 &&
              missingMovementScope === 0 &&
              missingAuditScope === 0 &&
              missingOrderFinalizedAt === 0 &&
              coreTraceGaps === 0,
            missingPaymentScope,
            missingPaymentCurrency,
            missingMovementScope,
            missingAuditScope,
            missingOrderFinalizedAt,
            missingAuditCorrelation: coreTraceGaps,
          },
          orders: { sales, cancelledCount: actions['order.cancelled'] ?? 0 },
          tenders,
          cash: {
            currency,
            count: cashCount,
            cashIn: minorText(cashIn, cashScale),
            cashOut: minorText(cashOut, cashScale),
            net: minorText(cashIn - cashOut, cashScale),
          },
          shifts: {
            opened: actions['session.opened'] ?? 0,
            closed: actions['session.closed'] ?? 0,
            variancePending: actions['session.variance_pending'] ?? 0,
            varianceApproved: actions['session.variance_approved'] ?? 0,
          },
          exceptions: {
            cancelledOrders: actions['order.cancelled'] ?? 0,
            voidedTenders: actions['payment.voided'] ?? 0,
            reversedCashMovements: actions['cash_movement.reversed'] ?? 0,
            pendingVariances: actions['session.variance_pending'] ?? 0,
          },
          observability: {
            metrics: {
              auditEventTotal: coreAuditTotal,
              exceptionTotal:
                (actions['order.cancelled'] ?? 0) +
                (actions['payment.voided'] ?? 0) +
                (actions['cash_movement.reversed'] ?? 0) +
                (actions['session.variance_pending'] ?? 0),
            },
            traceCoverage: { coreAuditTotal, coreTraceGaps, ratio: traceRatio },
            alerts: coreTraceGaps
              ? [{ code: 'core_trace_gap', severity: 'warning', count: coreTraceGaps }]
              : [],
          },
          audit: {
            events: auditRows.slice(0, auditLimit).map(projectedAudit),
            limit: auditLimit,
            truncated: auditRows.length > auditLimit,
          },
        },
      }
    },
  }),
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
      if (compareDecimals(args.cashRoundingIncrement ?? '0', '0') !== 0)
        return invalid('cashRoundingIncrement', 'cash rounding is modeled but disabled for the pilot')
      if (compareDecimals(args.maximumDifference ?? '0', '0') < 0)
        return invalid('maximumDifference', 'maximum cash difference cannot be negative')
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
    input: { id: 'id', name: 'text', journalId: 'id', settlementKind: 'text?', isCash: 'bool?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:pos.PaymentMethod',
      'write:pos.PaymentMethod',
      'read:account.Journal',
      'read:account.Account',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const journal = (await ctx.db.select('account.Journal', { id: args.journalId }))[0]
      const settlementKind = String(args.settlementKind ?? 'liquidity')
      if (!POS_PAYMENT_SETTLEMENT_KINDS.includes(settlementKind as never))
        return invalid('settlementKind', 'settlement kind must be liquidity or stored value')
      if (!journal?.defaultAccountId)
        return invalid('journalId', 'payment method requires a journal with a default account')
      const settlementAccount = (await ctx.db.select('account.Account', { id: journal.defaultAccountId }))[0]
      if (settlementKind === 'liquidity' && !['cash', 'bank'].includes(String(journal.type)))
        return invalid('journalId', 'liquidity payment method requires a cash or bank journal')
      if (
        settlementKind === 'stored_value' &&
        (String(journal.type) !== 'general' ||
          !String(settlementAccount?.accountType ?? '').startsWith('liability'))
      )
        return invalid('journalId', 'stored value payment method requires a general liability journal')
      if (settlementKind === 'stored_value' && args.isCash === true)
        return invalid('isCash', 'stored value cannot be counted as cash')
      const existing = (await ctx.db.select('pos.PaymentMethod', { id: args.id }))[0],
        values = {
          name: args.name,
          journalId: args.journalId,
          settlementKind,
          isCash: settlementKind === 'liquidity' && Boolean(args.isCash),
          active: true,
        }
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
      'read:company.Company',
    ],
    agent: true,
    handler: async (ctx, args) => {
      const session = (await ctx.db.select('pos.Session', { id: args.id }))[0]
      if (!session) return null
      const orders = await ctx.db.select('pos.Order', { sessionId: args.id })
      const scale = scaleOf(await currencyOf(ctx))
      const expectedCash = await sessionCashMinor(ctx, session, scale)
      const cashMovements = await ctx.db.select('pos.CashMovement', { sessionId: args.id })
      return { ...session, cashRegisterBalanceEnd: minorText(expectedCash, scale), orders, cashMovements }
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
      'read:company.Company',
      'write:pos.AuditEvent',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const scale = scaleOf(await currencyOf(ctx))
      const openingCash = moneyMinor(args.openingCash ?? '0', scale)
      const existing = (await ctx.db.select('pos.Session', { id: args.id }))[0]
      if (existing) {
        const same =
          existing.configId === args.configId &&
          existing.userId === args.userId &&
          (args.deviceId === undefined || existing.deviceId === args.deviceId) &&
          (args.openingCash === undefined ||
            moneyMinor(existing.cashRegisterBalanceStart, scale) === openingCash) &&
          (args.openingNotes === undefined || existing.openingNotes === args.openingNotes)
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
        cashRegisterBalanceStart: minorText(openingCash, scale),
        cashRegisterBalanceEnd: minorText(openingCash, scale),
        cashRegisterBalanceEndReal: minorText(openingCash, scale),
        cashRegisterDifference: minorText(0n, scale),
        varianceStatus: 'none',
        varianceReason: null,
        varianceNote: null,
        varianceApprovedBy: null,
        varianceApprovedAt: null,
        cashAdjustmentId: null,
        revision: 0,
      })
      await appendAudit(ctx, {
        id: `session:${String(args.id)}:created`,
        subjectType: 'session',
        subjectId: String(args.id),
        configId: args.configId,
        sessionId: args.id,
        action: 'session.created',
        actorId: args.userId,
        deviceId: args.deviceId,
        details: { configId: args.configId, openingCash: minorText(openingCash, scale) },
      })
      return { ok: true, id: args.id, revision: 0 }
    },
  }),
  openSession: defineFn({
    input: { id: 'id', expectedRevision: 'int?' },
    output: { ok: 'bool', id: 'id?', revision: 'int?', errors: 'json?' },
    effects: ['read:pos.Session', 'write:pos.Session', 'write:pos.AuditEvent'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const held = (await ctx.db.select('pos.Session', { id: args.id }))[0]
      if (held?.state === 'opened') return { ok: true, id: args.id, revision: n(held.revision) }
      if (held?.state !== 'opening_control') return invalid('state', 'only opening control can be opened')
      const claim = await claimSessionRevision(ctx, args.id, args.expectedRevision)
      if (claim.ok !== true) return claim
      await ctx.db.update('pos.Session', { id: args.id }, { state: 'opened', startAt: held.startAt ?? now() })
      await appendAudit(ctx, {
        id: `session:${String(args.id)}:opened`,
        subjectType: 'session',
        subjectId: String(args.id),
        configId: held.configId,
        sessionId: args.id,
        action: 'session.opened',
        actorId: held.userId,
        deviceId: held.deviceId,
        details: { revision: claim.revision },
      })
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
    effects: [
      'read:pos.Session',
      'write:pos.Session',
      'read:pos.CashMovement',
      'write:pos.CashMovement',
      'read:company.Company',
      'write:pos.AuditEvent',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      if (!['in', 'out'].includes(String(args.direction)))
        return invalid('direction', 'cash movement direction must be in or out')
      if (!String(args.reason).trim()) return invalid('reason', 'cash movement requires a reason')
      const session = (await ctx.db.select('pos.Session', { id: args.sessionId }))[0]
      if (session?.state !== 'opened') return invalid('state', 'cash movement requires an open shift')
      const scale = scaleOf(await currencyOf(ctx))
      const amount = moneyMinor(args.amount, scale)
      if (amount <= 0n) return invalid('amount', 'cash movement amount must be positive')
      const existing = (await ctx.db.select('pos.CashMovement', { id: args.id }))[0]
      if (existing) {
        const same =
          existing.sessionId === args.sessionId &&
          existing.direction === args.direction &&
          moneyMinor(existing.amount, scale) === amount
        return same
          ? { ok: true, id: args.id, revision: n(session.revision) }
          : invalid('id', 'cash movement id is already used by a different command')
      }
      const claim = await claimSessionRevision(ctx, args.sessionId, args.expectedRevision)
      if (claim.ok !== true) return claim
      await ctx.db.insert('pos.CashMovement', {
        id: args.id,
        sessionId: args.sessionId,
        configId: session.configId,
        direction: args.direction,
        amount: minorText(amount, scale),
        reason: String(args.reason),
        note: args.note ?? null,
        actorId: args.actorId,
        deviceId: args.deviceId ?? null,
        occurredAt: now(),
        reversalOfId: null,
      })
      await appendAudit(ctx, {
        id: `cash-movement:${String(args.id)}:recorded`,
        subjectType: 'cash_movement',
        subjectId: String(args.id),
        configId: session.configId,
        sessionId: args.sessionId,
        action: 'cash_movement.recorded',
        actorId: args.actorId,
        deviceId: args.deviceId,
        reason: args.reason,
        relatedId: args.sessionId,
        details: { direction: args.direction, amount: minorText(amount, scale), revision: claim.revision },
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
    effects: [
      'read:pos.Session',
      'write:pos.Session',
      'read:pos.CashMovement',
      'write:pos.CashMovement',
      'write:pos.AuditEvent',
    ],
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
        configId: session.configId,
        direction: original.direction === 'in' ? 'out' : 'in',
        amount: original.amount,
        reason: String(args.reason),
        note: args.note ?? null,
        actorId: args.actorId,
        deviceId: args.deviceId ?? null,
        occurredAt: now(),
        reversalOfId: original.id,
      })
      await appendAudit(ctx, {
        id: `cash-movement:${String(args.id)}:reversed`,
        subjectType: 'cash_movement',
        subjectId: String(args.id),
        configId: session.configId,
        sessionId: args.sessionId,
        action: 'cash_movement.reversed',
        actorId: args.actorId,
        deviceId: args.deviceId,
        reason: args.reason,
        relatedId: original.id,
        details: { sessionId: args.sessionId, amount: original.amount, revision: claim.revision },
      })
      return { ok: true, id: args.id, revision: claim.revision }
    },
  }),
  startClosing: defineFn({
    input: { id: 'id', expectedRevision: 'int?' },
    output: { ok: 'bool', id: 'id?', revision: 'int?', errors: 'json?' },
    effects: ['read:pos.Session', 'read:pos.Order', 'write:pos.Session', 'write:pos.AuditEvent'],
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
      await appendAudit(ctx, {
        id: `session:${String(args.id)}:closing`,
        subjectType: 'session',
        subjectId: String(args.id),
        configId: session.configId,
        sessionId: args.id,
        action: 'session.closing_started',
        actorId: session.userId,
        deviceId: session.deviceId,
        details: { revision: claim.revision },
      })
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
      'read:company.Company',
      'write:pos.AuditEvent',
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
      const scale = scaleOf(await currencyOf(ctx))
      const cash = await sessionCashMinor(ctx, session, scale)
      const closingCash = moneyMinor(args.closingCash, scale)
      const difference = closingCash - cash
      const maximumDifference = moneyMinor(config.maximumDifference ?? '0', scale)
      const pendingApproval = absoluteMinor(difference) > maximumDifference
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
          cashRegisterBalanceEnd: minorText(cash, scale),
          cashRegisterBalanceEndReal: minorText(closingCash, scale),
          cashRegisterDifference: minorText(difference, scale),
          varianceStatus: pendingApproval ? 'pending' : 'none',
          varianceReason: pendingApproval ? String(args.varianceReason) : null,
          varianceNote: pendingApproval ? (args.varianceNote ?? null) : null,
        },
      )
      await appendAudit(ctx, {
        id: `session:${String(args.id)}:sealed`,
        subjectType: 'session',
        subjectId: String(args.id),
        configId: session.configId,
        sessionId: args.id,
        action: pendingApproval ? 'session.variance_pending' : 'session.closed',
        actorId: session.userId,
        deviceId: session.deviceId,
        reason: pendingApproval ? args.varianceReason : undefined,
        details: {
          expectedCash: minorText(cash, scale),
          countedCash: minorText(closingCash, scale),
          difference: minorText(difference, scale),
          revision: claim.revision,
        },
      })
      return {
        ok: true,
        id: args.id,
        revision: claim.revision,
        difference: minorText(difference, scale),
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
    effects: [
      'read:pos.Session',
      'write:pos.Session',
      'read:pos.Config',
      'read:company.Company',
      'write:pos.AuditEvent',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const session = (await ctx.db.select('pos.Session', { id: args.id }))[0]
      if (session?.state !== 'pending_approval')
        return invalid('state', 'only a sealed variance can be recounted')
      const config = (await ctx.db.select('pos.Config', { id: session.configId }))[0]!
      const scale = scaleOf(await currencyOf(ctx))
      const countedCash = moneyMinor(args.countedCash, scale)
      const difference = countedCash - moneyMinor(session.cashRegisterBalanceEnd, scale)
      const maximumDifference = moneyMinor(config.maximumDifference ?? '0', scale)
      const pendingApproval = absoluteMinor(difference) > maximumDifference
      const claim = await claimSessionRevision(ctx, args.id, args.expectedRevision)
      if (claim.ok !== true) return claim
      await ctx.db.update(
        'pos.Session',
        { id: args.id },
        {
          state: pendingApproval ? 'pending_approval' : 'closed',
          cashRegisterBalanceEndReal: minorText(countedCash, scale),
          cashRegisterDifference: minorText(difference, scale),
          varianceStatus: pendingApproval ? 'pending' : 'corrected',
          varianceNote: args.note ?? session.varianceNote ?? null,
          varianceApprovedBy: pendingApproval ? null : args.reviewedBy,
          varianceApprovedAt: pendingApproval ? null : now(),
        },
      )
      await appendAudit(ctx, {
        id: `session:${String(args.id)}:recount:${String(claim.revision)}`,
        subjectType: 'session',
        subjectId: String(args.id),
        configId: session.configId,
        sessionId: args.id,
        action: pendingApproval ? 'session.recount_pending' : 'session.recount_accepted',
        actorId: args.reviewedBy,
        deviceId: session.deviceId,
        reason: args.note,
        details: {
          countedCash: minorText(countedCash, scale),
          difference: minorText(difference, scale),
          revision: claim.revision,
        },
      })
      return {
        ok: true,
        id: args.id,
        revision: claim.revision,
        difference: minorText(difference, scale),
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
      'write:pos.AuditEvent',
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
          session.cashRegisterDifference,
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
      await appendAudit(ctx, {
        id: `session:${String(args.id)}:variance-approved`,
        subjectType: 'session',
        subjectId: String(args.id),
        configId: session.configId,
        sessionId: args.id,
        action: 'session.variance_approved',
        actorId: args.approvedBy,
        deviceId: session.deviceId,
        reason: args.note ?? session.varianceReason,
        relatedId: adjustmentId,
        details: {
          difference: session.cashRegisterDifference,
          accountMoveId,
          revision: claim.revision,
        },
      })
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
  getReceipt: defineFn({
    input: { orderId: 'id' },
    effects: ['read:pos.Order', 'read:pos.ReceiptDocument'],
    agent: true,
    handler: async (ctx, args) => {
      const order = (await ctx.db.select('pos.Order', { id: args.orderId }))[0]
      if (!order || !['paid', 'done'].includes(String(order.state)) || !order.receiptId) return null
      const receipt = (await ctx.db.select('pos.ReceiptDocument', { id: order.receiptId }))[0]
      return receipt?.orderId === order.id ? receipt : null
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
      if (compareDecimals(args.qty, '0') <= 0) return invalid('qty', 'quantity must be positive')
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
      if (
        compareDecimals(discount, '0') < 0 ||
        compareDecimals(discount, '100') > 0 ||
        compareDecimals(priceUnit, '0') < 0
      )
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
          compareDecimals(existing.qty, args.qty) === 0 &&
          compareDecimals(existing.priceUnit, priceUnit) === 0 &&
          compareDecimals(existing.discount, discount) === 0 &&
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
      'write:pos.AuditEvent',
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
      if (compareDecimals(args.qty, '0') <= 0) return invalid('qty', 'quantity must be positive')
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
      if (
        compareDecimals(discount, '0') < 0 ||
        compareDecimals(discount, '100') > 0 ||
        compareDecimals(priceUnit, '0') < 0
      )
        return invalid('discount', 'price and discount are invalid')
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
      if (args.priceUnit !== undefined || args.discount !== undefined)
        await appendAudit(ctx, {
          id: `order-line:${String(args.id)}:adjusted:${String(claim.revision)}`,
          subjectType: 'order',
          subjectId: String(args.orderId),
          configId: order.configId,
          sessionId: order.sessionId,
          action: 'order.line_adjusted',
          actorId: args.overrideBy,
          deviceId: order.deviceId,
          reason: args.overrideReason,
          relatedId: args.id,
          details: {
            previousPriceUnit: line.priceUnit,
            priceUnit: String(priceUnit),
            previousDiscount: line.discount,
            discount: String(discount),
            revision: claim.revision,
          },
        })
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
      const scale = scaleOf(order.currency)
      let tendered: bigint
      try {
        tendered = moneyMinor(args.tenderedAmount ?? args.amount, scale)
      } catch {
        return invalid('tenderedAmount', 'payment must be a valid monetary amount')
      }
      if ((order.isRefund && tendered >= 0n) || (!order.isRefund && tendered <= 0n))
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
          moneyMinor(existing.tenderedAmount ?? existing.amount, scale) === tendered &&
          String(existing.reference ?? '') === String(args.reference ?? '')
        return same
          ? {
              ok: true,
              id: args.id,
              revision: n(order.revision),
              appliedAmount: existing.appliedAmount ?? existing.amount,
              change: minorText(
                moneyMinor(existing.tenderedAmount ?? existing.amount, scale) -
                  moneyMinor(existing.appliedAmount ?? existing.amount, scale),
                scale,
              ),
            }
          : invalid('id', 'tender id is already used by a different command')
      }
      const captured = (await ctx.db.select('pos.Payment', { orderId: args.orderId })).filter(
        (payment) => (payment.state ?? 'captured') === 'captured',
      )
      const capturedAmount = captured.reduce(
        (sum, payment) => sum + absoluteMinor(moneyMinor(payment.appliedAmount ?? payment.amount, scale)),
        0n,
      )
      const payable = absoluteMinor(moneyMinor(order.amountTotal, scale))
      const remaining = payable > capturedAmount ? payable - capturedAmount : 0n
      if (remaining === 0n) return invalid('amount', 'the order is already fully covered')
      const tenderedAbsolute = absoluteMinor(tendered)
      if (!method.isCash && tenderedAbsolute > remaining)
        return invalid('tenderedAmount', 'manual non-cash tender cannot exceed the remaining payable')
      const appliedAbsolute = method.isCash && tenderedAbsolute > remaining ? remaining : tenderedAbsolute
      const direction = order.isRefund ? -1n : 1n
      const applied = direction * appliedAbsolute
      const claim = await claimDraftRevision(ctx, args.orderId, args.expectedRevision)
      if (claim.ok !== true) return claim
      await ctx.db.insert('pos.Payment', {
        id: args.id,
        orderId: args.orderId,
        configId: order.configId,
        sessionId: order.sessionId,
        paymentMethodId: args.paymentMethodId,
        currency: order.currency,
        amount: minorText(applied, scale),
        tenderedAmount: minorText(tendered, scale),
        appliedAmount: minorText(applied, scale),
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
        appliedAmount: minorText(applied, scale),
        change: minorText(tendered - applied, scale),
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
          if (reservation.state === 'locked' && String(order.paymentLockId ?? '') !== attemptId)
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
        const unresolved = (await tx.db.select('pos.ProviderPaymentLock', { orderId: order.id })).find(
          (lock) => ['locked', 'needs_review', 'reversing', 'finalizing'].includes(String(lock.state)),
        )
        if (unresolved)
          return invalid('providerAttemptId', 'order has an unresolved external payment attempt')
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
        if (remaining <= 0.000001 || Math.abs(amount) > remaining + 0.000001)
          return invalid('amount', 'provider attempt exceeds the remaining payable')
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
            (winner.state !== 'locked' || String(currentOrder?.paymentLockId ?? '') === attemptId)
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
        if (Math.abs(amount) > remaining + 0.000001)
          return invalid('amount', 'provider settlement exceeds the remaining payable')
        const claim = await claimDraftRevision(tx, args.orderId, args.expectedRevision)
        if (claim.ok !== true) {
          const converged = await providerSettlementReplay(tx, args)
          return converged?.ok === true ? converged : claim
        }
        await tx.db.insert('pos.Payment', {
          id: args.id,
          orderId: args.orderId,
          configId: order.configId,
          sessionId: order.sessionId,
          paymentMethodId: args.paymentMethodId,
          currency: order.currency,
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
          !reservation ||
          reservation.orderId !== order.id ||
          reservation.paymentMethodId !== payment?.paymentMethodId ||
          n(reservation.amount) !== n(payment?.appliedAmount ?? payment?.amount) ||
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
            String(order.paymentLockId ?? '') !== attemptId
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
        const otherUnresolved = (
          await tx.db.select('pos.ProviderPaymentLock', { orderId: args.orderId })
        ).find(
          (lock) =>
            String(lock.id) !== attemptId &&
            ['locked', 'needs_review', 'reversing', 'finalizing'].includes(String(lock.state)),
        )
        if (
          original.state !== 'captured' ||
          otherUnresolved ||
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
          configId: order.configId,
          sessionId: order.sessionId,
          paymentMethodId: original.paymentMethodId,
          currency: order.currency,
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
        if (String(order.paymentLockId ?? '') === attemptId)
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
      'write:pos.AuditEvent',
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
      await appendAudit(ctx, {
        id: `payment:${String(args.id)}:voided`,
        subjectType: 'payment',
        subjectId: String(args.id),
        configId: order.configId,
        sessionId: order.sessionId,
        action: 'payment.voided',
        actorId: args.operatorId,
        deviceId: payment.deviceId ?? order.deviceId,
        reason: args.reason,
        relatedId: args.orderId,
        details: { amount: payment.appliedAmount ?? payment.amount, revision: claim.revision },
      })
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
      receiptId: 'id?',
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
      'read:pos.ReceiptDocument',
      'write:pos.ReceiptDocument',
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
      'write:pos.AuditEvent',
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
          receiptId: order.receiptId,
          revision: n(order.revision),
        }
      if (order.state !== 'draft') return invalid('state', 'only a new order can be paid')
      const providerMembership = await providerFinalizationLocks(ctx, order)
      if (providerMembership.ok !== true) return providerMembership
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
      const scale = scaleOf(order.currency)
      if (moneyMinor(order.amountPaid, scale) !== moneyMinor(order.amountTotal, scale))
        return invalid('amountPaid', 'paid amount must equal order total')
      const config = (await ctx.db.select('pos.Config', { id: order.configId }))[0]!
      if (moneyMinor(order.amountTax, scale) !== 0n && !config.taxAccountId)
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
      const claim = providerMembership.locks.length
        ? await claimProviderFinalization(ctx, args.id, args.expectedRevision)
        : await claimDraftRevision(ctx, args.id, args.expectedRevision)
      if (claim.ok !== true) return claim
      const providerLeases = ('leases' in claim ? claim.leases : []) as Array<{
        id: string
        token: string
      }>
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
          const pickingTypeId = `${String(config.warehouseId)}:${suffix}`
          const completedPicking = (await ctx.db.select('stock.Picking', { id: pickingId }))[0]
          if (completedPicking?.state === 'done') {
            const completedMoves = await ctx.db.select('stock.Move', { pickingId })
            let matches =
              completedPicking.pickingTypeId === pickingTypeId && completedMoves.length === goods.length
            for (const line of goods) {
              const moveId = `${String(line.id)}:move`
              const based = await toProductUnit(ctx, line.productId, line.productUomId, Math.abs(n(line.qty)))
              const move = completedMoves.find((candidate) => candidate.id === moveId)
              matches =
                matches &&
                based !== null &&
                move?.state === 'done' &&
                move.productId === line.productId &&
                move.productUomId === based.uomId &&
                move.posLineId === line.id &&
                move.origin === order.posReference &&
                Math.abs(n(move.productUomQty) - based.quantity) <= 0.000001
            }
            if (!matches)
              return invalid('pickingId', 'completed stock transfer does not match this order retry')
          } else {
            const created = (await stockFunctions.createPicking!.handler(ctx, {
              id: pickingId,
              name: `${order.isRefund ? 'Refund' : 'POS'} ${String(order.posReference)}`,
              pickingTypeId,
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
                const based = await toProductUnit(
                  ctx,
                  line.productId,
                  line.productUomId,
                  Math.abs(n(line.qty)),
                )
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
                const based = await toProductUnit(
                  ctx,
                  line.productId,
                  line.productUomId,
                  Math.abs(n(line.qty)),
                )
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
        }
        let accountMoveId: string
        try {
          accountMoveId = await createAccounting(ctx, effectiveOrder, config, lines, payments)
        } catch (error) {
          return invalid('accounting', (error as Error).message)
        }
        const receiptId = `${String(order.id)}:receipt:v1`
        const issuedAt = now()
        const receiptDocument = await receiptDocumentFor(
          ctx,
          effectiveOrder,
          config,
          session,
          partner,
          lines,
          payments,
          accountMoveId,
          issuedAt,
        )
        const contentHash = receiptHash(receiptDocument)
        await ctx.tx(async (tx) => {
          const inserted = await tx.db.insertIfAbsent('pos.ReceiptDocument', {
            id: receiptId,
            orderId: args.id,
            version: 1,
            templateVersion: 'pos-receipt-v1',
            contentHash,
            document: receiptDocument,
            issuedAt,
          })
          if (!('dryRun' in inserted) && !inserted.inserted) {
            const existing = (await tx.db.select('pos.ReceiptDocument', { id: receiptId }))[0]
            if (
              existing?.orderId !== args.id ||
              n(existing.version) !== 1 ||
              existing.templateVersion !== 'pos-receipt-v1' ||
              existing.contentHash !== contentHash
            )
              throw new Error('receipt identity is already bound to different content')
          }
          for (const lease of providerLeases) {
            const finalized = await tx.db.compareAndSet(
              'pos.ProviderPaymentLock',
              { id: lease.id },
              { state: 'finalizing', updatedAt: lease.token },
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
              finalizedAt: issuedAt,
              invoiceStatus: 'invoiced',
              pickingId,
              accountMoveId,
              receiptId,
            },
          )
          await appendAudit(tx, {
            id: `order:${String(args.id)}:finalized`,
            subjectType: 'order',
            subjectId: String(args.id),
            configId: order.configId,
            sessionId: order.sessionId,
            action: order.isRefund ? 'order.refund_finalized' : 'order.finalized',
            actorId: order.operatorId ?? session.userId,
            deviceId: order.deviceId ?? session.deviceId,
            relatedId: receiptId,
            details: {
              amountTotal: order.amountTotal,
              accountMoveId,
              pickingId,
              receiptId,
              revision: claim.revision,
            },
          })
        })
        finalizationCommitted = true
        return {
          ok: true,
          id: args.id,
          state: 'paid',
          revision: claim.revision,
          ...(pickingId ? { pickingId } : {}),
          accountMoveId,
          receiptId,
        }
      } finally {
        if (!finalizationCommitted)
          for (const lease of providerLeases)
            await ctx.db.compareAndSet(
              'pos.ProviderPaymentLock',
              { id: lease.id },
              { state: 'finalizing', updatedAt: lease.token },
              { state: 'needs_review', updatedAt: now() },
            )
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
        await appendAudit(tx, {
          id: `order:${String(args.id)}:refund-created`,
          subjectType: 'order',
          subjectId: String(args.id),
          configId: session.configId,
          sessionId: args.sessionId,
          action: 'order.refund_created',
          actorId: args.operatorId,
          deviceId: args.deviceId ?? session.deviceId,
          reason: args.reason,
          relatedId: original.id,
          details: {
            sessionId: args.sessionId,
            returnComplete: completesReturn,
            returnPortion: decimal(returnPortion),
            originalRevision: claim.revision,
          },
        })
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
        await appendAudit(tx, {
          id: `exchange:${String(args.id)}:created`,
          subjectType: 'exchange',
          subjectId: String(args.id),
          configId: original.configId,
          sessionId: args.sessionId,
          action: 'exchange.created',
          actorId: args.operatorId,
          deviceId: args.deviceId,
          reason,
          relatedId: original.id,
          details: { returnOrderId, replacementOrderId, originalRevision: returned.originalRevision },
          occurredAt: createdAt,
        })
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
    effects: ['read:pos.Order', 'write:pos.Order', 'read:pos.Payment', 'write:pos.AuditEvent'],
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
        await appendAudit(tx, {
          id: `order:${String(args.id)}:cancelled`,
          subjectType: 'order',
          subjectId: String(args.id),
          configId: order.configId,
          sessionId: order.sessionId,
          action: 'order.cancelled',
          actorId: order.operatorId,
          deviceId: order.deviceId,
          relatedId: order.sessionId,
          details: { revision: claim.revision },
        })
        return { ok: true, id: args.id, revision: claim.revision }
      }),
  }),
}
