// Roles: managing them, and resolving what a user may call.
//
// A role is a named list of function keys, additive across roles, the way
// Salesforce permission sets are additive over a minimal profile. It is not a set
// of models with CRUD flags — that is model-level CRUD grants, and it is what makes the domain contract's
// permissions unanswerable, because granting read on a table grants it everywhere
// the table is used.

import { asc, defineFn, deleteFrom, eq, from, inArray } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec } from '@ketvietlab/ketjs'

const error = (field: string, code: string, params?: Record<string, unknown>) => ({
  field,
  code,
  ...(params ? { params } : {}),
})

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
  const who = await ctx.db.one(from(U).select(U.superuser).where(eq(U.id, userId)))
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
  permissionCatalogue: defineFn({
    input: {},
    output: { key: 'text', module: 'text', task: 'text' },
    effects: [],
    handler: (ctx: Ctx) =>
      Object.entries(ctx.manifest.functions)
        .filter(([, fn]) => fn.exposure !== 'internal' && fn.provision !== true && !fn.anonymous)
        .map(([key]) => {
          const action = key.split('.').at(-1) ?? key
          const task = /^(list|get|count|report|forecast|permitted)/.test(action)
            ? 'read'
            : /^(save|create|archive|grant|revoke|assign|unassign|set|issue|apply|manage|publish|rollback)/.test(
                  action,
                )
              ? 'manage'
              : 'operate'
          return { key, module: key.split('.')[0] ?? '', task }
        })
        .sort(
          (a, b) =>
            a.module.localeCompare(b.module) || a.task.localeCompare(b.task) || a.key.localeCompare(b.key),
        ),
  }),

  applyPreset: defineFn({
    input: { module: 'text', level: 'text' },
    output: { ok: 'bool', roleId: 'id?', granted: 'int?', errors: 'json?' },
    effects: ['read:user.User', 'read:user.Role', 'write:user.Role', 'read:user.Grant', 'write:user.Grant'],
    idempotent: true,
    handler: async (ctx: Ctx, a) => {
      if (ctx.actor) {
        const U = ctx.table('user.User')
        const actor = await ctx.db.one(from(U).where(eq(U.id, ctx.actor), eq(U.active, true)))
        if (!actor?.superuser) return { ok: false, errors: [error('level', 'user.error.superuserRequired')] }
      }
      const moduleName = String(a.module)
      const level = String(a.level)
      if (!['user', 'manager'].includes(level))
        return { ok: false, errors: [error('level', 'user.error.presetLevel')] }
      if (!ctx.manifest.modules[moduleName])
        return { ok: false, errors: [error('module', 'user.error.moduleMissing')] }
      const roleId = `preset:${moduleName}:${level}`
      await ctx.db.insertIfAbsent('user.Role', {
        id: roleId,
        name: `${moduleName} · ${level === 'manager' ? 'Manager' : 'User'}`,
        description: `preset:${moduleName}:${level}`,
      })
      const keys = Object.entries(ctx.manifest.functions)
        .filter(([key, fn]) => {
          if (!key.startsWith(`${moduleName}.`) || fn.anonymous) return false
          if (fn.exposure === 'internal') return level === 'manager' && key === 'user.issueAuthToken'
          if (level === 'manager') return true
          const action = key.split('.').at(-1) ?? key
          // OAuth's public/self-service calls are anonymous-by-contract and already
          // available to a signed-in user. Provider and foreign identity rows are
          // administration data, so the ordinary User preset grants none of them.
          if (moduleName === 'oauth') return false
          return !/^(save|create|archive|grant|revoke|assign|unassign|set|issue|apply|manage|publish|rollback)/.test(
            action,
          )
        })
        .map(([key]) => key)
      let granted = 0
      for (const key of keys) {
        const result = await ctx.db.insertIfAbsent('user.Grant', {
          id: `preset:${moduleName}:${level}:${key}`,
          roleId,
          fnKey: key,
        })
        if ('dryRun' in result || result.inserted) granted++
      }
      return { ok: true, roleId, granted }
    },
  }),

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
      const owner = await ctx.db.one(from(R).where(eq(R.name, String(a.name).trim())))
      if (owner && owner.id !== a.id)
        return { ok: false, errors: [error('name', 'user.error.roleNameUnique')] }
      const cs = ctx.change('user.Role', a, existing).cast(['id', 'name', 'description']).required(['name'])
      if (!cs.valid) return { ok: false, errors: cs.errors }
      if (existing) {
        await ctx.db.commit(cs, { id: a.id })
        return { ok: true, id: a.id }
      }
      const inserted = await ctx.db.insertIfAbsent('user.Role', cs.changes)
      return 'dryRun' in inserted || inserted.inserted
        ? { ok: true, id: a.id }
        : { ok: false, errors: [error('name', 'user.error.roleNameUnique')] }
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
          errors: [error('fnKey', 'user.error.functionMissing', { key })],
        }
      }
      const R = ctx.table('user.Role')
      if (!(await ctx.db.one(from(R).where(eq(R.id, a.roleId))))) {
        return { ok: false, errors: [error('roleId', 'user.error.roleMissing')] }
      }
      const G = ctx.table('user.Grant')
      const held = await ctx.db.one(from(G).where(eq(G.roleId, a.roleId), eq(G.fnKey, key)))
      if (held) return { ok: true, id: String(held.id) }
      const inserted = await ctx.db.insertIfAbsent('user.Grant', { id: a.id, roleId: a.roleId, fnKey: key })
      return 'dryRun' in inserted || inserted.inserted
        ? { ok: true, id: a.id }
        : {
            ok: true,
            id: String((await ctx.db.one(from(G).where(eq(G.roleId, a.roleId), eq(G.fnKey, key))))?.id),
          }
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
        return { ok: false, errors: [error('userId', 'user.error.userMissing')] }
      }
      if (!(await ctx.db.one(from(R).where(eq(R.id, a.roleId))))) {
        return { ok: false, errors: [error('roleId', 'user.error.roleMissing')] }
      }
      const A = ctx.table('user.Assignment')
      const held = await ctx.db.one(from(A).where(eq(A.userId, a.userId), eq(A.roleId, a.roleId)))
      if (held) return { ok: true, id: String(held.id) }
      const inserted = await ctx.db.insertIfAbsent('user.Assignment', {
        id: a.id,
        userId: a.userId,
        roleId: a.roleId,
      })
      return 'dryRun' in inserted || inserted.inserted
        ? { ok: true, id: a.id }
        : {
            ok: true,
            id: String((await ctx.db.one(from(A).where(eq(A.userId, a.userId), eq(A.roleId, a.roleId))))?.id),
          }
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
