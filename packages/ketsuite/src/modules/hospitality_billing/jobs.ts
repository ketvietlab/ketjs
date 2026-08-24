/**
 * Billing the folios nobody billed by hand.
 *
 * A hotel closes folios all night; nobody is at the desk to press a button for
 * each one. This is the same call the button makes, run over everything closed
 * and unbilled — which is safe precisely because `invoiceFolio` converges: a
 * folio the desk already invoiced is returned, not invoiced again.
 *
 * It is deliberately not scheduled from inside this module. When a folio becomes
 * an invoice is a business decision — at checkout, at night audit, or only on
 * request — so a deployment enqueues it, the same way a property enqueues its
 * night audit.
 */

import { and, asc, defineFn, defineJob, eq, from } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, JobSpec, Row } from '@ketvietlab/ketjs'
import { functions } from './functions.ts'

const BATCH = 50

const invoiceEffects = (functions.invoiceFolio?.effects ?? []) as string[]

/** Closed folios with no bill against them, oldest first. */
const unbilled = async (ctx: Ctx, propertyId: unknown): Promise<Row[]> => {
  const F = ctx.table('hospitality_core.Folio')
  const closed = await ctx.db.all(
    from(F)
      .where(propertyId ? and(eq(F.state, 'closed'), eq(F.propertyId, propertyId)) : eq(F.state, 'closed'))
      .orderBy(asc(F.closedAt), asc(F.id))
      .limit(BATCH * 4),
  )
  const billed = new Set(
    (await ctx.db.select('hospitality_billing.FolioBill')).map((row) => String(row.folioId)),
  )
  return closed.filter((row) => !billed.has(String(row.id))).slice(0, BATCH)
}

export const billingJobs: Record<string, JobSpec> = {
  invoiceClosedFolios: defineJob({
    queue: 'default',
    input: { propertyId: 'id?' },
    effects: [...invoiceEffects],
    idempotent: true,
    maxAttempts: 3,
    timeoutMs: 120_000,
    handler: async (ctx, args) => {
      const folios = await unbilled(ctx, args.propertyId)
      let invoiced = 0
      const refused: Array<{ folioId: string; code: string }> = []
      for (const folio of folios) {
        const result = (await functions.invoiceFolio!.handler(ctx, { folioId: folio.id })) as Row
        if (result.ok === true) {
          invoiced += 1
          continue
        }
        // One folio nobody can bill must not stop the rest, and the reason is
        // worth carrying out: it is nearly always a charge type with no rule,
        // which is one decision away from unblocking every folio behind it.
        const first = (result.errors as Row[] | undefined)?.[0]
        refused.push({ folioId: String(folio.id), code: String(first?.code ?? 'unknown') })
      }
      // A job returns nothing, so what it did goes to the log — the refusals in
      // particular, because they are the same one repeated and worth reading.
      console.log(
        JSON.stringify({
          event: 'hospitality_billing.invoiceClosedFolios',
          considered: folios.length,
          invoiced,
          refused,
        }),
      )
    },
  }),
}

export const billingJobFunctions: Record<string, FnSpec> = {
  /**
   * Ask for the closed folios to be billed.
   *
   * Keyed per property so two operators pressing it, or a deployment running it
   * on a timer while somebody presses it, produce one run rather than several
   * competing over the same folios.
   */
  queueClosedFolios: defineFn({
    input: { propertyId: 'id?' },
    output: { ok: 'bool', queued: 'bool?' },
    effects: ['enqueue:hospitality_billing.invoiceClosedFolios'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const queued = await ctx.jobs.enqueue(
        'hospitality_billing.invoiceClosedFolios',
        { propertyId: args.propertyId ?? null },
        { uniqueKey: `invoice-closed-folios:${String(args.propertyId ?? 'all')}` },
      )
      return { ok: true, queued: !('dryRun' in queued) }
    },
  }),
}
