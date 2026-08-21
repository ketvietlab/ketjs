import { defineFn, eq, from } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { compareQty } from '../uom/convert.ts'
import { pushFromCompletedMove } from './routing.ts'

export const RECEPTION_STEPS = ['one_step', 'two_steps', 'three_steps'] as const
export const DELIVERY_STEPS = ['ship_only', 'pick_ship', 'pick_pack_ship'] as const
export const PICKING_TYPE_CODES = ['incoming', 'outgoing', 'internal'] as const
export const LOCATION_USAGES = [
  'supplier',
  'view',
  'internal',
  'customer',
  'inventory',
  'production',
  'transit',
] as const
export const MOVE_STATES = [
  'draft',
  'waiting',
  'confirmed',
  'partially_available',
  'assigned',
  'done',
  'cancel',
] as const
export const PICKING_STATES = ['draft', 'waiting', 'confirmed', 'assigned', 'done', 'cancel'] as const
export const TRACKING = ['none', 'lot', 'serial'] as const

const invalid = (field: string, message: string) => ({ ok: false, errors: [{ field, message }] })
const company = (ctx: Ctx): string => {
  if (!ctx.scope.company) throw new Error('stock operation requires a company in scope')
  return ctx.scope.company
}
const lotKey = (lotId: unknown): string => (lotId == null ? '' : String(lotId))
const quantId = (ctx: Ctx, productId: unknown, locationId: unknown, lotId: unknown): string =>
  `${company(ctx)}:${String(productId)}:${String(locationId)}:${lotKey(lotId) || '_'}`

async function trackingOf(ctx: Ctx, productId: unknown): Promise<'none' | 'lot' | 'serial'> {
  const product = (await ctx.db.select('product.Product', { id: productId }))[0]
  if (!product) throw new Error(`unknown product ${String(productId)}`)
  const template = (await ctx.db.select('product.Template', { id: product.templateId }))[0]
  const tracking = String(template?.tracking ?? 'none')
  return TRACKING.includes(tracking as never) ? (tracking as 'none' | 'lot' | 'serial') : 'none'
}

async function isStorable(ctx: Ctx, productId: unknown): Promise<boolean> {
  const product = (await ctx.db.select('product.Product', { id: productId }))[0]
  const template = product && (await ctx.db.select('product.Template', { id: product.templateId }))[0]
  return Boolean(template?.isStorable)
}

async function mutateQuant(
  ctx: Ctx,
  args: { productId: unknown; locationId: unknown; lotId?: unknown; quantity: number; reserved: number },
): Promise<Row> {
  const id = quantId(ctx, args.productId, args.locationId, args.lotId)
  for (let attempt = 0; attempt < 8; attempt++) {
    const current = (await ctx.db.select('stock.Quant', { id }))[0]
    if (!current) {
      // Odoo keeps the other side of completed moves on supplier, customer and
      // inventory locations as well. Those virtual locations legitimately carry
      // negative quantities; only a positive physical balance can be reserved.
      if (args.reserved < 0 || args.reserved > Math.max(args.quantity, 0))
        throw new Error('quant cannot become over-reserved')
      const inserted = await ctx.db.insertIfAbsent('stock.Quant', {
        id,
        productId: args.productId,
        locationId: args.locationId,
        lotId: args.lotId ?? null,
        lotKey: lotKey(args.lotId),
        quantity: String(args.quantity),
        reservedQuantity: String(args.reserved),
        inDate: new Date().toISOString(),
        version: 0,
      })
      // A dry run writes nothing, so there is no row to re-read and nothing for the
      // retry loop to converge on. Report the quant that would have been created
      // rather than spinning eight times and blaming concurrency.
      if ('dryRun' in inserted)
        return {
          id,
          productId: args.productId,
          locationId: args.locationId,
          lotId: args.lotId ?? null,
          lotKey: lotKey(args.lotId),
          quantity: args.quantity,
          reservedQuantity: args.reserved,
          version: 0,
        }
      if (inserted.inserted) return (await ctx.db.select('stock.Quant', { id }))[0]!
      continue
    }
    const quantity = Number(current.quantity) + args.quantity
    const reservedQuantity = Number(current.reservedQuantity) + args.reserved
    if (reservedQuantity < -1e-12 || reservedQuantity - Math.max(quantity, 0) > 1e-12)
      throw new Error(`quant ${id} cannot become over-reserved`)
    const changed = await ctx.db.compareAndSet(
      'stock.Quant',
      { id },
      {
        quantity: current.quantity,
        reservedQuantity: current.reservedQuantity,
        version: current.version,
      },
      {
        quantity: String(quantity),
        reservedQuantity: String(reservedQuantity),
        version: Number(current.version) + 1,
      },
    )
    if ('dryRun' in changed || changed.matched)
      return { ...current, quantity, reservedQuantity, version: Number(current.version) + 1 }
  }
  throw new Error(`concurrent quant update did not settle for ${id}`)
}

/** How much of a quant is already spoken for; 0 when the quant does not exist. */
async function reservedOn(
  ctx: Ctx,
  productId: unknown,
  locationId: unknown,
  lotId: unknown,
): Promise<number> {
  const id = quantId(ctx, productId, locationId, lotId)
  const quant = (await ctx.db.select('stock.Quant', { id }))[0]
  return quant ? Number(quant.reservedQuantity) : 0
}

async function updatePickingState(ctx: Ctx, pickingId: unknown): Promise<void> {
  const picking = (await ctx.db.select('stock.Picking', { id: pickingId }))[0]
  // draft belongs to confirmPicking and cancel is terminal. Deriving a state from the
  // moves and writing it unconditionally let a reservation confirm a draft transfer
  // and resurrect a cancelled one.
  if (!picking || picking.state === 'draft' || picking.state === 'cancel') return
  const moves = await ctx.db.select('stock.Move', { pickingId })
  const live = moves.filter((move) => move.state !== 'cancel')
  let state = 'confirmed'
  if (moves.length && !live.length) state = 'cancel'
  else if (live.length && live.every((move) => move.state === 'done')) state = 'done'
  else if (live.some((move) => move.state === 'assigned' || move.state === 'partially_available'))
    state = 'assigned'
  else if (live.some((move) => move.state === 'waiting')) state = 'waiting'
  await ctx.db.update('stock.Picking', { id: pickingId }, { state })
}

