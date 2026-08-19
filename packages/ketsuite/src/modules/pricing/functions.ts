import { defineFn } from 'ketjs'
import type { Ctx, FnSpec, Row } from 'ketjs'
import { convertQty, roundTo, type Unit } from '../uom/convert.ts'

export const APPLIED_ON = ['3_global', '2_product_category', '1_product', '0_product_variant'] as const
export const COMPUTE_PRICE = ['percentage', 'formula', 'fixed'] as const
export const PRICE_BASES = ['list_price', 'standard_price', 'pricelist'] as const

const invalid = (field: string, message: string) => ({ ok: false, errors: [{ field, message }] })

async function categoryAncestors(ctx: Ctx, id: unknown): Promise<Set<string>> {
  const result = new Set<string>()
  let cursor = id == null ? null : String(id)
  while (cursor && !result.has(cursor)) {
    result.add(cursor)
    const row = (await ctx.db.select('product.Category', { id: cursor }))[0]
    cursor = row?.parentId == null ? null : String(row.parentId)
  }
  return result
}

/**
 * A datetime as an instant, whichever adapter handed it over.
 *
 * SQLite gives back the ISO text that was written; Postgres stores TIMESTAMPTZ and
 * postgres.js parses it into a Date, whose `toString` is "Wed Aug 20 2026 …". A
 * string comparison between those two formats is not a date comparison at all — it
 * ranked every dated rule out of the running on Postgres and nowhere else.
 */
const at = (value: unknown): number | null => {
  if (value == null || value === '') return null
  const ms = value instanceof Date ? value.getTime() : Date.parse(String(value))
  return Number.isNaN(ms) ? null : ms
}

const applies = (
  item: Row,
  product: Row,
  template: Row,
  categories: Set<string>,
  qty: number,
  date: string,
) => {
  const when = at(date) ?? 0
  const start = at(item.dateStart)
  const end = at(item.dateEnd)
  if (Number(item.minQuantity) > qty) return false
  if (start !== null && start > when) return false
  if (end !== null && end < when) return false
  if (item.appliedOn === '0_product_variant') return item.productId === product.id
  if (item.appliedOn === '1_product') return item.templateId === template.id
  if (item.appliedOn === '2_product_category') return categories.has(String(item.categoryId))
  return item.appliedOn === '3_global'
}

async function priceFor(
  ctx: Ctx,
  pricelistId: string,
  product: Row,
  template: Row,
  qty: number,
  date: string,
  seen: Set<string>,
  depth = 0,
): Promise<{ price: number; ruleId: string | null }> {
  if (depth >= 32) throw new Error('pricelist recursion exceeds 32 levels')
  if (seen.has(pricelistId)) throw new Error(`recursive pricelist: ${[...seen, pricelistId].join(' -> ')}`)
  const nextSeen = new Set(seen).add(pricelistId)
  const categories = await categoryAncestors(ctx, template.categoryId)
  const categoryRank = new Map([...categories].map((categoryId, index) => [categoryId, index]))
  const items = (await ctx.db.select('pricing.PricelistItem', { pricelistId }))
    .filter((item) => applies(item, product, template, categories, qty, date))
    .sort((a, b) => {
      const specific = String(a.appliedOn).localeCompare(String(b.appliedOn))
      if (specific) return specific
      const quantity = Number(b.minQuantity) - Number(a.minQuantity)
      if (quantity) return quantity
      if (a.appliedOn === '2_product_category') {
        const category =
          Number(categoryRank.get(String(a.categoryId)) ?? Number.MAX_SAFE_INTEGER) -
          Number(categoryRank.get(String(b.categoryId)) ?? Number.MAX_SAFE_INTEGER)
        if (category) return category
      }
      return String(a.id).localeCompare(String(b.id))
    })
  const rule = items[0]
  if (!rule) return { price: Number(template.listPrice), ruleId: null }

  let base: number
  if (rule.base === 'standard_price') {
    const cost = (await ctx.db.select('product.Cost', { productId: product.id }))[0]
    base = Number(cost?.standardPrice ?? 0)
  } else if (rule.base === 'pricelist') {
    if (!rule.basePricelistId) throw new Error(`rule ${String(rule.id)} has no base pricelist`)
    const nested = (await ctx.db.select('pricing.Pricelist', { id: rule.basePricelistId }))[0]
    const current = (await ctx.db.select('pricing.Pricelist', { id: pricelistId }))[0]
    if (!nested || nested.currency !== current?.currency)
      throw new Error(`base pricelist ${String(rule.basePricelistId)} must use company currency`)
    base = (
      await priceFor(ctx, String(rule.basePricelistId), product, template, qty, date, nextSeen, depth + 1)
    ).price
  } else base = Number(template.listPrice)

  let price = base
  if (rule.computePrice === 'fixed') price = Number(rule.fixedPrice)
  else if (rule.computePrice === 'percentage') price = base - base * (Number(rule.percentPrice) / 100)
  else if (rule.computePrice === 'formula') {
    price = base - base * (Number(rule.priceDiscount) / 100)
    if (Number(rule.priceRound)) price = roundTo(price, Number(rule.priceRound))
    price += Number(rule.priceSurcharge)
    if (Number(rule.priceMinMargin)) price = Math.max(price, base + Number(rule.priceMinMargin))
    if (Number(rule.priceMaxMargin)) price = Math.min(price, base + Number(rule.priceMaxMargin))
  }
  return { price, ruleId: String(rule.id) }
}

