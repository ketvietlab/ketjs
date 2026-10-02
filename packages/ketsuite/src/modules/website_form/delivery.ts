import { asc, eq, from } from '@ketvietlab/ketjs'
import type { Ctx, Manifest, Row } from '@ketvietlab/ketjs'

/**
 * Handing a submission to the module that owns the work it asks for.
 *
 * A contact request is a CRM lead, not a Website record. This module cannot
 * know that: it depends on `website` alone, and naming CRM here would make every
 * site carry CRM. So the receiving side is a bridge that depends on this module
 * and comes to fetch what is waiting, the only direction the framework allows -
 * a module may enqueue only jobs of modules it depends on.
 *
 * A module receives submissions by declaring a job named `deliverFormSubmissions`.
 * That job is the whole contract: a form may name the module as its destination
 * only while the job is composed, the module reads `pendingDeliveries`, and writes
 * back with `recordDelivery`. The Website keeps its own copy of every submission -
 * the queue, the retention clock and the audit stay here - and the receiver
 * reports what became of the request, so the Studio can say so beside the copy.
 */
export const DESTINATION_JOB = 'deliverFormSubmissions'

/** How many times a failing hand-off is tried before it waits for a person. */
export const MAX_DELIVERY_ATTEMPTS = 5

export type DeliveryState = 'pending' | 'delivered' | 'failed'

/** Modules that receive submissions in this deployment, by name. */
export const destinationsOf = (manifest: Manifest): string[] =>
  Object.keys(manifest.jobs ?? {})
    .filter((key) => key.endsWith(`.${DESTINATION_JOB}`))
    .map((key) => key.slice(0, -DESTINATION_JOB.length - 1))
    .filter((name) => Boolean(manifest.modules[name]))
    .sort()

/** Forms in reach that route to a destination, for a sweep to find the companies with work. */
export const formsRoutedTo = async (ctx: Ctx, destination: string): Promise<Row[]> => {
  const Form = ctx.table('website_form.Form')
  return ctx.db.all(from(Form).where(eq(Form.destination, destination)).orderBy(asc(Form.id)))
}

/** Submissions waiting for this destination, oldest first. */
export const pendingDeliveries = async (ctx: Ctx, destination: string, limit: number): Promise<Row[]> => {
  const Submission = ctx.table('website_form.FormSubmission')
  return ctx.db.all(
    from(Submission)
      .where(eq(Submission.destination, destination), eq(Submission.deliveryState, 'pending'))
      .orderBy(asc(Submission.createdAt))
      .limit(limit),
  )
}

/**
 * Delivered submissions whose record is still open, least recently checked first.
 *
 * A closed record does not move again, so it leaves the rotation; an open one is
 * looked at in turn, which bounds every pass however long the backlog grows.
 */
export const openDeliveries = async (ctx: Ctx, destination: string, limit: number): Promise<Row[]> => {
  const Submission = ctx.table('website_form.FormSubmission')
  return ctx.db.all(
    from(Submission)
      .where(
        eq(Submission.destination, destination),
        eq(Submission.deliveryState, 'delivered'),
        eq(Submission.deliveryOutcome, 'open'),
      )
      .orderBy(asc(Submission.deliverySyncedAt), asc(Submission.createdAt))
      .limit(limit),
  )
}

export type DeliveryReport = {
  state?: DeliveryState
  /** The receiver's record, and where a person opens it. */
  ref?: string | null
  href?: string | null
  /** The receiver's own words for where the record stands, and whether it is still open. */
  status?: string | null
  outcome?: 'open' | 'won' | 'lost' | 'closed' | null
  /** A message key the receiver owns, saying why the hand-off failed. */
  error?: string | null
  attempts?: number
  at?: Date
}

/**
 * Write what the receiver says about one submission.
 *
 * Raced on the state the receiver read, so a person pressing retry while a pass
 * is running cannot have their pending row overwritten by the pass's failure.
 */
export const recordDelivery = async (ctx: Ctx, row: Row, report: DeliveryReport): Promise<boolean> => {
  const at = (report.at ?? new Date()).toISOString()
  const patch: Row = { deliverySyncedAt: at }
  if (report.state !== undefined) patch.deliveryState = report.state
  if (report.state === 'delivered' && !row.deliveredAt) patch.deliveredAt = at
  if (report.ref !== undefined) patch.deliveryRef = report.ref
  if (report.href !== undefined) patch.deliveryHref = report.href
  if (report.status !== undefined) patch.deliveryStatus = report.status
  if (report.outcome !== undefined) patch.deliveryOutcome = report.outcome
  if (report.error !== undefined) patch.deliveryError = report.error
  if (report.attempts !== undefined) patch.deliveryAttempts = report.attempts
  const changed = await ctx.db.compareAndSet(
    'website_form.FormSubmission',
    { id: row.id },
    { deliveryState: (row.deliveryState ?? null) as string | null },
    patch,
  )
  return 'dryRun' in changed || changed.matched
}

/** The delivery columns a submission starts with, given the form it was sent to. */
export const deliveryOnArrival = (form: Row): Row =>
  form.destination
    ? { destination: String(form.destination), deliveryState: 'pending', deliveryAttempts: 0 }
    : {}

/** The delivery columns as the module's readers return them. */
export const deliveryOutput = {
  destination: 'text?',
  deliveryState: 'text?',
  deliveryAttempts: 'int?',
  deliveryRef: 'text?',
  deliveryHref: 'text?',
  deliveryStatus: 'text?',
  deliveryOutcome: 'text?',
  deliveryError: 'text?',
  deliveredAt: 'datetime?',
  deliverySyncedAt: 'datetime?',
} as const