export const functions: Record<string, FnSpec> = {
  listStorableProducts: defineFn({
    input: {},
    effects: ['read:product.Template', 'read:product.Product'],
    agent: true,
    handler: (ctx) => {
      const Template = ctx.table('product.Template')
      return ctx.db.all(
        from(Template)
          .where(eq(Template.active, true))
          .where(eq(Template.isStorable, true))
          .preload('variants'),
      )
    },
  }),
  getProductConfig: defineFn({
    input: { templateId: 'id' },
    output: { templateId: 'id', isStorable: 'bool', tracking: 'text' },
    effects: ['read:product.Template'],
    agent: true,
    handler: async (ctx, args) => {
      const template = (await ctx.db.select('product.Template', { id: args.templateId }))[0]
      return template
        ? {
            templateId: args.templateId,
            isStorable: Boolean(template.isStorable),
            tracking: String(template.tracking ?? 'none'),
          }
        : null
    },
  }),
  configureProduct: defineFn({
    input: { templateId: 'id', isStorable: 'bool', tracking: 'text?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:product.Template', 'write:product.Template'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const template = (await ctx.db.select('product.Template', { id: args.templateId }))[0]
      if (!template) return invalid('templateId', 'template không tồn tại')
      const tracking = String(args.tracking ?? 'none')
      if (!TRACKING.includes(tracking as never)) return invalid('tracking', `phải là: ${TRACKING.join(', ')}`)
      if (!args.isStorable && tracking !== 'none')
        return invalid('tracking', 'sản phẩm không lưu kho phải dùng tracking none')
      await ctx.db.update(
        'product.Template',
        { id: args.templateId },
        { isStorable: args.isStorable, tracking },
      )
      return { ok: true, id: args.templateId }
    },
  }),
  listWarehouses: defineFn({
    input: {},
    effects: ['read:stock.Warehouse'],
    agent: true,
    handler: (ctx) => ctx.db.select('stock.Warehouse', { active: true }),
  }),
  listPickings: defineFn({
    input: { state: 'text?' },
    effects: ['read:stock.Picking'],
    agent: true,
    handler: async (ctx, args) =>
      args.state ? ctx.db.select('stock.Picking', { state: args.state }) : ctx.db.select('stock.Picking'),
  }),
  getPicking: defineFn({
    input: { id: 'id' },
    effects: ['read:stock.Picking', 'read:stock.Move', 'read:stock.MoveLine'],
    agent: true,
    handler: async (ctx, args) => {
      const picking = (await ctx.db.select('stock.Picking', { id: args.id }))[0]
      if (!picking) return null
      const moves = await ctx.db.select('stock.Move', { pickingId: args.id })
      return {
        ...picking,
        moves: await Promise.all(
          moves.map(async (move) => ({
            ...move,
            lines: await ctx.db.select('stock.MoveLine', { moveId: move.id }),
          })),
        ),
      }
    },
  }),
  listLocations: defineFn({
    input: { warehouseId: 'id?' },
    effects: ['read:stock.Location'],
    agent: true,
    handler: (ctx, args) =>
      ctx.db.select('stock.Location', args.warehouseId ? { warehouseId: args.warehouseId } : {}),
  }),
  listPickingTypes: defineFn({
    input: {},
    effects: ['read:stock.PickingType'],
    agent: true,
    handler: (ctx) => ctx.db.select('stock.PickingType', { active: true }),
  }),
  listLots: defineFn({
    input: { productId: 'id?' },
    effects: ['read:stock.Lot'],
    agent: true,
    handler: (ctx, args) => ctx.db.select('stock.Lot', args.productId ? { productId: args.productId } : {}),
  }),
  listQuants: defineFn({
    input: { productId: 'id?', locationId: 'id?' },
    effects: ['read:stock.Quant'],
    agent: true,
    handler: (ctx, args) =>
      ctx.db.select('stock.Quant', {
        ...(args.productId ? { productId: args.productId } : {}),
        ...(args.locationId ? { locationId: args.locationId } : {}),
      }),
  }),

  saveWarehouse: defineFn({
    input: { id: 'id', name: 'text', code: 'text', receptionSteps: 'text?', deliverySteps: 'text?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:stock.Warehouse',
      'write:stock.Warehouse',
      'read:stock.Location',
      'write:stock.Location',
      'read:stock.PickingType',
      'write:stock.PickingType',
      'read:stock.Route',
      'write:stock.Route',
      'read:stock.Rule',
      'write:stock.Rule',
      'read:stock.WarehouseRoute',
      'write:stock.WarehouseRoute',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const receptionSteps = args.receptionSteps ?? 'one_step'
      const deliverySteps = args.deliverySteps ?? 'ship_only'
      if (!RECEPTION_STEPS.includes(receptionSteps as never))
        return invalid('receptionSteps', `phải là: ${RECEPTION_STEPS.join(', ')}`)
      if (!DELIVERY_STEPS.includes(deliverySteps as never))
        return invalid('deliverySteps', `phải là: ${DELIVERY_STEPS.join(', ')}`)
      const existing = (await ctx.db.select('stock.Warehouse', { id: args.id }))[0]
      const values = { ...args, receptionSteps, deliverySteps, active: true }
      const cs = ctx
        .change('stock.Warehouse', values, existing ?? null)
        .cast(['id', 'name', 'code', 'receptionSteps', 'deliverySteps', 'active'])
        .required(['name', 'code'])
      if (!cs.valid) return { ok: false, errors: cs.errors }
      await ctx.tx(async (tx) => {
        await tx.db.commit(cs, existing ? { id: args.id } : undefined)
        const viewId = `${String(args.id)}:view`
        const locations = [
          { suffix: 'view', name: String(args.name), usage: 'view', parentId: null, active: true },
          { suffix: 'stock', name: 'Stock', usage: 'internal', parentId: viewId, active: true },
          {
            suffix: 'input',
            name: 'Input',
            usage: 'internal',
            parentId: viewId,
            active: receptionSteps !== 'one_step',
          },
          {
            suffix: 'quality',
            name: 'Quality',
            usage: 'internal',
            parentId: viewId,
            active: receptionSteps === 'three_steps',
          },
          {
            suffix: 'output',
            name: 'Output',
            usage: 'internal',
            parentId: viewId,
            active: deliverySteps !== 'ship_only',
          },
          {
            suffix: 'pick',
            name: 'Pick',
            usage: 'internal',
            parentId: viewId,
            active: deliverySteps !== 'ship_only',
          },
          {
            suffix: 'pack',
            name: 'Pack',
            usage: 'internal',
            parentId: viewId,
            active: deliverySteps === 'pick_pack_ship',
          },
          { suffix: 'supplier', name: 'Supplier', usage: 'supplier', parentId: null, active: true },
          { suffix: 'customer', name: 'Customer', usage: 'customer', parentId: null, active: true },
        ]
        for (const location of locations) {
          const id = `${String(args.id)}:${location.suffix}`
          const values = {
            name: location.name,
            usage: location.usage,
            parentId: location.parentId,
            parentPath: location.parentId ? `${viewId}/${id}/` : `${id}/`,
            warehouseId: args.id,
            active: location.active,
          }
          const found = (await tx.db.select('stock.Location', { id }))[0]
          if (found) await tx.db.update('stock.Location', { id }, values)
          else await tx.db.insert('stock.Location', { id, ...values })
        }
        const incomingDestination =
          receptionSteps === 'one_step' ? `${String(args.id)}:stock` : `${String(args.id)}:input`
        const outgoingSource =
          deliverySteps === 'ship_only' ? `${String(args.id)}:stock` : `${String(args.id)}:output`
        const types = [
          {
            id: `${String(args.id)}:incoming`,
            name: 'Receipts',
            code: 'incoming',
            source: `${String(args.id)}:supplier`,
            destination: incomingDestination,
          },
          {
            id: `${String(args.id)}:outgoing`,
            name: 'Delivery Orders',
            code: 'outgoing',
            source: outgoingSource,
            destination: `${String(args.id)}:customer`,
            active: true,
          },
          {
            id: `${String(args.id)}:internal`,
            name: 'Internal Transfers',
            code: 'internal',
            source: `${String(args.id)}:stock`,
            destination: `${String(args.id)}:output`,
            active: true,
          },
          {
            id: `${String(args.id)}:quality`,
            name: 'Quality Control',
            code: 'internal',
            source: `${String(args.id)}:input`,
            destination: `${String(args.id)}:quality`,
            active: receptionSteps === 'three_steps',
          },
          {
            id: `${String(args.id)}:store`,
            name: 'Store',
            code: 'internal',
            source:
              receptionSteps === 'three_steps' ? `${String(args.id)}:quality` : `${String(args.id)}:input`,
            destination: `${String(args.id)}:stock`,
            active: receptionSteps !== 'one_step',
          },
          {
            id: `${String(args.id)}:pick`,
            name: 'Pick',
            code: 'internal',
            source: `${String(args.id)}:stock`,
            destination:
              deliverySteps === 'pick_pack_ship' ? `${String(args.id)}:pack` : `${String(args.id)}:output`,
            active: deliverySteps !== 'ship_only',
          },
          {
            id: `${String(args.id)}:pack`,
            name: 'Pack',
            code: 'internal',
            source: `${String(args.id)}:pack`,
            destination: `${String(args.id)}:output`,
            active: deliverySteps === 'pick_pack_ship',
          },
        ]
        for (const type of types) {
          const values = {
            name: type.name,
            code: type.code,
            warehouseId: args.id,
            defaultLocationSrcId: type.source,
            defaultLocationDestId: type.destination,
            createBackorder: 'ask',
            active: type.active ?? true,
          }
          const found = (await tx.db.select('stock.PickingType', { id: type.id }))[0]
          if (found) await tx.db.update('stock.PickingType', { id: type.id }, values)
          else await tx.db.insert('stock.PickingType', { id: type.id, ...values })
        }

        const warehouseId = String(args.id)
        const receiptRouteId = `${warehouseId}:receipt-route`
        const deliveryRouteId = `${warehouseId}:delivery-route`
        const routes = [
          { id: receiptRouteId, name: `${String(args.name)}: ${receptionSteps}`, sequence: 50 },
          { id: deliveryRouteId, name: `${String(args.name)}: ${deliverySteps}`, sequence: 60 },
        ]
        for (const route of routes) {
          const found = (await tx.db.select('stock.Route', { id: route.id }))[0]
          const values = { name: route.name, sequence: route.sequence, active: true }
          if (found) await tx.db.update('stock.Route', { id: route.id }, values)
          else await tx.db.insert('stock.Route', { id: route.id, ...values })
          await tx.db.insertIfAbsent('stock.WarehouseRoute', {
            id: `${company(tx)}:${warehouseId}:${route.id}`,
            warehouseId: args.id,
            routeId: route.id,
          })
        }

        // The subset executes route chains backwards from demand, so each leg is
        // represented as a pull rule. The resulting locations and operation types
        // match Odoo 19's receipt/delivery topology.
        const ruleDefinitions = [
          {
            id: `${warehouseId}:receipt:supplier-stock`,
            name: 'Receive in Stock',
            routeId: receiptRouteId,
            source: `${warehouseId}:supplier`,
            destination: `${warehouseId}:stock`,
            pickingTypeId: `${warehouseId}:incoming`,
            active: receptionSteps === 'one_step',
          },
          {
            id: `${warehouseId}:receipt:supplier-input`,
            name: 'Receive in Input',
            routeId: receiptRouteId,
            source: `${warehouseId}:supplier`,
            destination: `${warehouseId}:input`,
            pickingTypeId: `${warehouseId}:incoming`,
            active: receptionSteps !== 'one_step',
          },
          {
            id: `${warehouseId}:receipt:input-stock`,
            name: 'Input to Stock',
            routeId: receiptRouteId,
            source: `${warehouseId}:input`,
            destination: `${warehouseId}:stock`,
            pickingTypeId: `${warehouseId}:store`,
            active: receptionSteps === 'two_steps',
          },
          {
            id: `${warehouseId}:receipt:input-quality`,
            name: 'Input to Quality',
            routeId: receiptRouteId,
            source: `${warehouseId}:input`,
            destination: `${warehouseId}:quality`,
            pickingTypeId: `${warehouseId}:quality`,
            active: receptionSteps === 'three_steps',
          },
          {
            id: `${warehouseId}:receipt:quality-stock`,
            name: 'Quality to Stock',
            routeId: receiptRouteId,
            source: `${warehouseId}:quality`,
            destination: `${warehouseId}:stock`,
            pickingTypeId: `${warehouseId}:store`,
            active: receptionSteps === 'three_steps',
          },
          {
            id: `${warehouseId}:delivery:stock-customer`,
            name: 'Deliver from Stock',
            routeId: deliveryRouteId,
            source: `${warehouseId}:stock`,
            destination: `${warehouseId}:customer`,
            pickingTypeId: `${warehouseId}:outgoing`,
            active: deliverySteps === 'ship_only',
          },
          {
            id: `${warehouseId}:delivery:stock-output`,
            name: 'Pick to Output',
            routeId: deliveryRouteId,
            source: `${warehouseId}:stock`,
            destination: `${warehouseId}:output`,
            pickingTypeId: `${warehouseId}:pick`,
            procureMethod: 'make_to_stock',
            active: deliverySteps === 'pick_ship',
          },
          {
            id: `${warehouseId}:delivery:stock-pack`,
            name: 'Pick to Pack',
            routeId: deliveryRouteId,
            source: `${warehouseId}:stock`,
            destination: `${warehouseId}:pack`,
            pickingTypeId: `${warehouseId}:pick`,
            procureMethod: 'make_to_stock',
            active: deliverySteps === 'pick_pack_ship',
          },
          {
            id: `${warehouseId}:delivery:pack-output`,
            name: 'Pack to Output',
            routeId: deliveryRouteId,
            source: `${warehouseId}:pack`,
            destination: `${warehouseId}:output`,
            pickingTypeId: `${warehouseId}:pack`,
            active: deliverySteps === 'pick_pack_ship',
          },
          {
            id: `${warehouseId}:delivery:output-customer`,
            name: 'Ship from Output',
            routeId: deliveryRouteId,
            source: `${warehouseId}:output`,
            destination: `${warehouseId}:customer`,
            pickingTypeId: `${warehouseId}:outgoing`,
            active: deliverySteps !== 'ship_only',
          },
        ]
        for (const [sequence, rule] of ruleDefinitions.entries()) {
          const values = {
            name: rule.name,
            routeId: rule.routeId,
            action: 'pull',
            sequence: sequence + 10,
            locationSrcId: rule.source,
            locationDestId: rule.destination,
            pickingTypeId: rule.pickingTypeId,
            procureMethod: rule.procureMethod ?? 'make_to_order',
            active: rule.active,
          }
          const found = (await tx.db.select('stock.Rule', { id: rule.id }))[0]
          if (found) await tx.db.update('stock.Rule', { id: rule.id }, values)
          else await tx.db.insert('stock.Rule', { id: rule.id, ...values })
        }
      })
      return { ok: true, id: args.id }
    },
  }),

  saveLocation: defineFn({
    input: { id: 'id', name: 'text', usage: 'text', parentId: 'id?', warehouseId: 'id?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:stock.Location', 'write:stock.Location'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      if (!LOCATION_USAGES.includes(args.usage as never))
        return invalid('usage', `phải là: ${LOCATION_USAGES.join(', ')}`)
      if (args.parentId === args.id) return invalid('parentId', 'location không thể là cha của chính nó')
      let parentPath = `${String(args.id)}/`
      if (args.parentId) {
        const parent = (await ctx.db.select('stock.Location', { id: args.parentId }))[0]
        if (!parent) return invalid('parentId', 'location cha không tồn tại')
        if (String(parent.parentPath).split('/').includes(String(args.id)))
          return invalid('parentId', 'cây location có vòng lặp')
        parentPath = `${String(parent.parentPath)}${String(args.id)}/`
      }
      const existing = (await ctx.db.select('stock.Location', { id: args.id }))[0]
      const values = { ...args, parentPath, active: true }
      const cs = ctx
        .change('stock.Location', values, existing ?? null)
        .cast(['id', 'name', 'usage', 'parentId', 'parentPath', 'warehouseId', 'active'])
        .required(['name', 'usage'])
      if (!cs.valid) return { ok: false, errors: cs.errors }
      await ctx.db.commit(cs, existing ? { id: args.id } : undefined)
      return { ok: true, id: args.id }
    },
  }),

  savePickingType: defineFn({
    input: {
      id: 'id',
      name: 'text',
      code: 'text',
      warehouseId: 'id?',
      defaultLocationSrcId: 'id?',
      defaultLocationDestId: 'id?',
      createBackorder: 'text?',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:stock.PickingType', 'write:stock.PickingType'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      if (!PICKING_TYPE_CODES.includes(args.code as never))
        return invalid('code', `phải là: ${PICKING_TYPE_CODES.join(', ')}`)
      const createBackorder = String(args.createBackorder ?? 'ask')
      if (!['ask', 'always', 'never'].includes(createBackorder))
        return invalid('createBackorder', 'phải là ask, always hoặc never')
      const existing = (await ctx.db.select('stock.PickingType', { id: args.id }))[0]
      const values = { ...args, createBackorder, active: true }
      const cs = ctx
        .change('stock.PickingType', values, existing ?? null)
        .cast([
          'id',
          'name',
          'code',
          'warehouseId',
          'defaultLocationSrcId',
          'defaultLocationDestId',
          'createBackorder',
          'active',
        ])
        .required(['name', 'code'])
      if (!cs.valid) return { ok: false, errors: cs.errors }
      await ctx.db.commit(cs, existing ? { id: args.id } : undefined)
      return { ok: true, id: args.id }
    },
  }),

  createLot: defineFn({
    input: { id: 'id', productId: 'id', name: 'text', ref: 'text?', note: 'text?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:product.Product', 'write:stock.Lot'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      if (!(await ctx.db.select('product.Product', { id: args.productId }))[0])
        return invalid('productId', 'biến thể không tồn tại')
      const result = await ctx.db.insertIfAbsent('stock.Lot', { ...args, active: true })
      return 'inserted' in result && !result.inserted
        ? invalid('name', 'lot/serial đã tồn tại cho sản phẩm')
        : { ok: true, id: args.id }
    },
  }),

  createPicking: defineFn({
    input: {
      id: 'id',
      name: 'text',
      pickingTypeId: 'id',
      locationId: 'id?',
      locationDestId: 'id?',
      moveType: 'text?',
      scheduledDate: 'datetime?',
      backorderId: 'id?',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:stock.PickingType', 'write:stock.Picking'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const type = (await ctx.db.select('stock.PickingType', { id: args.pickingTypeId }))[0]
      if (!type) return invalid('pickingTypeId', 'operation type không tồn tại')
      const locationId = args.locationId ?? type.defaultLocationSrcId
      const locationDestId = args.locationDestId ?? type.defaultLocationDestId
      if (!locationId || !locationDestId) return invalid('locationId', 'cần source và destination location')
      const moveType = String(args.moveType ?? 'direct')
      if (!['direct', 'one'].includes(moveType)) return invalid('moveType', 'phải là direct hoặc one')
      const inserted = await ctx.db.insertIfAbsent('stock.Picking', {
        id: args.id,
        name: args.name,
        pickingTypeId: args.pickingTypeId,
        locationId,
        locationDestId,
        moveType,
        state: 'draft',
        backorderId: args.backorderId ?? null,
        scheduledDate: args.scheduledDate ?? new Date().toISOString(),
        dateDone: null,
      })
      return 'inserted' in inserted && !inserted.inserted
        ? { ok: true, id: args.id }
        : { ok: true, id: args.id }
    },
  }),

  addMove: defineFn({
    input: {
      id: 'id',
      name: 'text',
      pickingId: 'id?',
      productId: 'id',
      productUomId: 'id',
      productUomQty: 'decimal',
      locationId: 'id?',
      locationDestId: 'id?',
      procureMethod: 'text?',
      ruleId: 'id?',
      origin: 'text?',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:stock.Picking', 'read:product.Product', 'read:uom.Unit', 'write:stock.Move'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const picking = args.pickingId
        ? (await ctx.db.select('stock.Picking', { id: args.pickingId }))[0]
        : null
      if (args.pickingId && !picking) return invalid('pickingId', 'transfer không tồn tại')
      if (picking && ['done', 'cancel'].includes(String(picking.state)))
        return invalid('pickingId', 'không thể thêm move vào transfer đã kết thúc')
      if (!(await ctx.db.select('product.Product', { id: args.productId }))[0])
        return invalid('productId', 'biến thể không tồn tại')
      if (!(await ctx.db.select('uom.Unit', { id: args.productUomId }))[0])
        return invalid('productUomId', 'đơn vị không tồn tại')
      if (!(Number(args.productUomQty) > 0)) return invalid('productUomQty', 'phải lớn hơn 0')
      const locationId = args.locationId ?? picking?.locationId
      const locationDestId = args.locationDestId ?? picking?.locationDestId
      if (!locationId || !locationDestId) return invalid('locationId', 'cần source và destination location')
      const procureMethod = String(args.procureMethod ?? 'make_to_stock')
      if (!['make_to_stock', 'make_to_order'].includes(procureMethod))
        return invalid('procureMethod', 'move chỉ nhận make_to_stock hoặc make_to_order')
      await ctx.db.insertIfAbsent('stock.Move', {
        id: args.id,
        name: args.name,
        pickingId: args.pickingId ?? null,
        productId: args.productId,
        productUomId: args.productUomId,
        productUomQty: args.productUomQty,
        quantity: '0',
        locationId,
        locationDestId,
        state: picking?.state === 'draft' ? 'draft' : 'confirmed',
        picked: false,
        procureMethod,
        ruleId: args.ruleId ?? null,
        origin: args.origin ?? null,
      })
      return { ok: true, id: args.id }
    },
  }),

  confirmPicking: defineFn({
    input: { id: 'id' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:stock.Picking', 'read:stock.Move', 'write:stock.Picking', 'write:stock.Move'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const picking = (await ctx.db.select('stock.Picking', { id: args.id }))[0]
      if (!picking) return invalid('id', 'transfer không tồn tại')
      if (picking.state === 'done' || picking.state === 'cancel')
        return invalid('state', 'transfer đã kết thúc')
      await ctx.db.update('stock.Picking', { id: args.id }, { state: 'confirmed' })
      for (const move of await ctx.db.select('stock.Move', { pickingId: args.id }))
        if (move.state === 'draft') await ctx.db.update('stock.Move', { id: move.id }, { state: 'confirmed' })
      return { ok: true, id: args.id }
    },
  }),

  reserveMove: defineFn({
    input: { id: 'id' },
    output: { ok: 'bool', reserved: 'decimal?', state: 'text?', errors: 'json?' },
    effects: [
      'read:stock.Move',
      'write:stock.Move',
      'read:stock.Picking',
      'write:stock.Picking',
      'read:stock.MoveLine',
      'write:stock.MoveLine',
      'read:stock.Quant',
      'write:stock.Quant',
      'read:product.Product',
      'read:product.Template',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const move = (await ctx.db.select('stock.Move', { id: args.id }))[0]
      if (!move) return invalid('id', 'move không tồn tại')
      if (!(await isStorable(ctx, move.productId)))
        return invalid('productId', 'chỉ sản phẩm lưu kho mới được reserve')
      if (['done', 'cancel'].includes(String(move.state))) return invalid('state', 'move đã kết thúc')
      if (move.state === 'draft') return invalid('state', 'xác nhận transfer trước khi reserve')
      const demand = Number(move.productUomQty)
      let reserved = (await ctx.db.select('stock.MoveLine', { moveId: move.id }))
        .filter((line) => !line.picked)
        .reduce((sum, line) => sum + Number(line.quantity), 0)
      let state = 'confirmed'
      const tracking = await trackingOf(ctx, move.productId)
      const quants = (
        await ctx.db.select('stock.Quant', { productId: move.productId, locationId: move.locationId })
      ).sort((a, b) => String(a.lotKey).localeCompare(String(b.lotKey)))
      await ctx.tx(async (tx) => {
        for (const quant of quants) {
          if (reserved >= demand) break
          if (tracking !== 'none' && !quant.lotId) continue
          const available = Number(quant.quantity) - Number(quant.reservedQuantity)
          if (available <= 0) continue
          const take = Math.min(
            available,
            demand - reserved,
            tracking === 'serial' ? 1 : Number.POSITIVE_INFINITY,
          )
          await mutateQuant(tx, {
            productId: move.productId,
            locationId: move.locationId,
            lotId: quant.lotId,
            quantity: 0,
            reserved: take,
          })
          const lineId = `${String(move.id)}:reserve:${String(quant.id)}`
          const line = (await tx.db.select('stock.MoveLine', { id: lineId }))[0]
          if (line)
            await tx.db.update(
              'stock.MoveLine',
              { id: lineId },
              { quantity: String(Number(line.quantity) + take) },
            )
          else
            await tx.db.insert('stock.MoveLine', {
              id: lineId,
              moveId: move.id,
              pickingId: move.pickingId,
              productId: move.productId,
              productUomId: move.productUomId,
              quantity: String(take),
              quantityProductUom: String(take),
              locationId: move.locationId,
              locationDestId: move.locationDestId,
              lotId: quant.lotId,
              picked: false,
            })
          reserved += take
        }
        state =
          compareQty(reserved, demand, 0.000001) >= 0
            ? 'assigned'
            : reserved > 0
              ? 'partially_available'
              : 'confirmed'
        await tx.db.update('stock.Move', { id: move.id }, { state, quantity: String(reserved) })
        if (move.pickingId) await updatePickingState(tx, move.pickingId)
      })
      // The state that was written, not a second derivation of it: the tolerant
      // compareQty above and a bare `reserved >= demand` disagree inside 1e-6, and
      // the caller was being told the opposite of what landed in the row.
      return { ok: true, reserved: String(reserved), state }
    },
  }),

  saveMoveLine: defineFn({
    input: { id: 'id', moveId: 'id', quantity: 'decimal', lotId: 'id?', picked: 'bool?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:stock.Move',
      'read:stock.MoveLine',
      'write:stock.MoveLine',
      'read:stock.Lot',
      'read:stock.Location',
      'read:stock.Quant',
      'write:stock.Quant',
      'read:product.Product',
      'read:product.Template',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const move = (await ctx.db.select('stock.Move', { id: args.moveId }))[0]
      if (!move) return invalid('moveId', 'move không tồn tại')
      if (['done', 'cancel'].includes(String(move.state)))
        return invalid('moveId', 'không thể sửa dòng của move đã kết thúc')
      const tracking = await trackingOf(ctx, move.productId)
      if (tracking !== 'none' && !args.lotId)
        return invalid('lotId', `${tracking} tracked product cần lot/serial`)
      if (!(Number(args.quantity) > 0)) return invalid('quantity', 'phải lớn hơn 0')
      if (tracking === 'serial' && compareQty(Number(args.quantity), 1, 0.000001) > 0)
        return invalid('quantity', 'serial move line không được lớn hơn 1')
      if (tracking === 'serial' && args.picked && compareQty(Number(args.quantity), 1, 0.000001) !== 0)
        return invalid('quantity', 'serial đã pick phải có quantity đúng 1')
      if (args.lotId) {
        const lot = (await ctx.db.select('stock.Lot', { id: args.lotId }))[0]
        if (!lot || lot.productId !== move.productId)
          return invalid('lotId', 'lot/serial không thuộc sản phẩm')
      }
      const existing = (await ctx.db.select('stock.MoveLine', { id: args.id }))[0]
      const values = {
        id: args.id,
        moveId: move.id,
        pickingId: move.pickingId,
        productId: move.productId,
        productUomId: move.productUomId,
        quantity: args.quantity,
        quantityProductUom: args.quantity,
        locationId: move.locationId,
        locationDestId: move.locationDestId,
        lotId: args.lotId ?? null,
        picked: args.picked ?? false,
      }
      const cs = ctx
        .change('stock.MoveLine', values, existing ?? null)
        .cast([
          'id',
          'moveId',
          'pickingId',
          'productId',
          'productUomId',
          'quantity',
          'quantityProductUom',
          'locationId',
          'locationDestId',
          'lotId',
          'picked',
        ])
        .required(['moveId', 'productId', 'productUomId', 'quantity', 'locationId', 'locationDestId'])
      if (!cs.valid) return { ok: false, errors: cs.errors }
      await ctx.tx(async (tx) => {
        const source = (await tx.db.select('stock.Location', { id: move.locationId }))[0]
        if (source && ['internal', 'transit'].includes(String(source.usage))) {
          const oldQuantity = existing && !existing.picked ? Number(existing.quantity) : 0
          const newQuantity = Number(args.quantity)
          if (existing && lotKey(existing.lotId) !== lotKey(args.lotId) && oldQuantity)
            await mutateQuant(tx, {
              productId: move.productId,
              locationId: move.locationId,
              lotId: existing.lotId,
              quantity: 0,
              reserved: -oldQuantity,
            })
          const delta =
            lotKey(existing?.lotId) === lotKey(args.lotId) ? newQuantity - oldQuantity : newQuantity
          if (delta)
            await mutateQuant(tx, {
              productId: move.productId,
              locationId: move.locationId,
              lotId: args.lotId,
              quantity: 0,
              reserved: delta,
            })
        }
        await tx.db.commit(cs, existing ? { id: args.id } : undefined)
      })
      return { ok: true, id: args.id }
    },
  }),

  completePicking: defineFn({
    input: { id: 'id', quantities: 'json?', createBackorder: 'bool?', pickedOnly: 'bool?' },
    output: { ok: 'bool', id: 'id?', backorderId: 'id?', errors: 'json?' },
    effects: [
      'read:stock.Picking',
      'write:stock.Picking',
      'read:stock.PickingType',
      'read:stock.Move',
      'write:stock.Move',
      'read:stock.MoveLine',
      'write:stock.MoveLine',
      'read:stock.Location',
      'read:stock.Quant',
      'write:stock.Quant',
      'read:product.Product',
      'read:product.Template',
      'read:product.Category',
      'read:stock.Route',
      'read:stock.Rule',
      'read:stock.ProductRoute',
      'read:stock.CategoryRoute',
      'read:stock.WarehouseRoute',
      'read:stock.MoveLink',
      'write:stock.MoveLink',
    ],
    agent: true,
    handler: async (ctx, args) => {
      const picking = (await ctx.db.select('stock.Picking', { id: args.id }))[0]
      if (!picking) return invalid('id', 'transfer không tồn tại')
      if (picking.state === 'done') return { ok: true, id: args.id }
      if (picking.state === 'cancel') return invalid('state', 'transfer đã hủy')
      const requested = new Map<string, number>()
      if (Array.isArray(args.quantities))
        for (const entry of args.quantities as Array<{ moveLineId: string; quantity: number }>)
          requested.set(String(entry.moveLineId), Number(entry.quantity))
      const moves = await ctx.db.select('stock.Move', { pickingId: args.id })
      const remaining: Array<{ move: Row; quantity: number }> = []
      await ctx.tx(async (tx) => {
        for (const move of moves) {
          const tracking = await trackingOf(tx, move.productId)
          const source = (await tx.db.select('stock.Location', { id: move.locationId }))[0]!
          const destination = (await tx.db.select('stock.Location', { id: move.locationDestId }))[0]!
          const lines = await tx.db.select('stock.MoveLine', { moveId: move.id })
          let done = 0
          for (const line of lines) {
            const reserved = Number(line.quantity)
            if (args.pickedOnly && !line.picked) {
              if ((source.usage === 'internal' || source.usage === 'transit') && reserved)
                await mutateQuant(tx, {
                  productId: move.productId,
                  locationId: move.locationId,
                  lotId: line.lotId,
                  quantity: 0,
                  reserved: -reserved,
                })
              await tx.db.update(
                'stock.MoveLine',
                { id: line.id },
                { quantity: '0', quantityProductUom: '0', picked: true },
              )
              continue
            }
            const quantity = requested.has(String(line.id))
              ? requested.get(String(line.id))!
              : requested.size
                ? 0
                : reserved
            if (quantity < 0 || quantity > reserved)
              throw new Error(`invalid done quantity for ${String(line.id)}`)
            if (tracking !== 'none' && !line.lotId)
              throw new Error(`${tracking} tracked product requires a lot/serial`)
            if (tracking === 'serial' && quantity > 0 && compareQty(quantity, 1, 0.000001) !== 0)
              throw new Error('serial picked move line quantity must equal 1')
            if (source.usage === 'internal' || source.usage === 'transit') {
              // Release only what this line actually holds. A line written by
              // saveMoveLine never incremented the quant's reservedQuantity, so
              // releasing its full quantity drove the mirror negative and threw —
              // leaving the transfer impossible to complete by any later call.
              const held = await reservedOn(tx, move.productId, move.locationId, line.lotId)
              await mutateQuant(tx, {
                productId: move.productId,
                locationId: move.locationId,
                lotId: line.lotId,
                quantity: -quantity,
                reserved: -Math.min(reserved, held),
              })
            } else {
              await mutateQuant(tx, {
                productId: move.productId,
                locationId: move.locationId,
                lotId: line.lotId,
                quantity: -quantity,
                reserved: 0,
              })
            }
            // Keep both sides of every completed move in the quant ledger. The
            // forecast still counts only internal/transit locations.
            if (destination)
              await mutateQuant(tx, {
                productId: move.productId,
                locationId: move.locationDestId,
                lotId: line.lotId,
                quantity,
                reserved: 0,
              })
            await tx.db.update(
              'stock.MoveLine',
              { id: line.id },
              { quantity: String(quantity), quantityProductUom: String(quantity), picked: true },
            )
            done += quantity
          }
          await tx.db.update(
            'stock.Move',
            { id: move.id },
            { quantity: String(done), picked: true, state: 'done' },
          )
          await pushFromCompletedMove(tx, move, done)
          const left = Math.max(0, Number(move.productUomQty) - done)
          if (left > 0) remaining.push({ move, quantity: left })
        }
        await tx.db.update(
          'stock.Picking',
          { id: args.id },
          { state: 'done', dateDone: new Date().toISOString() },
        )
      })

      const type = (await ctx.db.select('stock.PickingType', { id: picking.pickingTypeId }))[0]
      const shouldBackorder =
        remaining.length > 0 && (args.createBackorder ?? type?.createBackorder !== 'never')
      let backorderId: string | null = null
      if (shouldBackorder) {
        backorderId = `${String(args.id)}:backorder:${Date.now()}`
        await ctx.db.insert('stock.Picking', {
          id: backorderId,
          name: `${String(picking.name)} backorder`,
          pickingTypeId: picking.pickingTypeId,
          locationId: picking.locationId,
          locationDestId: picking.locationDestId,
          moveType: picking.moveType,
          state: 'confirmed',
          backorderId: picking.id,
          scheduledDate: new Date().toISOString(),
          dateDone: null,
        })
        for (const { move, quantity } of remaining) {
          const id = `${String(move.id)}:backorder:${Date.now()}`
          await ctx.db.insert('stock.Move', {
            ...Object.fromEntries(Object.entries(move).filter(([key]) => key !== 'companyId')),
            id,
            pickingId: backorderId,
            productUomQty: String(quantity),
            quantity: '0',
            state: 'confirmed',
            picked: false,
          })
          await ctx.db.insertIfAbsent('stock.MoveLink', {
            id: `${String(move.id)}:${id}`,
            originMoveId: move.id,
            destinationMoveId: id,
          })
        }
      }
      return { ok: true, id: args.id, backorderId }
    },
  }),

  adjustInventory: defineFn({
    input: {
      id: 'id',
      productId: 'id',
      locationId: 'id',
      inventoryLocationId: 'id',
      countedQuantity: 'decimal',
      lotId: 'id?',
      productUomId: 'id',
    },
    output: { ok: 'bool', pickingId: 'id?', moveId: 'id?', difference: 'decimal?', errors: 'json?' },
    effects: [
      'read:stock.Quant',
      'write:stock.Quant',
      'read:stock.Location',
      'read:stock.Lot',
      'read:stock.PickingType',
      'write:stock.PickingType',
      'write:stock.Picking',
      'write:stock.Move',
      'write:stock.MoveLine',
      'read:product.Product',
      'read:product.Template',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      if (!(await isStorable(ctx, args.productId)))
        return invalid('productId', 'chỉ sản phẩm lưu kho mới kiểm kê')
      if (Number(args.countedQuantity) < 0)
        return invalid('countedQuantity', 'số lượng kiểm kê không được âm')
      const tracking = await trackingOf(ctx, args.productId)
      if (tracking !== 'none' && !args.lotId)
        return invalid('lotId', `${tracking} tracked product cần lot/serial`)
      if (tracking === 'serial' && compareQty(Number(args.countedQuantity), 1, 0.000001) > 0)
        return invalid('countedQuantity', 'mỗi serial chỉ có thể có số lượng 0 hoặc 1')
      if (args.lotId) {
        const lot = (await ctx.db.select('stock.Lot', { id: args.lotId }))[0]
        if (!lot || lot.productId !== args.productId)
          return invalid('lotId', 'lot/serial không thuộc sản phẩm')
      }
      const current = (
        await ctx.db.select('stock.Quant', {
          productId: args.productId,
          locationId: args.locationId,
          lotKey: lotKey(args.lotId),
        })
      )[0]
      const difference = Number(args.countedQuantity) - Number(current?.quantity ?? 0)
      if (Math.abs(difference) < 1e-12) return { ok: true, moveId: args.id, difference: '0' }
      const incoming = difference > 0
      const source = incoming ? args.inventoryLocationId : args.locationId
      const destination = incoming ? args.locationId : args.inventoryLocationId
      const pickingTypeId = `${String(args.inventoryLocationId)}:adjustment`
      const pickingId = `${String(args.id)}:picking`
      await ctx.tx(async (tx) => {
        await mutateQuant(tx, {
          productId: args.productId,
          locationId: source,
          lotId: args.lotId,
          quantity: -Math.abs(difference),
          reserved: 0,
        })
        await mutateQuant(tx, {
          productId: args.productId,
          locationId: destination,
          lotId: args.lotId,
          quantity: Math.abs(difference),
          reserved: 0,
        })
        await tx.db.insertIfAbsent('stock.PickingType', {
          id: pickingTypeId,
          name: 'Inventory Adjustments',
          code: 'internal',
          warehouseId: null,
          defaultLocationSrcId: args.inventoryLocationId,
          defaultLocationDestId: args.locationId,
          createBackorder: 'never',
          active: true,
        })
        await tx.db.insertIfAbsent('stock.Picking', {
          id: pickingId,
          name: `Inventory ${String(args.id)}`,
          pickingTypeId,
          locationId: source,
          locationDestId: destination,
          moveType: 'direct',
          state: 'done',
          backorderId: null,
          scheduledDate: new Date().toISOString(),
          dateDone: new Date().toISOString(),
        })
        await tx.db.insertIfAbsent('stock.Move', {
          id: args.id,
          name: 'Inventory adjustment',
          pickingId,
          productId: args.productId,
          productUomId: args.productUomId,
          productUomQty: String(Math.abs(difference)),
          quantity: String(Math.abs(difference)),
          locationId: source,
          locationDestId: destination,
          state: 'done',
          picked: true,
          procureMethod: 'make_to_stock',
          ruleId: null,
          origin: 'inventory',
        })
        await tx.db.insertIfAbsent('stock.MoveLine', {
          id: `${args.id}:line`,
          moveId: args.id,
          pickingId,
          productId: args.productId,
          productUomId: args.productUomId,
          quantity: String(Math.abs(difference)),
          quantityProductUom: String(Math.abs(difference)),
          locationId: source,
          locationDestId: destination,
          lotId: args.lotId ?? null,
          picked: true,
        })
      })
      return { ok: true, pickingId, moveId: args.id, difference: String(difference) }
    },
  }),

  forecast: defineFn({
    input: { productId: 'id', warehouseId: 'id?', locationId: 'id?' },
    output: {
      productId: 'id',
      onHand: 'decimal',
      reserved: 'decimal',
      available: 'decimal',
      incoming: 'decimal',
      outgoing: 'decimal',
      forecasted: 'decimal',
      forecast: 'decimal',
    },
    effects: ['read:stock.Quant', 'read:stock.Move', 'read:stock.Location'],
    agent: true,
    handler: async (ctx, args) => {
      const locations = await ctx.db.select('stock.Location')
      const anchor = args.locationId ? locations.find((location) => location.id === args.locationId) : null
      const inside = new Set(
        locations
          .filter((location) => ['internal', 'transit'].includes(String(location.usage)))
          .filter((location) => {
            if (args.warehouseId) return location.warehouseId === args.warehouseId
            if (anchor) return String(location.parentPath).startsWith(String(anchor.parentPath))
            return true
          })
          .map((location) => String(location.id)),
      )
      const quants = (await ctx.db.select('stock.Quant', { productId: args.productId })).filter((quant) =>
        inside.has(String(quant.locationId)),
      )
      const onHand = quants.reduce((sum, quant) => sum + Number(quant.quantity), 0)
      const reserved = quants.reduce((sum, quant) => sum + Number(quant.reservedQuantity), 0)
      const moves = (await ctx.db.select('stock.Move', { productId: args.productId })).filter(
        (move) => !['done', 'cancel', 'draft'].includes(String(move.state)),
      )
      let incoming = 0,
        outgoing = 0
      for (const move of moves) {
        const remaining = Math.max(0, Number(move.productUomQty) - Number(move.quantity))
        const sourceInside = inside.has(String(move.locationId))
        const destinationInside = inside.has(String(move.locationDestId))
        if (!sourceInside && destinationInside) incoming += remaining
        if (sourceInside && !destinationInside) outgoing += remaining
      }
      const forecasted = onHand + incoming - outgoing
      return {
        productId: args.productId,
        onHand: String(onHand),
        reserved: String(reserved),
        available: String(onHand - reserved),
        incoming: String(incoming),
        outgoing: String(outgoing),
        forecasted: String(forecasted),
        forecast: String(forecasted),
      }
    },
  }),
}

