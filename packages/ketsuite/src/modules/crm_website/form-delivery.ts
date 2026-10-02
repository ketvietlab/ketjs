import { defineJob } from '@ketvietlab/ketjs'
import type { Ctx, JobSpec, Row } from '@ketvietlab/ketjs'
import { caseWriteEffects } from '../crm/index.ts'
import {
  DESTINATION_JOB,
  MAX_DELIVERY_ATTEMPTS,
  formsRoutedTo,
  openDeliveries,
  pendingDeliveries,
  recordDelivery,
} from '../website_form/delivery.ts'
import { isPurged } from '../website_form/retention.ts'
import { captureLead } from './functions.ts'

/**
 * Website form submissions, routed here, become CRM leads.
 *
 * The Website keeps its copy; the lead is CRM's record, worked in CRM. Every
 * minute a sweep finds the companies with forms routed here and queues one pass
 * each. A pass turns waiting submissions into leads and then reports, for the
 * open leads it last looked at longest ago, where each one stands now - so the
 * Studio can show a submission's lead moving through the pipeline without
 * reading CRM itself.
 */
const DESTINATION = 'crm_website'
const DELIVER_BATCH = 25
const SYNC_BATCH = 50
/** Long enough for a description, short enough that a form cannot fill a record with an essay. */
const DESCRIPTION_CAP = 8_000

const text = (value: unknown): string => (value == null ? '' : String(value).trim())
const fieldsOf = (schema: unknown): Row[] => {
  const fields = (schema as Row | null)?.fields
  return Array.isArray(fields) ? (fields as Row[]) : []
}
/** Field names a person's name is usually asked under. */
const NAME_FIELD = /^(name|full_?name|contact_?name|ho_?ten|ho_?va_?ten|ten)$/i

/**
 * The lead a submission describes, read from the fields the visitor was shown.
 *
 * Email and phone come from fields of those types, the person from a field named
 * like a name (or the first required text field), and every answer, labelled as
 * the visitor read it, goes into the description - so nothing asked is lost on
 * the way, whatever the form calls its fields.
 */
export const leadOf = (form: Row, schema: unknown, payload: unknown) => {
  const answers = (payload && typeof payload === 'object' ? payload : {}) as Row
  const fields = fieldsOf(schema)
  const first = (type: string) =>
    fields.map((f) => (f.type === type ? text(answers[String(f.name)]) : '')).find(Boolean) ?? ''
  const nameField =
    fields.find((f) => NAME_FIELD.test(String(f.name)) && text(answers[String(f.name)])) ??
    fields.find((f) => (f.type ?? 'text') === 'text' && f.required === true && text(answers[String(f.name)]))
  const person = nameField ? text(answers[String(nameField.name)]) : ''
  const lines = fields
    .map((f) => {
      const value = answers[String(f.name)]
      const shown = f.type === 'checkbox' ? (value === true ? 'Có' : 'Không') : text(value)
      return shown ? `${text(f.label) || String(f.name)}: ${shown}` : ''
    })
    .filter(Boolean)
  const formName = text(form.name)
  return {
    name: person ? `${formName}: ${person}`.slice(0, 200) : formName,
    contactName: person || null,
    email: first('email') || null,
    phone: first('tel') || null,
    description: lines.join('\n').slice(0, DESCRIPTION_CAP) || null,
    utmSource: 'website',
    utmMedium: 'form',
    utmCampaign: formName.slice(0, 200) || null,
  }
}

/**
 * Where a lead stands, in CRM's words: its stage, and whether it is still open.
 *
 * A merged lead is followed to the one it became, so the submission keeps
 * pointing at the record people actually work.
 */
export const caseStatusOf = async (ctx: Ctx, caseId: string) => {
  let id = caseId
  let held: Row | undefined
  for (let hop = 0; hop < 5; hop += 1) {
    held = (await ctx.db.select('crm.Case', { id }))[0]
    if (!held?.mergedIntoId) break
    id = String(held.mergedIntoId)
  }
  if (!held) return null
  const stage = held.stageId ? (await ctx.db.select('crm.Stage', { id: held.stageId }))[0] : undefined
  const state = text(held.terminalState)
  return {
    ref: id,
    href: ctx.manifest.modules.crm_backend ? `/admin/crm/cases/${encodeURIComponent(id)}` : null,
    status: text(stage?.name) || null,
    outcome: (state === 'won' || state === 'lost' ? state : held.active === false ? 'closed' : 'open') as
      | 'open'
      | 'won'
      | 'lost'
      | 'closed',
  }
}

