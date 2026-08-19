import { defineFn } from 'ketjs'
import type { Ctx, FnSpec, Row } from 'ketjs'

export const RULE_ACTIONS = ['pull', 'push', 'pull_push'] as const
export const PROCUREMENT_METHODS = ['make_to_stock', 'make_to_order', 'mts_else_mto'] as const

const invalid = (field: string, message: string): { ok: false; errors: object[] } => ({
  ok: false,
  errors: [{ field, message }],
})

async function routeFor(ctx: Ctx, product: Row, location: Row, explicit?: unknown): Promise<string | null> {
  if (explicit) return String(explicit)
  const productRoute = (await ctx.db.select('stock.ProductRoute', { productId: product.id }))[0]
  if (productRoute) return String(productRoute.routeId)
  const template = (await ctx.db.select('product.Template', { id: product.templateId }))[0]
  if (template?.categoryId) {
    const categoryRoute = (await ctx.db.select('stock.CategoryRoute', { categoryId: template.categoryId }))[0]
    if (categoryRoute) return String(categoryRoute.routeId)
  }
  if (location.warehouseId) {
    const warehouseRoute = (
      await ctx.db.select('stock.WarehouseRoute', { warehouseId: location.warehouseId })
    )[0]
    if (warehouseRoute) return String(warehouseRoute.routeId)
  }
  return null
}

async function available(ctx: Ctx, productId: unknown, locationId: unknown): Promise<number> {
  const quants = await ctx.db.select('stock.Quant', { productId, locationId })
  return quants.reduce((sum, quant) => sum + Number(quant.quantity) - Number(quant.reservedQuantity), 0)
}

async function procure(
  ctx: Ctx,
  args: {
    moveId: string
    productId: unknown
    productUomId: unknown
    quantity: number
    locationId: unknown
    routeId?: unknown
    origin?: unknown
  },
): Promise<{ ok: true; moveIds: string[]; method: string } | { ok: false; errors: object[] }> {
  const product = (await ctx.db.select('product.Product', { id: args.productId }))[0]
  if (!product) return invalid('productId', 'biến thể không tồn tại')
  const destination = (await ctx.db.select('stock.Location', { id: args.locationId }))[0]
  if (!destination) return invalid('locationId', 'location đích không tồn tại')
  const routeId = await routeFor(ctx, product, destination, args.routeId)
  if (!routeId) return invalid('routeId', 'không tìm thấy route cho sản phẩm và location')
  const rules = (
    await ctx.db.select('stock.Rule', { routeId, locationDestId: args.locationId, active: true })
  ).sort((a, b) => Number(a.sequence) - Number(b.sequence))
  const rule = rules[0]
  if (!rule?.locationSrcId) return invalid('routeId', 'route không có pull/push rule phù hợp')
  let method = String(rule.procureMethod)
  if (method === 'mts_else_mto')
    method =
      (await available(ctx, args.productId, rule.locationSrcId)) >= args.quantity
        ? 'make_to_stock'
        : 'make_to_order'
  const moveIds: string[] = []
  await ctx.db.insertIfAbsent('stock.Move', {
    id: args.moveId,
    name: String(rule.name),
    pickingId: null,
    productId: args.productId,
    productUomId: args.productUomId,
    productUomQty: String(args.quantity),
    quantity: '0',
    locationId: rule.locationSrcId,
    locationDestId: args.locationId,
    state: 'confirmed',
    picked: false,
    procureMethod: method,
    ruleId: rule.id,
    origin: args.origin ?? 'procurement',
  })
  moveIds.push(args.moveId)

  if (method === 'make_to_order') {
    const upstream = (
      await ctx.db.select('stock.Rule', { routeId, locationDestId: rule.locationSrcId, active: true })
    )
      .filter((candidate) => candidate.id !== rule.id && candidate.locationSrcId)
      .sort((a, b) => Number(a.sequence) - Number(b.sequence))[0]
    if (upstream) {
      const upstreamId = `${args.moveId}:upstream`
      await ctx.db.insertIfAbsent('stock.Move', {
        id: upstreamId,
        name: String(upstream.name),
        pickingId: null,
        productId: args.productId,
        productUomId: args.productUomId,
        productUomQty: String(args.quantity),
        quantity: '0',
        locationId: upstream.locationSrcId,
        locationDestId: rule.locationSrcId,
        state: 'confirmed',
        picked: false,
        procureMethod: upstream.procureMethod === 'mts_else_mto' ? 'make_to_order' : upstream.procureMethod,
        ruleId: upstream.id,
        origin: args.origin ?? 'procurement',
      })
      await ctx.db.insertIfAbsent('stock.MoveLink', {
        id: `${upstreamId}:${args.moveId}`,
        originMoveId: upstreamId,
        destinationMoveId: args.moveId,
      })
      moveIds.unshift(upstreamId)
    }
  }
  return { ok: true, moveIds, method }
}