functions.savePicking = defineFn({
  input: {
    id: 'id',
    name: 'text',
    pickingTypeId: 'id',
    locationId: 'id?',
    locationDestId: 'id?',
    moveType: 'text?',
    scheduledDate: 'datetime?',
    backorderId: 'id?',
  },
  output: { ok: 'bool', id: 'id?', errors: 'json?' },
  effects: ['read:stock.PickingType', 'read:stock.Picking', 'write:stock.Picking'],
  idempotent: true,
  agent: true,
  handler: async (ctx, args) => {
    const type = (await ctx.db.select('stock.PickingType', { id: args.pickingTypeId }))[0]
    if (!type) return invalid('pickingTypeId', 'operation type không tồn tại')
    const existing = (await ctx.db.select('stock.Picking', { id: args.id }))[0]
    const values = {
      ...args,
      locationId: args.locationId ?? type.defaultLocationSrcId,
      locationDestId: args.locationDestId ?? type.defaultLocationDestId,
      moveType: args.moveType ?? 'direct',
      state: existing?.state ?? 'draft',
      backorderId: args.backorderId ?? existing?.backorderId ?? null,
      scheduledDate: args.scheduledDate ?? existing?.scheduledDate ?? new Date().toISOString(),
      dateDone: existing?.dateDone ?? null,
    }
    if (!values.locationId || !values.locationDestId)
      return invalid('locationId', 'cần source và destination location')
    const cs = ctx
      .change('stock.Picking', values, existing ?? null)
      .cast([
        'id',
        'name',
        'pickingTypeId',
        'locationId',
        'locationDestId',
        'moveType',
        'state',
        'backorderId',
        'scheduledDate',
        'dateDone',
      ])
      .required([
        'name',
        'pickingTypeId',
        'locationId',
        'locationDestId',
        'moveType',
        'state',
        'scheduledDate',
      ])
    if (!cs.valid) return { ok: false, errors: cs.errors }
    await ctx.db.commit(cs, existing ? { id: args.id } : undefined)
    return { ok: true, id: args.id }
  },
})

