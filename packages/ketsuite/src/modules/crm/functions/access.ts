import { defineFn } from '@ketvietlab/ketjs'
import type { FnSpec } from '@ketvietlab/ketjs'
import { ensureCrmDefaults, invalid, issue, n } from '../operations.ts'
import { defaultEffects, command, isSuperuser, accessScopes } from './shared.ts'

export const accessFunctions: Record<string, FnSpec> = {
  'bootstrap.defaults': defineFn({
    input: { idempotencyKey: 'text' },
    output: { ok: 'bool' },
    effects: [...defaultEffects],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const error = command(ctx, args.idempotencyKey)
      if (error) return error
      await ensureCrmDefaults(ctx)
      return { ok: true }
    },
  }),

  'access.get': defineFn({
    input: { userId: 'id?' },
    output: { grant: 'json?' },
    effects: ['read:crm.AccessGrant', 'read:user.User'],
    agent: true,
    handler: async (ctx, args) => {
      if (!ctx.actor) return { grant: null }
      const requested = String(args.userId ?? ctx.actor)
      if (requested !== ctx.actor && !(await isSuperuser(ctx))) return { grant: null }
      const grant = (await ctx.db.select('crm.AccessGrant', { userId: requested }))[0] ?? null
      return { grant }
    },
  }),

  'access.save': defineFn({
    input: {
      id: 'id',
      userId: 'id',
      viewScope: 'text',
      editScope: 'text',
      assignScope: 'text',
      active: 'bool?',
      expectedVersion: 'int?',
      idempotencyKey: 'text',
    },
    output: { ok: 'bool', id: 'id?', version: 'int?', errors: 'json?' },
    effects: ['read:crm.AccessGrant', 'write:crm.AccessGrant', 'read:user.User'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const error = command(ctx, args.idempotencyKey)
      if (error) return error
      if (!(await isSuperuser(ctx))) return invalid(issue('actor', 'crm.error.permission'))
      if (
        !accessScopes.has(String(args.viewScope)) ||
        !accessScopes.has(String(args.editScope)) ||
        !accessScopes.has(String(args.assignScope))
      )
        return invalid(issue('viewScope', 'crm.error.invalidAccessScope'))
      const user = (await ctx.db.select('user.User', { id: args.userId, active: true }))[0]
      if (!user) return invalid(issue('userId', 'crm.error.notFound'))
      const byUser = (await ctx.db.select('crm.AccessGrant', { userId: args.userId }))[0]
      const existing = (await ctx.db.select('crm.AccessGrant', { id: args.id }))[0]
      if (byUser && byUser.id !== args.id) return invalid(issue('userId', 'crm.error.duplicateName'))
      if (existing && existing.userId !== args.userId) return invalid(issue('userId', 'crm.error.permission'))
      const expected = args.expectedVersion == null ? n(existing?.version) : n(args.expectedVersion)
      const version = n(existing?.version) + 1
      const values = {
        userId: args.userId,
        viewScope: args.viewScope,
        editScope: args.editScope,
        assignScope: args.assignScope,
        active: args.active ?? true,
        version,
      }
      if (existing) {
        const changed = await ctx.db.compareAndSet(
          'crm.AccessGrant',
          { id: args.id },
          { version: expected },
          values,
        )
        if (!('dryRun' in changed) && !changed.matched)
          return invalid(issue('version', 'crm.error.stageConflict', { current: existing.version }))
      } else await ctx.db.insert('crm.AccessGrant', { id: args.id, ...values })
      return { ok: true, id: args.id, version }
    },
  }),
}
