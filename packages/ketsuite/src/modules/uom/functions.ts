import { asc, defineFn, eq, from } from 'ketjs'
import type { Ctx, FnSpec, Row } from 'ketjs'
import { compareQty, convertQty, roundTo, type Unit, type UomError } from './convert.ts'

const PRECISION_ID = 'product'

const asUnit = (row: Row): Unit => ({
  id: String(row.id),
  parentPath: String(row.parentPath),
  absoluteFactor: Number(row.absoluteFactor),
  rounding: Number(row.rounding),
})

type UnitRow = {
  id: string
  name: string
  sequence: number
  relativeFactor: number
  relativeUomId: string | null
  absoluteFactor: number
  rounding: number
  parentPath: string
  active: boolean
  locked: boolean
}

function deriveTree(rows: UnitRow[]): { ok: true; rows: UnitRow[] } | { ok: false; errors: object[] } {
  const byId = new Map(rows.map((row) => [row.id, row]))
  const state = new Map<string, 0 | 1 | 2>()
  const visit = (row: UnitRow): string | null => {
    if (state.get(row.id) === 2) return null
    if (state.get(row.id) === 1) return row.id
    state.set(row.id, 1)
    if (!row.relativeUomId) {
      if (row.relativeFactor !== 1) return `${row.id}: reference root must have relativeFactor 1`
      row.absoluteFactor = 1
      row.parentPath = `${row.id}/`
    } else {
      const parent = byId.get(row.relativeUomId)
      if (!parent) return `${row.id}: unknown relativeUomId ${row.relativeUomId}`
      const error = visit(parent)
      if (error) return error
      row.absoluteFactor = row.relativeFactor * parent.absoluteFactor
      row.parentPath = `${parent.parentPath}${row.id}/`
    }
    state.set(row.id, 2)
    return null
  }
  for (const row of rows) {
    if (!(row.relativeFactor > 0))
      return { ok: false, errors: [{ field: 'relativeFactor', message: 'phải lớn hơn 0' }] }
    const error = visit(row)
    if (error)
      return {
        ok: false,
        errors: [
          {
            field: 'relativeUomId',
            message: error.includes('reference root')
              ? error
              : `cây đơn vị có vòng lặp hoặc cha không hợp lệ: ${error}`,
          },
        ],
      }
  }
  return { ok: true, rows }
}