functions.saveLot = defineFn({
  input: { id: 'id', productId: 'id', name: 'text', ref: 'text?', note: 'text?', active: 'bool?' },
  output: { ok: 'bool', id: 'id?', errors: 'json?' },
  effects: ['read:product.Product', 'read:stock.Lot', 'write:stock.Lot', 'read:stock.MoveLine'],
  idempotent: true,
  agent: true,
  handler: async (ctx, args) => {
    if (!(await ctx.db.select('product.Product', { id: args.productId }))[0])
      return invalid('productId', 'biến thể không tồn tại')
    const existing = (await ctx.db.select('stock.Lot', { id: args.id }))[0]
    if (existing && existing.productId !== args.productId) {
      const moveLines = await ctx.db.select('stock.MoveLine', { lotId: args.id })
      if (moveLines.length)
        return invalid(
          'productId',
          'không thể đổi sản phẩm khi lô hoặc sê-ri đã được dùng trong dịch chuyển kho',
        )
    }
    const values = { ...args, active: args.active ?? existing?.active ?? true }
    const cs = ctx
      .change('stock.Lot', values, existing ?? null)
      .cast(['id', 'productId', 'name', 'ref', 'note', 'active'])
      .required(['productId', 'name'])
    if (!cs.valid) return { ok: false, errors: cs.errors }
    await ctx.db.commit(cs, existing ? { id: args.id } : undefined)
    return { ok: true, id: args.id }
  },
})

