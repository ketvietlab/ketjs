import { deleteFrom, defineFn, eq } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { quoteTaxLine } from '../account/functions.ts'
import {
  absDecimalText,
  canonicalDecimalText,
  minorText,
  moneyMinor,
  negateDecimalText,
  scaleOf,
} from '../account/money.ts'
import { invalid, issue, n } from '../loyalty/engine.ts'
import { orderFunctions } from '../loyalty/order-functions.ts'
import { functions as saleFunctions } from '../sale/functions.ts'
import { ours } from '../sale/scope.ts'

const effectsOf = (...specs: Array<FnSpec | undefined>): string[] => [
  ...new Set(specs.flatMap((spec) => spec?.effects ?? [])),
]

const decimal = (value: number): string => String(value)

const lineTotal = async (ctx: Ctx, line: Row): Promise<string> => {
  if (line.priceSubtotalIncl != null) return canonicalDecimalText(String(line.priceSubtotalIncl))
  const quote = await quoteTaxLine(ctx, {
    productId: line.productId,
    taxIds: Array.isArray(line.taxIds) ? line.taxIds : line.taxId ? [line.taxId] : [],
    quantity: String(line.productUomQty ?? '1'),
    priceUnit: String(line.priceUnit ?? '0'),
    discount: String(line.discount ?? '0'),
    taxUse: 'sale',
  })
  return quote.ok === true ? quote.amountTotal : canonicalDecimalText(String(line.priceSubtotal ?? '0'))
}

export const saleSnapshot = async (ctx: Ctx, orderId: string) => {
  const order = (await ours(ctx, 'sale.Order', { id: orderId }))[0]
  if (!order) return null
  const lines = await ours(ctx, 'sale.OrderLine', { orderId })
  return {
    orderType: 'sale',
    orderId,
    partnerId: order.partnerId,
    currency: order.currency,
    pricelistId: order.pricelistId ?? null,
    date: order.dateOrder,
    lines: await Promise.all(
      lines.map(async (line) => ({
        id: String(line.id),
        productId: String(line.productId),
        quantity: n(line.productUomQty),
        untaxed: canonicalDecimalText(String(line.priceSubtotal ?? '0')),
        total: await lineTotal(ctx, line),
        lineKind: String(line.lineKind ?? 'product'),
      })),
    ),
  }
}

const recompute = async (ctx: Ctx, orderId: string) => {
  const order = (await ours(ctx, 'sale.Order', { id: orderId }))[0]
  if (!order) return
  const scale = scaleOf(order.currency)
  const lines = await ours(ctx, 'sale.OrderLine', { orderId })
  let untaxed = 0n
  let total = 0n
  for (const line of lines) {
    untaxed += moneyMinor(String(line.priceSubtotal ?? '0'), scale)
    total += moneyMinor(await lineTotal(ctx, line), scale)
  }
  await ctx.db.update(
    'sale.Order',
    {
      id: orderId,
    },
    {
      amountUntaxed: minorText(untaxed, scale),
      amountTax: minorText(total - untaxed, scale),
      amountTotal: minorText(total, scale),
    },
  )
}

const removeRewardLines = async (ctx: Ctx, orderId: string, programId?: string) => {
  const L = ctx.table('sale.OrderLine')
  const lines = (await ours(ctx, 'sale.OrderLine', { orderId })).filter(
    (line) =>
      line.lineKind === 'reward' &&
      (!programId || String(line.loyaltyApplicationId) === `sale:${orderId}:${programId}`),
  )
  for (const line of lines) await ctx.db.del(deleteFrom(L).where(eq(L.id, line.id)))
  await recompute(ctx, orderId)
}

const materializeReward = async (ctx: Ctx, orderId: string, programId: string, payload: Row) => {
  const order = (await ours(ctx, 'sale.Order', { id: orderId }))[0]
  if (!order || !['draft', 'sent'].includes(String(order.state)) || order.locked)
    return invalid(issue('orderId', 'loyalty.error.state'))
  await removeRewardLines(ctx, orderId, programId)
  const reward = (await ctx.db.select('loyalty.Reward', { id: payload.rewardId }))[0]
  if (!reward) return invalid(issue('rewardId', 'loyalty.error.rewardMissing'))
  const ordinary = (await ours(ctx, 'sale.OrderLine', { orderId })).filter(
    (line) => line.lineKind !== 'reward',
  )
  const productId = String(payload.productId ?? reward.lineProductId)
  const product = (await ctx.db.select('product.Product', { id: productId }))[0]
  const template = product && (await ctx.db.select('product.Template', { id: product.templateId }))[0]
  const uomId = template?.uomId ?? ordinary[0]?.productUomId
  if (!product || !uomId) return invalid(issue('rewardId', 'loyalty.error.rewardProduct'))
  const productReward = payload.rewardType === 'product'
  const quantity = productReward ? n(payload.productQuantity ?? 1) : 1
  const priceUnit = productReward
    ? '0'
    : negateDecimalText(absDecimalText(String(payload.discountAmount ?? '0')))
  const subtotal = productReward ? '0' : priceUnit
  await ctx.db.insert('sale.OrderLine', {
    id: `loyalty:${orderId}:${programId}`,
    orderId,
    productId,
    name: reward.description,
    productUomQty: decimal(quantity),
    productUomId: uomId,
    priceUnit,
    discount: '0',
    taxId: null,
    taxIds: [],
    taxEvidence: null,
    quoteRevision: null,
    qtyDelivered: '0',
    qtyInvoiced: '0',
    priceSubtotal: subtotal,
    priceSubtotalIncl: subtotal,
    sequence: 9000,
    lineKind: 'reward',
    loyaltyApplicationId: `sale:${orderId}:${programId}`,
    loyaltyRewardId: reward.id,
    loyaltyPointsCost: decimal(n(payload.requiredPoints)),
  })
  await recompute(ctx, orderId)
  return { ok: true }
}

