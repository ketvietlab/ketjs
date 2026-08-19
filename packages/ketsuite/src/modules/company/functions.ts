import { asc, defineFn, eq, from } from 'ketjs'
import type { Ctx, FnSpec, Row } from 'ketjs'

export const functions: Record<string, FnSpec> = {
  /**
   * Every company, regardless of which one the request is acting as.
   *
   * The model is shared so no `crossCompany` is needed — and that is the right
   * shape: knowing a company exists is not the same as being allowed to read its
   * ledgers, and only the second is a company-scoped question.
   */
  listCompanies: defineFn({
    input: { includeArchived: 'bool?' },
    output: { id: 'id', partnerId: 'id', parentId: 'id?', currency: 'text', active: 'bool' },
    effects: ['read:company.Company'],
    agent: true,
    handler: async (ctx: Ctx, a) => {
      const C = ctx.table('company.Company')
      const q = from(C).orderBy(asc(C.id))
      return ctx.db.all(a.includeArchived === true ? q : q.where(eq(C.active, true)))
    },
  }),

  saveCompany: defineFn({
    input: { id: 'id', partnerId: 'id', parentId: 'id?', currency: 'text' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:partner.Partner', 'read:company.Company', 'write:company.Company'],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, a) => {
      if (a.parentId === a.id) {
        return { ok: false, errors: [{ field: 'parentId', message: 'một công ty không thể là công ty mẹ của chính nó' }] }
      }
      const P = ctx.table('partner.Partner')
      const party = await ctx.db.one(from(P).where(eq(P.id, a.partnerId)))
      if (!party) return { ok: false, errors: [{ field: 'partnerId', message: 'không có đối tác nào mang id này' }] }
      if (party.kind !== 'company') {
        return { ok: false, errors: [{ field: 'partnerId', message: 'pháp nhân phải là đối tác loại "company"' }] }
      }
      const C = ctx.table('company.Company')
      const existing = await ctx.db.one(from(C).where(eq(C.id, a.id)))
      let cs = ctx.change('company.Company', a, existing)
        .cast(['id', 'partnerId', 'parentId', 'currency'])
        .required(['partnerId', 'currency'])
      if (!existing) cs = cs.put('active', true)
      if (!cs.valid) return { ok: false, errors: cs.errors }
      await ctx.db.commit(cs, existing ? { id: a.id } : undefined)
      return { ok: true, id: a.id }
    },
  }),

  archiveCompany: defineFn({
    input: { id: 'id', active: 'bool' },
    output: { id: 'id', active: 'bool' },
    effects: ['write:company.Company'],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, a) => {
      await ctx.db.update('company.Company', { id: a.id }, { active: a.active } as Row)
      return { id: a.id, active: a.active }
    },
  }),
}