functions.assignPicking = defineFn({
  input: { id: 'id' },
  output: { ok: 'bool', state: 'text?', allocations: 'json?', shortages: 'json?', errors: 'json?' },
  effects: [
    'read:stock.Picking',
    'write:stock.Picking',
    'read:stock.Move',
    'write:stock.Move',
    'read:stock.MoveLine',
    'write:stock.MoveLine',
    'read:stock.Quant',
    'write:stock.Quant',
    'read:product.Product',
    'read:product.Template',
  ],
  idempotent: true,
  agent: true,
  handler: async (ctx, args) => {
    const picking = (await ctx.db.select('stock.Picking', { id: args.id }))[0]
    if (!picking) return invalid('id', 'transfer không tồn tại')
    if (picking.state === 'draft') return invalid('state', 'xác nhận transfer trước khi giữ hàng')
    if (picking.state === 'done' || picking.state === 'cancel')
      return invalid('state', 'transfer đã kết thúc')
    const allocations: Row[] = []
    const shortages: Row[] = []
    for (const move of await ctx.db.select('stock.Move', { pickingId: args.id })) {
      const result = (await functions.reserveMove!.handler(ctx, { id: move.id })) as Row
      const reserved = Number(result.reserved ?? 0)
      allocations.push(...(await ctx.db.select('stock.MoveLine', { moveId: move.id })))
      const shortage = Math.max(0, Number(move.productUomQty) - reserved)
      if (shortage) shortages.push({ moveId: move.id, quantity: String(shortage) })
    }
    const updated = (await ctx.db.select('stock.Picking', { id: args.id }))[0]!
    return { ok: true, state: updated.state, allocations, shortages }
  },
})

