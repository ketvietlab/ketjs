import { asc, defineFn, eq, from, inArray } from 'ketjs'
import type { Ctx, FnSpec, Row } from 'ketjs'
import { compareQty, convertQty, isZero } from '../uom/convert.ts'
import type { Unit } from '../uom/convert.ts'
import { LOCATION_USAGES, REAL_USAGES } from './types.ts'

const oneOf = (allowed: readonly string[], what: string) => (v: unknown) =>
  allowed.includes(String(v)) || `${what} phải là một trong: ${allowed.join(', ')}`

const asUnit = (row: Row): Unit => ({
  id: String(row.id), categoryId: String(row.categoryId),
  factor: Number(row.factor), rounding: Number(row.rounding),
})

/**
 * The unit a product is counted in, and the precision that goes with it.
 *
 * Everything a quant holds is in this unit. A move may be written in any unit of
 * the same category and is converted here — a quant that mixed units would be a
 * quant nobody can add up.
 */
const productUnit = async (ctx: Ctx, productId: string): Promise<Unit | null> => {
  const P = ctx.table('product.Product')
  const variant = await ctx.db.one(from(P).where(eq(P.id, productId)))
  if (!variant) return null
  const T = ctx.table('product.Template')
  const template = await ctx.db.one(from(T).where(eq(T.id, variant.templateId)))
  if (!template?.uomId) return null
  const U = ctx.table('uom.Unit')
  const unit = await ctx.db.one(from(U).where(eq(U.id, template.uomId)))
  return unit ? asUnit(unit) : null
}

/** The quant for one product in one location, made if it is not there yet. */
const quantFor = async (ctx: Ctx, productId: string, locationId: string): Promise<Row> => {
  const Q = ctx.table('stock.Quant')
  const found = await ctx.db.one(from(Q).where(eq(Q.productId, productId), eq(Q.locationId, locationId)))
  if (found) return found
  const id = `${productId}@${locationId}`
  await ctx.db.insert('stock.Quant', { id, productId, locationId, quantity: 0, reserved: 0 })
  return { id, productId, locationId, quantity: 0, reserved: 0 }
}

const err = (field: string, message: string) => ({ ok: false, errors: [{ field, message }] })

