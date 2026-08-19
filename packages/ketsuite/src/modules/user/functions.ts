import { asc, defineFn, deleteFrom, eq, from } from 'ketjs'
import type { Ctx, FnSpec, Row } from 'ketjs'
import { hashPassword, needsRehash, verifyPassword } from './password.ts'
import { roleFunctions } from './roles.ts'

/**
 * Not one of these declares `password` in its output, which is what keeps the hash
 * inside the server: the projection picks declared fields, so a handler that
 * returned the whole row would still hand back only what is named here.
 */
export const functions: Record<string, FnSpec> = {
  ...roleFunctions,

  listUsers: defineFn({
    input: { includeArchived: 'bool?' },
    output: {
      id: 'id',
      login: 'text',
      name: 'text',
      email: 'text?',
      partnerId: 'id?',
      defaultCompanyId: 'id?',
      active: 'bool',
      superuser: 'bool',
    },
    effects: ['read:user.User'],
    agent: true,
    handler: async (ctx: Ctx, a) => {
      const U = ctx.table('user.User')
      const q = from(U).orderBy(asc(U.login))
      return ctx.db.all(a.includeArchived === true ? q : q.where(eq(U.active, true)))
    },
  }),

  getUser: defineFn({
    input: { id: 'id' },
    output: {
      id: 'id',
      login: 'text',
      name: 'text',
      email: 'text?',
      lang: 'text?',
      partnerId: 'id?',
      defaultCompanyId: 'id?',
      active: 'bool',
      superuser: 'bool',
      memberships: 'json?',
    },
    effects: ['read:user.User', 'read:user.Membership'],
    agent: true,
    handler: async (ctx: Ctx, a) => {
      const U = ctx.table('user.User')
      return ctx.db.one(from(U).where(eq(U.id, a.id)).preload('memberships'))
    },
  }),

  createUser: defineFn({
    input: {
      id: 'id',
      login: 'text',
      password: 'text',
      name: 'text',
      email: 'text?',
      partnerId: 'id?',
      defaultCompanyId: 'id?',
      superuser: 'bool?',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:user.User', 'write:user.User'],
    idempotent: true,
    // Deliberately not an agent tool: an agent that can mint logins is an agent
    // that can mint itself one.
    handler: async (ctx: Ctx, a) => {
      const U = ctx.table('user.User')
      if (await ctx.db.one(from(U).where(eq(U.login, a.login)))) {
        return { ok: false, errors: [{ field: 'login', message: 'tên đăng nhập đã tồn tại' }] }
      }
      if (String(a.password).length < 8) {
        return { ok: false, errors: [{ field: 'password', message: 'mật khẩu phải dài ít nhất 8 ký tự' }] }
      }
      const cs = ctx
        .change('user.User', { ...a, password: await hashPassword(String(a.password)) }, null)
        .cast(['id', 'login', 'password', 'name', 'email', 'partnerId', 'defaultCompanyId'])
        .required(['login', 'password', 'name'])
        .put('active', true)
        .put('superuser', a.superuser === true)
      if (!cs.valid) return { ok: false, errors: cs.errors }
      await ctx.db.commit(cs)
      return { ok: true, id: a.id }
    },
  }),

  /**
   * Changing a password takes the old one, even for an administrator acting on
   * their own account: a session someone walked away from should not be enough.
   */
  setPassword: defineFn({
    input: { id: 'id', currentPassword: 'text', newPassword: 'text' },
    output: { ok: 'bool', errors: 'json?' },
    effects: ['read:user.User', 'write:user.User'],
    handler: async (ctx: Ctx, a) => {
      const U = ctx.table('user.User')
      const row = await ctx.db.one(from(U).where(eq(U.id, a.id)))
      if (!row || !(await verifyPassword(String(a.currentPassword), String(row.password)))) {
        return { ok: false, errors: [{ field: 'currentPassword', message: 'mật khẩu hiện tại không đúng' }] }
      }
      if (String(a.newPassword).length < 8) {
        return { ok: false, errors: [{ field: 'newPassword', message: 'mật khẩu phải dài ít nhất 8 ký tự' }] }
      }
      await ctx.db.update('user.User', { id: a.id }, {
        password: await hashPassword(String(a.newPassword)),
      } as Row)
      return { ok: true }
    },
  }),

  /**
   * The one function that reads a password hash, and it returns a verdict rather
   * than a row. It also answers the same way for an unknown login and a wrong
   * password: telling those apart is how an attacker enumerates accounts.
   */
  authenticate: defineFn({
    // There is no session yet — checking the password is how one begins.
    anonymous: true,
    input: { login: 'text', password: 'text' },
    output: { ok: 'bool', userId: 'id?', companies: 'json?', defaultCompanyId: 'id?', rehash: 'bool?' },
    effects: ['read:user.User', 'read:user.Membership'],
    handler: async (ctx: Ctx, a) => {
      const U = ctx.table('user.User')
      const row = await ctx.db.one(from(U).where(eq(U.login, a.login), eq(U.active, true)))
      if (!row) {
        // Verify against nothing anyway, so a missing account does not answer
        // faster than a wrong password.
        await verifyPassword(String(a.password), 'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAA')
        return { ok: false }
      }
      if (!(await verifyPassword(String(a.password), String(row.password)))) return { ok: false }

      const M = ctx.table('user.Membership')
      const companies = (await ctx.db.all(from(M).select(M.companyId).where(eq(M.userId, row.id)))).map((r) =>
        String(r.companyId),
      )
      return {
        ok: true,
        userId: row.id,
        companies,
        defaultCompanyId: row.defaultCompanyId ?? companies[0] ?? null,
        rehash: needsRehash(String(row.password)),
      }
    },
  }),

  grantCompany: defineFn({
    input: { id: 'id', userId: 'id', companyId: 'id' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:user.User', 'read:company.Company', 'read:user.Membership', 'write:user.Membership'],
    idempotent: true,
    handler: async (ctx: Ctx, a) => {
      const U = ctx.table('user.User')
      const C = ctx.table('company.Company')
      if (!(await ctx.db.one(from(U).where(eq(U.id, a.userId))))) {
        return { ok: false, errors: [{ field: 'userId', message: 'không có người dùng nào mang id này' }] }
      }
      if (!(await ctx.db.one(from(C).where(eq(C.id, a.companyId))))) {
        return { ok: false, errors: [{ field: 'companyId', message: 'không có công ty nào mang id này' }] }
      }
      const M = ctx.table('user.Membership')
      const held = await ctx.db.one(from(M).where(eq(M.userId, a.userId), eq(M.companyId, a.companyId)))
      if (held) return { ok: true, id: String(held.id) }
      await ctx.db.insert('user.Membership', { id: a.id, userId: a.userId, companyId: a.companyId })
      return { ok: true, id: a.id }
    },
  }),

  revokeCompany: defineFn({
    input: { userId: 'id', companyId: 'id' },
    output: { ok: 'bool', removed: 'int' },
    effects: ['read:user.Membership', 'write:user.Membership'],
    idempotent: true,
    handler: async (ctx: Ctx, a) => {
      const M = ctx.table('user.Membership')
      const { changes } = await ctx.db.del(
        deleteFrom(M).where(eq(M.userId, a.userId), eq(M.companyId, a.companyId)),
      )
      return { ok: true, removed: changes }
    },
  }),

  archiveUser: defineFn({
    input: { id: 'id', active: 'bool' },
    output: { id: 'id', active: 'bool' },
    effects: ['write:user.User'],
    idempotent: true,
    handler: async (ctx: Ctx, a) => {
      await ctx.db.update('user.User', { id: a.id }, { active: a.active } as Row)
      return { id: a.id, active: a.active }
    },
  }),
}