functions.cancelPicking = defineFn({
  input: { id: 'id' },
  output: { ok: 'bool', id: 'id?', errors: 'json?' },
  effects: [
    'read:stock.Picking',
    'write:stock.Picking',
    'read:stock.Move',
    'write:stock.Move',
    'read:stock.MoveLine',
    'write:stock.MoveLine',
    'read:stock.Location',
    'read:stock.Quant',
    'write:stock.Quant',
  ],
  idempotent: true,
  agent: true,
  handler: async (ctx, args) => {
    const picking = (await ctx.db.select('stock.Picking', { id: args.id }))[0]
    if (!picking) return invalid('id', 'transfer không tồn tại')
    if (picking.state === 'done') return invalid('state', 'transfer đã hoàn thành')
    await ctx.tx(async (tx) => {
      for (const move of await tx.db.select('stock.Move', { pickingId: args.id })) {
        const source = (await tx.db.select('stock.Location', { id: move.locationId }))[0]
        for (const line of await tx.db.select('stock.MoveLine', { moveId: move.id })) {
          if (!line.picked && source && ['internal', 'transit'].includes(String(source.usage)))
            await mutateQuant(tx, {
              productId: move.productId,
              locationId: move.locationId,
              lotId: line.lotId,
              quantity: 0,
              reserved: -Number(line.quantity),
            })
          await tx.db.update(
            'stock.MoveLine',
            { id: line.id },
            { quantity: '0', quantityProductUom: '0', picked: true },
          )
        }
        await tx.db.update('stock.Move', { id: move.id }, { state: 'cancel', quantity: '0', picked: false })
      }
      await tx.db.update('stock.Picking', { id: args.id }, { state: 'cancel' })
    })
    return { ok: true, id: args.id }
  },
})

