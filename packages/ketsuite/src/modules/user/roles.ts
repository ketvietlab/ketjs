// Roles: managing them, and resolving what a user may call.
//
// A role is a named list of function keys, additive across roles, the way
// Salesforce permission sets are additive over a minimal profile. It is not a set
// of models with CRUD flags — that is ir.model.access, and it is what makes Odoo's
// permissions unanswerable, because granting read on a table grants it everywhere
// the table is used.

import { asc, defineFn, deleteFrom, eq, from, inArray } from 'ketjs'
import type { Ctx, FnSpec } from 'ketjs'

/**
 * Every function key this user may call, across all their roles.
 *
 * Resolved per request rather than cached in the session. A cached list is a
 * revoked role that keeps working until someone logs out, and "why can they still
 * do that" is a worse conversation than one extra query. Cache it when a
 * measurement says to, not before.
 */
export async function permittedFor(ctx: Ctx, userId: string): Promise<string[] | null> {
  // Null is "no restriction", and a superuser is the only thing that returns it —
  // otherwise the functions that grant the first role are themselves behind the
  // check, and nobody can ever be granted anything.
  const U = ctx.table('user.User')
  const who = await ctx.db.one(from(U).where(eq(U.id, userId)))
  if (who?.superuser) return null
  const A = ctx.table('user.Assignment')
  const roleIds = (await ctx.db.all(from(A).select(A.roleId).where(eq(A.userId, userId)))).map((r) =>
    String(r.roleId),
  )
  if (!roleIds.length) return []
  const G = ctx.table('user.Grant')
  const rows = await ctx.db.all(
    from(G)
      .select(G.fnKey)
      .where(inArray({ model: 'user.Grant', name: 'roleId' }, roleIds)),
  )
  return [...new Set(rows.map((r) => String(r.fnKey)))].sort()
}

export const roleFunctions: Record<string, FnSpec> = {
  listRoles: defineFn({
    input: {},
    output: { id: 'id', name: 'text', description: 'text?' },
    effects: ['read:user.Role'],
    handler: (ctx: Ctx) => ctx.db.all(from(ctx.table('user.Role')).orderBy(asc(ctx.table('user.Role').name))),
  }),

  getRole: defineFn({
    input: { id: 'id' },
    output: { id: 'id', name: 'text', description: 'text?', grants: 'json?' },
    effects: ['read:user.Role', 'read:user.Grant'],
    handler: async (ctx: Ctx, a) => {
      const R = ctx.table('user.Role')
      return ctx.db.one(from(R).where(eq(R.id, a.id)).preload('grants'))
    },
  }),

  saveRole: defineFn({
    input: { id: 'id', name: 'text', description: 'text?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:user.Role', 'write:user.Role'],
    idempotent: true,
    handler: async (ctx: Ctx, a) => {
      const R = ctx.table('user.Role')
      const existing = await ctx.db.one(from(R).where(eq(R.id, a.id)))
      const cs = ctx.change('user.Role', a, existing).cast(['id', 'name', 'description']).required(['name'])
      if (!cs.valid) return { ok: false, errors: cs.errors }
      await ctx.db.commit(cs, existing ? { id: a.id } : undefined)
      return { ok: true, id: a.id }
    },
  }),

  /**
   * Granting a function that does not exist is refused rather than stored.
   *
   * A grant for a removed or misspelt function is a permission nobody can see is
   * dead: it sits in the table looking like access, and the day the name comes
   * back it silently becomes access again.
   */
  grantFunction: defineFn({
    input: { id: 'id', roleId: 'id', fnKey: 'text' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:user.Role', 'read:user.Grant', 'write:user.Grant'],
    idempotent: true,
    handler: async (ctx: Ctx, a) => {
      const key = String(a.fnKey)
      if (!ctx.manifest.functions[key]) {
        return {
          ok: false,
          errors: [{ field: 'fnKey', message: `không có hàm "${key}" trong bản triển khai này` }],
        }
      }
      const R = ctx.table('user.Role')
      if (!(await ctx.db.one(from(R).where(eq(R.id, a.roleId))))) {
        return { ok: false, errors: [{ field: 'roleId', message: 'không có vai trò nào mang id này' }] }
      }
      const G = ctx.table('user.Grant')
      const held = await ctx.db.one(from(G).where(eq(G.roleId, a.roleId), eq(G.fnKey, key)))
      if (held) return { ok: true, id: String(held.id) }
      await ctx.db.insert('user.Grant', { id: a.id, roleId: a.roleId, fnKey: key })
      return { ok: true, id: a.id }
    },
  }),

  revokeFunction: defineFn({
    input: { roleId: 'id', fnKey: 'text' },
    output: { ok: 'bool', removed: 'int' },
    effects: ['read:user.Grant', 'write:user.Grant'],
    idempotent: true,
    handler: async (ctx: Ctx, a) => {
      const G = ctx.table('user.Grant')
      const { changes } = await ctx.db.del(deleteFrom(G).where(eq(G.roleId, a.roleId), eq(G.fnKey, a.fnKey)))
      return { ok: true, removed: changes }
    },
  }),

  assignRole: defineFn({
    input: { id: 'id', userId: 'id', roleId: 'id' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:user.User', 'read:user.Role', 'read:user.Assignment', 'write:user.Assignment'],
    idempotent: true,
    handler: async (ctx: Ctx, a) => {
      const U = ctx.table('user.User')
      const R = ctx.table('user.Role')
      if (!(await ctx.db.one(from(U).where(eq(U.id, a.userId))))) {
        return { ok: false, errors: [{ field: 'userId', message: 'không có người dùng nào mang id này' }] }
      }
      if (!(await ctx.db.one(from(R).where(eq(R.id, a.roleId))))) {
        return { ok: false, errors: [{ field: 'roleId', message: 'không có vai trò nào mang id này' }] }
      }
      const A = ctx.table('user.Assignment')
      const held = await ctx.db.one(from(A).where(eq(A.userId, a.userId), eq(A.roleId, a.roleId)))
      if (held) return { ok: true, id: String(held.id) }
      await ctx.db.insert('user.Assignment', { id: a.id, userId: a.userId, roleId: a.roleId })
      return { ok: true, id: a.id }
    },
  }),

  unassignRole: defineFn({
    input: { userId: 'id', roleId: 'id' },
    output: { ok: 'bool', removed: 'int' },
    effects: ['read:user.Assignment', 'write:user.Assignment'],
    idempotent: true,
    handler: async (ctx: Ctx, a) => {
      const A = ctx.table('user.Assignment')
      const { changes } = await ctx.db.del(
        deleteFrom(A).where(eq(A.userId, a.userId), eq(A.roleId, a.roleId)),
      )
      return { ok: true, removed: changes }
    },
  }),

  /** What a given user may call. The same list the server enforces per request. */
  permitted: defineFn({
    input: { userId: 'id' },
    output: { userId: 'id', functions: 'json?', superuser: 'bool' },
    effects: ['read:user.User', 'read:user.Assignment', 'read:user.Grant'],
    handler: async (ctx: Ctx, a) => {
      const list = await permittedFor(ctx, String(a.userId))
      return list === null
        ? { userId: a.userId, superuser: true }
        : { userId: a.userId, functions: list, superuser: false }
    },
  }),
}
