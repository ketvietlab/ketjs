import { defineFn, deleteFrom, eq } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { functions as stockFunctions } from '../stock/functions.ts'
import { toProductUnit } from '../stock/units.ts'
import { BOM_TYPES } from './types.ts'

type InputRow = Record<string, unknown>

const now = () => new Date().toISOString()
const clean = (value: unknown): string => String(value ?? '').trim()
const issue = (field: string, code: string) => ({ field, code })
const invalid = (...errors: Array<{ field: string; code: string }>) => ({ ok: false, errors })
const positive = (value: unknown): boolean => Number(value) > 0 && Number.isFinite(Number(value))
const company = (ctx: Ctx): string => {
  if (!ctx.scope.company) throw new Error('manufacturing requires an active company')
  return ctx.scope.company
}
const ours = async (ctx: Ctx, model: string, where: InputRow = {}): Promise<Row[]> =>
  (await ctx.db.select(model, where)).filter((row) => String(row.companyId) === company(ctx))

const effectsOf = (...specs: Array<FnSpec | undefined>): string[] => [
  ...new Set(specs.flatMap((spec) => spec?.effects ?? [])),
]

const productUnit = async (
  ctx: Ctx,
  productId: unknown,
  uomId: unknown,
  quantity: unknown,
): Promise<{ uomId: string; quantity: number } | null> => {
  if (!positive(quantity)) return null
  return toProductUnit(ctx, productId, uomId, Number(quantity))
}

const bomDetail = async (ctx: Ctx, row: Row): Promise<Row> => ({
  ...row,
  lines: (await ours(ctx, 'manufacturing.BomLine', { bomId: row.id })).sort(
    (a, b) => Number(a.sequence) - Number(b.sequence),
  ),
  operations: (await ours(ctx, 'manufacturing.Operation', { bomId: row.id })).sort(
    (a, b) => Number(a.sequence) - Number(b.sequence),
  ),
  byproducts: (await ours(ctx, 'manufacturing.Byproduct', { bomId: row.id })).sort(
    (a, b) => Number(a.sequence) - Number(b.sequence),
  ),
})

const productionDetail = async (ctx: Ctx, row: Row): Promise<Row> => {
  const links = (await ours(ctx, 'manufacturing.ProductionMove', { productionId: row.id })).sort(
    (a, b) => Number(a.sequence) - Number(b.sequence),
  )
  const moves = new Map((await ours(ctx, 'stock.Move')).map((move) => [String(move.id), move]))
  return {
    ...row,
    moves: links.map((link) => ({ ...link, move: moves.get(String(link.moveId)) ?? null })),
    workOrders: (await ours(ctx, 'manufacturing.WorkOrder', { productionId: row.id })).sort(
      (a, b) => Number(a.sequence) - Number(b.sequence),
    ),
  }
}

const validateBomParts = async (
  ctx: Ctx,
  bomId: string,
  lines: InputRow[],
  operations: InputRow[],
  byproducts: InputRow[],
): Promise<Array<{ field: string; code: string }>> => {
  const errors: Array<{ field: string; code: string }> = []
  const operationIds = new Set<string>()
  for (const [index, operation] of operations.entries()) {
    const id = clean(operation.id) || `${bomId}:operation:${index + 1}`
    operation.id = id
    if (!clean(operation.name)) errors.push(issue(`operations.${index}.name`, 'manufacturing.error.required'))
    if (!clean(operation.workCenterId))
      errors.push(issue(`operations.${index}.workCenterId`, 'manufacturing.error.required'))
    else if (!(await ours(ctx, 'manufacturing.WorkCenter', { id: operation.workCenterId }))[0])
      errors.push(issue(`operations.${index}.workCenterId`, 'manufacturing.error.missing'))
    if (Number(operation.durationExpected ?? 0) < 0)
      errors.push(issue(`operations.${index}.durationExpected`, 'manufacturing.error.invalid'))
    operationIds.add(id)
  }
  const validateMaterial = async (part: InputRow, index: number, prefix: string) => {
    const converted = await productUnit(ctx, part.productId, part.productUomId, part.productQty)
    if (!converted) errors.push(issue(`${prefix}.${index}.productQty`, 'manufacturing.error.invalid'))
    if (part.operationId && !operationIds.has(String(part.operationId)))
      errors.push(issue(`${prefix}.${index}.operationId`, 'manufacturing.error.missing'))
  }
  for (const [index, line] of lines.entries()) await validateMaterial(line, index, 'lines')
  for (const [index, byproduct] of byproducts.entries())
    await validateMaterial(byproduct, index, 'byproducts')
  return errors
}