functions.reconcileReservations = defineFn({
  input: { productId: 'id?', locationId: 'id?' },
  output: { ok: 'bool', changed: 'int' },
  effects: [
    'read:stock.Move',
    'read:stock.MoveLine',
    'read:stock.Location',
    'read:stock.Quant',
    'write:stock.Quant',
  ],
  idempotent: true,
  agent: true,
  handler: async (ctx, args) => {
    const moves = new Map((await ctx.db.select('stock.Move')).map((move) => [String(move.id), move]))
    const locations = new Map(
      (await ctx.db.select('stock.Location')).map((location) => [String(location.id), location]),
    )
    const wanted = new Map<string, number>()
    for (const line of await ctx.db.select('stock.MoveLine')) {
      const move = moves.get(String(line.moveId))
      const location = locations.get(String(line.locationId))
      if (
        line.picked ||
        !move ||
        ['done', 'cancel'].includes(String(move.state)) ||
        !location ||
        !['internal', 'transit'].includes(String(location.usage)) ||
        (args.productId && line.productId !== args.productId) ||
        (args.locationId && line.locationId !== args.locationId)
      )
        continue
      const id = quantId(ctx, line.productId, line.locationId, line.lotId)
      wanted.set(id, (wanted.get(id) ?? 0) + Number(line.quantity))
    }
    let changed = 0
    for (const quant of await ctx.db.select('stock.Quant')) {
      if (args.productId && quant.productId !== args.productId) continue
      if (args.locationId && quant.locationId !== args.locationId) continue
      const expected = wanted.get(String(quant.id)) ?? 0
      const delta = expected - Number(quant.reservedQuantity)
      if (Math.abs(delta) > 1e-12) {
        await mutateQuant(ctx, {
          productId: quant.productId,
          locationId: quant.locationId,
          lotId: quant.lotId,
          quantity: 0,
          reserved: delta,
        })
        changed++
      }
    }
    return { ok: true, changed }
  },
})