export const functions: Record<string, FnSpec> = {
  /**
   * A warehouse and the tree it needs, in one call.
   *
   * Odoo does the same: creating one gives you a view location holding a stock
   * location, because a warehouse with nowhere to put anything is not a warehouse.
   */
  saveWarehouse: defineFn({
    input: { id: 'id', name: 'text', code: 'text' },
    output: { ok: 'bool', id: 'id?', stockLocationId: 'id?', errors: 'json?' },
    effects: ['read:stock.Warehouse', 'write:stock.Warehouse', 'read:stock.Location', 'write:stock.Location'],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, a) => {
      const W = ctx.table('stock.Warehouse')
      const existing = await ctx.db.one(from(W).where(eq(W.id, a.id)))
      if (existing) {
        const cs = ctx.change('stock.Warehouse', a, existing).cast(['id', 'name', 'code']).required(['name', 'code'])
        if (!cs.valid) return { ok: false, errors: cs.errors }
        await ctx.db.commit(cs, { id: a.id })
        return { ok: true, id: a.id, stockLocationId: String(existing.stockLocationId ?? '') }
      }
      return ctx.tx(async (tx) => {
        const view = `${a.id}/view`
        const stock = `${a.id}/stock`
        await tx.db.insert('stock.Location', { id: view, name: String(a.code), parentId: null, usage: 'view', warehouseId: a.id, active: true })
        await tx.db.insert('stock.Location', { id: stock, name: 'Stock', parentId: view, usage: 'internal', warehouseId: a.id, active: true })
        await tx.db.insert('stock.Warehouse', {
          id: a.id, name: a.name, code: a.code, viewLocationId: view, stockLocationId: stock, active: true,
        })
        return { ok: true, id: a.id, stockLocationId: stock }
      })
    },
  }),

  saveLocation: defineFn({
    input: { id: 'id', name: 'text', usage: 'text', parentId: 'id?', warehouseId: 'id?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:stock.Location', 'write:stock.Location'],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, a) => {
      if (a.parentId === a.id) return err('parentId', 'một địa điểm không thể là cha của chính nó')
      const L = ctx.table('stock.Location')
      if (a.parentId) {
        // Walking up is cheap and a cycle here would hang every later walk.
        let cursor: unknown = a.parentId
        for (let hops = 0; cursor && hops < 64; hops++) {
          if (cursor === a.id) return err('parentId', 'quan hệ cha con tạo thành vòng')
          const row = await ctx.db.one(from(L).where(eq(L.id, String(cursor))))
          if (!row) return err('parentId', 'không có địa điểm nào mang id này')
          cursor = row.parentId
        }
      }
      const existing = await ctx.db.one(from(L).where(eq(L.id, a.id)))
      let cs = ctx.change('stock.Location', a, existing)
        .cast(['id', 'name', 'usage', 'parentId', 'warehouseId'])
        .required(['name', 'usage'])
        .validate('usage', oneOf(LOCATION_USAGES, 'loại địa điểm'))
      if (!existing) cs = cs.put('active', true)
      if (!cs.valid) return { ok: false, errors: cs.errors }
      await ctx.db.commit(cs, existing ? { id: a.id } : undefined)
      return { ok: true, id: a.id }
    },
  }),

  listLocations: defineFn({
    input: { usage: 'text?' },
    output: { id: 'id', name: 'text', usage: 'text', parentId: 'id?', warehouseId: 'id?', active: 'bool' },
    effects: ['read:stock.Location'],
    agent: true,
    handler: async (ctx: Ctx, a) => {
      const L = ctx.table('stock.Location')
      const q = from(L).orderBy(asc(L.id))
      return ctx.db.all(a.usage ? q.where(eq(L.usage, a.usage)) : q)
    },
  }),

  /**
   * What is on hand, and what is left to promise.
   *
   * Only real usages count. A supplier location sitting at −40 is not stock you
   * have; it is a record that forty came in from outside.
   */
  onHand: defineFn({
    input: { productId: 'id', locationId: 'id?' },
    output: { productId: 'id', quantity: 'decimal', reserved: 'decimal', available: 'decimal' },
    effects: ['read:stock.Quant', 'read:stock.Location'],
    agent: true,
    handler: async (ctx: Ctx, a) => {
      const Q = ctx.table('stock.Quant')
      let rows = await ctx.db.all(from(Q).where(eq(Q.productId, a.productId)))
      if (a.locationId) {
        rows = rows.filter(r => r.locationId === a.locationId)
      } else {
        const L = ctx.table('stock.Location')
        const real = new Set((await ctx.db.all(from(L).where(inArray({ model: 'stock.Location', name: 'usage' }, [...REAL_USAGES]))))
          .map(r => String(r.id)))
        rows = rows.filter(r => real.has(String(r.locationId)))
      }
      const quantity = rows.reduce((n, r) => n + Number(r.quantity), 0)
      const reserved = rows.reduce((n, r) => n + Number(r.reserved), 0)
      return { productId: a.productId, quantity, reserved, available: quantity - reserved }
    },
  }),

  createMove: defineFn({
    input: { id: 'id', productId: 'id', uomId: 'id', quantity: 'decimal', sourceId: 'id', destId: 'id', reference: 'text?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:stock.Move', 'write:stock.Move', 'read:stock.Location', 'read:product.Product', 'read:product.Template', 'read:uom.Unit'],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, a) => {
      if (a.sourceId === a.destId) return err('destId', 'nguồn và đích phải khác nhau')
      const L = ctx.table('stock.Location')
      for (const [field, id] of [['sourceId', a.sourceId], ['destId', a.destId]] as const) {
        const loc = await ctx.db.one(from(L).where(eq(L.id, String(id))))
        if (!loc) return err(field, 'không có địa điểm nào mang id này')
        // A view is a folder. Putting stock in one is how a tree stops adding up.
        if (loc.usage === 'view') return err(field, 'không thể luân chuyển vào hoặc ra khỏi địa điểm loại "view"')
      }
      const unit = await productUnit(ctx, String(a.productId))
      if (!unit) return err('productId', 'sản phẩm không tồn tại hoặc chưa khai đơn vị tính')
      const U = ctx.table('uom.Unit')
      const moveUnit = await ctx.db.one(from(U).where(eq(U.id, a.uomId)))
      if (!moveUnit) return err('uomId', 'không có đơn vị nào mang id này')
      if (moveUnit.categoryId !== unit.categoryId) {
        return err('uomId', 'đơn vị của phiếu khác nhóm với đơn vị của sản phẩm')
      }
      if (Number(a.quantity) <= 0) return err('quantity', 'số lượng phải lớn hơn 0')

      const cs = ctx.change('stock.Move', a, null)
        .cast(['id', 'productId', 'uomId', 'quantity', 'sourceId', 'destId', 'reference'])
        .required(['productId', 'uomId', 'quantity', 'sourceId', 'destId'])
        .put('state', 'draft')
        .put('reserved', 0)
      if (!cs.valid) return { ok: false, errors: cs.errors }
      await ctx.db.commit(cs)
      return { ok: true, id: a.id }
    },
  }),

  /**
   * Set stock aside for a move.
   *
   * Reserving is what stops two orders promising the same unit, so it has to see a
   * consistent view of the quant while it decides — hence the transaction. A
   * virtual source (a supplier, a stock-take) reserves nothing: there is nothing
   * there to run out of.
   */
  reserveMove: defineFn({
    input: { id: 'id' },
    output: { ok: 'bool', reserved: 'decimal?', shortBy: 'decimal?', errors: 'json?' },
    effects: ['read:stock.Move', 'write:stock.Move', 'read:stock.Quant', 'write:stock.Quant', 'read:stock.Location', 'read:product.Product', 'read:product.Template', 'read:uom.Unit'],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, a) => ctx.tx(async (tx) => {
      const M = tx.table('stock.Move')
      const move = await tx.db.one(from(M).where(eq(M.id, a.id)))
      if (!move) return err('id', 'không có phiếu nào mang id này')
      if (move.state === 'done' || move.state === 'cancel') return err('id', `phiếu đang ở trạng thái "${String(move.state)}"`)
      if (move.state === 'assigned') return { ok: true, reserved: Number(move.reserved) }

      const unit = await productUnit(tx, String(move.productId))
      if (!unit) return err('productId', 'sản phẩm chưa khai đơn vị tính')
      const U = tx.table('uom.Unit')
      const moveUnit = asUnit((await tx.db.one(from(U).where(eq(U.id, move.uomId)))) as Row)
      const needed = convertQty(Number(move.quantity), moveUnit, unit)

      const L = tx.table('stock.Location')
      const source = await tx.db.one(from(L).where(eq(L.id, move.sourceId)))
      const virtual = !REAL_USAGES.includes(String(source?.usage) as never)
      if (virtual) {
        await tx.db.update('stock.Move', { id: a.id }, { state: 'assigned', reserved: needed } as Row)
        return { ok: true, reserved: needed }
      }

      const quant = await quantFor(tx, String(move.productId), String(move.sourceId))
      const available = Number(quant.quantity) - Number(quant.reserved)
      if (compareQty(available, needed, unit.rounding) < 0) {
        // Answered, not thrown: an agent or a screen can act on a shortfall, and
        // "not enough" is an ordinary outcome rather than a broken call.
        return { ok: false, shortBy: needed - available, errors: [{ field: 'quantity', message: 'không đủ tồn để giữ chỗ' }] }
      }
      await tx.db.update('stock.Quant', { id: quant.id }, { reserved: Number(quant.reserved) + needed } as Row)
      await tx.db.update('stock.Move', { id: a.id }, { state: 'assigned', reserved: needed } as Row)
      return { ok: true, reserved: needed }
    }),
  }),

  /**
   * Apply the move: take from one location, give to the other, in one transaction.
   *
   * Both sides always change by the same amount, which is what makes the ledger
   * add up — and why a virtual location goes negative rather than the quantity
   * appearing from nowhere.
   */
  applyMove: defineFn({
    input: { id: 'id' },
    output: { ok: 'bool', quantity: 'decimal?', errors: 'json?' },
    effects: ['read:stock.Move', 'write:stock.Move', 'read:stock.Quant', 'write:stock.Quant', 'read:stock.Location', 'read:product.Product', 'read:product.Template', 'read:uom.Unit'],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, a) => ctx.tx(async (tx) => {
      const M = tx.table('stock.Move')
      const move = await tx.db.one(from(M).where(eq(M.id, a.id)))
      if (!move) return err('id', 'không có phiếu nào mang id này')
      if (move.state === 'done') return { ok: true, quantity: Number(move.reserved) }
      if (move.state === 'cancel') return err('id', 'phiếu đã bị huỷ')

      const unit = await productUnit(tx, String(move.productId))
      if (!unit) return err('productId', 'sản phẩm chưa khai đơn vị tính')
      const U = tx.table('uom.Unit')
      const moveUnit = asUnit((await tx.db.one(from(U).where(eq(U.id, move.uomId)))) as Row)
      const qty = convertQty(Number(move.quantity), moveUnit, unit)

      const L = tx.table('stock.Location')
      const source = await tx.db.one(from(L).where(eq(L.id, move.sourceId)))
      const sourceReal = REAL_USAGES.includes(String(source?.usage) as never)

      const out = await quantFor(tx, String(move.productId), String(move.sourceId))
      if (sourceReal) {
        const available = Number(out.quantity) - Number(out.reserved) + Number(move.reserved)
        if (compareQty(available, qty, unit.rounding) < 0) {
          return { ok: false, errors: [{ field: 'quantity', message: 'không đủ tồn để xuất' }] }
        }
      }
      await tx.db.update('stock.Quant', { id: out.id }, {
        quantity: Number(out.quantity) - qty,
        // Whatever this move was holding is spent, not merely released.
        reserved: Math.max(0, Number(out.reserved) - Number(move.reserved)),
      } as Row)

      const into = await quantFor(tx, String(move.productId), String(move.destId))
      await tx.db.update('stock.Quant', { id: into.id }, { quantity: Number(into.quantity) + qty } as Row)

      await tx.db.update('stock.Move', { id: a.id }, {
        state: 'done', reserved: qty, doneAt: new Date(0).toISOString(),
      } as Row)
      return { ok: true, quantity: qty }
    }),
  }),

  cancelMove: defineFn({
    input: { id: 'id' },
    output: { ok: 'bool', errors: 'json?' },
    effects: ['read:stock.Move', 'write:stock.Move', 'read:stock.Quant', 'write:stock.Quant', 'read:stock.Location'],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, a) => ctx.tx(async (tx) => {
      const M = tx.table('stock.Move')
      const move = await tx.db.one(from(M).where(eq(M.id, a.id)))
      if (!move) return err('id', 'không có phiếu nào mang id này')
      if (move.state === 'done') return err('id', 'phiếu đã thực hiện, không huỷ được')
      if (move.state === 'cancel') return { ok: true }

      // Give back what it was holding, or the stock stays promised to nothing.
      if (!isZero(Number(move.reserved), 0.000001)) {
        const L = tx.table('stock.Location')
        const source = await tx.db.one(from(L).where(eq(L.id, move.sourceId)))
        if (REAL_USAGES.includes(String(source?.usage) as never)) {
          const quant = await quantFor(tx, String(move.productId), String(move.sourceId))
          await tx.db.update('stock.Quant', { id: quant.id }, {
            reserved: Math.max(0, Number(quant.reserved) - Number(move.reserved)),
          } as Row)
        }
      }
      await tx.db.update('stock.Move', { id: a.id }, { state: 'cancel', reserved: 0 } as Row)
      return { ok: true }
    }),
  }),
}
