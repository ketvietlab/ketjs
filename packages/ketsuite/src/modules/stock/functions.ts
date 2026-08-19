import { defineFn } from 'ketjs'
import type { Ctx, FnSpec, Row } from 'ketjs'
import { compareQty } from '../uom/convert.ts'

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
      if (args.quantity < 0 || args.reserved < 0 || args.reserved > args.quantity)
        throw new Error('quant cannot become negative or over-reserved')
      const inserted = await ctx.db.insertIfAbsent('stock.Quant', {
        id,
        productId: args.productId,
        locationId: args.locationId,
        lotId: args.lotId ?? null,
        lotKey: lotKey(args.lotId),
        quantity: String(args.quantity),
        reservedQuantity: String(args.reserved),
        version: 0,
      })
      if ('inserted' in inserted && inserted.inserted) return (await ctx.db.select('stock.Quant', { id }))[0]!
      continue
    }
    const quantity = Number(current.quantity) + args.quantity
    const reservedQuantity = Number(current.reservedQuantity) + args.reserved
    if (quantity < -1e-12 || reservedQuantity < -1e-12 || reservedQuantity - quantity > 1e-12)
      throw new Error(`quant ${id} cannot become negative or over-reserved`)
    const changed = await ctx.db.compareAndSet(
      'stock.Quant',
      { id },
      { version: current.version },
      {
        quantity: String(quantity),
        reservedQuantity: String(reservedQuantity),
        version: Number(current.version) + 1,
      },
    )
    if ('matched' in changed && changed.matched)
      return { ...current, quantity, reservedQuantity, version: Number(current.version) + 1 }
  }
  throw new Error(`concurrent quant update did not settle for ${id}`)
}

async function updatePickingState(ctx: Ctx, pickingId: unknown): Promise<void> {
  const moves = await ctx.db.select('stock.Move', { pickingId })
  let state = 'confirmed'
  if (moves.length && moves.every((move) => move.state === 'done')) state = 'done'
  else if (moves.some((move) => move.state === 'assigned' || move.state === 'partially_available'))
    state = 'assigned'
  else if (moves.some((move) => move.state === 'waiting')) state = 'waiting'
  await ctx.db.update('stock.Picking', { id: pickingId }, { state })
}

