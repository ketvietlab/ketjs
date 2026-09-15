import { defineFn } from '@ketvietlab/ketjs'
import type { FnSpec, Row } from '@ketvietlab/ketjs'
import { gamificationProfile, n } from '../operations.ts'
import { command } from './shared.ts'

export const gamificationFunctions: Record<string, FnSpec> = {
  'gamification.refresh': defineFn({
    input: { userId: 'id?', limit: 'int?', idempotencyKey: 'text' },
    output: { ok: 'bool', profiles: 'json?', errors: 'json?' },
    effects: [
      'read:user.User',
      'read:crm.Case',
      'read:activity.Activity',
      'read:crm.GamificationProfile',
      'write:crm.GamificationProfile',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const error = command(ctx, args.idempotencyKey)
      if (error) return error
      const users = args.userId
        ? await ctx.db.select('user.User', { id: args.userId, active: true })
        : (await ctx.db.select('user.User', { active: true })).slice(
            0,
            Math.max(1, Math.min(500, n(args.limit ?? 200))),
          )
      /**
       * Counted per user rather than by loading the pipeline into memory.
       *
       * The previous shape read every case, every activity and every link on
       * every refresh, so the leaderboard grew a full-table scan per company as
       * the pipeline grew. Each figure is now a counting query the
       * `(companyId, assigneeUserId, …)` indexes already serve.
       */
      const profiles: Row[] = []
      for (const user of users) profiles.push(await gamificationProfile(ctx, user))
      return {
        ok: true,
        profiles: profiles.sort(
          (a, b) => n(b.points) - n(a.points) || String(a.id).localeCompare(String(b.id)),
        ),
      }
    },
  }),

  'gamification.list': defineFn({
    input: { limit: 'int?' },
    output: { profiles: 'json' },
    effects: ['read:crm.GamificationProfile', 'read:user.User'],
    handler: async (ctx, args) => {
      const users = new Map((await ctx.db.select('user.User')).map((user) => [String(user.id), user]))
      const profiles = (await ctx.db.select('crm.GamificationProfile'))
        .sort((a, b) => n(b.points) - n(a.points) || String(a.id).localeCompare(String(b.id)))
        .slice(0, Math.max(1, Math.min(200, n(args.limit ?? 50))))
        .map((profile) => ({
          ...profile,
          userName: users.get(String(profile.userId))?.name ?? profile.userId,
        }))
      return { profiles }
    },
  }),
}
