import { deleteFrom, defineFn, eq } from 'ketjs'
import type { Ctx, FnSpec, Row } from 'ketjs'
import { invalid, issue, n } from '../loyalty/engine.ts'
import { orderFunctions } from '../loyalty/order-functions.ts'
import { functions as posFunctions } from '../pos/functions.ts'

const effectsOf = (...specs: Array<FnSpec | undefined>): string[] => [
  ...new Set(specs.flatMap((spec) => spec?.effects ?? [])),
]
const money = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100
const decimal = (value: number): string => String(money(value))

export const posSnapshot = async (ctx: Ctx, orderId: string) => {
  const order = (await ctx.db.select('pos.Order', { id: orderId }))[0]
  if (!order) return null
  const config = (await ctx.db.select('pos.Config', { id: order.configId }))[0]
  const lines = await ctx.db.select('pos.OrderLine', { orderId })
  return {
    orderType: 'pos',
    orderId,
    partnerId: order.partnerId ?? null,
    currency: order.currency,
    pricelistId: config?.pricelistId ?? null,
    date: order.dateOrder,
    lines: lines.map((line) => ({
      id: String(line.id),
      productId: String(line.productId),
      quantity: n(line.qty),
      untaxed: n(line.priceSubtotal),
      total: n(line.priceSubtotalIncl),
      lineKind: String(line.lineKind ?? 'product'),
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
  await removeRewardLines(ctx, orderId, programId)
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

const snapshotEffects = ['read:pos.Order', 'read:pos.Config', 'read:pos.OrderLine'] as const
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
    input: { orderId: 'id', code: 'text' },
    effects: [...snapshotEffects, ...effectsOf(orderFunctions.applyCode)],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const order = await posSnapshot(ctx, String(args.orderId))
      if (!order) return invalid(issue('orderId', 'loyalty.error.order'))
      return orderFunctions.applyCode!.handler(ctx, { order, code: args.code })
    },
  }),

  applyReward: defineFn({
    input: { orderId: 'id', programId: 'id', rewardId: 'id', points: 'decimal?' },
    effects: [...materializeEffects, ...effectsOf(orderFunctions.applyReward)],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const order = await posSnapshot(ctx, String(args.orderId))
      if (!order) return invalid(issue('orderId', 'loyalty.error.order'))
      const applied = (await orderFunctions.applyReward!.handler(ctx, {
        order,
        programId: args.programId,
        rewardId: args.rewardId,
        ...(args.points === undefined ? {} : { points: args.points }),
      })) as Row
      if (applied.ok !== true) return applied
      const materialized = await materializeReward(
        ctx,
        String(args.orderId),
        String(args.programId),
        applied.reward as Row,
      )
      return (materialized as Row).ok === true ? applied : materialized
    },
  }),

  removeReward: defineFn({
    input: { orderId: 'id', programId: 'id' },
    effects: [...materializeEffects, ...effectsOf(orderFunctions.removeReward)],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const removed = (await orderFunctions.removeReward!.handler(ctx, {
        orderType: 'pos',
        orderId: args.orderId,
        programId: args.programId,
      })) as Row
      if (removed.ok !== true) return removed
      await removeRewardLines(ctx, String(args.orderId), String(args.programId))
      return removed
    },
  }),

  validateOrder: defineFn({
    input: { id: 'id' },
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
        loyalty = (await orderFunctions['order.finalize']!.handler(ctx, { order })) as Row
      }
      if (loyalty.ok !== true) return loyalty
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
    input: { id: 'id' },
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
      if (args.dryRun) return { ok: true, candidates: orders.map((order) => order.id), processed: 0 }
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
          result = (await orderFunctions['order.finalize']!.handler(ctx, { order })) as Row
        }
        results.push({ id: held.id, ok: result.ok })
        if (result.ok === true)
          await ctx.db.update('pos.Order', { id: held.id }, { loyaltyState: 'finalized' })
      }
      return { ok: results.every((row) => row.ok), processed: results.length, results }
    },
  }),
}
