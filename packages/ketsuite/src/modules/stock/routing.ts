import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { convertQty, type Unit } from '../uom/convert.ts'
import { company, ours } from './scope.ts'

export const RULE_ACTIONS = ['pull', 'push', 'pull_push'] as const
export const PROCUREMENT_METHODS = ['make_to_stock', 'make_to_order', 'mts_else_mto'] as const

const invalid = (field: string, message: string): { ok: false; errors: object[] } => ({
  ok: false,
  errors: [{ field, message }],
})

/**
 * The company a composed row id has to carry.
 *
 * These link models are company-scoped, so an id built from the two business ids
 * alone is the same string in every tenant. insertIfAbsent then turns the second
 * company's write into a no-op and reports it as a success.
 */

async function orderedRouteIds(ctx: Ctx, ids: string[]): Promise<string[]> {
  const routes = new Map((await ours(ctx, 'stock.Route')).map((route) => [String(route.id), route]))
  return [...new Set(ids)].sort(
    (a, b) =>
      Number(routes.get(a)?.sequence ?? 10) - Number(routes.get(b)?.sequence ?? 10) || a.localeCompare(b),
  )
}

async function routesFor(ctx: Ctx, product: Row, location: Row, explicit?: unknown): Promise<string[]> {
  if (explicit) return [String(explicit)]
  const productRoutes = await ours(ctx, 'stock.ProductRoute', { productId: product.id })
  if (productRoutes.length)
    return orderedRouteIds(
      ctx,
      productRoutes.map((route) => String(route.routeId)),
    )
  const template = (await ctx.db.select('product.Template', { id: product.templateId }))[0]
  let categoryId = template?.categoryId == null ? null : String(template.categoryId)
  const seenCategories = new Set<string>()
  while (categoryId && !seenCategories.has(categoryId)) {
    seenCategories.add(categoryId)
    const categoryRoutes = await ours(ctx, 'stock.CategoryRoute', { categoryId })
    if (categoryRoutes.length)
      return orderedRouteIds(
        ctx,
        categoryRoutes.map((route) => String(route.routeId)),
      )
    const category = (await ctx.db.select('product.Category', { id: categoryId }))[0]
    categoryId = category?.parentId == null ? null : String(category.parentId)
  }
  if (location.warehouseId) {
    const warehouseRoutes = await ours(ctx, 'stock.WarehouseRoute', {
      warehouseId: location.warehouseId,
    })
    if (warehouseRoutes.length)
      return orderedRouteIds(
        ctx,
        warehouseRoutes.map((route) => String(route.routeId)),
      )
  }
  return []
}

/** Create the next move(s) for the domain contract-style push and pull-push rules. */
export async function pushFromCompletedMove(ctx: Ctx, move: Row, quantity: number): Promise<string[]> {
  if (!(quantity > 0)) return []
  const product = (await ctx.db.select('product.Product', { id: move.productId }))[0]
  const source = (await ours(ctx, 'stock.Location', { id: move.locationDestId }))[0]
  if (!product || !source) return []
  const routeIds = await routesFor(ctx, product, source)
  const routeRank = new Map(routeIds.map((routeId, index) => [routeId, index]))
  const candidates: Row[] = []
  for (const routeId of routeIds)
    candidates.push(
      ...(await ours(ctx, 'stock.Rule', {
        routeId,
        locationSrcId: move.locationDestId,
        active: true,
      })),
    )
  const rules = candidates
    .filter((rule) => rule.action === 'push' || rule.action === 'pull_push')
    .sort(
      (a, b) =>
        Number(routeRank.get(String(a.routeId))) - Number(routeRank.get(String(b.routeId))) ||
        Number(a.sequence) - Number(b.sequence) ||
        String(a.id).localeCompare(String(b.id)),
    )
  const ids: string[] = []
  const links = await ours(ctx, 'stock.MoveLink', { originMoveId: move.id })
  const linkedRules = new Set<string>()
  for (const link of links) {
    const destination = (await ours(ctx, 'stock.Move', { id: link.destinationMoveId }))[0]
    if (destination?.ruleId) linkedRules.add(String(destination.ruleId))
  }
  for (const rule of rules) {
    if (linkedRules.has(String(rule.id))) continue
    const id = `${String(move.id)}:push:${String(rule.id)}`
    await ctx.db.insertIfAbsent('stock.Move', {
      id,
      name: String(rule.name),
      pickingId: null,
      productId: move.productId,
      productUomId: move.productUomId,
      productUomQty: String(quantity),
      quantity: '0',
      locationId: move.locationDestId,
      locationDestId: rule.locationDestId,
      state: 'confirmed',
      picked: false,
      procureMethod: rule.procureMethod,
      ruleId: rule.id,
      origin: `push:${String(move.id)}`,
    })
    await ctx.db.insertIfAbsent('stock.MoveLink', {
      id: `${String(move.id)}:${id}`,
      originMoveId: move.id,
      destinationMoveId: id,
    })
    ids.push(id)
  }
  return ids
}

