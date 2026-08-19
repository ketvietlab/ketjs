import { asc, defineFn, eq, from, like } from 'ketjs'
import type { Ctx, FnSpec, Row } from 'ketjs'
import { PRODUCT_TYPES } from './types.ts'

/**
 * The one query both the page and its total are built from.
 *
 * Written once because a count that filters differently from the list it counts
 * is the bug you find on page four, not on page one.
 */
const templateQuery = (ctx: Ctx, a: { type?: string | null; search?: string | null }) => {
  const T = ctx.table('product.Template')
  let q = from(T).where(eq(T.active, true)).orderBy(asc(T.name))
  if (a.type != null) q = q.where(eq(T.type, a.type))
  if (a.search != null && a.search !== '') q = q.where(like(T.name, `%${a.search}%`))
  return q
}

export const functions: Record<string, FnSpec> = {
  listTemplates: defineFn({
    // limit/offset/search go on the function rather than on a generic list
    // endpoint: the filter is part of what the function promises, so an agent
    // reading the signature sees it, and the effect check still applies.
    input: { withVariants: 'bool?', type: 'text?', search: 'text?', limit: 'int?', offset: 'int?' },
    // Projection is one level deep: naming "variants" here says the caller gets
    // the variant rows whole. That is a decision, and it is visible as one — the
    // alternative for a narrower slice is a view model, which is a field list.
    output: { id: 'id', name: 'text', type: 'text', categoryId: 'id?', uomId: 'id?', description: 'text?', active: 'bool?', variants: 'json?' },
    effects: ['read:product.Template', 'read:product.Product'],
    agent: true,
    handler: async (ctx: Ctx, a) => {
      let q = templateQuery(ctx, a)
      // Already checked as int by the signature; Number is the narrowing, not a parse.
      if (a.limit != null) q = q.limit(Number(a.limit))
      if (a.offset != null) q = q.offset(Number(a.offset))
      return ctx.db.all(a.withVariants === true ? q.preload('variants') : q)
    },
  }),

  /** How many the list would return without its limit — the "/ 30" in "1-30 / 30". */
  countTemplates: defineFn({
    input: { type: 'text?', search: 'text?' },
    output: { count: 'int' },
    effects: ['read:product.Template'],
    agent: true,
    handler: async (ctx: Ctx, a) => ({ count: await ctx.db.count(templateQuery(ctx, a)) }),
  }),

  getTemplate: defineFn({
    input: { id: 'id' },
    output: { id: 'id', name: 'text', type: 'text', categoryId: 'id?', uomId: 'id?', description: 'text?', active: 'bool?', variants: 'json?', category: 'json?', uom: 'json?' },
    effects: ['read:product.Template', 'read:product.Product', 'read:product.Category', 'read:uom.Unit'],
    agent: true,
    handler: async (ctx: Ctx, a) => {
      const T = ctx.table('product.Template')
      return ctx.db.one(from(T).where(eq(T.id, a.id)).preload('variants', 'category', 'uom'))
    },
  }),

  saveTemplate: defineFn({
    input: { id: 'id', name: 'text', type: 'text', categoryId: 'id?', uomId: 'id?', description: 'text?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:product.Template', 'write:product.Template'],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, a) => {
      const T = ctx.table('product.Template')
      const existing = await ctx.db.one(from(T).where(eq(T.id, a.id)))
      let cs = ctx.change('product.Template', a, existing)
        .cast(['id', 'name', 'type', 'categoryId', 'uomId', 'description'])
        .required(['name', 'type'])
        // The vocabulary is small on purpose, so it is checked here rather than
        // widened into the column type.
        .validate('type', v => PRODUCT_TYPES.includes(v as never) || `phải là một trong: ${PRODUCT_TYPES.join(', ')}`)
      if (!existing) cs = cs.put('active', true)
      if (!cs.valid) return { ok: false, errors: cs.errors }
      await ctx.db.commit(cs, existing ? { id: a.id } : undefined)
      return { ok: true, id: a.id }
    },
  }),

  saveVariant: defineFn({
    input: { id: 'id', templateId: 'id', sku: 'text', barcode: 'text?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:product.Product', 'read:product.Template', 'write:product.Product'],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, a) => {
      const T = ctx.table('product.Template')
      // A variant without a template is an orphan the schema would happily store,
      // so it is refused here rather than discovered later.
      if (!(await ctx.db.one(from(T).where(eq(T.id, a.templateId))))) {
        return { ok: false, errors: [{ field: 'templateId', message: 'không có template nào mang id này' }] }
      }
      const P = ctx.table('product.Product')
      const existing = await ctx.db.one(from(P).where(eq(P.id, a.id)))
      let cs = ctx.change('product.Product', a, existing)
        .cast(['id', 'templateId', 'sku', 'barcode'])
        .required(['templateId', 'sku'])
      if (!existing) cs = cs.put('active', true)
      if (!cs.valid) return { ok: false, errors: cs.errors }
      await ctx.db.commit(cs, existing ? { id: a.id } : undefined)
      return { ok: true, id: a.id }
    },
  }),

  archiveTemplate: defineFn({
    input: { id: 'id', active: 'bool' },
    output: { id: 'id', active: 'bool' },
    effects: ['write:product.Template'],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, a) => {
      // Archiving rather than deleting, for the same reason a field is never
      // dropped: rows elsewhere point at this one.
      await ctx.db.update('product.Template', { id: a.id }, { active: a.active } as Row)
      return { id: a.id, active: a.active }
    },
  }),

  listCategories: defineFn({
    input: {},
    output: { id: 'id', name: 'text', parentId: 'id?', children: 'json?' },
    effects: ['read:product.Category'],
    agent: true,
    handler: async (ctx: Ctx) => {
      const C = ctx.table('product.Category')
      return ctx.db.all(from(C).orderBy(asc(C.name)).preload('children'))
    },
  }),

  saveCategory: defineFn({
    input: { id: 'id', name: 'text', parentId: 'id?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:product.Category', 'write:product.Category'],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, a) => {
      if (a.parentId === a.id) {
        return { ok: false, errors: [{ field: 'parentId', message: 'một danh mục không thể là cha của chính nó' }] }
      }
      const C = ctx.table('product.Category')
      const existing = await ctx.db.one(from(C).where(eq(C.id, a.id)))
      const cs = ctx.change('product.Category', a, existing)
        .cast(['id', 'name', 'parentId'])
        .required(['name'])
      if (!cs.valid) return { ok: false, errors: cs.errors }
      await ctx.db.commit(cs, existing ? { id: a.id } : undefined)
      return { ok: true, id: a.id }
    },
  }),
}
