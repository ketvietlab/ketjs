import { deleteFrom, defineFn, eq } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { evaluate, invalid, issue, n, normalizeCode } from '../loyalty/engine.ts'
import { applyOrderReward, orderFunctions, removeOrderReward } from '../loyalty/order-functions.ts'
import type { OrderSnapshot } from '../loyalty/types.ts'
import { claimDraftRevision, functions as posFunctions } from '../pos/functions.ts'

const effectsOf = (...specs: Array<FnSpec | undefined>): string[] => [
  ...new Set(specs.flatMap((spec) => spec?.effects ?? [])),
]
const money = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100
const decimal = (value: number): string => String(money(value))
const same = (left: unknown, right: unknown): boolean => Math.abs(n(left) - n(right)) <= 0.000001

class AtomicFailure extends Error {
  readonly result: Row

  constructor(result: Row) {
    super('loyalty command rejected')
    this.result = result
  }
}

const atomic = async (ctx: Ctx, body: (tx: Ctx) => Promise<Row>): Promise<Row> => {
  try {
    return await ctx.tx(async (tx) => {
      const result = await body(tx)
      if (result.ok !== true) throw new AtomicFailure(result)
      return result
    })
  } catch (error) {
    if (error instanceof AtomicFailure) return error.result
    throw error
  }
}

export const posSnapshot = async (ctx: Ctx, orderId: string): Promise<OrderSnapshot | null> => {
  const order = (await ctx.db.select('pos.Order', { id: orderId }))[0]
  if (!order) return null
  const config = (await ctx.db.select('pos.Config', { id: order.configId }))[0]
  const [lines, applications] = await Promise.all([
    ctx.db.select('pos.OrderLine', { orderId }),
    ctx.db.select('loyalty.Application', { orderType: 'pos', orderId }),
  ])
  return {
    orderType: 'pos',
    orderId,
    partnerId: order.partnerId == null ? null : String(order.partnerId),
    currency: String(order.currency),
    pricelistId: config?.pricelistId == null ? null : String(config.pricelistId),
    date: String(order.dateOrder),
    codes: applications.map((application) => normalizeCode(application.code)).filter(Boolean),
    lines: lines.map((line) => ({
      id: String(line.id),
      productId: String(line.productId),
      quantity: n(line.qty),
      untaxed: n(line.priceSubtotal),
      total: n(line.priceSubtotalIncl),
      lineKind: String(line.lineKind ?? 'product') as OrderSnapshot['lines'][number]['lineKind'],
    })),
  }
}

const recompute = async (ctx: Ctx, orderId: string) => {
  const lines = await ctx.db.select('pos.OrderLine', { orderId })
  const untaxed = money(lines.reduce((sum, line) => sum + n(line.priceSubtotal), 0))
  const total = money(lines.reduce((sum, line) => sum + n(line.priceSubtotalIncl), 0))
  const paid = money(
    (await ctx.db.select('pos.Payment', { orderId })).reduce((sum, payment) => sum + n(payment.amount), 0),
  )
  await ctx.db.update(
    'pos.Order',
    { id: orderId },
    {
      amountUntaxed: decimal(untaxed),
      amountTax: decimal(total - untaxed),
      amountTotal: decimal(total),
      amountPaid: decimal(paid),
      amountReturn: decimal(paid - total),
    },
  )
}

const removeRewardLines = async (ctx: Ctx, orderId: string, programId?: string) => {
  const L = ctx.table('pos.OrderLine')
  const lines = (await ctx.db.select('pos.OrderLine', { orderId })).filter(
    (line) =>
      line.lineKind === 'reward' &&
      (!programId || String(line.loyaltyApplicationId) === `pos:${orderId}:${programId}`),
  )
  for (const line of lines) await ctx.db.del(deleteFrom(L).where(eq(L.id, line.id)))
  await recompute(ctx, orderId)
}