const transition = async (
  ctx: Ctx,
  model: string,
  row: Row,
  expectedVersion: number,
  expectedState: string | string[],
  values: InputRow,
) => {
  const states = Array.isArray(expectedState) ? expectedState : [expectedState]
  if (Number(row.version) !== expectedVersion) return false
  if (!states.includes(String(row.state))) return false
  const changed = await ctx.db.compareAndSet(
    model,
    { id: row.id },
    { version: expectedVersion, state: row.state },
    { ...values, version: expectedVersion + 1 },
  )
  return 'dryRun' in changed || changed.matched
}

const saveBomEffects = [
  'read:manufacturing.Bom',
  'write:manufacturing.Bom',
  'read:manufacturing.BomLine',
  'write:manufacturing.BomLine',
  'read:manufacturing.Byproduct',
  'write:manufacturing.Byproduct',
  'read:manufacturing.Operation',
  'write:manufacturing.Operation',
  'read:manufacturing.WorkCenter',
  'read:product.Product',
  'read:product.Template',
  'read:uom.Unit',
]

const confirmEffects = [
  'read:manufacturing.Bom',
  'read:manufacturing.BomLine',
  'read:manufacturing.Byproduct',
  'read:manufacturing.Operation',
  'read:manufacturing.Production',
  'write:manufacturing.Production',
  'read:manufacturing.ProductionMove',
  'write:manufacturing.ProductionMove',
  'read:manufacturing.WorkOrder',
  'write:manufacturing.WorkOrder',
  'read:stock.PickingType',
  'write:stock.PickingType',
  ...effectsOf(
    stockFunctions.createPicking,
    stockFunctions.addMove,
    stockFunctions.confirmPicking,
    stockFunctions.assignPicking,
  ),
]

