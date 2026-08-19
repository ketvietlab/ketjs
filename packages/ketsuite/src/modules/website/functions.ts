import { asc, defineFn, eq, from, like, validateLayout } from 'ketjs'
import type { Ctx, FnSpec, Row } from 'ketjs'

/**
 * The one query both the page and its total are built from — a count that filters
 * differently from the list it counts is the bug you find on page four.
 */
const pageQuery = (ctx: Ctx, a: { includeDrafts?: boolean | null; search?: string | null }) => {
  const P = ctx.table('website.Page')
  let q = from(P).orderBy(asc(P.path))
  if (a.includeDrafts !== true) q = q.where(eq(P.published, true))
  if (a.search != null && a.search !== '') q = q.where(like(P.title, `%${a.search}%`))
  return q
}

export const functions: Record<string, FnSpec> = {
  getPageByPath: defineFn({
    // A public storefront is public. It reads a published page and nothing else.
    anonymous: true,
    input: { path: 'text' },
    output: { id: 'id', path: 'text', title: 'text', layout: 'json', published: 'bool' },
    effects: ['read:website.Page'],
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const P = ctx.table('website.Page')
      return ctx.db.one(from(P).where(eq(P.path, args.path), eq(P.published, true)))
    },
  }),

  listPages: defineFn({
    input: { includeDrafts: 'bool?', search: 'text?', limit: 'int?', offset: 'int?' },
    output: { id: 'id', path: 'text', title: 'text', published: 'bool' },
    effects: ['read:website.Page'],
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const P = ctx.table('website.Page')
      let q = pageQuery(ctx, args).select(P.id, P.path, P.title, P.published)
      // Already checked as int by the signature; Number is the narrowing, not a parse.
      if (args.limit != null) q = q.limit(Number(args.limit))
      if (args.offset != null) q = q.offset(Number(args.offset))
      return ctx.db.all(q)
    },
  }),

  /** How many the list would return without its limit — the "/ 30" in "1-30 / 30". */
  countPages: defineFn({
    input: { includeDrafts: 'bool?', search: 'text?' },
    output: { count: 'int' },
    effects: ['read:website.Page'],
    agent: true,
    handler: async (ctx: Ctx, args) => ({ count: await ctx.db.count(pageQuery(ctx, args)) }),
  }),

  /**
   * The agent's main write surface. The layout is checked against the sections that
   * actually exist before anything is stored, and the failure comes back as a list
   * of what is wrong and where — not as an exception, because a list is what an
   * agent can act on.
   */
  savePage: defineFn({
    input: { id: 'id', path: 'text', title: 'text', layout: 'json' },
    output: { ok: 'bool', id: 'id?', sections: 'int?', errors: 'json?' },
    effects: ['read:website.Page', 'write:website.Page'],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const check = validateLayout(ctx.manifest, args.layout)
      if (!check.ok) return { ok: false, errors: check.errors }

      const P = ctx.table('website.Page')
      const existing = await ctx.db.one(from(P).where(eq(P.id, args.id)))
      let cs = ctx
        .change('website.Page', args, existing)
        .cast(['id', 'path', 'title', 'layout'])
        .required(['path', 'title'])
        .validate('path', (v) => String(v).startsWith('/') || 'đường dẫn phải bắt đầu bằng /')
        .put('updatedAt', new Date(0).toISOString())
      if (!existing) cs = cs.put('published', false)
      if (!cs.valid) return { ok: false, errors: cs.errors }

      await ctx.db.commit(cs, existing ? { id: args.id } : undefined)
      return { ok: true, id: args.id, sections: (args.layout as unknown[]).length }
    },
  }),

  publishPage: defineFn({
    input: { id: 'id', published: 'bool' },
    output: { id: 'id', published: 'bool' },
    effects: ['write:website.Page'],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, args) => {
      await ctx.db.update('website.Page', { id: args.id }, { published: args.published } as Row)
      return { id: args.id, published: args.published }
    },
  }),
}