export const functions: Record<string, FnSpec> = {
  listUnits: defineFn({
    input: { rootId: 'id?' },
    effects: ['read:uom.Unit'],
    agent: true,
    handler: async (ctx, args) => {
      const U = ctx.table('uom.Unit')
      const rows = await ctx.db.all(from(U).where(eq(U.active, true)).orderBy(asc(U.sequence), asc(U.name)))
      return args.rootId == null
        ? rows
        : rows.filter((row) => String(row.parentPath).split('/').filter(Boolean)[0] === args.rootId)
    },
  }),

  savePrecision: defineFn({
    input: { digits: 'int' },
    output: { ok: 'bool', errors: 'json?', digits: 'int?' },
    effects: ['read:uom.Precision', 'write:uom.Precision', 'read:uom.Unit'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const digits = Number(args.digits)
      if (digits < 0 || digits > 12)
        return { ok: false, errors: [{ field: 'digits', message: 'phải nằm trong khoảng 0..12' }] }
      const existing = (await ctx.db.select('uom.Precision', { id: PRECISION_ID }))[0]
      const units = await ctx.db.select('uom.Unit')
      if (units.length && Number(existing?.digits ?? 2) !== digits)
        return {
          ok: false,
          errors: [
            {
              field: 'digits',
              message: 'precision phải được cấu hình trước khi tạo đơn vị và không thể đổi sau đó',
            },
          ],
        }
      if (existing) await ctx.db.update('uom.Precision', { id: PRECISION_ID }, { digits })
      else await ctx.db.insert('uom.Precision', { id: PRECISION_ID, digits })
      return { ok: true, digits }
    },
  }),

  saveUnit: defineFn({
    input: {
      id: 'id',
      name: 'text',
      relativeUomId: 'id?',
      relativeFactor: 'decimal',
      sequence: 'int?',
      active: 'bool?',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:uom.Unit', 'write:uom.Unit', 'read:uom.Precision', 'write:uom.Precision'],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, args) => {
      if (args.relativeUomId === args.id)
        return {
          ok: false,
          errors: [{ field: 'relativeUomId', message: 'một đơn vị không thể tham chiếu chính nó' }],
        }
      const stored = await ctx.db.select('uom.Unit')
      const current = stored.find((row) => row.id === args.id)
      const precision = (await ctx.db.select('uom.Precision', { id: PRECISION_ID }))[0]
      const digits = precision ? Number(precision.digits) : 2
      const rounding = 10 ** -digits
      const conversionChanged =
        current &&
        (String(current.relativeUomId ?? '') !== String(args.relativeUomId ?? '') ||
          Number(current.relativeFactor) !== Number(args.relativeFactor))
      const lockedDescendant = conversionChanged
        ? stored.find(
            (row) =>
              row.id !== args.id &&
              Boolean(row.locked) &&
              String(row.parentPath).split('/').includes(String(args.id)),
          )
        : null
      if (conversionChanged && (current?.locked || lockedDescendant))
        return {
          ok: false,
          errors: [
            {
              field: 'relativeFactor',
              message: lockedDescendant
                ? `conversion identity ảnh hưởng đơn vị đã sử dụng ${String(lockedDescendant.id)}`
                : 'conversion identity đã được sử dụng và không thể đổi',
            },
          ],
        }
      const candidate: UnitRow = {
        id: String(args.id),
        name: String(args.name),
        sequence:
          args.sequence == null
            ? Math.min(Math.trunc(Number(args.relativeFactor) * 100), 1000)
            : Number(args.sequence),
        relativeFactor: Number(args.relativeFactor),
        relativeUomId: args.relativeUomId == null ? null : String(args.relativeUomId),
        absoluteFactor: 1,
        rounding,
        parentPath: '',
        active: args.active == null ? (current ? Boolean(current.active) : true) : Boolean(args.active),
        locked: current ? Boolean(current.locked) : false,
      }
      const rows = stored
        .filter((row) => row.id !== args.id)
        .map((row) => ({
          id: String(row.id),
          name: String(row.name),
          sequence: Number(row.sequence),
          relativeFactor: Number(row.relativeFactor),
          relativeUomId: row.relativeUomId == null ? null : String(row.relativeUomId),
          absoluteFactor: Number(row.absoluteFactor),
          rounding,
          parentPath: String(row.parentPath),
          active: Boolean(row.active),
          locked: Boolean(row.locked),
        }))
      rows.push(candidate)
      const derived = deriveTree(rows)
      if (!derived.ok) return derived

      await ctx.tx(async (tx) => {
        await tx.db.insertIfAbsent('uom.Precision', { id: PRECISION_ID, digits })
        for (const row of derived.rows) {
          const values = {
            name: row.name,
            sequence: row.sequence,
            relativeFactor: String(row.relativeFactor),
            relativeUomId: row.relativeUomId,
            absoluteFactor: String(row.absoluteFactor),
            rounding: String(row.rounding),
            parentPath: row.parentPath,
            locked: row.locked,
            active: row.active,
          }
          if (stored.some((old) => old.id === row.id)) await tx.db.update('uom.Unit', { id: row.id }, values)
          else await tx.db.insert('uom.Unit', { id: row.id, ...values })
        }
      })
      return { ok: true, id: args.id }
    },
  }),

  lockUnit: defineFn({
    input: { id: 'id' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:uom.Unit', 'write:uom.Unit'],
    idempotent: true,
    handler: async (ctx, args) => {
      const unit = (await ctx.db.select('uom.Unit', { id: args.id }))[0]
      if (!unit) return { ok: false, errors: [{ field: 'id', message: 'đơn vị không tồn tại' }] }
      await ctx.db.update('uom.Unit', { id: args.id }, { locked: true })
      return { ok: true, id: args.id }
    },
  }),

  convert: defineFn({
    input: { qty: 'float', fromId: 'id', toId: 'id' },
    output: { ok: 'bool', qty: 'float?', errors: 'json?', code: 'text?' },
    effects: ['read:uom.Unit'],
    agent: true,
    handler: async (ctx, args) => {
      const fromUnit = (await ctx.db.select('uom.Unit', { id: args.fromId }))[0]
      const toUnit = (await ctx.db.select('uom.Unit', { id: args.toId }))[0]
      if (!fromUnit || !toUnit)
        return {
          ok: false,
          errors: [{ field: fromUnit ? 'toId' : 'fromId', message: 'không có đơn vị nào mang id này' }],
        }
      try {
        return { ok: true, qty: convertQty(Number(args.qty), asUnit(fromUnit), asUnit(toUnit)) }
      } catch (error) {
        const problem = error as UomError
        return { ok: false, errors: [{ field: 'toId', message: problem.message }], code: problem.code }
      }
    },
  }),
}

export { compareQty, convertQty, roundTo }
