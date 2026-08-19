import { asc, defineFn, eq, from } from 'ketjs'
import type { Ctx, FnSpec, Row } from 'ketjs'
import { convertQty, roundTo, compareQty, type UomError } from './convert.ts'
import type { Unit } from './convert.ts'

const UNIT_TYPES = ['reference', 'bigger', 'smaller'] as const

const asUnit = (r: Row): Unit => ({
  id: String(r.id),
  categoryId: String(r.categoryId),
  factor: Number(r.factor),
  rounding: Number(r.rounding),
})

export const functions: Record<string, FnSpec> = {
  listUnits: defineFn({
    input: { categoryId: 'id?' },
    effects: ['read:uom.Unit'],
    agent: true,
    handler: async (ctx: Ctx, a) => {
      const U = ctx.table('uom.Unit')
      let q = from(U).where(eq(U.active, true)).orderBy(asc(U.name))
      if (a.categoryId != null) q = q.where(eq(U.categoryId, a.categoryId))
      return ctx.db.all(q)
    },
  }),

  saveUnit: defineFn({
    input: { id: 'id', name: 'text', categoryId: 'id', type: 'text', factor: 'float', rounding: 'float' },
    effects: ['read:uom.Unit', 'read:uom.Category', 'write:uom.Unit'],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, a) => {
      const U = ctx.table('uom.Unit')
      const C = ctx.table('uom.Category')
      const errors: Array<{ field: string; message: string }> = []

      if (!UNIT_TYPES.includes(a.type as never))
        errors.push({ field: 'type', message: `phải là một trong: ${UNIT_TYPES.join(', ')}` })
      if (!(Number(a.factor) > 0)) errors.push({ field: 'factor', message: 'phải lớn hơn 0' })
      if (!(Number(a.rounding) > 0)) errors.push({ field: 'rounding', message: 'phải lớn hơn 0' })
      if (!(await ctx.db.one(from(C).where(eq(C.id, a.categoryId))))) {
        errors.push({ field: 'categoryId', message: 'không có nhóm đơn vị nào mang id này' })
      }
      // The reference is what every other unit in the category is measured against,
      // so its factor is 1 by definition and there is exactly one of them.
      if (a.type === 'reference') {
        if (Number(a.factor) !== 1) errors.push({ field: 'factor', message: 'đơn vị gốc luôn có hệ số 1' })
        const already = await ctx.db.one(
          from(U).where(eq(U.categoryId, a.categoryId), eq(U.type, 'reference')),
        )
        if (already && already.id !== a.id) {
          errors.push({ field: 'type', message: `nhóm này đã có đơn vị gốc là "${String(already.name)}"` })
        }
      }
      if (errors.length) return { ok: false, errors }

      const existing = await ctx.db.one(from(U).where(eq(U.id, a.id)))
      let cs = ctx
        .change('uom.Unit', a, existing)
        .cast(['id', 'name', 'categoryId', 'type', 'factor', 'rounding'])
      if (!existing) cs = cs.put('active', true)
      if (!cs.valid) return { ok: false, errors: cs.errors }
      await ctx.db.commit(cs, existing ? { id: a.id } : undefined)
      return { ok: true, id: a.id }
    },
  }),

  convert: defineFn({
    input: { qty: 'float', fromId: 'id', toId: 'id' },
    // The declaration was wrong and nothing said so until output became a
    // projection: this answers {ok:true, qty} or {ok:false, errors}, and a caller
    // needs the flag as much as the number.
    output: { ok: 'bool', qty: 'float?', errors: 'json?', code: 'text?' },
    effects: ['read:uom.Unit'],
    agent: true,
    handler: async (ctx: Ctx, a) => {
      const U = ctx.table('uom.Unit')
      const from_ = await ctx.db.one(from(U).where(eq(U.id, a.fromId)))
      const to = await ctx.db.one(from(U).where(eq(U.id, a.toId)))
      if (!from_ || !to) {
        return {
          ok: false,
          errors: [{ field: from_ ? 'toId' : 'fromId', message: 'không có đơn vị nào mang id này' }],
        }
      }
      try {
        return { ok: true, qty: convertQty(Number(a.qty), asUnit(from_), asUnit(to)) }
      } catch (e) {
        const err = e as UomError
        return { ok: false, errors: [{ field: 'toId', message: err.message }], code: err.code }
      }
    },
  }),
}

export { convertQty, roundTo, compareQty }