export const routingFunctions: Record<string, FnSpec> = {
  listRoutes: defineFn({
    input: {},
    effects: ['read:stock.Route'],
    agent: true,
    handler: (ctx) => ctx.db.select('stock.Route', { active: true }),
  }),
  listOrderpoints: defineFn({
    input: {},
    effects: ['read:stock.Orderpoint'],
    agent: true,
    handler: (ctx) => ctx.db.select('stock.Orderpoint', { active: true }),
  }),
  saveRoute: defineFn({
    input: { id: 'id', name: 'text', sequence: 'int?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:stock.Route', 'write:stock.Route'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const existing = (await ctx.db.select('stock.Route', { id: args.id }))[0]
      const values = { ...args, sequence: args.sequence ?? 10, active: true }
      const cs = ctx
        .change('stock.Route', values, existing ?? null)
        .cast(['id', 'name', 'sequence', 'active'])
        .required(['name'])
      if (!cs.valid) return { ok: false, errors: cs.errors }
      await ctx.db.commit(cs, existing ? { id: args.id } : undefined)
      return { ok: true, id: args.id }
    },
  }),
  saveRule: defineFn({
    input: {
      id: 'id',
      name: 'text',
      routeId: 'id',
      action: 'text',
      sequence: 'int?',
      locationSrcId: 'id?',
      locationDestId: 'id',
      pickingTypeId: 'id',
      procureMethod: 'text?',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:stock.Rule', 'read:stock.Route', 'write:stock.Rule'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      if (!RULE_ACTIONS.includes(args.action as never))
        return invalid('action', `phải là: ${RULE_ACTIONS.join(', ')}`)
      const procureMethod = args.procureMethod ?? 'make_to_stock'
      if (!PROCUREMENT_METHODS.includes(procureMethod as never))
        return invalid('procureMethod', `phải là: ${PROCUREMENT_METHODS.join(', ')}`)
      if (!(await ctx.db.select('stock.Route', { id: args.routeId }))[0])
        return invalid('routeId', 'route không tồn tại')
      const existing = (await ctx.db.select('stock.Rule', { id: args.id }))[0]
      const values = { ...args, procureMethod, sequence: args.sequence ?? 20, active: true }
      const cs = ctx
        .change('stock.Rule', values, existing ?? null)
        .cast([
          'id',
          'name',
          'routeId',
          'action',
          'sequence',
          'locationSrcId',
          'locationDestId',
          'pickingTypeId',
          'procureMethod',
          'active',
        ])
        .required(['name', 'routeId', 'action', 'locationDestId', 'pickingTypeId', 'procureMethod'])
      if (!cs.valid) return { ok: false, errors: cs.errors }
      await ctx.db.commit(cs, existing ? { id: args.id } : undefined)
      return { ok: true, id: args.id }
    },
  }),
  assignProductRoute: defineFn({
    input: { productId: 'id', routeId: 'id' },
    output: { ok: 'bool', id: 'id' },
    effects: ['write:stock.ProductRoute'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const id = `${String(args.productId)}:${String(args.routeId)}`
      await ctx.db.insertIfAbsent('stock.ProductRoute', {
        id,
        productId: args.productId,
        routeId: args.routeId,
      })
      return { ok: true, id }
    },
  }),
  assignCategoryRoute: defineFn({
    input: { categoryId: 'id', routeId: 'id' },
    output: { ok: 'bool', id: 'id' },
    effects: ['write:stock.CategoryRoute'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const id = `${String(args.categoryId)}:${String(args.routeId)}`
      await ctx.db.insertIfAbsent('stock.CategoryRoute', {
        id,
        categoryId: args.categoryId,
        routeId: args.routeId,
      })
      return { ok: true, id }
    },
  }),
  assignWarehouseRoute: defineFn({
    input: { warehouseId: 'id', routeId: 'id' },
    output: { ok: 'bool', id: 'id' },
    effects: ['write:stock.WarehouseRoute'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const id = `${String(args.warehouseId)}:${String(args.routeId)}`
      await ctx.db.insertIfAbsent('stock.WarehouseRoute', {
        id,
        warehouseId: args.warehouseId,
        routeId: args.routeId,
      })
      return { ok: true, id }
    },
  }),
  procure: defineFn({
    input: {
      moveId: 'id',
      productId: 'id',
      productUomId: 'id',
      quantity: 'decimal',
      locationId: 'id',
      routeId: 'id?',
      origin: 'text?',
    },
    output: { ok: 'bool', moveIds: 'json?', method: 'text?', errors: 'json?' },
    effects: [
      'read:product.Product',
      'read:product.Template',
      'read:stock.Location',
      'read:stock.Quant',
      'read:stock.ProductRoute',
      'read:stock.CategoryRoute',
      'read:stock.WarehouseRoute',
      'read:stock.Rule',
      'write:stock.Move',
      'write:stock.MoveLink',
    ],
    idempotent: true,
    agent: true,
    handler: (ctx, args) =>
      procure(ctx, {
        moveId: String(args.moveId),
        productId: args.productId,
        productUomId: args.productUomId,
        quantity: Number(args.quantity),
        locationId: args.locationId,
        routeId: args.routeId,
        origin: args.origin,
      }),
  }),
  saveOrderpoint: defineFn({
    input: {
      id: 'id',
      productId: 'id',
      locationId: 'id',
      minQuantity: 'decimal',
      maxQuantity: 'decimal',
      quantityMultiple: 'decimal?',
      replenishmentUomId: 'id',
      routeId: 'id?',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:stock.Orderpoint', 'write:stock.Orderpoint'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      if (Number(args.maxQuantity) < Number(args.minQuantity))
        return invalid('maxQuantity', 'phải lớn hơn hoặc bằng minQuantity')
      const existing = (await ctx.db.select('stock.Orderpoint', { id: args.id }))[0]
      const values = { ...args, quantityMultiple: args.quantityMultiple ?? '1', active: true }
      const cs = ctx
        .change('stock.Orderpoint', values, existing ?? null)
        .cast([
          'id',
          'productId',
          'locationId',
          'minQuantity',
          'maxQuantity',
          'quantityMultiple',
          'replenishmentUomId',
          'routeId',
          'active',
        ])
        .required(['productId', 'locationId', 'minQuantity', 'maxQuantity', 'replenishmentUomId'])
      if (!cs.valid) return { ok: false, errors: cs.errors }
      await ctx.db.commit(cs, existing ? { id: args.id } : undefined)
      return { ok: true, id: args.id }
    },
  }),
  runOrderpoint: defineFn({
    input: { id: 'id', moveId: 'id' },
    output: { ok: 'bool', quantity: 'decimal?', moveIds: 'json?', method: 'text?', errors: 'json?' },
    effects: [
      'read:stock.Orderpoint',
      'read:stock.Quant',
      'read:stock.Move',
      'read:stock.Location',
      'read:product.Product',
      'read:product.Template',
      'read:stock.ProductRoute',
      'read:stock.CategoryRoute',
      'read:stock.WarehouseRoute',
      'read:stock.Rule',
      'write:stock.Move',
      'write:stock.MoveLink',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const point = (await ctx.db.select('stock.Orderpoint', { id: args.id }))[0]
      if (!point) return invalid('id', 'orderpoint không tồn tại')
      const quants = await ctx.db.select('stock.Quant', {
        productId: point.productId,
        locationId: point.locationId,
      })
      const onHand = quants.reduce((sum, quant) => sum + Number(quant.quantity), 0)
      const moves = (await ctx.db.select('stock.Move', { productId: point.productId })).filter(
        (move) => !['done', 'cancel', 'draft'].includes(String(move.state)),
      )
      const incoming = moves
        .filter((move) => move.locationDestId === point.locationId)
        .reduce((sum, move) => sum + Math.max(0, Number(move.productUomQty) - Number(move.quantity)), 0)
      const outgoing = moves
        .filter((move) => move.locationId === point.locationId)
        .reduce((sum, move) => sum + Math.max(0, Number(move.productUomQty) - Number(move.quantity)), 0)
      const forecast = onHand + incoming - outgoing
      if (forecast >= Number(point.minQuantity))
        return { ok: true, quantity: '0', moveIds: [], method: 'none' }
      const multiple = Math.max(Number(point.quantityMultiple), 1e-12)
      const quantity = Math.ceil((Number(point.maxQuantity) - forecast) / multiple) * multiple
      const result = await procure(ctx, {
        moveId: String(args.moveId),
        productId: point.productId,
        productUomId: point.replenishmentUomId,
        quantity,
        locationId: point.locationId,
        routeId: point.routeId,
        origin: `orderpoint:${String(point.id)}`,
      })
      return result.ok ? { ...result, quantity: String(quantity) } : result
    },
  }),
}
