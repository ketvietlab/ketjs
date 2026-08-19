import { asc, defineFn, eq, from } from 'ketjs'
import type { Ctx, FnSpec } from 'ketjs'

export const functions: Record<string, FnSpec> = {
  listMenu: defineFn({
    input: {},
    effects: ['read:website_menu.MenuItem'],
    agent: true,
    handler: async (ctx: Ctx) => {
      const M = ctx.table('website_menu.MenuItem')
      return ctx.db.all(from(M).orderBy(asc(M.position)))
    },
  }),

  addMenuItem: defineFn({
    input: { id: 'id', label: 'text', href: 'text', position: 'int?' },
    effects: ['write:website_menu.MenuItem'],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, args) => {
      let cs = ctx.change('website_menu.MenuItem', args)
        .cast(['id', 'label', 'href', 'position'])
        .required(['label', 'href'])
        .validate('href', v => String(v).startsWith('/') || String(v).startsWith('http') || 'liên kết phải là / hoặc http')
      if (args.position == null) cs = cs.put('position', 0)
      if (!cs.valid) return { ok: false, errors: cs.errors }
      await ctx.db.commit(cs)
      return { ok: true, id: args.id }
    },
  }),

  removeMenuItem: defineFn({
    input: { id: 'id' },
    effects: ['write:website_menu.MenuItem'],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const M = ctx.table('website_menu.MenuItem')
      return ctx.db.del(from(M).where(eq(M.id, args.id)))
    },
  }),
}