export const functions: Record<string, FnSpec> = {
  listBoms: defineFn({
    input: { productId: 'id?', includeArchived: 'bool?' },
    output: { id: 'id', code: 'text?', productId: 'id', productQty: 'decimal', type: 'text' },
    effects: ['read:manufacturing.Bom'],
    agent: true,
    handler: async (ctx, args) =>
      (await ours(ctx, 'manufacturing.Bom', args.productId ? { productId: args.productId } : {}))
        .filter((row) => args.includeArchived === true || row.active !== false)
        .sort((a, b) => String(a.code ?? a.id).localeCompare(String(b.code ?? b.id))),
  }),

  getBom: defineFn({
    input: { id: 'id' },
    output: { id: 'id', code: 'text?', productId: 'id', lines: 'json?', operations: 'json?' },
    effects: [
      'read:manufacturing.Bom',
      'read:manufacturing.BomLine',
      'read:manufacturing.Operation',
      'read:manufacturing.Byproduct',
    ],
    agent: true,
    handler: async (ctx, args) => {
      const row = (await ours(ctx, 'manufacturing.Bom', { id: args.id }))[0]
      return row ? bomDetail(ctx, row) : null
    },
  }),

  saveBom: defineFn({
    input: {
      id: 'id',
      code: 'text?',
      productId: 'id',
      productQty: 'decimal',
      productUomId: 'id',
      type: 'text?',
      active: 'bool?',
      lines: 'json?',
      operations: 'json?',
      byproducts: 'json?',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: saveBomEffects,
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const id = String(args.id)
      const type = String(args.type ?? 'normal')
      const converted = await productUnit(ctx, args.productId, args.productUomId, args.productQty)
      const lines = Array.isArray(args.lines) ? (args.lines as InputRow[]).map((row) => ({ ...row })) : []
      const operations = Array.isArray(args.operations)
        ? (args.operations as InputRow[]).map((row) => ({ ...row }))
        : []
      const byproducts = Array.isArray(args.byproducts)
        ? (args.byproducts as InputRow[]).map((row) => ({ ...row }))
        : []
      const errors = await validateBomParts(ctx, id, lines, operations, byproducts)
      if (!converted) errors.push(issue('productQty', 'manufacturing.error.invalid'))
      if (!BOM_TYPES.includes(type as never)) errors.push(issue('type', 'manufacturing.error.invalid'))
      const code = clean(args.code) || null
      if (code && (await ours(ctx, 'manufacturing.Bom', { code })).some((row) => String(row.id) !== id))
        errors.push(issue('code', 'manufacturing.error.invalid'))
      if (errors.length) return { ok: false, errors }

      const existing = (await ours(ctx, 'manufacturing.Bom', { id }))[0]
      await ctx.tx(async (tx) => {
        const values = {
          code,
          productId: args.productId,
          productQty: String(converted!.quantity),
          productUomId: converted!.uomId,
          type,
          active: args.active ?? true,
        }
        if (existing) await tx.db.update('manufacturing.Bom', { id }, values)
        else await tx.db.insert('manufacturing.Bom', { id, ...values })

        const L = tx.table('manufacturing.BomLine')
        const B = tx.table('manufacturing.Byproduct')
        const O = tx.table('manufacturing.Operation')
        await tx.db.del(deleteFrom(L).where(eq(L.bomId, id)))
        await tx.db.del(deleteFrom(B).where(eq(B.bomId, id)))
        await tx.db.del(deleteFrom(O).where(eq(O.bomId, id)))

        for (const [index, operation] of operations.entries())
          await tx.db.insert('manufacturing.Operation', {
            id: operation.id,
            bomId: id,
            workCenterId: operation.workCenterId,
            name: clean(operation.name),
            sequence: Number(operation.sequence ?? (index + 1) * 10),
            durationExpected: Math.max(0, Number(operation.durationExpected ?? 0)),
            instructions: clean(operation.instructions) || null,
          })
        for (const [index, line] of lines.entries()) {
          const unit = await productUnit(tx, line.productId, line.productUomId, line.productQty)
          await tx.db.insert('manufacturing.BomLine', {
            id: clean(line.id) || `${id}:line:${index + 1}`,
            bomId: id,
            productId: line.productId,
            productQty: String(unit!.quantity),
            productUomId: unit!.uomId,
            operationId: line.operationId ?? null,
            sequence: Number(line.sequence ?? (index + 1) * 10),
          })
        }
        for (const [index, byproduct] of byproducts.entries()) {
          const unit = await productUnit(
            tx,
            byproduct.productId,
            byproduct.productUomId,
            byproduct.productQty,
          )
          await tx.db.insert('manufacturing.Byproduct', {
            id: clean(byproduct.id) || `${id}:byproduct:${index + 1}`,
            bomId: id,
            productId: byproduct.productId,
            productQty: String(unit!.quantity),
            productUomId: unit!.uomId,
            sequence: Number(byproduct.sequence ?? (index + 1) * 10),
          })
        }
      })
      return { ok: true, id }
    },
  }),

  listWorkCenters: defineFn({
    input: { includeArchived: 'bool?' },
    output: { id: 'id', code: 'text', name: 'text', capacity: 'decimal', active: 'bool' },
    effects: ['read:manufacturing.WorkCenter'],
    agent: true,
    handler: async (ctx, args) =>
      (await ours(ctx, 'manufacturing.WorkCenter'))
        .filter((row) => args.includeArchived === true || row.active !== false)
        .sort((a, b) => String(a.code).localeCompare(String(b.code))),
  }),

  saveWorkCenter: defineFn({
    input: {
      id: 'id',
      code: 'text',
      name: 'text',
      capacity: 'decimal?',
      timeEfficiency: 'decimal?',
      costPerHour: 'decimal?',
      active: 'bool?',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:manufacturing.WorkCenter', 'write:manufacturing.WorkCenter'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const id = String(args.id)
      const code = clean(args.code)
      const name = clean(args.name)
      if (!code || !name) return invalid(issue(!code ? 'code' : 'name', 'manufacturing.error.required'))
      if ((await ours(ctx, 'manufacturing.WorkCenter', { code })).some((row) => String(row.id) !== id))
        return invalid(issue('code', 'manufacturing.error.invalid'))
      const capacity = Number(args.capacity ?? 1)
      const efficiency = Number(args.timeEfficiency ?? 100)
      if (!(capacity > 0) || !(efficiency > 0) || Number(args.costPerHour ?? 0) < 0)
        return invalid(issue('capacity', 'manufacturing.error.invalid'))
      const values = {
        code,
        name,
        capacity: String(capacity),
        timeEfficiency: String(efficiency),
        costPerHour: String(Number(args.costPerHour ?? 0)),
        active: args.active ?? true,
      }
      const existing = (await ours(ctx, 'manufacturing.WorkCenter', { id }))[0]
      if (existing) await ctx.db.update('manufacturing.WorkCenter', { id }, values)
      else await ctx.db.insert('manufacturing.WorkCenter', { id, ...values })
      return { ok: true, id }
    },
  }),

  listProductions: defineFn({
    input: { state: 'text?', productId: 'id?' },
    output: { id: 'id', name: 'text', productId: 'id', productQty: 'decimal', state: 'text' },
    effects: ['read:manufacturing.Production'],
    agent: true,
    handler: async (ctx, args) =>
      (await ours(ctx, 'manufacturing.Production'))
        .filter(
          (row) =>
            (!args.state || row.state === args.state) &&
            (!args.productId || row.productId === args.productId),
        )
        .sort((a, b) => String(b.scheduledStart).localeCompare(String(a.scheduledStart))),
  }),

  getProduction: defineFn({
    input: { id: 'id' },
    output: {
      id: 'id',
      name: 'text',
      bomId: 'id',
      productId: 'id',
      productQty: 'decimal',
      productUomId: 'id',
      quantityProduced: 'decimal',
      state: 'text',
      version: 'int',
      moves: 'json?',
      workOrders: 'json?',
    },
    effects: [
      'read:manufacturing.Production',
      'read:manufacturing.ProductionMove',
      'read:manufacturing.WorkOrder',
      'read:stock.Move',
    ],
    agent: true,
    handler: async (ctx, args) => {
      const row = (await ours(ctx, 'manufacturing.Production', { id: args.id }))[0]
      return row ? productionDetail(ctx, row) : null
    },
  }),

  saveProduction: defineFn({
    input: {
      id: 'id',
      name: 'text',
      bomId: 'id',
      productQty: 'decimal',
      productUomId: 'id',
      sourceLocationId: 'id',
      productionLocationId: 'id',
      destinationLocationId: 'id',
      scheduledStart: 'datetime',
      scheduledFinish: 'datetime?',
      origin: 'text?',
      version: 'int?',
    },
    output: { ok: 'bool', id: 'id?', version: 'int?', errors: 'json?' },
    effects: [
      'read:manufacturing.Bom',
      'read:manufacturing.Production',
      'write:manufacturing.Production',
      'read:stock.Location',
      'read:product.Product',
      'read:product.Template',
      'read:uom.Unit',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const bom = (await ours(ctx, 'manufacturing.Bom', { id: args.bomId }))[0]
      if (!bom || bom.active === false) return invalid(issue('bomId', 'manufacturing.error.missing'))
      const converted = await productUnit(ctx, bom.productId, args.productUomId, args.productQty)
      if (!converted) return invalid(issue('productQty', 'manufacturing.error.invalid'))
      const locations = new Map(
        (await ours(ctx, 'stock.Location')).map((location) => [String(location.id), location]),
      )
      const source = locations.get(String(args.sourceLocationId))
      const production = locations.get(String(args.productionLocationId))
      const destination = locations.get(String(args.destinationLocationId))
      if (!source || !['internal', 'transit'].includes(String(source.usage)))
        return invalid(issue('sourceLocationId', 'manufacturing.error.invalid'))
      if (production?.usage !== 'production')
        return invalid(issue('productionLocationId', 'manufacturing.error.invalid'))
      if (!destination || !['internal', 'transit'].includes(String(destination.usage)))
        return invalid(issue('destinationLocationId', 'manufacturing.error.invalid'))
      if (!clean(args.name)) return invalid(issue('name', 'manufacturing.error.required'))
      const id = String(args.id)
      const existing = (await ours(ctx, 'manufacturing.Production', { id }))[0]
      if (existing && existing.state !== 'draft') return invalid(issue('state', 'manufacturing.error.state'))
      if (existing && Number(existing.version) !== Number(args.version))
        return invalid(issue('version', 'manufacturing.error.version'))
      const version = existing ? Number(existing.version) + 1 : 1
      const values = {
        name: clean(args.name),
        bomId: bom.id,
        productId: bom.productId,
        productQty: String(converted.quantity),
        productUomId: converted.uomId,
        quantityProduced: '0',
        sourceLocationId: args.sourceLocationId,
        productionLocationId: args.productionLocationId,
        destinationLocationId: args.destinationLocationId,
        rawPickingId: null,
        outputPickingId: null,
        state: 'draft',
        scheduledStart: args.scheduledStart,
        scheduledFinish: args.scheduledFinish ?? null,
        startedAt: null,
        finishedAt: null,
        origin: clean(args.origin) || null,
        version,
      }
      if (existing) await ctx.db.update('manufacturing.Production', { id }, values)
      else await ctx.db.insert('manufacturing.Production', { id, ...values })
      return { ok: true, id, version }
    },
  }),

  confirmProduction: defineFn({
    input: { id: 'id', version: 'int' },
    output: { ok: 'bool', id: 'id?', version: 'int?', shortages: 'json?', errors: 'json?' },
    effects: confirmEffects,
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const production = (await ours(ctx, 'manufacturing.Production', { id: args.id }))[0]
      if (!production) return invalid(issue('id', 'manufacturing.error.missing'))
      if (production.state !== 'draft')
        return ['confirmed', 'in_progress', 'done'].includes(String(production.state))
          ? { ok: true, id: production.id, version: production.version, shortages: [] }
          : invalid(issue('state', 'manufacturing.error.state'))
      if (Number(production.version) !== Number(args.version))
        return invalid(issue('version', 'manufacturing.error.version'))
      const bom = (await ours(ctx, 'manufacturing.Bom', { id: production.bomId }))[0]
      if (!bom || bom.active === false) return invalid(issue('bomId', 'manufacturing.error.missing'))
      const lines = (await ours(ctx, 'manufacturing.BomLine', { bomId: bom.id })).sort(
        (a, b) => Number(a.sequence) - Number(b.sequence),
      )
      const byproducts = (await ours(ctx, 'manufacturing.Byproduct', { bomId: bom.id })).sort(
        (a, b) => Number(a.sequence) - Number(b.sequence),
      )
      const operations = (await ours(ctx, 'manufacturing.Operation', { bomId: bom.id })).sort(
        (a, b) => Number(a.sequence) - Number(b.sequence),
      )
      const factor = Number(production.productQty) / Number(bom.productQty)
      const rawPickingId = `${String(production.id)}:components`
      const outputPickingId = `${String(production.id)}:outputs`
      const rawTypeId = `${company(ctx)}:manufacturing:components`
      const outputTypeId = `${company(ctx)}:manufacturing:outputs`
      await ctx.tx(async (tx) => {
        const claimed = await transition(
          tx,
          'manufacturing.Production',
          production,
          Number(args.version),
          'draft',
          { state: 'confirmed', rawPickingId, outputPickingId },
        )
        if (!claimed) throw new Error('manufacturing production changed during confirmation')
        await tx.db.insertIfAbsent('stock.PickingType', {
          id: rawTypeId,
          name: 'Manufacturing Components',
          code: 'internal',
          warehouseId: null,
          defaultLocationSrcId: null,
          defaultLocationDestId: null,
          createBackorder: 'never',
          active: true,
        })
        await tx.db.insertIfAbsent('stock.PickingType', {
          id: outputTypeId,
          name: 'Manufacturing Outputs',
          code: 'internal',
          warehouseId: null,
          defaultLocationSrcId: null,
          defaultLocationDestId: null,
          createBackorder: 'never',
          active: true,
        })
        await stockFunctions.createPicking!.handler(tx, {
          id: rawPickingId,
          name: `${String(production.name)} · Components`,
          pickingTypeId: rawTypeId,
          locationId: production.sourceLocationId,
          locationDestId: production.productionLocationId,
          moveType: 'one',
          scheduledDate: production.scheduledStart,
        })
        await stockFunctions.createPicking!.handler(tx, {
          id: outputPickingId,
          name: `${String(production.name)} · Outputs`,
          pickingTypeId: outputTypeId,
          locationId: production.productionLocationId,
          locationDestId: production.destinationLocationId,
          moveType: 'direct',
          scheduledDate: production.scheduledFinish ?? production.scheduledStart,
        })
        for (const [index, line] of lines.entries()) {
          const moveId = `${String(production.id)}:raw:${String(line.id)}`
          await stockFunctions.addMove!.handler(tx, {
            id: moveId,
            name: `${String(production.name)} · component ${index + 1}`,
            pickingId: rawPickingId,
            productId: line.productId,
            productUomId: line.productUomId,
            productUomQty: String(Number(line.productQty) * factor),
            origin: String(production.name),
          })
          await tx.db.insertIfAbsent('manufacturing.ProductionMove', {
            id: `${String(production.id)}:move:raw:${String(line.id)}`,
            productionId: production.id,
            moveId,
            kind: 'component',
            sequence: Number(line.sequence),
          })
        }
        const finishedMoveId = `${String(production.id)}:finished`
        await stockFunctions.addMove!.handler(tx, {
          id: finishedMoveId,
          name: `${String(production.name)} · finished product`,
          pickingId: outputPickingId,
          productId: production.productId,
          productUomId: production.productUomId,
          productUomQty: production.productQty,
          origin: String(production.name),
        })
        await tx.db.insertIfAbsent('manufacturing.ProductionMove', {
          id: `${String(production.id)}:move:finished`,
          productionId: production.id,
          moveId: finishedMoveId,
          kind: 'finished',
          sequence: 0,
        })
        for (const [index, byproduct] of byproducts.entries()) {
          const moveId = `${String(production.id)}:byproduct:${String(byproduct.id)}`
          await stockFunctions.addMove!.handler(tx, {
            id: moveId,
            name: `${String(production.name)} · by-product ${index + 1}`,
            pickingId: outputPickingId,
            productId: byproduct.productId,
            productUomId: byproduct.productUomId,
            productUomQty: String(Number(byproduct.productQty) * factor),
            origin: String(production.name),
          })
          await tx.db.insertIfAbsent('manufacturing.ProductionMove', {
            id: `${String(production.id)}:move:byproduct:${String(byproduct.id)}`,
            productionId: production.id,
            moveId,
            kind: 'byproduct',
            sequence: Number(byproduct.sequence),
          })
        }
        for (const [index, operation] of operations.entries())
          await tx.db.insertIfAbsent('manufacturing.WorkOrder', {
            id: `${String(production.id)}:work:${String(operation.id)}`,
            productionId: production.id,
            operationId: operation.id,
            workCenterId: operation.workCenterId,
            name: operation.name,
            sequence: operation.sequence,
            state: index === 0 ? 'ready' : 'pending',
            durationExpected: operation.durationExpected,
            durationActual: 0,
            startedAt: null,
            finishedAt: null,
            version: 1,
          })
        await stockFunctions.confirmPicking!.handler(tx, { id: rawPickingId })
        await stockFunctions.confirmPicking!.handler(tx, { id: outputPickingId })
      })
      const allocation = (await stockFunctions.assignPicking!.handler(ctx, {
        id: rawPickingId,
      })) as Row
      return {
        ok: true,
        id: production.id,
        version: Number(args.version) + 1,
        shortages: allocation.shortages ?? [],
      }
    },
  }),

  startProduction: defineFn({
    input: { id: 'id', version: 'int' },
    output: { ok: 'bool', id: 'id?', version: 'int?', errors: 'json?' },
    effects: ['read:manufacturing.Production', 'write:manufacturing.Production'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const row = (await ours(ctx, 'manufacturing.Production', { id: args.id }))[0]
      if (!row) return invalid(issue('id', 'manufacturing.error.missing'))
      if (row.state === 'in_progress') return { ok: true, id: row.id, version: row.version }
      const changed = await transition(
        ctx,
        'manufacturing.Production',
        row,
        Number(args.version),
        'confirmed',
        {
          state: 'in_progress',
          startedAt: now(),
        },
      )
      return changed
        ? { ok: true, id: row.id, version: Number(args.version) + 1 }
        : invalid(issue('version', 'manufacturing.error.version'))
    },
  }),

  cancelProduction: defineFn({
    input: { id: 'id', version: 'int' },
    output: { ok: 'bool', id: 'id?', version: 'int?', errors: 'json?' },
    effects: [
      'read:manufacturing.Production',
      'write:manufacturing.Production',
      'read:manufacturing.WorkOrder',
      'write:manufacturing.WorkOrder',
      ...effectsOf(stockFunctions.cancelPicking),
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const row = (await ours(ctx, 'manufacturing.Production', { id: args.id }))[0]
      if (!row) return invalid(issue('id', 'manufacturing.error.missing'))
      if (row.state === 'cancelled') return { ok: true, id: row.id, version: row.version }
      if (row.state === 'done') return invalid(issue('state', 'manufacturing.error.state'))
      if (Number(row.version) !== Number(args.version))
        return invalid(issue('version', 'manufacturing.error.version'))
      if (row.rawPickingId) await stockFunctions.cancelPicking!.handler(ctx, { id: row.rawPickingId })
      if (row.outputPickingId) await stockFunctions.cancelPicking!.handler(ctx, { id: row.outputPickingId })
      for (const work of await ours(ctx, 'manufacturing.WorkOrder', { productionId: row.id }))
        if (work.state !== 'done')
          await ctx.db.update('manufacturing.WorkOrder', { id: work.id }, { state: 'cancelled' })
      const changed = await transition(
        ctx,
        'manufacturing.Production',
        row,
        Number(args.version),
        ['draft', 'confirmed', 'in_progress'],
        { state: 'cancelled' },
      )
      if (!changed) return invalid(issue('version', 'manufacturing.error.version'))
      return { ok: true, id: row.id, version: Number(args.version) + 1 }
    },
  }),

  completeProduction: defineFn({
    input: { id: 'id', version: 'int', producedQuantity: 'decimal?', outputs: 'json?' },
    output: { ok: 'bool', id: 'id?', version: 'int?', errors: 'json?' },
    effects: [
      'read:manufacturing.Production',
      'write:manufacturing.Production',
      'read:manufacturing.ProductionMove',
      'read:manufacturing.WorkOrder',
      'read:stock.Move',
      'read:stock.MoveLine',
      'read:stock.Lot',
      'read:product.Product',
      'read:product.Template',
      ...effectsOf(stockFunctions.assignPicking, stockFunctions.saveMoveLine, stockFunctions.completePicking),
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const row = (await ours(ctx, 'manufacturing.Production', { id: args.id }))[0]
      if (!row) return invalid(issue('id', 'manufacturing.error.missing'))
      if (row.state === 'done') return { ok: true, id: row.id, version: row.version }
      if (!['confirmed', 'in_progress', 'to_close'].includes(String(row.state)))
        return invalid(issue('state', 'manufacturing.error.state'))
      if (Number(row.version) !== Number(args.version))
        return invalid(issue('version', 'manufacturing.error.version'))
      const workOrders = await ours(ctx, 'manufacturing.WorkOrder', { productionId: row.id })
      if (workOrders.some((work) => work.state !== 'done'))
        return invalid(issue('workOrders', 'manufacturing.error.state'))
      const produced = Number(args.producedQuantity ?? row.productQty)
      if (!(produced > 0)) return invalid(issue('producedQuantity', 'manufacturing.error.invalid'))
      if (!row.rawPickingId || !row.outputPickingId)
        return invalid(issue('state', 'manufacturing.error.state'))
      const rawPicking = (await ours(ctx, 'stock.Picking', { id: row.rawPickingId }))[0]
      const outputPicking = (await ours(ctx, 'stock.Picking', { id: row.outputPickingId }))[0]
      if (!rawPicking || !outputPicking) return invalid(issue('state', 'manufacturing.error.state'))
      if (rawPicking.state !== 'done')
        await stockFunctions.assignPicking!.handler(ctx, { id: row.rawPickingId })
      const rawMoves = await ours(ctx, 'stock.Move', { pickingId: row.rawPickingId })
      for (const move of rawMoves) {
        const allocated = (await ours(ctx, 'stock.MoveLine', { moveId: move.id })).reduce(
          (sum, line) => sum + Number(line.quantity),
          0,
        )
        if (allocated + 1e-9 < Number(move.productUomQty))
          return invalid(issue('components', 'manufacturing.error.stockShortage'))
      }
      const requested = new Map<string, InputRow[]>()
      if (Array.isArray(args.outputs))
        for (const output of args.outputs as InputRow[]) {
          const held = requested.get(String(output.moveId)) ?? []
          held.push(output)
          requested.set(String(output.moveId), held)
        }
      const outputMoves = await ours(ctx, 'stock.Move', { pickingId: row.outputPickingId })
      const factor = produced / Number(row.productQty)
      for (const move of outputMoves) {
        const product = (await ctx.db.select('product.Product', { id: move.productId }))[0]
        const template = product && (await ctx.db.select('product.Template', { id: product.templateId }))[0]
        const tracking = String(template?.tracking ?? 'none')
        const commands = requested.get(String(move.id)) ?? []
        if (tracking !== 'none' && (!commands.length || commands.some((command) => !command.lotId)))
          return invalid(issue('outputs', 'manufacturing.error.invalid'))
        for (const command of commands)
          if (command.lotId) {
            const lot = (await ours(ctx, 'stock.Lot', { id: command.lotId }))[0]
            if (!lot || lot.productId !== move.productId)
              return invalid(issue('outputs', 'manufacturing.error.invalid'))
          }
      }
      let claimedVersion = Number(row.version)
      if (row.state !== 'to_close') {
        const claimed = await transition(
          ctx,
          'manufacturing.Production',
          row,
          Number(args.version),
          ['confirmed', 'in_progress'],
          { state: 'to_close' },
        )
        if (!claimed) return invalid(issue('version', 'manufacturing.error.version'))
        claimedVersion += 1
      }
      if (rawPicking.state !== 'done')
        await stockFunctions.completePicking!.handler(ctx, {
          id: row.rawPickingId,
          createBackorder: false,
        })
      if (outputPicking.state !== 'done') {
        for (const move of outputMoves) {
          const commands = requested.get(String(move.id)) ?? [
            { quantity: String(Number(move.productUomQty) * factor), lotId: null },
          ]
          for (const [index, command] of commands.entries()) {
            const saved = (await stockFunctions.saveMoveLine!.handler(ctx, {
              id: `${String(move.id)}:output:${String(command.lotId ?? index + 1)}`,
              moveId: move.id,
              quantity: command.quantity,
              lotId: command.lotId ?? null,
              picked: true,
            })) as Row
            if (saved.ok === false) throw new Error('validated manufacturing output was rejected')
          }
        }
        await stockFunctions.completePicking!.handler(ctx, {
          id: row.outputPickingId,
          createBackorder: false,
        })
      }
      const current = (await ours(ctx, 'manufacturing.Production', { id: row.id }))[0]!
      const changed = await transition(ctx, 'manufacturing.Production', current, claimedVersion, 'to_close', {
        state: 'done',
        quantityProduced: String(produced),
        finishedAt: now(),
      })
      if (!changed) return invalid(issue('version', 'manufacturing.error.version'))
      return { ok: true, id: row.id, version: claimedVersion + 1 }
    },
  }),

  startWorkOrder: defineFn({
    input: { id: 'id', version: 'int' },
    output: { ok: 'bool', id: 'id?', version: 'int?', errors: 'json?' },
    effects: [
      'read:manufacturing.WorkOrder',
      'write:manufacturing.WorkOrder',
      'read:manufacturing.Production',
      'write:manufacturing.Production',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const row = (await ours(ctx, 'manufacturing.WorkOrder', { id: args.id }))[0]
      if (!row) return invalid(issue('id', 'manufacturing.error.missing'))
      if (row.state === 'in_progress') return { ok: true, id: row.id, version: row.version }
      const previous = (
        await ours(ctx, 'manufacturing.WorkOrder', { productionId: row.productionId })
      ).filter((work) => Number(work.sequence) < Number(row.sequence))
      if (previous.some((work) => work.state !== 'done'))
        return invalid(issue('state', 'manufacturing.error.state'))
      const changed = await transition(
        ctx,
        'manufacturing.WorkOrder',
        row,
        Number(args.version),
        ['ready', 'paused'],
        { state: 'in_progress', startedAt: row.startedAt ?? now() },
      )
      if (!changed) return invalid(issue('version', 'manufacturing.error.version'))
      const production = (await ours(ctx, 'manufacturing.Production', { id: row.productionId }))[0]
      if (production?.state === 'confirmed')
        await ctx.db.update(
          'manufacturing.Production',
          { id: production.id },
          {
            state: 'in_progress',
            startedAt: production.startedAt ?? now(),
            version: Number(production.version) + 1,
          },
        )
      return { ok: true, id: row.id, version: Number(args.version) + 1 }
    },
  }),

  pauseWorkOrder: defineFn({
    input: { id: 'id', version: 'int' },
    output: { ok: 'bool', id: 'id?', version: 'int?', errors: 'json?' },
    effects: ['read:manufacturing.WorkOrder', 'write:manufacturing.WorkOrder'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const row = (await ours(ctx, 'manufacturing.WorkOrder', { id: args.id }))[0]
      if (!row) return invalid(issue('id', 'manufacturing.error.missing'))
      if (row.state === 'paused') return { ok: true, id: row.id, version: row.version }
      const elapsed = row.startedAt
        ? Math.max(0, Math.round((Date.now() - Date.parse(String(row.startedAt))) / 60_000))
        : 0
      const changed = await transition(
        ctx,
        'manufacturing.WorkOrder',
        row,
        Number(args.version),
        'in_progress',
        { state: 'paused', durationActual: Number(row.durationActual) + elapsed, startedAt: null },
      )
      return changed
        ? { ok: true, id: row.id, version: Number(args.version) + 1 }
        : invalid(issue('version', 'manufacturing.error.version'))
    },
  }),

  finishWorkOrder: defineFn({
    input: { id: 'id', version: 'int' },
    output: { ok: 'bool', id: 'id?', version: 'int?', errors: 'json?' },
    effects: ['read:manufacturing.WorkOrder', 'write:manufacturing.WorkOrder'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const row = (await ours(ctx, 'manufacturing.WorkOrder', { id: args.id }))[0]
      if (!row) return invalid(issue('id', 'manufacturing.error.missing'))
      if (row.state === 'done') return { ok: true, id: row.id, version: row.version }
      const elapsed = row.startedAt
        ? Math.max(0, Math.round((Date.now() - Date.parse(String(row.startedAt))) / 60_000))
        : 0
      const changed = await transition(
        ctx,
        'manufacturing.WorkOrder',
        row,
        Number(args.version),
        ['in_progress', 'paused'],
        {
          state: 'done',
          durationActual: Number(row.durationActual) + elapsed,
          startedAt: null,
          finishedAt: now(),
        },
      )
      if (!changed) return invalid(issue('version', 'manufacturing.error.version'))
      const next = (await ours(ctx, 'manufacturing.WorkOrder', { productionId: row.productionId }))
        .filter((work) => Number(work.sequence) > Number(row.sequence) && work.state === 'pending')
        .sort((a, b) => Number(a.sequence) - Number(b.sequence))[0]
      if (next) await ctx.db.update('manufacturing.WorkOrder', { id: next.id }, { state: 'ready' })
      return { ok: true, id: row.id, version: Number(args.version) + 1 }
    },
  }),
}