functions.validatePicking = defineFn({
  input: { id: 'id', backorder: 'text?' },
  output: { ok: 'bool', id: 'id?', backorderId: 'id?', errors: 'json?' },
  effects: functions.completePicking!.effects,
  agent: true,
  handler: async (ctx, args) => {
    const picking = (await ctx.db.select('stock.Picking', { id: args.id }))[0]
    if (!picking) return invalid('id', 'transfer không tồn tại')
    const type = (await ctx.db.select('stock.PickingType', { id: picking.pickingTypeId }))[0]
    const moves = await ctx.db.select('stock.Move', { pickingId: args.id })
    let hasRemaining = false
    for (const move of moves) {
      const done = (await ctx.db.select('stock.MoveLine', { moveId: move.id }))
        .filter((line) => line.picked)
        .reduce((sum, line) => sum + Number(line.quantity), 0)
      if (done + 1e-12 < Number(move.productUomQty)) hasRemaining = true
    }
    let createBackorder = false
    if (hasRemaining && type?.createBackorder === 'always') createBackorder = true
    else if (hasRemaining && type?.createBackorder === 'ask') {
      if (!['create', 'cancel'].includes(String(args.backorder ?? '')))
        return invalid('backorder', 'phải chọn create hoặc cancel')
      createBackorder = args.backorder === 'create'
    }
    return functions.completePicking!.handler(ctx, {
      id: args.id,
      createBackorder,
      pickedOnly: true,
    })
  },
})
