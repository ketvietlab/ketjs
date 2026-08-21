import { defineJob, from, inArray } from '@ketvietlab/ketjs'
import type { JobContext, JobSpec } from '@ketvietlab/ketjs'

export const jobs: Record<string, JobSpec> = {
  sweep: defineJob({
    queue: 'maintenance',
    input: { minAgeMs: 'int?' },
    effects: ['read:storage.Attachment', 'storage:read', 'storage:remove'],
    idempotent: true,
    handler: async (ctx: JobContext, args) => {
      const company = ctx.scope.company
      if (!company) throw new Error('storage.sweep requires a company scope')
      const A = ctx.table('storage.Attachment')
      // A caller may shorten the grace period but never erase it: upload writes the
      // bytes before it records the row, so a zero floor collects objects an
      // in-flight request is about to reference.
      const cutoff = Date.now() - Math.max(5 * 60_000, Number(args.minAgeMs ?? 60 * 60 * 1_000))
      const prefix = `blobs/${company}/`
      let after: string | undefined
      do {
        const page = await ctx.storage.list(prefix, { ...(after ? { after } : {}), limit: 250 })
        const referenced = new Set(
          (await ctx.db.all(from(A).select(A.storeKey).where(inArray(A.storeKey, page.keys)))).map(
            (row) => row.storeKey,
          ),
        )
        for (const key of page.keys) {
          if (ctx.signal.aborted) throw ctx.signal.reason
          if (referenced.has(key)) continue
          const meta = await ctx.storage.head(key)
          if (!meta?.modifiedAt || new Date(meta.modifiedAt).getTime() > cutoff) continue
          await ctx.storage.remove(key)
        }
        after = page.next
      } while (after)
    },
  }),
}
