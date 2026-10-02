import type { Ctx } from '@ketvietlab/ketjs'
import { dateBucket, isTimezone } from '@ketvietlab/ketjs'

/**
 * The company's civil-date timezone, or UTC when it has none.
 *
 * "Overdue" and "grouped by day" are claims about a calendar, and a calendar
 * belongs to a place. For Flow that place is the company: unlike Hospitality it
 * has no notion of a site, and a company that disagreed with itself about what
 * day it is would make the figures beside a list and the list itself say
 * different things — see FLW-DEC-010.
 *
 * The column is Accounting's by name because Accounting needed a civil date
 * first. It is the company's by meaning, and reading it here is what keeps two
 * settings from having to agree.
 */
export async function businessTimezone(ctx: Ctx): Promise<string> {
  const companyId = ctx.scope?.company
  if (!companyId) return 'UTC'
  const company = (await ctx.db.select('company.Company', { id: companyId }))[0]
  const timezone = String(company?.accountingTimezone ?? '').trim()
  return isTimezone(timezone) ? timezone : 'UTC'
}

/**
 * Today where the company is — which, for most of the day in Vietnam, is not
 * today in UTC. A task due today was being counted late from 07:00 local.
 */
export async function businessToday(ctx: Ctx, timezone?: string): Promise<string> {
  const zone = timezone ?? (await businessTimezone(ctx))
  return dateBucket(new Date().toISOString(), 'day', zone) ?? new Date().toISOString().slice(0, 10)
}
