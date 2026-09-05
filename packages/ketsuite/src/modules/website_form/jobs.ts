import { defineJob } from '@ketvietlab/ketjs'
import type { JobSpec } from '@ketvietlab/ketjs'
import { formsWithRetention, purgeFormOnce } from './purge.ts'

/** How many batches one run will do before handing the rest to another run. */
const PASSES_PER_RUN = 8

const dayStamp = (now: Date): string => now.toISOString().slice(0, 10)

/**
 * Retention runs on its own, because a retention period nobody enforces is a
 * sentence in a privacy notice rather than a property of the system.
 *
 * `every`, not `dailyAt`: an age in days is compared against a timestamp, and
 * has no opinion about what time of day it is anywhere. Naming a wall clock
 * here would force a timezone into a decision that does not have one.
 */
export const jobs: Record<string, JobSpec> = {
  retentionSweep: defineJob({
    input: {},
    idempotent: true,
    crossCompany: true,
    schedule: { every: '24h' },
    effects: ['read:website_form.Form', 'enqueue:website_form.purgeExpired'],
    handler: async (ctx) => {
      const now = new Date()
      const companies = new Set<string>()
      for (const form of await formsWithRetention(ctx)) {
        const company = form.companyId == null ? '' : String(form.companyId)
        if (company) companies.add(company)
      }
      // One job per legal entity, keyed on the day: a sweep retried after a
      // worker restart finds today's job already queued rather than queueing a
      // second one behind it.
      for (const company of [...companies].sort())
        await ctx.jobs.enqueue(
          'website_form.purgeExpired',
          { pass: 1 },
          { company, uniqueKey: `website_form.retention:${company}:${dayStamp(now)}:1` },
        )
    },
  }),

  purgeExpired: defineJob({
    input: { pass: 'int?' },
    idempotent: true,
    effects: [
      'read:website_form.Form',
      'read:website_form.FormSubmission',
      'write:website_form.FormSubmission',
      'write:website_form.FormSubmissionAudit',
      'enqueue:website_form.purgeExpired',
    ],
    handler: async (ctx, args) => {
      const now = new Date()
      const pass = Number.isInteger(Number(args.pass)) ? Math.max(Number(args.pass), 1) : 1
      const forms = await formsWithRetention(ctx)
      let budget = PASSES_PER_RUN
      let unfinished = false
      for (const form of forms) {
        if (budget === 0) {
          // Forms this run never reached.
          unfinished = true
          break
        }
        let more = true
        while (more && budget > 0) {
          more = (await purgeFormOnce(ctx, form, now)).more
          budget -= 1
        }
        if (more) unfinished = true
      }
      // A backlog is finished by another run rather than by a longer one, so a
      // first pass over years of submissions cannot hold a worker slot open
      // long enough to be killed and retried from the beginning.
      //
      // The company is in the key because a unique job key is unique per tenant,
      // not per company: without it, two companies both needing a second pass on
      // the same day would collide and one of them would silently never run.
      if (unfinished)
        await ctx.jobs.enqueue(
          'website_form.purgeExpired',
          { pass: pass + 1 },
          {
            uniqueKey: `website_form.retention:${ctx.scope.company ?? ''}:${dayStamp(now)}:${pass + 1}`,
          },
        )
    },
  }),
}