async function available(ctx: Ctx, productId: unknown, locationId: unknown): Promise<number> {
  const quants = await ours(ctx, 'stock.Quant', { productId, locationId })
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
  const destination = (await ours(ctx, 'stock.Location', { id: args.locationId }))[0]
  if (!destination) return invalid('locationId', 'location đích không tồn tại')
  const routeIds = await routesFor(ctx, product, destination, args.routeId)
  if (!routeIds.length) return invalid('routeId', 'không tìm thấy route cho sản phẩm và location')
  const routeRank = new Map(routeIds.map((routeId, index) => [routeId, index]))
  const ruleFor = async (locationId: unknown): Promise<Row | null> => {
    const candidates: Row[] = []
    for (const routeId of routeIds)
      candidates.push(
        ...(await ours(ctx, 'stock.Rule', { routeId, locationDestId: locationId, active: true })),
      )
    return (
      candidates
        .filter((rule) => rule.locationSrcId && rule.action !== 'push')
        .sort(
          (a, b) =>
            Number(routeRank.get(String(a.routeId))) - Number(routeRank.get(String(b.routeId))) ||
            Number(a.sequence) - Number(b.sequence) ||
            String(a.id).localeCompare(String(b.id)),
        )[0] ?? null
    )
  }
  const moveIds: string[] = []
  const chain: string[] = []
  let firstMethod = 'make_to_stock'
  const build = async (
    destinationId: unknown,
    moveId: string,
    downstreamId: string | null,
    depth: number,
  ): Promise<boolean> => {
    if (depth >= 32) throw new Error(`stock rule depth exceeds 32: ${chain.join(' -> ')}`)
    const rule = await ruleFor(destinationId)
    if (!rule) return false
    const ruleId = String(rule.id)
    if (chain.includes(ruleId)) throw new Error(`stock rule cycle: ${[...chain, ruleId].join(' -> ')}`)
    chain.push(ruleId)
    let method = String(rule.procureMethod)
    if (method === 'mts_else_mto')
      method =
        (await available(ctx, args.productId, rule.locationSrcId)) >= args.quantity
          ? 'make_to_stock'
          : 'make_to_order'
    if (depth === 0) firstMethod = method
    await ctx.db.insertIfAbsent('stock.Move', {
      id: moveId,
      name: String(rule.name),
      pickingId: null,
      productId: args.productId,
      productUomId: args.productUomId,
      productUomQty: String(args.quantity),
      quantity: '0',
      locationId: rule.locationSrcId,
      locationDestId: destinationId,
      state: 'confirmed',
      picked: false,
      procureMethod: method,
      ruleId: rule.id,
      origin: args.origin ?? 'procurement',
    })
    if (downstreamId)
      await ctx.db.insertIfAbsent('stock.MoveLink', {
        id: `${moveId}:${downstreamId}`,
        originMoveId: moveId,
        destinationMoveId: downstreamId,
      })
    moveIds.unshift(moveId)
    if (method === 'make_to_order')
      await build(
        rule.locationSrcId,
        depth === 0 ? `${args.moveId}:upstream` : `${args.moveId}:upstream:${depth + 1}`,
        moveId,
        depth + 1,
      )
    chain.pop()
    return true
  }
  try {
    if (!(await build(args.locationId, args.moveId, null, 0)))
      return invalid('routeId', 'route không có pull/push rule phù hợp')
  } catch (error) {
    return invalid('routeId', (error as Error).message)
  }
  return { ok: true, moveIds, method: firstMethod }
}

