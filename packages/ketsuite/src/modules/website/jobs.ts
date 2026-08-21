import type { JobSpec } from 'ketjs'

export const jobs: Record<string, JobSpec> = {
  publishScheduled: {
    queue: 'default',
    input: { id: 'id', revisionId: 'id' },
    effects: ['read:website.Entry', 'write:website.Entry'],
    idempotent: true,
    handler: async (ctx, args) => {
      const entry = (await ctx.db.select('website.Entry', { id: args.id }))[0]
      if (
        entry?.status !== 'scheduled' ||
        entry.scheduledRevisionId !== args.revisionId ||
        !entry.scheduledRevisionId
      )
        return
      if (entry.publishAt && new Date(String(entry.publishAt)) > new Date()) return
      await ctx.db.compareAndSet(
        'website.Entry',
        { id: args.id },
        { status: 'scheduled', scheduledRevisionId: args.revisionId },
        {
          status: 'published',
          publishedRevisionId: args.revisionId,
          scheduledRevisionId: null,
          publishAt: null,
          publishedAt: new Date().toISOString(),
        },
      )
    },
  },
}