const materializeReward = async (ctx: Ctx, orderId: string, programId: string, payload: Row) => {
  const order = (await ctx.db.select('pos.Order', { id: orderId }))[0]
  if (!order) return invalid(issue('orderId', 'loyalty.error.state'))
  if (order.state !== 'draft' || order.isRefund) return invalid(issue('orderId', 'loyalty.error.state'))
  const reward = (await ctx.db.select('loyalty.Reward', { id: payload.rewardId }))[0]
  if (!reward) return invalid(issue('rewardId', 'loyalty.error.rewardMissing'))
  const ordinary = (await ctx.db.select('pos.OrderLine', { orderId })).filter(
    (line) => line.lineKind !== 'reward',
  )
  const productId = String(payload.productId ?? reward.lineProductId)
  const product = (await ctx.db.select('product.Product', { id: productId }))[0]
  const template = product && (await ctx.db.select('product.Template', { id: product.templateId }))[0]
  const uomId = template?.uomId ?? ordinary[0]?.productUomId
  if (!product || !uomId) return invalid(issue('rewardId', 'loyalty.error.rewardProduct'))
  await removeRewardLines(ctx, orderId, programId)
  const productReward = payload.rewardType === 'product'
  const quantity = productReward ? n(payload.productQuantity ?? 1) : 1
  const priceUnit = productReward ? 0 : -Math.abs(n(payload.discountAmount))
  await ctx.db.insert('pos.OrderLine', {
    id: `loyalty:${orderId}:${programId}`,
    orderId,
    productId,
    productUomId: uomId,
    name: reward.description,
    qty: decimal(quantity),
    priceUnit: decimal(priceUnit),
    discount: '0',
    taxId: null,
    priceSubtotal: decimal(quantity * priceUnit),
    priceSubtotalIncl: decimal(quantity * priceUnit),
    refundedOrderlineId: null,
    sequence: 9000,
    lineKind: 'reward',
    loyaltyApplicationId: `pos:${orderId}:${programId}`,
    loyaltyRewardId: reward.id,
    loyaltyPointsCost: decimal(n(payload.requiredPoints)),
  })
  await recompute(ctx, orderId)
  return { ok: true }
}

export const preflightOrder = async (ctx: Ctx, orderId: string): Promise<Row> => {
  const snapshot = await posSnapshot(ctx, orderId)
  if (!snapshot) return invalid(issue('orderId', 'loyalty.error.order'))
  const applications = (await ctx.db.select('loyalty.Application', { orderType: 'pos', orderId })).filter(
    (application) => application.state !== 'reversed',
  )
  const codes = applications.map((application) => normalizeCode(application.code)).filter(Boolean)
  const programs = await evaluate(ctx, {
    ...snapshot,
    codes: [...new Set(codes)],
  })
  const lines = await ctx.db.select('pos.OrderLine', { orderId })

  for (const application of applications) {
    const evaluated = await evaluate(
      ctx,
      { ...snapshot, codes: [...new Set(codes)] },
      {
        onlyProgramId: String(application.programId),
        ...(n(application.pointsSpent) > 0 ? { requestedPoints: n(application.pointsSpent) } : {}),
      },
    )
    const program = evaluated[0]
    if (!program) return invalid(issue('programId', 'loyalty.error.ineligible'))
    if (!application.rewardId) continue
    const quote = program.rewards.find((reward) => reward.rewardId === application.rewardId)
    const payload = application.rewardPayload as Row | null
    if (
      !quote ||
      !payload ||
      !same(quote.requiredPoints, application.pointsSpent) ||
      !same(quote.discountAmount, application.discountAmount)
    )
      return invalid(issue('rewardId', 'loyalty.error.ineligible'))
    const rewardLine = lines.find(
      (line) => line.lineKind === 'reward' && line.loyaltyApplicationId === application.id,
    )
    if (!rewardLine) return invalid(issue('rewardId', 'loyalty.error.ineligible'))
    if (quote.rewardType === 'product') {
      if (
        rewardLine.productId !== quote.productId ||
        !same(rewardLine.qty, quote.productQuantity) ||
        !same(rewardLine.priceSubtotalIncl, 0)
      )
        return invalid(issue('rewardId', 'loyalty.error.ineligible'))
    } else if (!same(rewardLine.priceSubtotalIncl, -quote.discountAmount))
      return invalid(issue('rewardId', 'loyalty.error.ineligible'))

    const heldProgram = (await ctx.db.select('loyalty.Program', { id: application.programId }))[0]
    const expectedReservation = Math.max(
      0,
      n(application.pointsSpent) - (heldProgram?.appliesOn === 'future' ? 0 : n(program.points)),
    )
    if (expectedReservation > 0) {
      const reservation = (
        await ctx.db.select('loyalty.Reservation', {
          orderType: 'pos',
          orderId,
          rewardId: application.rewardId,
        })
      )[0]
      const wallet = application.walletId
        ? (await ctx.db.select('loyalty.Wallet', { id: application.walletId }))[0]
        : null
      if (
        application.state !== 'reserved' ||
        reservation?.state !== 'reserved' ||
        !wallet?.active ||
        reservation.walletId !== wallet.id ||
        !same(reservation.amount, expectedReservation)
      )
        return invalid(issue('wallet', 'loyalty.error.concurrent'))
    } else if (application.state === 'reserved') return invalid(issue('wallet', 'loyalty.error.concurrent'))
  }
  return { ok: true, programs }
}

const snapshotEffects = [
  'read:pos.Order',
  'read:pos.Config',
  'read:pos.OrderLine',
  'read:loyalty.Application',
] as const
const materializeEffects = [
  ...snapshotEffects,
  'write:pos.Order',
  'write:pos.OrderLine',
  'read:pos.Payment',
  'read:loyalty.Reward',
  'read:product.Product',
  'read:product.Template',
] as const