export const functions: Record<string, FnSpec> = {
  listPricelists: defineFn({
    input: {},
    effects: ['read:pricing.Pricelist'],
    agent: true,
    handler: (ctx) => ctx.db.select('pricing.Pricelist'),
  }),
  listPricelistItems: defineFn({
    input: { pricelistId: 'id' },
    effects: ['read:pricing.PricelistItem'],
    agent: true,
    handler: (ctx, args) => ctx.db.select('pricing.PricelistItem', { pricelistId: args.pricelistId }),
  }),

  savePricelist: defineFn({
    input: { id: 'id', name: 'text', currency: 'text?', sequence: 'int?', active: 'bool?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:pricing.Pricelist', 'write:pricing.Pricelist', 'read:company.Company'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      if (!ctx.scope.company) return invalid('company', 'cần chọn company')
      const company = (await ctx.db.select('company.Company', { id: ctx.scope.company }))[0]
      if (!company) return invalid('company', 'company không tồn tại')
      const currency = String(args.currency ?? company.currency)
      if (currency !== company.currency)
        return invalid('currency', `phải dùng currency ${String(company.currency)} của company`)
      const existing = (await ctx.db.select('pricing.Pricelist', { id: args.id }))[0]
      const values = { ...args, currency, sequence: args.sequence ?? 16, active: args.active ?? true }
      const cs = ctx
        .change('pricing.Pricelist', values, existing ?? null)
        .cast(['id', 'name', 'currency', 'sequence', 'active'])
        .required(['name', 'currency'])
      if (!cs.valid) return { ok: false, errors: cs.errors }
      await ctx.db.commit(cs, existing ? { id: args.id } : undefined)
      return { ok: true, id: args.id }
    },
  }),

  savePricelistItem: defineFn({
    input: {
      id: 'id',
      pricelistId: 'id',
      dateStart: 'datetime?',
      dateEnd: 'datetime?',
      minQuantity: 'decimal?',
      appliedOn: 'text',
      categoryId: 'id?',
      templateId: 'id?',
      productId: 'id?',
      base: 'text?',
      basePricelistId: 'id?',
      computePrice: 'text',
      fixedPrice: 'decimal?',
      percentPrice: 'decimal?',
      priceDiscount: 'decimal?',
      priceRound: 'decimal?',
      priceSurcharge: 'decimal?',
      priceMinMargin: 'decimal?',
      priceMaxMargin: 'decimal?',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:pricing.Pricelist',
      'read:pricing.PricelistItem',
      'write:pricing.PricelistItem',
      'read:product.Category',
      'read:product.Template',
      'read:product.Product',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      if (!APPLIED_ON.includes(args.appliedOn as never))
        return invalid('appliedOn', `phải là: ${APPLIED_ON.join(', ')}`)
      if (!COMPUTE_PRICE.includes(args.computePrice as never))
        return invalid('computePrice', `phải là: ${COMPUTE_PRICE.join(', ')}`)
      const base = args.base ?? 'list_price'
      if (!PRICE_BASES.includes(base as never)) return invalid('base', `phải là: ${PRICE_BASES.join(', ')}`)
      if (!(await ctx.db.select('pricing.Pricelist', { id: args.pricelistId }))[0])
        return invalid('pricelistId', 'bảng giá không tồn tại')
      const start = at(args.dateStart)
      const end = at(args.dateEnd)
      if (start !== null && end !== null && start >= end) return invalid('dateEnd', 'phải sau dateStart')
      if (Number(args.minQuantity ?? 0) < 0) return invalid('minQuantity', 'không được âm')
      if (Number(args.priceRound ?? 0) < 0) return invalid('priceRound', 'không được âm')
      if (base === 'pricelist' && !args.basePricelistId)
        return invalid('basePricelistId', 'bắt buộc khi base là pricelist')
      if (args.basePricelistId === args.pricelistId)
        return invalid('basePricelistId', 'bảng giá không thể dựa trên chính nó')
      if (args.basePricelistId) {
        const current = (await ctx.db.select('pricing.Pricelist', { id: args.pricelistId }))[0]!
        const nested = (await ctx.db.select('pricing.Pricelist', { id: args.basePricelistId }))[0]
        if (!nested || nested.currency !== current.currency)
          return invalid('basePricelistId', 'bảng giá gốc phải cùng company và currency')
      }
      const target =
        args.appliedOn === '0_product_variant'
          ? args.productId
          : args.appliedOn === '1_product'
            ? args.templateId
            : args.appliedOn === '2_product_category'
              ? args.categoryId
              : true
      if (!target) return invalid('appliedOn', 'quy tắc thiếu đối tượng áp dụng')
      if (
        args.appliedOn === '0_product_variant' &&
        !(await ctx.db.select('product.Product', { id: args.productId }))[0]
      )
        return invalid('productId', 'biến thể không tồn tại')
      if (
        args.appliedOn === '1_product' &&
        !(await ctx.db.select('product.Template', { id: args.templateId }))[0]
      )
        return invalid('templateId', 'template không tồn tại')
      if (
        args.appliedOn === '2_product_category' &&
        !(await ctx.db.select('product.Category', { id: args.categoryId }))[0]
      )
        return invalid('categoryId', 'danh mục không tồn tại')
      const existing = (await ctx.db.select('pricing.PricelistItem', { id: args.id }))[0]
      const values = {
        ...args,
        base,
        minQuantity: args.minQuantity ?? '0',
        fixedPrice: args.fixedPrice ?? '0',
        percentPrice: args.percentPrice ?? '0',
        priceDiscount: args.priceDiscount ?? '0',
        priceRound: args.priceRound ?? '0',
        priceSurcharge: args.priceSurcharge ?? '0',
        priceMinMargin: args.priceMinMargin ?? '0',
        priceMaxMargin: args.priceMaxMargin ?? '0',
      }
      const cs = ctx
        .change('pricing.PricelistItem', values, existing ?? null)
        .cast([
          'id',
          'pricelistId',
          'dateStart',
          'dateEnd',
          'minQuantity',
          'appliedOn',
          'categoryId',
          'templateId',
          'productId',
          'base',
          'basePricelistId',
          'computePrice',
          'fixedPrice',
          'percentPrice',
          'priceDiscount',
          'priceRound',
          'priceSurcharge',
          'priceMinMargin',
          'priceMaxMargin',
        ])
        .required(['pricelistId', 'appliedOn', 'base', 'computePrice'])
      if (!cs.valid) return { ok: false, errors: cs.errors }
      await ctx.db.commit(cs, existing ? { id: args.id } : undefined)
      return { ok: true, id: args.id }
    },
  }),

  priceFor: defineFn({
    input: { pricelistId: 'id', productId: 'id', quantity: 'decimal', uomId: 'id?', date: 'datetime?' },
    output: { ok: 'bool', price: 'decimal?', currency: 'text?', ruleId: 'id?', errors: 'json?' },
    effects: [
      'read:pricing.Pricelist',
      'read:pricing.PricelistItem',
      'read:product.Product',
      'read:product.Template',
      'read:product.Category',
      'read:product.Cost',
      'read:uom.Unit',
    ],
    agent: true,
    handler: async (ctx, args) => {
      const pricelist = (await ctx.db.select('pricing.Pricelist', { id: args.pricelistId }))[0]
      if (!pricelist) return invalid('pricelistId', 'bảng giá không tồn tại')
      const product = (await ctx.db.select('product.Product', { id: args.productId }))[0]
      if (!product) return invalid('productId', 'biến thể không tồn tại')
      const template = (await ctx.db.select('product.Template', { id: product.templateId }))[0]!
      let quantity = Number(args.quantity)
      if (args.uomId) {
        if (!template.uomId) return invalid('uomId', 'template chưa có UoM mặc định')
        const from = (await ctx.db.select('uom.Unit', { id: args.uomId }))[0]
        const to = (await ctx.db.select('uom.Unit', { id: template.uomId }))[0]
        if (!from || !to) return invalid('uomId', 'đơn vị không tồn tại')
        try {
          quantity = convertQty(quantity, from as unknown as Unit, to as unknown as Unit)
        } catch (error) {
          return invalid('uomId', (error as Error).message)
        }
      }
      try {
        const result = await priceFor(
          ctx,
          String(args.pricelistId),
          product,
          template,
          quantity,
          String(args.date ?? new Date().toISOString()),
          new Set(),
        )
        return { ok: true, price: String(result.price), currency: pricelist.currency, ruleId: result.ruleId }
      } catch (error) {
        return { ok: false, errors: [{ field: 'pricelistId', message: (error as Error).message }] }
      }
    },
  }),
}
