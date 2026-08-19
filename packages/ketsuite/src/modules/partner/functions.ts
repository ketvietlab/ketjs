import { asc, defineFn, deleteFrom, eq, from } from 'ketjs'
import type { Ctx, FnSpec, Row } from 'ketjs'
import { ADDRESS_USES, PARTNER_KINDS, PARTNER_ROLES } from './types.ts'

const oneOf = (allowed: readonly string[], what: string) => (v: unknown) =>
  allowed.includes(String(v)) || `${what} phải là một trong: ${allowed.join(', ')}`

/**
 * Every function declares what it hands back (D33). It matters more here than
 * anywhere so far: a party carries a tax number and an email, and a screen that
 * needs a name should not be the reason those travel.
 */
export const functions: Record<string, FnSpec> = {
  listPartners: defineFn({
    input: { role: 'text?', kind: 'text?', includeArchived: 'bool?' },
    output: { id: 'id', kind: 'text', name: 'text', ref: 'text?', active: 'bool' },
    effects: ['read:partner.Partner', 'read:partner.Role'],
    agent: true,
    handler: async (ctx: Ctx, a) => {
      const P = ctx.table('partner.Partner')
      let q = from(P).select(P.id, P.kind, P.name, P.ref, P.active).orderBy(asc(P.name))
      if (a.includeArchived !== true) q = q.where(eq(P.active, true))
      if (a.kind) q = q.where(eq(P.kind, a.kind))
      const rows = await ctx.db.all(q)
      if (!a.role) return rows

      // Filtering by role is a second query rather than a join, because the query
      // value has no join and adding one for this would be the wrong first reason.
      const R = ctx.table('partner.Role')
      const holders = new Set(
        (await ctx.db.all(from(R).select(R.partnerId).where(eq(R.role, a.role)))).map((r) => r.partnerId),
      )
      return rows.filter((r) => holders.has(r.id))
    },
  }),

  getPartner: defineFn({
    input: { id: 'id' },
    output: {
      id: 'id',
      kind: 'text',
      name: 'text',
      parentId: 'id?',
      vat: 'text?',
      ref: 'text?',
      email: 'text?',
      phone: 'text?',
      lang: 'text?',
      active: 'bool',
      addresses: 'json?',
      roles: 'json?',
    },
    effects: ['read:partner.Partner', 'read:partner.Address', 'read:partner.Role'],
    agent: true,
    handler: async (ctx: Ctx, a) => {
      const P = ctx.table('partner.Partner')
      return ctx.db.one(from(P).where(eq(P.id, a.id)).preload('addresses', 'roles'))
    },
  }),

  savePartner: defineFn({
    input: {
      id: 'id',
      kind: 'text',
      name: 'text',
      parentId: 'id?',
      vat: 'text?',
      ref: 'text?',
      email: 'text?',
      phone: 'text?',
      lang: 'text?',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:partner.Partner', 'write:partner.Partner'],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, a) => {
      if (a.parentId === a.id) {
        return {
          ok: false,
          errors: [{ field: 'parentId', message: 'một đối tác không thể là cha của chính nó' }],
        }
      }
      const P = ctx.table('partner.Partner')
      const existing = await ctx.db.one(from(P).where(eq(P.id, a.id)))
      let cs = ctx
        .change('partner.Partner', a, existing)
        .cast(['id', 'kind', 'name', 'parentId', 'vat', 'ref', 'email', 'phone', 'lang'])
        .required(['kind', 'name'])
        .validate('kind', oneOf(PARTNER_KINDS, 'loại đối tác'))
      if (!existing) cs = cs.put('active', true)
      if (!cs.valid) return { ok: false, errors: cs.errors }
      await ctx.db.commit(cs, existing ? { id: a.id } : undefined)
      return { ok: true, id: a.id }
    },
  }),

  archivePartner: defineFn({
    input: { id: 'id', active: 'bool' },
    output: { id: 'id', active: 'bool' },
    effects: ['write:partner.Partner'],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, a) => {
      await ctx.db.update('partner.Partner', { id: a.id }, { active: a.active } as Row)
      return { id: a.id, active: a.active }
    },
  }),

  saveAddress: defineFn({
    input: {
      id: 'id',
      partnerId: 'id',
      use: 'text',
      street: 'text',
      street2: 'text?',
      city: 'text',
      zip: 'text?',
      state: 'text?',
      country: 'text',
      isDefault: 'bool?',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:partner.Partner', 'read:partner.Address', 'write:partner.Address'],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, a) => {
      const P = ctx.table('partner.Partner')
      if (!(await ctx.db.one(from(P).where(eq(P.id, a.partnerId))))) {
        return { ok: false, errors: [{ field: 'partnerId', message: 'không có đối tác nào mang id này' }] }
      }
      const A = ctx.table('partner.Address')
      const existing = await ctx.db.one(from(A).where(eq(A.id, a.id)))
      let cs = ctx
        .change('partner.Address', a, existing)
        .cast(['id', 'partnerId', 'use', 'street', 'street2', 'city', 'zip', 'state', 'country'])
        .required(['partnerId', 'use', 'street', 'city', 'country'])
        .validate('use', oneOf(ADDRESS_USES, 'loại địa chỉ'))
      cs = cs.put('isDefault', a.isDefault === true)
      if (!cs.valid) return { ok: false, errors: cs.errors }
      await ctx.db.commit(cs, existing ? { id: a.id } : undefined)
      return { ok: true, id: a.id }
    },
  }),

  /**
   * Roles are added and removed rather than edited, which is what makes them rows:
   * a party becoming a supplier is one insert, not a column that grows.
   */
  grantRole: defineFn({
    input: { id: 'id', partnerId: 'id', role: 'text' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:partner.Partner', 'read:partner.Role', 'write:partner.Role'],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, a) => {
      if (!PARTNER_ROLES.includes(a.role as never)) {
        return {
          ok: false,
          errors: [{ field: 'role', message: `vai trò phải là một trong: ${PARTNER_ROLES.join(', ')}` }],
        }
      }
      const P = ctx.table('partner.Partner')
      if (!(await ctx.db.one(from(P).where(eq(P.id, a.partnerId))))) {
        return { ok: false, errors: [{ field: 'partnerId', message: 'không có đối tác nào mang id này' }] }
      }
      const R = ctx.table('partner.Role')
      const held = await ctx.db.one(from(R).where(eq(R.partnerId, a.partnerId), eq(R.role, a.role)))
      // Already held is success, not an error: the caller wanted it to be true.
      if (held) return { ok: true, id: String(held.id) }
      await ctx.db.insert('partner.Role', { id: a.id, partnerId: a.partnerId, role: a.role })
      return { ok: true, id: a.id }
    },
  }),

  revokeRole: defineFn({
    input: { partnerId: 'id', role: 'text' },
    output: { ok: 'bool', removed: 'int' },
    effects: ['read:partner.Role', 'write:partner.Role'],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, a) => {
      const R = ctx.table('partner.Role')
      const { changes } = await ctx.db.del(
        deleteFrom(R).where(eq(R.partnerId, a.partnerId), eq(R.role, a.role)),
      )
      return { ok: true, removed: changes }
    },
  }),

  /**
   * Terms for the company this request is acting as. The scope machinery decides
   * which rows those are — this function never mentions a company, which is the
   * whole point of the segment being a model rather than an EAV side table.
   */
  saveTerms: defineFn({
    input: {
      id: 'id',
      partnerId: 'id',
      paymentTermDays: 'int?',
      creditLimit: 'decimal?',
      receivableAccount: 'text?',
      payableAccount: 'text?',
      note: 'text?',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:partner.Partner', 'read:partner.CompanyTerms', 'write:partner.CompanyTerms'],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, a) => {
      const P = ctx.table('partner.Partner')
      if (!(await ctx.db.one(from(P).where(eq(P.id, a.partnerId))))) {
        return { ok: false, errors: [{ field: 'partnerId', message: 'không có đối tác nào mang id này' }] }
      }
      const T = ctx.table('partner.CompanyTerms')
      const existing = await ctx.db.one(from(T).where(eq(T.id, a.id)))
      const cs = ctx
        .change('partner.CompanyTerms', a, existing)
        .cast([
          'id',
          'partnerId',
          'paymentTermDays',
          'creditLimit',
          'receivableAccount',
          'payableAccount',
          'note',
        ])
        .required(['partnerId'])
      if (!cs.valid) return { ok: false, errors: cs.errors }
      await ctx.db.commit(cs, existing ? { id: a.id } : undefined)
      return { ok: true, id: a.id }
    },
  }),

  getTerms: defineFn({
    input: { partnerId: 'id' },
    output: {
      id: 'id',
      partnerId: 'id',
      paymentTermDays: 'int?',
      creditLimit: 'decimal?',
      receivableAccount: 'text?',
      payableAccount: 'text?',
      note: 'text?',
    },
    effects: ['read:partner.CompanyTerms'],
    agent: true,
    handler: async (ctx: Ctx, a) => {
      const T = ctx.table('partner.CompanyTerms')
      return ctx.db.one(from(T).where(eq(T.partnerId, a.partnerId)))
    },
  }),
}