export const functions: Record<string, FnSpec> = {
  getOrderState: defineFn({
    input: { orderId: 'id' },
    effects: ['read:pos.Order', 'read:loyalty.Application'],
    agent: true,
    handler: async (ctx, args) => {
      const order = (await ctx.db.select('pos.Order', { id: args.orderId }))[0]
      if (!order) return null
      return {
        state: order.loyaltyState ?? 'draft',
        pointsEarned: String(order.loyaltyPointsEarned ?? 0),
        pointsSpent: String(order.loyaltyPointsSpent ?? 0),
        applications: (
          await ctx.db.select('loyalty.Application', {
            orderType: 'pos',
            orderId: args.orderId,
          })
        ).map((application) => ({
          programId: String(application.programId),
          rewardId: application.rewardId == null ? null : String(application.rewardId),
          pointsEarned: String(application.pointsEarned ?? 0),
          pointsSpent: String(application.pointsSpent ?? 0),
          discountAmount: String(application.discountAmount ?? 0),
          state: String(application.state),
        })),
      }
    },
  }),

  evaluateOrder: defineFn({
    input: { orderId: 'id' },
    effects: [...snapshotEffects, ...effectsOf(orderFunctions.evaluateOrder)],
    agent: true,
    handler: async (ctx, args) => {
      const order = await posSnapshot(ctx, String(args.orderId))
      if (!order) return invalid(issue('orderId', 'loyalty.error.order'))
      return orderFunctions.evaluateOrder!.handler(ctx, { order })
    },
  }),

  applyCode: defineFn({
    input: { orderId: 'id', code: 'text', expectedRevision: 'int?' },
    effects: [...snapshotEffects, 'write:pos.Order', ...effectsOf(orderFunctions.applyCode)],
    idempotent: true,
    agent: true,
    handler: (ctx, args) =>
      atomic(ctx, async (tx) => {
        const claim = await claimDraftRevision(tx, args.orderId, args.expectedRevision)
        if (claim.ok !== true) return claim
        const order = await posSnapshot(tx, String(args.orderId))
        if (!order) return invalid(issue('orderId', 'loyalty.error.order'))
        const applied = (await orderFunctions.applyCode!.handler(tx, {
          order,
          code: args.code,
        })) as Row
        return applied.ok === true ? { ...applied, revision: claim.revision } : applied
      }),
  }),

  applyReward: defineFn({
    input: {
      orderId: 'id',
      programId: 'id',
      rewardId: 'id',
      points: 'decimal?',
      expectedRevision: 'int?',
    },
    effects: [...materializeEffects, ...effectsOf(orderFunctions.applyReward)],
    idempotent: true,
    agent: true,
    handler: (ctx, args) =>
      atomic(ctx, async (tx) => {
        const claim = await claimDraftRevision(tx, args.orderId, args.expectedRevision)
        if (claim.ok !== true) return claim
        const order = await posSnapshot(tx, String(args.orderId))
        if (!order) return invalid(issue('orderId', 'loyalty.error.order'))
        const applied = await applyOrderReward(
          tx,
          {
            order,
            programId: args.programId,
            rewardId: args.rewardId,
            ...(args.points === undefined ? {} : { points: args.points }),
          },
          { inTransaction: true },
        )
        if (applied.ok !== true) return applied
        const materialized = await materializeReward(
          tx,
          String(args.orderId),
          String(args.programId),
          applied.reward as Row,
        )
        return (materialized as Row).ok === true
          ? { ...applied, revision: claim.revision }
          : (materialized as Row)
      }),
  }),

  removeReward: defineFn({
    input: { orderId: 'id', programId: 'id', expectedRevision: 'int?' },
    effects: [...materializeEffects, ...effectsOf(orderFunctions.removeReward)],
    idempotent: true,
    agent: true,
    handler: (ctx, args) =>
      atomic(ctx, async (tx) => {
        const claim = await claimDraftRevision(tx, args.orderId, args.expectedRevision)
        if (claim.ok !== true) return claim
        const removed = await removeOrderReward(
          tx,
          {
            orderType: 'pos',
            orderId: args.orderId,
            programId: args.programId,
          },
          { inTransaction: true },
        )
        if (removed.ok !== true) return removed
        await removeRewardLines(tx, String(args.orderId), String(args.programId))
        return { ...removed, revision: claim.revision }
      }),
  }),

  validateOrder: defineFn({
    input: { id: 'id', expectedRevision: 'int?' },
    effects: [
      ...effectsOf(posFunctions.validateOrder),
      ...snapshotEffects,
      ...effectsOf(orderFunctions['order.finalize']),
      ...effectsOf(orderFunctions['order.reverse']),
      'write:pos.Order',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const before = (await ctx.db.select('pos.Order', { id: args.id }))[0]
      if (!before) return invalid(issue('id', 'loyalty.error.order'))
      if (!before.isRefund && before.loyaltyState !== 'finalized') {
        const preflight = await preflightOrder(ctx, String(args.id))
        if (preflight.ok !== true) return preflight
      }
      const validated = (await posFunctions.validateOrder!.handler(ctx, args)) as Row
      if (validated.ok !== true) return validated
      const held = (await ctx.db.select('pos.Order', { id: args.id }))[0]!
      let loyalty: Row
      if (held.isRefund && held.refundedOrderId)
        loyalty = (await orderFunctions['order.reverse']!.handler(ctx, {
          orderType: 'pos',
          orderId: held.refundedOrderId,
        })) as Row
      else {
        const order = await posSnapshot(ctx, String(args.id))
        if (!order) return invalid(issue('id', 'loyalty.error.order'))
        loyalty = (await orderFunctions['order.finalize']!.handler(ctx, {
          order,
        })) as Row
        for (let retry = 0; loyalty.ok !== true && retry < 2; retry += 1) {
          const concurrent = ((loyalty.errors as Row[] | undefined) ?? []).some(
            (error) => error.code === 'loyalty.error.concurrent',
          )
          if (!concurrent) break
          loyalty = (await orderFunctions['order.finalize']!.handler(ctx, {
            order,
          })) as Row
        }
      }
      if (loyalty.ok !== true) {
        await ctx.db.update('pos.Order', { id: args.id }, { loyaltyState: 'pending_reconcile' })
        return loyalty
      }
      const applications = (loyalty.applications as Row[] | undefined) ?? []
      await ctx.db.update(
        'pos.Order',
        { id: args.id },
        {
          loyaltyState: held.isRefund ? 'reversed' : 'finalized',
          loyaltyPointsEarned: decimal(applications.reduce((sum, row) => sum + n(row.pointsEarned), 0)),
          loyaltyPointsSpent: decimal(applications.reduce((sum, row) => sum + n(row.pointsSpent), 0)),
        },
      )
      return { ...validated, loyalty }
    },
  }),

  refundOrder: defineFn({
    input: { id: 'id', uuid: 'text?', originalOrderId: 'id', sessionId: 'id' },
    effects: effectsOf(posFunctions.refundOrder),
    idempotent: true,
    agent: true,
    handler: (ctx, args) => posFunctions.refundOrder!.handler(ctx, args),
  }),

  cancelOrder: defineFn({
    input: { id: 'id', expectedRevision: 'int?' },
    effects: [
      ...effectsOf(posFunctions.cancelOrder),
      ...effectsOf(orderFunctions['order.reverse']),
      'write:pos.Order',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const cancelled = (await posFunctions.cancelOrder!.handler(ctx, args)) as Row
      if (cancelled.ok !== true) return cancelled
      const loyalty = (await orderFunctions['order.reverse']!.handler(ctx, {
        orderType: 'pos',
        orderId: args.id,
      })) as Row
      if (loyalty.ok === true) await ctx.db.update('pos.Order', { id: args.id }, { loyaltyState: 'reversed' })
      return loyalty.ok === true ? { ...cancelled, loyalty } : loyalty
    },
  }),

  backfill: defineFn({
    input: { dryRun: 'bool?', limit: 'int?', offset: 'int?' },
    effects: [
      ...snapshotEffects,
      ...effectsOf(orderFunctions['order.finalize']),
      ...effectsOf(orderFunctions['order.reverse']),
      'write:pos.Order',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const orders = (await ctx.db.select('pos.Order'))
        .filter(
          (order) => ['paid', 'done'].includes(String(order.state)) && order.loyaltyState !== 'finalized',
        )
        .slice(n(args.offset), n(args.offset) + Math.max(1, n(args.limit ?? 100)))
      if (args.dryRun)
        return {
          ok: true,
          candidates: orders.map((order) => order.id),
          processed: 0,
        }
      const results: Row[] = []
      for (const held of orders) {
        let result: Row
        if (held.isRefund && held.refundedOrderId)
          result = (await orderFunctions['order.reverse']!.handler(ctx, {
            orderType: 'pos',
            orderId: held.refundedOrderId,
          })) as Row
        else {
          const order = await posSnapshot(ctx, String(held.id))
          if (!order) continue
          result = (await orderFunctions['order.finalize']!.handler(ctx, {
            order,
          })) as Row
        }
        results.push({ id: held.id, ok: result.ok })
        if (result.ok === true)
          await ctx.db.update('pos.Order', { id: held.id }, { loyaltyState: 'finalized' })
      }
      return {
        ok: results.every((row) => row.ok),
        processed: results.length,
        results,
      }
    },
  }),
}
