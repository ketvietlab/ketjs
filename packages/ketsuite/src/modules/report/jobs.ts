import { defineJob, deleteFrom, eq } from 'ketjs'
import type { JobSpec } from 'ketjs'

export const jobs: Record<string, JobSpec> = {
  purgeCache: defineJob({
    queue: 'maintenance',
    input: {},
    effects: ['read:report.Cache', 'write:report.Cache', 'storage:remove'],
    idempotent: true,
    handler: async (ctx) => {
      const expired = (await ctx.db.select('report.Cache')).filter(
        (row) => row.active === false || String(row.expiresAt) <= new Date().toISOString(),
      )
      for (const row of expired) {
        await ctx.storage.remove(String(row.storageKey))
        const C = ctx.table('report.Cache')
        await ctx.db.del(deleteFrom(C).where(eq(C.id, row.id)))
      }
    },
  }),
}
