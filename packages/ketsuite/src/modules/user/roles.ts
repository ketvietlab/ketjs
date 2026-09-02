// Roles: managing them, and resolving what a user may call.
//
// A role is a named list of function keys, additive across roles, the way
// Salesforce permission sets are additive over a minimal profile. It is not a set
// of models with CRUD flags — that is model-level CRUD grants, and it is what makes the domain contract's
// permissions unanswerable, because granting read on a table grants it everywhere
// the table is used.

import { asc, defineFn, deleteFrom, eq, from, isNull, or } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Manifest } from '@ketvietlab/ketjs'
import {
  advanceAuthorizationRevision,
  authorizationFunctions,
  effectiveFunctionKeys,
  managedRoleHealthIssues,
  recordAuthorizationAudit,
} from './authorization.ts'

const AUTHORIZATION_MUTATION_EFFECTS = [
  'read:user.AuthorizationRevision',
  'write:user.AuthorizationRevision',
  'write:user.SecurityAudit',
]

const error = (field: string, code: string, params?: Record<string, unknown>) => ({
  field,
  code,
  ...(params ? { params } : {}),
})

export type LegacyPermissionTask = 'read' | 'operate' | 'manage'
export type LegacyPermissionCatalogueEntry = {
  key: string
  module: string
  task: LegacyPermissionTask
}

const legacyReadAction = /^(list|get|count|report|forecast|permitted)/
const legacyManageAction =
  /^(save|create|archive|grant|revoke|assign|unassign|set|issue|apply|manage|publish|rollback)/

const legacyTaskOf = (key: string): LegacyPermissionTask => {
  const action = key.split('.').at(-1) ?? key
  if (legacyReadAction.test(action)) return 'read'
  if (legacyManageAction.test(action)) return 'manage'
  return 'operate'
}

/** Exact projection used by the current permission screen. Kept public for migration inventory only. */
export const legacyPermissionCatalogue = (manifest: Manifest): LegacyPermissionCatalogueEntry[] =>
  Object.entries(manifest.functions)
    .filter(([, fn]) => fn.exposure !== 'internal' && fn.provision !== true && !fn.anonymous)
    .map(([key]) => ({
      key,
      module: key.split('.')[0] ?? '',
      task: legacyTaskOf(key),
    }))
    .sort(
      (left, right) =>
        left.module.localeCompare(right.module) ||
        left.task.localeCompare(right.task) ||
        left.key.localeCompare(right.key),
    )

/** Exact function set granted by the current module User/Manager preset heuristic. */
export const legacyPresetFunctions = (
  manifest: Manifest,
  moduleName: string,
  level: 'user' | 'manager',
): string[] => {
  if (!manifest.modules[moduleName]) throw new Error(`no module "${moduleName}" in the manifest`)
  return Object.entries(manifest.functions)
    .filter(([key, fn]) => {
      if (!key.startsWith(`${moduleName}.`) || fn.anonymous) return false
      if (fn.exposure === 'internal') return level === 'manager' && key === 'user.issueAuthToken'
      if (level === 'manager') return true
      // OAuth's public/self-service calls are anonymous-by-contract and already
      // available to a signed-in user. Provider and foreign identity rows are
      // administration data, so the ordinary User preset grants none of them.
      if (moduleName === 'oauth') return false
      return !legacyManageAction.test(key.split('.').at(-1) ?? key)
    })
    .map(([key]) => key)
    .sort()
}

/**
 * Every function key this user may call, across all their roles.
 *
 * Resolved per request rather than cached in the session. A cached list is a
 * revoked role that keeps working until someone logs out, and "why can they still
 * do that" is a worse conversation than one extra query. Cache it when a
 * measurement says to, not before.
 */
export async function permittedFor(ctx: Ctx, userId: string): Promise<string[] | null> {
  return effectiveFunctionKeys(ctx, userId)
}