const snapshotEffects = [
  'read:sale.Order',
  'read:sale.OrderLine',
  'read:account.Tax',
  'read:company.Company',
] as const

const materializeEffects = [
  ...snapshotEffects,
  'write:sale.Order',
  'write:sale.OrderLine',
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
      const order = await saleSnapshot(ctx, String(args.orderId))
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
      const order = await saleSnapshot(ctx, String(args.orderId))
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
      const order = await saleSnapshot(ctx, String(args.orderId))
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
        orderType: 'sale',
        orderId: args.orderId,
        programId: args.programId,
      })) as Row
      if (removed.ok !== true) return removed
      await removeRewardLines(ctx, String(args.orderId), String(args.programId))
      return removed
    },
  }),

  confirmOrder: defineFn({
    input: { id: 'id' },
    effects: [
      ...effectsOf(saleFunctions.confirmOrder),
      ...snapshotEffects,
      ...effectsOf(orderFunctions['order.finalize']),
      'write:sale.Order',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const confirmed = (await saleFunctions.confirmOrder!.handler(ctx, args)) as Row
      if (confirmed.ok !== true) return confirmed
      const order = await saleSnapshot(ctx, String(args.id))
      if (!order) return invalid(issue('id', 'loyalty.error.order'))
      const loyalty = (await orderFunctions['order.finalize']!.handler(ctx, { order })) as Row
      if (loyalty.ok !== true) return loyalty
      const applications = loyalty.applications as Row[]
      await ctx.db.update(
        'sale.Order',
        { id: args.id },
        {
          loyaltyState: 'finalized',
          loyaltyPointsEarned: decimal(applications.reduce((sum, row) => sum + n(row.pointsEarned), 0)),
          loyaltyPointsSpent: decimal(applications.reduce((sum, row) => sum + n(row.pointsSpent), 0)),
        },
      )
      return { ...confirmed, loyalty }
    },
  }),

  cancelOrder: defineFn({
    input: { id: 'id' },
    effects: [
      ...effectsOf(saleFunctions.cancelOrder),
      ...effectsOf(orderFunctions['order.reverse']),
      'write:sale.Order',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const cancelled = (await saleFunctions.cancelOrder!.handler(ctx, args)) as Row
      if (cancelled.ok !== true) return cancelled
      const loyalty = (await orderFunctions['order.reverse']!.handler(ctx, {
        orderType: 'sale',
        orderId: args.id,
      })) as Row
      if (loyalty.ok === true)
        await ctx.db.update('sale.Order', { id: args.id }, { loyaltyState: 'reversed' })
      return loyalty.ok === true ? { ...cancelled, loyalty } : loyalty
    },
  }),

  refundOrder: defineFn({
    input: { id: 'id', originalOrderId: 'id' },
    effects: [...effectsOf(orderFunctions['order.reverse']), 'read:sale.Order', 'write:sale.Order'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const order = (await ours(ctx, 'sale.Order', { id: args.originalOrderId }))[0]
      if (!order) return invalid(issue('originalOrderId', 'loyalty.error.order'))
      const loyalty = (await orderFunctions['order.reverse']!.handler(ctx, {
        orderType: 'sale',
        orderId: args.originalOrderId,
      })) as Row
      if (loyalty.ok === true)
        await ctx.db.update('sale.Order', { id: args.originalOrderId }, { loyaltyState: 'reversed' })
      return loyalty.ok === true
        ? { ok: true, id: args.id, originalOrderId: args.originalOrderId, loyalty }
        : loyalty
    },
  }),

  backfill: defineFn({
    input: { dryRun: 'bool?', limit: 'int?', offset: 'int?' },
    effects: [...snapshotEffects, ...effectsOf(orderFunctions['order.finalize']), 'write:sale.Order'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const orders = (await ours(ctx, 'sale.Order', { state: 'sale' }))
        .filter((order) => order.loyaltyState !== 'finalized')
        .slice(n(args.offset), n(args.offset) + Math.max(1, n(args.limit ?? 100)))
      if (args.dryRun) return { ok: true, candidates: orders.map((order) => order.id), processed: 0 }
      const results: Row[] = []
      for (const held of orders) {
        const order = await saleSnapshot(ctx, String(held.id))
        if (!order) continue
        const result = (await orderFunctions['order.finalize']!.handler(ctx, { order })) as Row
        results.push({ id: held.id, ok: result.ok })
        if (result.ok === true)
          await ctx.db.update('sale.Order', { id: held.id }, { loyaltyState: 'finalized' })
      }
      return { ok: results.every((row) => row.ok), processed: results.length, results }
    },
  }),
}
