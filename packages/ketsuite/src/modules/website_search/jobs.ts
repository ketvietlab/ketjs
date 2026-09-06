import { defineJob, eq, from } from '@ketvietlab/ketjs'
import type { Ctx, JobSpec, Row } from '@ketvietlab/ketjs'
import { isCurrent, rebuildPass, stateFor } from './rebuild.ts'

/**
 * Keeping the index level with what is being served.
 *
 * `reindexSite` says in its own comment that it exists "so an operator or a job
 * can drive a long rebuild", and there was no job — so between publications the
 * index only caught up through `searchIndexed`, three passes at a time, paid
 * for by whichever visitors happened to search first. They also got `stale`
 * results while they paid. That is a sound fallback and a poor schedule.
 */

/** How many rebuild passes one run spends before handing the rest on. */
const PASSES_PER_RUN = 10

const dayStamp = (now: Date): string => now.toISOString().slice(0, 10)

/** The sites a rebuild could apply to: the ones actually being served. */
const servedSites = async (ctx: Ctx): Promise<Row[]> => {
  const Site = ctx.table('website.Site')
  return ctx.db.all(from(Site).where(eq(Site.active, true)))
}

export const jobs: Record<string, JobSpec> = {
  indexSweep: defineJob({
    input: {},
    idempotent: true,
    crossCompany: true,
    /**
     * `every`, not `dailyAt`: an index is behind or it is not, and that has no
     * opinion about what time it is anywhere. An hour is short enough that a
     * publication is searchable well before anyone notices, and long enough
     * that a site nobody edits costs one query an hour.
     */
    schedule: { every: '1h' },
    effects: ['read:website.Site', 'enqueue:website_search.rebuildStale'],
    handler: async (ctx) => {
      const now = new Date()
      const companies = new Set<string>()
      for (const site of await servedSites(ctx)) {
        const company = site.companyId == null ? '' : String(site.companyId)
        if (company) companies.add(company)
      }
      // One job per legal entity, keyed on the hour: a sweep retried after a
      // worker restart finds this hour's job already queued rather than
      // queueing a second one behind it.
      const stamp = `${dayStamp(now)}T${String(now.getUTCHours()).padStart(2, '0')}`
      for (const company of [...companies].sort())
        await ctx.jobs.enqueue(
          'website_search.rebuildStale',
          { pass: 1 },
          { company, uniqueKey: `website_search.sweep:${company}:${stamp}:1` },
        )
    },
  }),

  rebuildStale: defineJob({
    input: { pass: 'int?' },
    idempotent: true,
    effects: [
      'read:website.Site',
      'read:website.Entry',
      'read:website.EntryRevision',
      'read:website.Publication',
      'read:website_search.SearchDocument',
      'write:website_search.SearchDocument',
      'read:website_search.SearchIndexState',
      'write:website_search.SearchIndexState',
      'enqueue:website_search.rebuildStale',
    ],
    handler: async (ctx, args) => {
      const now = new Date()
      const pass = Number.isInteger(Number(args.pass)) ? Math.max(Number(args.pass), 1) : 1
      let budget = PASSES_PER_RUN
      let unfinished = false
      for (const site of await servedSites(ctx)) {
        if (budget === 0) {
          // Sites this run never reached.
          unfinished = true
          break
        }
        // The same passes the screen and the visitor path drive - a job
        // context cannot reach a declared function, so this is the import
        // rather than the call, and the behaviour is identical either way.
        if (isCurrent(await stateFor(ctx, site.id), site)) continue
        let done = false
        while (!done && budget > 0) {
          done = (await rebuildPass(ctx, site)).done
          budget -= 1
        }
        if (!done) unfinished = true
      }
      // A backlog is finished by another run rather than by a longer one, so a
      // first build over a large site cannot hold a worker slot long enough to
      // be killed and retried from the beginning.
      //
      // The company is in the key because a unique job key is unique per
      // tenant, not per company: without it two companies both needing a
      // second pass in the same hour would collide and one would never run.
      if (unfinished) {
        const stamp = `${dayStamp(now)}T${String(now.getUTCHours()).padStart(2, '0')}`
        await ctx.jobs.enqueue(
          'website_search.rebuildStale',
          { pass: pass + 1 },
          { uniqueKey: `website_search.sweep:${ctx.scope.company ?? ''}:${stamp}:${pass + 1}` },
        )
      }
    },
  }),
}