export const roleFunctions: Record<string, FnSpec> = {
  ...authorizationFunctions,
  permissionCatalogue: defineFn({
    input: {},
    output: { key: 'text', module: 'text', task: 'text' },
    effects: [],
    handler: (ctx: Ctx) => legacyPermissionCatalogue(ctx.manifest),
  }),

  applyPreset: defineFn({
    input: { module: 'text', level: 'text' },
    output: { ok: 'bool', roleId: 'id?', granted: 'int?', errors: 'json?' },
    effects: [
      'read:user.User',
      'read:user.Role',
      'write:user.Role',
      'read:user.Grant',
      'write:user.Grant',
      'read:user.GrantSource',
      'write:user.GrantSource',
      ...AUTHORIZATION_MUTATION_EFFECTS,
    ],
    idempotent: true,
    handler: async (ctx: Ctx, a) => {
      if (ctx.actor) {
        const U = ctx.table('user.User')
        const actor = await ctx.db.one(from(U).where(eq(U.id, ctx.actor), eq(U.active, true)))
        const expiresAt = actor?.superuserExpiresAt ? Date.parse(String(actor.superuserExpiresAt)) : null
        if (!actor?.superuser || (expiresAt != null && expiresAt <= Date.now()))
          return {
            ok: false,
            errors: [error('level', 'user.error.superuserRequired')],
          }
      }
      const moduleName = String(a.module)
      const level = String(a.level)
      if (!['user', 'manager'].includes(level))
        return {
          ok: false,
          errors: [error('level', 'user.error.presetLevel')],
        }
      if (!ctx.manifest.modules[moduleName])
        return {
          ok: false,
          errors: [error('module', 'user.error.moduleMissing')],
        }
      const roleId = `preset:${moduleName}:${level}`
      return ctx.tx(async (tx) => {
        const role = await tx.db.insertIfAbsent('user.Role', {
          id: roleId,
          name: `${moduleName} · ${level === 'manager' ? 'Manager' : 'User'}`,
          description: `preset:${moduleName}:${level}`,
          mode: 'custom',
          templateKey: null,
          templateVersion: null,
          templateDigest: null,
          revision: 1,
        })
        const keys = legacyPresetFunctions(tx.manifest, moduleName, level as 'user' | 'manager')
        let granted = 0
        let changed = 'dryRun' in role || role.inserted
        for (const key of keys) {
          const source = await tx.db.insertIfAbsent('user.GrantSource', {
            id: `legacy:${roleId}:${key}`,
            roleId,
            fnKey: key,
            sourceKind: 'legacy-direct',
            sourceKey: `preset:${moduleName}:${level}`,
            sourceVersion: null,
          })
          const result = await tx.db.insertIfAbsent('user.Grant', {
            id: `preset:${moduleName}:${level}:${key}`,
            roleId,
            fnKey: key,
          })
          if ('dryRun' in result || result.inserted) granted++
          changed ||= 'dryRun' in source || source.inserted || 'dryRun' in result || result.inserted
        }
        if (changed) {
          const revision = await advanceAuthorizationRevision(tx)
          await recordAuthorizationAudit(tx, {
            event: 'authorization.legacy-preset.applied',
            targetKind: 'role',
            targetId: roleId,
            source: `preset:${moduleName}:${level}`,
            reason: 'legacy preset compatibility',
            before: null,
            after: { roleId, keys },
            revision,
          })
        }
        return { ok: true, roleId, granted }
      })
    },
  }),

  listRoles: defineFn({
    input: {},
    output: {
      id: 'id',
      name: 'text',
      description: 'text?',
      mode: 'text?',
      templateKey: 'text?',
      templateVersion: 'int?',
      templateDigest: 'text?',
      revision: 'int?',
      assignmentCount: 'int',
      healthIssues: 'json',
    },
    effects: ['read:user.Role', 'read:user.Assignment', 'read:user.Grant', 'read:user.GrantSource'],
    handler: async (ctx: Ctx) => {
      const R = ctx.table('user.Role')
      const A = ctx.table('user.Assignment')
      const G = ctx.table('user.Grant')
      const S = ctx.table('user.GrantSource')
      const [roles, assignments, grants, sources] = await Promise.all([
        ctx.db.all(from(R).orderBy(asc(R.name))),
        ctx.db.all(from(A)),
        ctx.db.all(from(G)),
        ctx.db.all(from(S)),
      ])
      return roles.map((role) => {
        const roleId = String(role.id)
        const healthIssues = managedRoleHealthIssues(ctx.manifest, role, grants, sources)
        if (
          grants.some(
            (grant) => String(grant.roleId) === roleId && !ctx.manifest.functions[String(grant.fnKey)],
          )
        )
          healthIssues.push('stale-function')
        return {
          ...role,
          assignmentCount: assignments.filter((assignment) => String(assignment.roleId) === roleId).length,
          healthIssues,
        }
      })
    },
  }),

  getRole: defineFn({
    input: { id: 'id' },
    output: {
      id: 'id',
      name: 'text',
      description: 'text?',
      mode: 'text?',
      templateKey: 'text?',
      templateVersion: 'int?',
      templateDigest: 'text?',
      revision: 'int?',
      grants: 'json?',
      grantSources: 'json?',
    },
    effects: ['read:user.Role', 'read:user.Grant', 'read:user.GrantSource'],
    handler: async (ctx: Ctx, a) => {
      const R = ctx.table('user.Role')
      return ctx.db.one(from(R).where(eq(R.id, a.id)).preload('grants').preload('grantSources'))
    },
  }),

  saveRole: defineFn({
    input: { id: 'id', name: 'text', description: 'text?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:user.Role', 'write:user.Role', ...AUTHORIZATION_MUTATION_EFFECTS],
    idempotent: true,
    handler: async (ctx: Ctx, a) => {
      const R = ctx.table('user.Role')
      const existing = await ctx.db.one(from(R).where(eq(R.id, a.id)))
      if (existing && String(existing.mode ?? 'custom') === 'managed')
        return { ok: false, errors: [error('id', 'E_ROLE_TEMPLATE_CONFLICT')] }
      const owner = await ctx.db.one(from(R).where(eq(R.name, String(a.name).trim())))
      if (owner && owner.id !== a.id)
        return {
          ok: false,
          errors: [error('name', 'user.error.roleNameUnique')],
        }
      const cs = ctx.change('user.Role', a, existing).cast(['id', 'name', 'description']).required(['name'])
      if (!cs.valid) return { ok: false, errors: cs.errors }
      if (existing) {
        if (
          existing.name === cs.changes.name &&
          (existing.description ?? null) === (cs.changes.description ?? null) &&
          String(existing.mode ?? 'custom') === 'custom'
        )
          return { ok: true, id: a.id }
        return ctx.tx(async (tx) => {
          const after = {
            name: cs.changes.name,
            description: cs.changes.description ?? null,
            mode: 'custom',
            revision: Number(existing.revision ?? 0) + 1,
          }
          await tx.db.update('user.Role', { id: a.id }, after)
          const revision = await advanceAuthorizationRevision(tx)
          await recordAuthorizationAudit(tx, {
            event: 'authorization.custom-role.updated',
            targetKind: 'role',
            targetId: String(a.id),
            source: 'custom',
            reason: 'legacy role editor compatibility',
            before: existing,
            after,
            revision,
          })
          return { ok: true, id: a.id }
        })
      }
      return ctx.tx(async (tx) => {
        const after = {
          ...cs.changes,
          mode: 'custom',
          templateKey: null,
          templateVersion: null,
          templateDigest: null,
          revision: 1,
        }
        const inserted = await tx.db.insertIfAbsent('user.Role', after)
        if (!('dryRun' in inserted) && !inserted.inserted)
          return {
            ok: false,
            errors: [error('name', 'user.error.roleNameUnique')],
          }
        const revision = await advanceAuthorizationRevision(tx)
        await recordAuthorizationAudit(tx, {
          event: 'authorization.custom-role.created',
          targetKind: 'role',
          targetId: String(a.id),
          source: 'custom',
          reason: 'legacy role editor compatibility',
          before: null,
          after,
          revision,
        })
        return { ok: true, id: a.id }
      })
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
    effects: [
      'read:user.Role',
      'read:user.Grant',
      'write:user.Grant',
      'read:user.GrantSource',
      'write:user.GrantSource',
      ...AUTHORIZATION_MUTATION_EFFECTS,
    ],
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
        return {
          ok: false,
          errors: [error('roleId', 'user.error.roleMissing')],
        }
      }
      return ctx.tx(async (tx) => {
        const G = tx.table('user.Grant')
        const S = tx.table('user.GrantSource')
        const held = await tx.db.one(from(G).where(eq(G.roleId, a.roleId), eq(G.fnKey, key)))
        const heldSource = await tx.db.one(
          from(S).where(
            eq(S.roleId, a.roleId),
            eq(S.fnKey, key),
            eq(S.sourceKind, 'custom'),
            eq(S.sourceKey, 'direct'),
          ),
        )
        if (held && heldSource) return { ok: true, id: String(held.id) }
        await tx.db.insertIfAbsent('user.GrantSource', {
          id: `custom:${String(a.roleId)}:${key}`,
          roleId: a.roleId,
          fnKey: key,
          sourceKind: 'custom',
          sourceKey: 'direct',
          sourceVersion: null,
        })
        const inserted = held
          ? null
          : await tx.db.insertIfAbsent('user.Grant', {
              id: a.id,
              roleId: a.roleId,
              fnKey: key,
            })
        const id = String(
          held?.id ??
            (inserted && ('dryRun' in inserted || inserted.inserted)
              ? a.id
              : (await tx.db.one(from(G).where(eq(G.roleId, a.roleId), eq(G.fnKey, key))))?.id),
        )
        const revision = await advanceAuthorizationRevision(tx)
        await recordAuthorizationAudit(tx, {
          event: 'authorization.custom-grant.added',
          targetKind: 'grant',
          targetId: id,
          source: 'custom:direct',
          reason: 'legacy grant editor compatibility',
          before: held,
          after: { roleId: a.roleId, fnKey: key },
          revision,
        })
        return { ok: true, id }
      })
    },
  }),

  revokeFunction: defineFn({
    input: { roleId: 'id', fnKey: 'text' },
    output: { ok: 'bool', removed: 'int' },
    effects: [
      'read:user.Grant',
      'write:user.Grant',
      'read:user.GrantSource',
      'write:user.GrantSource',
      ...AUTHORIZATION_MUTATION_EFFECTS,
    ],
    idempotent: true,
    handler: async (ctx: Ctx, a) => {
      return ctx.tx(async (tx) => {
        const G = tx.table('user.Grant')
        const S = tx.table('user.GrantSource')
        const grant = await tx.db.one(from(G).where(eq(G.roleId, a.roleId), eq(G.fnKey, a.fnKey)))
        if (!grant) return { ok: true, removed: 0 }
        const sources = await tx.db.all(from(S).where(eq(S.roleId, a.roleId), eq(S.fnKey, a.fnKey)))
        let changed = 0
        for (const source of sources.filter((row) =>
          ['custom', 'legacy-direct'].includes(String(row.sourceKind)),
        ))
          changed += (await tx.db.del(deleteFrom(S).where(eq(S.id, source.id)))).changes
        const remaining = await tx.db.one(from(S).where(eq(S.roleId, a.roleId), eq(S.fnKey, a.fnKey)))
        const legacyWithoutSource = sources.length === 0
        const removed =
          !remaining && (changed > 0 || legacyWithoutSource)
            ? (await tx.db.del(deleteFrom(G).where(eq(G.roleId, a.roleId), eq(G.fnKey, a.fnKey)))).changes
            : 0
        if (!changed && !removed) return { ok: true, removed: 0 }
        const revision = await advanceAuthorizationRevision(tx)
        await recordAuthorizationAudit(tx, {
          event: 'authorization.custom-grant.removed',
          targetKind: 'grant',
          targetId: String(grant.id),
          source: 'custom:direct',
          reason: 'legacy grant editor compatibility',
          before: grant,
          after: remaining ? grant : null,
          revision,
        })
        return { ok: true, removed }
      })
    },
  }),

  assignRole: defineFn({
    input: { id: 'id', userId: 'id', roleId: 'id' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:user.User',
      'read:user.Role',
      'read:user.Assignment',
      'write:user.Assignment',
      ...AUTHORIZATION_MUTATION_EFFECTS,
    ],
    idempotent: true,
    handler: async (ctx: Ctx, a) => {
      const U = ctx.table('user.User')
      const R = ctx.table('user.Role')
      if (!(await ctx.db.one(from(U).where(eq(U.id, a.userId))))) {
        return {
          ok: false,
          errors: [error('userId', 'user.error.userMissing')],
        }
      }
      if (!(await ctx.db.one(from(R).where(eq(R.id, a.roleId))))) {
        return {
          ok: false,
          errors: [error('roleId', 'user.error.roleMissing')],
        }
      }
      const scope = {
        scopeKind: 'tenant',
        companyId: null,
        branchId: null,
        scopeKey: 'tenant',
      }
      const A = ctx.table('user.Assignment')
      const held = await ctx.db.one(
        from(A).where(eq(A.userId, a.userId), eq(A.roleId, a.roleId), eq(A.scopeKey, 'tenant')),
      )
      if (held) return { ok: true, id: String(held.id) }
      return ctx.tx(async (tx) => {
        const inserted = await tx.db.insertIfAbsent('user.Assignment', {
          id: a.id,
          userId: a.userId,
          roleId: a.roleId,
          ...scope,
        })
        if (!('dryRun' in inserted) && !inserted.inserted) {
          const winner = await tx.db.one(
            from(tx.table('user.Assignment')).where(
              eq(tx.table('user.Assignment').userId, a.userId),
              eq(tx.table('user.Assignment').roleId, a.roleId),
              eq(tx.table('user.Assignment').scopeKey, 'tenant'),
            ),
          )
          return { ok: true, id: String(winner?.id) }
        }
        const id = String(a.id)
        const revision = await advanceAuthorizationRevision(tx)
        await recordAuthorizationAudit(tx, {
          event: 'authorization.assignment.created',
          targetKind: 'assignment',
          targetId: id,
          scopeKey: 'tenant',
          source: String(a.roleId),
          reason: 'legacy assignment compatibility',
          before: null,
          after: { userId: a.userId, roleId: a.roleId, ...scope },
          revision,
        })
        return { ok: true, id }
      })
    },
  }),

  unassignRole: defineFn({
    input: { userId: 'id', roleId: 'id' },
    output: { ok: 'bool', removed: 'int' },
    effects: ['read:user.Assignment', 'write:user.Assignment', ...AUTHORIZATION_MUTATION_EFFECTS],
    idempotent: true,
    handler: async (ctx: Ctx, a) => {
      return ctx.tx(async (tx) => {
        const A = tx.table('user.Assignment')
        const held = await tx.db.one(
          from(A).where(
            eq(A.userId, a.userId),
            eq(A.roleId, a.roleId),
            or(eq(A.scopeKey, 'tenant'), isNull(A.scopeKey)),
          ),
        )
        if (!held) return { ok: true, removed: 0 }
        const { changes } = await tx.db.del(deleteFrom(A).where(eq(A.id, held.id)))
        const revision = await advanceAuthorizationRevision(tx)
        await recordAuthorizationAudit(tx, {
          event: 'authorization.assignment.removed',
          targetKind: 'assignment',
          targetId: String(held.id),
          scopeKey: String(held.scopeKey ?? 'tenant'),
          source: String(a.roleId),
          reason: 'legacy assignment compatibility',
          before: held,
          after: null,
          revision,
        })
        return { ok: true, removed: changes }
      })
    },
  }),

  /** What a given user may call. The same list the server enforces per request. */
  permitted: defineFn({
    input: { userId: 'id' },
    output: { userId: 'id', functions: 'json?', superuser: 'bool' },
    effects: [
      'read:user.User',
      'read:user.Role',
      'read:user.Assignment',
      'read:user.Grant',
      'read:user.GrantSource',
      'read:user.Membership',
      'read:user.BranchMembership',
      'read:user.AuthorizationRevision',
      'read:company.Company',
      'read:company.Branch',
    ],
    handler: async (ctx: Ctx, a) => {
      const list = await permittedFor(ctx, String(a.userId))
      return list === null
        ? { userId: a.userId, superuser: true }
        : { userId: a.userId, functions: list, superuser: false }
    },
  }),
}