const deliverOne = async (ctx: Ctx, row: Row, at: Date): Promise<void> => {
  const attempts = Number(row.deliveryAttempts ?? 0) + 1
  const fail = (error: string) => recordDelivery(ctx, row, { state: 'failed', error, attempts, at })
  if (isPurged(row)) {
    await fail('crm_website.error.answersErased')
    return
  }
  const form = (await ctx.db.select('website_form.Form', { id: row.formId }))[0]
  if (!form) {
    await fail('crm_website.error.formMissing')
    return
  }
  // The labels and types the visitor answered, not today's wording.
  const version = (
    await ctx.db.select('website_form.FormVersion', {
      formId: row.formId,
      version: Number(row.schemaVersion ?? 1),
    })
  )[0]
  const lead = leadOf(form, version?.schema ?? form.schema, row.payload)
  try {
    // CRM saves each lead in its own transaction. Keyed on the submission, so a pass that dies
    // after CRM saved the lead finds it on the next run.
    const result = await captureLead(
      ctx,
      { ...lead, idempotencyKey: `website-form:${String(row.id)}` },
      { rateLimit: false },
    )
    if (!result.ok) {
      // CRM refused the content (no way to reach the person, say); sending it again changes nothing.
      const code = String(result.errors?.[0]?.code ?? 'crm_website.error.deliveryFailed')
      // The visitor-facing wording would tell staff to enter a contact; theirs says what happened.
      await fail(code === 'crm_website.error.contactRequired' ? 'crm_website.error.noContact' : code)
      return
    }
    const status = await caseStatusOf(ctx, String(result.caseId))
    await recordDelivery(ctx, row, {
      state: 'delivered',
      ref: status?.ref ?? String(result.caseId),
      href: status?.href ?? null,
      status: status?.status ?? null,
      outcome: status?.outcome ?? 'open',
      error: null,
      attempts,
      at,
    })
  } catch (error) {
    // A fault on this side (a lock, a restart) is tried again on later passes, then left for a person.
    ctx.log.warn('crm_website.form_delivery_failed', {
      submission: String(row.id),
      attempts,
      error: error instanceof Error ? error.message : String(error),
    })
    await recordDelivery(ctx, row, {
      state: attempts >= MAX_DELIVERY_ATTEMPTS ? 'failed' : 'pending',
      error: 'crm_website.error.deliveryFailed',
      attempts,
      at,
    })
  }
}

const syncOne = async (ctx: Ctx, row: Row, at: Date): Promise<void> => {
  const status = row.deliveryRef ? await caseStatusOf(ctx, String(row.deliveryRef)) : null
  // A lead deleted in CRM has no stage left to report; the submission says so once and stops asking.
  await recordDelivery(
    ctx,
    row,
    status
      ? { ref: status.ref, href: status.href, status: status.status, outcome: status.outcome, at }
      : { href: null, status: null, outcome: 'closed', at },
  )
}

const leadEffects = [
  ...caseWriteEffects,
  'read:crm_website.Submission',
  'write:crm_website.Submission',
  'read:crm_website.SubmissionRateLimit',
  'write:crm_website.SubmissionRateLimit',
  'read:company.Company',
]

const minuteStamp = (at: Date): string => at.toISOString().slice(0, 16)

export const jobs: Record<string, JobSpec> = {
  /**
   * The marker `website_form` reads to offer CRM as a destination, and the sweep.
   *
   * One pass per company, keyed on the minute, so a sweep retried after a restart
   * finds this minute's pass already queued.
   */
  [DESTINATION_JOB]: defineJob({
    input: {},
    idempotent: true,
    crossCompany: true,
    schedule: { every: '1m' },
    effects: ['read:website_form.Form', 'enqueue:crm_website.routeFormSubmissions'],
    handler: async (ctx) => {
      const at = new Date()
      const companies = new Set<string>()
      for (const form of await formsRoutedTo(ctx, DESTINATION))
        if (form.companyId != null) companies.add(String(form.companyId))
      for (const company of [...companies].sort())
        await ctx.jobs.enqueue(
          'crm_website.routeFormSubmissions',
          {},
          { company, uniqueKey: `crm_website.forms:${company}:${minuteStamp(at)}` },
        )
    },
  }),

  routeFormSubmissions: defineJob({
    input: {},
    idempotent: true,
    effects: [
      ...leadEffects,
      'read:website_form.Form',
      'read:website_form.FormVersion',
      'read:website_form.FormSubmission',
      'write:website_form.FormSubmission',
    ],
    handler: async (ctx) => {
      const at = new Date()
      for (const row of await pendingDeliveries(ctx, DESTINATION, DELIVER_BATCH))
        await deliverOne(ctx, row, at)
      for (const row of await openDeliveries(ctx, DESTINATION, SYNC_BATCH)) await syncOne(ctx, row, at)
    },
  }),
}