export const functions: Record<string, FnSpec> = {
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
    effects: ['read:stock.Warehouse', 'write:stock.Warehouse'],
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
      await ctx.db.commit(cs, existing ? { id: args.id } : undefined)
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
    input: { id: 'id', productId: 'id', name: 'text' },
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
      const demand = Number(move.productUomQty)
      let reserved = (await ctx.db.select('stock.MoveLine', { moveId: move.id }))
        .filter((line) => !line.picked)
        .reduce((sum, line) => sum + Number(line.quantity), 0)
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
              locationId: move.locationId,
              locationDestId: move.locationDestId,
              lotId: quant.lotId,
              picked: false,
            })
          reserved += take
        }
        const state =
          compareQty(reserved, demand, 0.000001) >= 0
            ? 'assigned'
            : reserved > 0
              ? 'partially_available'
              : 'confirmed'
        await tx.db.update('stock.Move', { id: move.id }, { state, quantity: String(reserved) })
        if (move.pickingId) await updatePickingState(tx, move.pickingId)
      })
      const state = reserved >= demand ? 'assigned' : reserved > 0 ? 'partially_available' : 'confirmed'
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
      'read:product.Product',
      'read:product.Template',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const move = (await ctx.db.select('stock.Move', { id: args.moveId }))[0]
      if (!move) return invalid('moveId', 'move không tồn tại')
      const tracking = await trackingOf(ctx, move.productId)
      if (tracking !== 'none' && !args.lotId)
        return invalid('lotId', `${tracking} tracked product cần lot/serial`)
      if (tracking === 'serial' && compareQty(Number(args.quantity), 1, 0.000001) > 0)
        return invalid('quantity', 'serial move line không được lớn hơn 1')
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
          'locationId',
          'locationDestId',
          'lotId',
          'picked',
        ])
        .required(['moveId', 'productId', 'productUomId', 'quantity', 'locationId', 'locationDestId'])
      if (!cs.valid) return { ok: false, errors: cs.errors }
      await ctx.db.commit(cs, existing ? { id: args.id } : undefined)
      return { ok: true, id: args.id }
    },
  }),

  completePicking: defineFn({
    input: { id: 'id', quantities: 'json?', createBackorder: 'bool?' },
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
      'write:stock.MoveLink',
    ],
    agent: true,
    handler: async (ctx, args) => {
      const picking = (await ctx.db.select('stock.Picking', { id: args.id }))[0]
      if (!picking) return invalid('id', 'transfer không tồn tại')
      if (picking.state === 'done') return { ok: true, id: args.id }
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
            const quantity = requested.has(String(line.id)) ? requested.get(String(line.id))! : reserved
            if (quantity < 0 || quantity > reserved)
              throw new Error(`invalid done quantity for ${String(line.id)}`)
            if (tracking !== 'none' && !line.lotId)
              throw new Error(`${tracking} tracked product requires a lot/serial`)
            if (tracking === 'serial' && compareQty(quantity, 1, 0.000001) > 0)
              throw new Error('serial move line quantity cannot exceed 1')
            if (source.usage === 'internal' || source.usage === 'transit')
              await mutateQuant(tx, {
                productId: move.productId,
                locationId: move.locationId,
                lotId: line.lotId,
                quantity: -quantity,
                reserved: -reserved,
              })
            if (destination.usage === 'internal' || destination.usage === 'transit')
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
              { quantity: String(quantity), picked: true },
            )
            done += quantity
          }
          await tx.db.update(
            'stock.Move',
            { id: move.id },
            { quantity: String(done), picked: true, state: 'done' },
          )
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
    output: { ok: 'bool', moveId: 'id?', difference: 'decimal?', errors: 'json?' },
    effects: [
      'read:stock.Quant',
      'write:stock.Quant',
      'read:stock.Location',
      'read:stock.Lot',
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
      await ctx.tx(async (tx) => {
        await mutateQuant(tx, {
          productId: args.productId,
          locationId: args.locationId,
          lotId: args.lotId,
          quantity: difference,
          reserved: 0,
        })
        await tx.db.insertIfAbsent('stock.Move', {
          id: args.id,
          name: 'Inventory adjustment',
          pickingId: null,
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
          pickingId: null,
          productId: args.productId,
          productUomId: args.productUomId,
          quantity: String(Math.abs(difference)),
          locationId: source,
          locationDestId: destination,
          lotId: args.lotId ?? null,
          picked: true,
        })
      })
      return { ok: true, moveId: args.id, difference: String(difference) }
    },
  }),

  forecast: defineFn({
    input: { productId: 'id', locationId: 'id?' },
    output: {
      productId: 'id',
      onHand: 'decimal',
      incoming: 'decimal',
      outgoing: 'decimal',
      forecast: 'decimal',
    },
    effects: ['read:stock.Quant', 'read:stock.Move'],
    agent: true,
    handler: async (ctx, args) => {
      const quants = await ctx.db.select('stock.Quant', {
        productId: args.productId,
        ...(args.locationId ? { locationId: args.locationId } : {}),
      })
      const onHand = quants.reduce((sum, quant) => sum + Number(quant.quantity), 0)
      const moves = (await ctx.db.select('stock.Move', { productId: args.productId })).filter(
        (move) => !['done', 'cancel', 'draft'].includes(String(move.state)),
      )
      let incoming = 0,
        outgoing = 0
      for (const move of moves) {
        const remaining = Math.max(0, Number(move.productUomQty) - Number(move.quantity))
        if (!args.locationId || move.locationDestId === args.locationId) incoming += remaining
        if (!args.locationId || move.locationId === args.locationId) outgoing += remaining
      }
      return {
        productId: args.productId,
        onHand: String(onHand),
        incoming: String(incoming),
        outgoing: String(outgoing),
        forecast: String(onHand + incoming - outgoing),
      }
    },
  }),
}