export const routingFunctions: Record<string, FnSpec> = {
  listRoutes: defineFn({
    input: {},
    effects: ['read:stock.Route'],
    agent: true,
    handler: (ctx) => ours(ctx, 'stock.Route', { active: true }),
  }),
  listRules: defineFn({
    input: { routeId: 'id?' },
    effects: ['read:stock.Rule'],
    agent: true,
    handler: (ctx, args) =>
      ours(ctx, 'stock.Rule', {
        active: true,
        ...(args.routeId ? { routeId: args.routeId } : {}),
      }),
  }),
  listOrderpoints: defineFn({
    input: {},
    effects: ['read:stock.Orderpoint'],
    agent: true,
    handler: (ctx) => ours(ctx, 'stock.Orderpoint', { active: true }),
  }),
  saveRoute: defineFn({
    input: { id: 'id', name: 'text', sequence: 'int?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:stock.Route', 'write:stock.Route'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const existing = (await ours(ctx, 'stock.Route', { id: args.id }))[0]
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
      if (!(await ours(ctx, 'stock.Route', { id: args.routeId }))[0])
        return invalid('routeId', 'route không tồn tại')
      const existing = (await ours(ctx, 'stock.Rule', { id: args.id }))[0]
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
      const id = `${company(ctx)}:${String(args.productId)}:${String(args.routeId)}`
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
      const id = `${company(ctx)}:${String(args.categoryId)}:${String(args.routeId)}`
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
      const id = `${company(ctx)}:${String(args.warehouseId)}:${String(args.routeId)}`
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
      'read:product.Category',
      'read:stock.Location',
      'read:stock.Route',
      'read:stock.Quant',
      'read:stock.Route',
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
      warehouseId: 'id',
      locationId: 'id',
      trigger: 'text?',
      minQuantity: 'decimal',
      maxQuantity: 'decimal',
      replenishmentUomId: 'id?',
      routeId: 'id?',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:stock.Orderpoint',
      'write:stock.Orderpoint',
      'read:stock.Warehouse',
      'read:stock.Location',
      'read:product.Product',
      'read:product.Template',
      'read:uom.Unit',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      if (Number(args.maxQuantity) < Number(args.minQuantity))
        return invalid('maxQuantity', 'phải lớn hơn hoặc bằng minQuantity')
      const trigger = String(args.trigger ?? 'auto')
      if (!['auto', 'manual'].includes(trigger)) return invalid('trigger', 'phải là auto hoặc manual')
      if (!(await ours(ctx, 'stock.Warehouse', { id: args.warehouseId }))[0])
        return invalid('warehouseId', 'warehouse không tồn tại')
      const location = (await ours(ctx, 'stock.Location', { id: args.locationId }))[0]
      if (!location || location.warehouseId !== args.warehouseId)
        return invalid('locationId', 'location không thuộc warehouse')
      const product = (await ctx.db.select('product.Product', { id: args.productId }))[0]
      const template = product
        ? (await ctx.db.select('product.Template', { id: product.templateId }))[0]
        : null
      if (!product || !template?.uomId) return invalid('productId', 'sản phẩm chưa có UoM mặc định')
      const replenishmentUomId = args.replenishmentUomId ?? template.uomId
      const baseUom = (await ctx.db.select('uom.Unit', { id: template.uomId }))[0]
      const replenishmentUom = (await ctx.db.select('uom.Unit', { id: replenishmentUomId }))[0]
      const root = (unit: Row) => String(unit.parentPath).split('/').filter(Boolean)[0]
      if (!baseUom || !replenishmentUom || root(baseUom) !== root(replenishmentUom))
        return invalid('replenishmentUomId', 'đơn vị bổ sung phải cùng cây với UoM mặc định')
      const existing = (await ours(ctx, 'stock.Orderpoint', { id: args.id }))[0]
      const values = { ...args, trigger, replenishmentUomId, active: true }
      const cs = ctx
        .change('stock.Orderpoint', values, existing ?? null)
        .cast([
          'id',
          'productId',
          'warehouseId',
          'locationId',
          'trigger',
          'minQuantity',
          'maxQuantity',
          'replenishmentUomId',
          'routeId',
          'active',
        ])
        .required(['productId', 'warehouseId', 'locationId', 'trigger', 'minQuantity', 'maxQuantity'])
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
      'read:product.Category',
      'read:uom.Unit',
      'read:stock.Route',
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
      const point = (await ours(ctx, 'stock.Orderpoint', { id: args.id }))[0]
      if (!point) return invalid('id', 'orderpoint không tồn tại')
      const quants = await ours(ctx, 'stock.Quant', {
        productId: point.productId,
        locationId: point.locationId,
      })
      const onHand = quants.reduce((sum, quant) => sum + Number(quant.quantity), 0)
      const moves = (await ours(ctx, 'stock.Move', { productId: point.productId })).filter(
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
      const product = (await ctx.db.select('product.Product', { id: point.productId }))[0]!
      const template = (await ctx.db.select('product.Template', { id: product.templateId }))[0]!
      const baseUom = (await ctx.db.select('uom.Unit', { id: template.uomId }))[0]!
      const replenishmentUom = (
        await ctx.db.select('uom.Unit', {
          id: point.replenishmentUomId ?? template.uomId,
        })
      )[0]!
      let raw: number
      try {
        raw =
          ((Number(point.maxQuantity) - forecast) * Number((baseUom as unknown as Unit).absoluteFactor)) /
          Number((replenishmentUom as unknown as Unit).absoluteFactor)
        convertQty(1, baseUom as unknown as Unit, replenishmentUom as unknown as Unit)
      } catch (error) {
        return invalid('replenishmentUomId', (error as Error).message)
      }
      const rounding = Math.max(Number(replenishmentUom.rounding), 1e-12)
      const quantity = Math.ceil(raw / rounding - 1e-12) * rounding
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

routingFunctions.runOrderpoints = defineFn({
  input: { warehouseId: 'id?' },
  output: { ok: 'bool', results: 'json' },
  effects: routingFunctions.runOrderpoint!.effects,
  agent: true,
  handler: async (ctx, args) => {
    const points = (await ours(ctx, 'stock.Orderpoint', { active: true })).filter(
      (point) => point.trigger === 'auto' && (!args.warehouseId || point.warehouseId === args.warehouseId),
    )
    const results: Row[] = []
    for (const point of points) {
      const result = (await routingFunctions.runOrderpoint!.handler(ctx, {
        id: point.id,
        moveId: `${String(point.id)}:auto:${Date.now()}:${results.length}`,
      })) as Row
      results.push({ id: point.id, ...result })
    }
    return { ok: true, results }
  },
})
