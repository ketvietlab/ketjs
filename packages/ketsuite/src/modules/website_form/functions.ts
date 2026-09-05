import { createHash, randomUUID } from 'node:crypto'
import { asc, defineFn, desc, eq, from, isNull } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { canAccessSite, canAdministerSite, canManageStructure } from '../website/access.ts'
import { actorKeyOf, recordAccess } from './audit.ts'
import { purgeFormOnce } from './purge.ts'
import {
  MAX_EXPORT_ROWS,
  exportRow,
  isHeld,
  isPurged,
  parseRetentionDays,
  parseSummaryFields,
  schemaFieldNames,
  summaryFieldsOf,
  summaryOf,
} from './retention.ts'

type FormField = {
  name: string
  type?: 'text' | 'email' | 'tel' | 'number' | 'textarea' | 'checkbox'
  required?: boolean
}

const invalid = (field: string, message: string) => ({ ok: false, errors: [{ field, message }] })
const FIELD_TYPES = new Set(['text', 'email', 'tel', 'number', 'textarea', 'checkbox'])
const page = (limit: unknown, offset: unknown) => ({
  limit: Math.min(Math.max(Number.isInteger(limit) ? Number(limit) : 50, 1), 100),
  offset: Math.min(Math.max(Number.isInteger(offset) ? Number(offset) : 0, 0), 100_000),
})
const jsonBytes = (value: unknown): number => {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8')
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

/**
 * A stable rendering of a value, so that re-saving a form with its keys in a
 * different order is recognised as the same contract rather than a new version.
 */
const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`
}

/**
 * What the version is a version of: the fields a visitor is asked to fill and
 * the notice they are asked to agree to. Both change what a rendered page means,
 * so both belong to one version rather than two that can disagree.
 */
const contractOf = (schema: unknown, consentText: unknown): string =>
  canonicalJson({ schema, consentText: normalisedNotice(consentText) })

/**
 * The stored form of a notice. Hashing the raw input while storing a trimmed
 * one made the two disagree, so re-saving an unchanged form advanced the
 * version every time and invalidated every page open against it.
 */
const normalisedNotice = (value: unknown): string | null =>
  value == null ? null : String(value).trim() || null

/** Forms created before versioning existed are version 1. */
const versionOf = (form: Row | null | undefined): number => {
  const raw = Number(form?.schemaVersion ?? 1)
  return Number.isInteger(raw) && raw > 0 ? raw : 1
}

const fieldsOf = (schema: unknown): FormField[] => {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return []
  const fields = (schema as { fields?: unknown }).fields
  if (!Array.isArray(fields)) return []
  return fields.filter(
    (field): field is FormField =>
      !!field && typeof field === 'object' && typeof (field as { name?: unknown }).name === 'string',
  )
}

const validateSchema = (schema: unknown): Array<{ field: string; message: string }> => {
  const fields = fieldsOf(schema)
  const rawFields =
    schema && typeof schema === 'object' && !Array.isArray(schema)
      ? (schema as { fields?: unknown }).fields
      : null
  if (!Array.isArray(rawFields) || rawFields.length !== fields.length)
    return [{ field: 'schema', message: 'website_form.error.invalidSchema' }]
  if (!fields.length) return [{ field: 'schema', message: 'website_form.error.fieldsRequired' }]
  if (fields.length > 50 || jsonBytes(schema) > 64 * 1024)
    return [{ field: 'schema', message: 'website_form.error.schemaTooLarge' }]
  const seen = new Set<string>()
  const errors: Array<{ field: string; message: string }> = []
  for (const field of fields) {
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(field.name))
      errors.push({ field: field.name, message: 'website_form.error.invalidFieldName' })
    if (seen.has(field.name)) errors.push({ field: field.name, message: 'website_form.error.duplicateField' })
    seen.add(field.name)
    if (field.type && !FIELD_TYPES.has(field.type))
      errors.push({ field: field.name, message: 'website_form.error.invalidFieldType' })
  }
  return errors
}

const validatePayload = (schema: unknown, payload: unknown): Array<{ field: string; message: string }> => {
  const fields = fieldsOf(schema)
  const value =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {}
  const allowed = new Set(fields.map((field) => field.name))
  const errors: Array<{ field: string; message: string }> = []
  if (jsonBytes(value) > 64 * 1024)
    return [{ field: 'payload', message: 'website_form.error.payloadTooLarge' }]
  for (const key of Object.keys(value))
    if (!allowed.has(key)) errors.push({ field: key, message: 'website_form.error.unknownField' })
  for (const field of fields) {
    const current = value[field.name]
    if (field.required && (current == null || current === '' || current === false)) {
      errors.push({ field: field.name, message: 'website_form.error.required' })
      continue
    }
    if (current == null || current === '') continue
    if (field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(current)))
      errors.push({ field: field.name, message: 'website_form.error.invalidEmail' })
    if (field.type === 'number' && !Number.isFinite(Number(current)))
      errors.push({ field: field.name, message: 'website_form.error.invalidNumber' })
    if (field.type === 'checkbox' && typeof current !== 'boolean')
      errors.push({ field: field.name, message: 'website_form.error.invalidCheckbox' })
    if (typeof current === 'string' && current.length > (field.type === 'textarea' ? 10_000 : 1_000))
      errors.push({ field: field.name, message: 'website_form.error.valueTooLong' })
  }
  return errors
}

const fingerprint = (formId: unknown, rateKey: unknown): string =>
  createHash('sha256')
    .update(`${String(formId)}:${String(rateKey ?? 'anonymous')}`)
    .digest('hex')
const digestId = (formId: unknown, key: string): string =>
  createHash('sha256')
    .update(`submission:${String(formId)}:${key}`)
    .digest('hex')

const formById = (ctx: Ctx, id: unknown): Promise<Row | null> => {
  const Form = ctx.table('website_form.Form')
  return ctx.db.one(from(Form).where(eq(Form.id, id)))
}

const submissionById = async (ctx: Ctx, id: unknown): Promise<Row | null> =>
  (await ctx.db.select('website_form.FormSubmission', { id }))[0] ?? null

/**
 * Whether a visitor can reach this form at all.
 *
 * A form is served by a site, and deactivating a site is how a whole website
 * is withdrawn. That withdrawal reached the pages and stopped at the forms: a
 * form checked only its own `active` flag, so every form on a site that had
 * been taken down kept answering `getForm` and kept accepting posts. The page
 * already sitting in someone's browser is the case this exists for — the site
 * is gone and the submit button still works.
 */
const servesPublicly = async (ctx: Ctx, form: Row): Promise<boolean> => {
  if (form.active !== true) return false
  const site = (await ctx.db.select('website.Site', { id: form.siteId }))[0]
  return site?.active === true
}

/**
 * The form behind a submission, and whether this caller may read its answers.
 *
 * Reading one person's answers is a higher bar than working the queue they
 * arrive in: an editor arranges the site, an administrator answers for what
 * leaves it. A caller below the bar is told the same thing as a caller naming
 * a row that does not exist, so that the refusal does not confirm the row.
 */
const readableSubmission = async (ctx: Ctx, id: unknown): Promise<{ form: Row; row: Row } | null> => {
  const row = await submissionById(ctx, id)
  if (!row) return null
  const form = await formById(ctx, row.formId)
  if (!form || !(await canAdministerSite(ctx, form.siteId))) return null
  return { form, row }
}

const claimRateSlot = async (ctx: Ctx, key: string, now: Date): Promise<boolean> => {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const held = (await ctx.db.select('website_form.FormRateLimit', { id: key }))[0]
    if (!held) {
      const inserted = await ctx.db.insertIfAbsent('website_form.FormRateLimit', {
        id: key,
        key,
        windowStartedAt: now.toISOString(),
        count: 1,
      })
      if ('dryRun' in inserted || inserted.inserted) return true
      continue
    }
    const startedAt = new Date(String(held.windowStartedAt))
    const inWindow = now.getTime() - startedAt.getTime() < 15 * 60 * 1000
    if (inWindow && Number(held.count) >= 5) return false
    const nextStartedAt = inWindow ? held.windowStartedAt : now.toISOString()
    const nextCount = inWindow ? Number(held.count) + 1 : 1
    const changed = await ctx.db.compareAndSet(
      'website_form.FormRateLimit',
      { id: key },
      { windowStartedAt: held.windowStartedAt, count: held.count },
      { windowStartedAt: nextStartedAt, count: nextCount },
    )
    if ('dryRun' in changed || changed.matched) return true
  }
  return false
}

export const functions: Record<string, FnSpec> = {
  listForms: defineFn({
    input: { siteId: 'id', active: 'bool?' },
    output: {
      id: 'id',
      siteId: 'id',
      name: 'text',
      schema: 'json',
      schemaVersion: 'int',
      consentText: 'text?',
      summaryFields: 'json?',
      retentionDays: 'int?',
      successMessage: 'text',
      notifyTo: 'text?',
      active: 'bool',
    },
    effects: ['read:website_form.Form', 'read:website.SiteMember'],
    agent: true,
    handler: async (ctx: Ctx, args) => {
      if (!(await canAccessSite(ctx, args.siteId))) return []
      const Form = ctx.table('website_form.Form')
      let query = from(Form).where(eq(Form.siteId, args.siteId)).orderBy(asc(Form.name))
      if (args.active != null) query = query.where(eq(Form.active, args.active))
      const rows = await ctx.db.all(query)
      // Normalised here too: a caller seeding a version from this list would
      // otherwise send an empty value for a pre-versioning row, and the route
      // would read that as "no version declared" and skip the staleness check.
      return rows.map((row) => ({ ...row, schemaVersion: versionOf(row) }))
    },
  }),

  getForm: defineFn({
    anonymous: true,
    input: { id: 'id' },
    output: {
      id: 'id',
      siteId: 'id',
      name: 'text',
      schema: 'json',
      schemaVersion: 'int',
      consentText: 'text?',
      successMessage: 'text',
      active: 'bool',
    },
    effects: ['read:website.Site', 'read:website_form.Form'],
    handler: async (ctx: Ctx, args) => {
      const form = await formById(ctx, args.id)
      if (!form || !(await servesPublicly(ctx, form))) return null
      // The version travels with the schema so the rendered page can send it back.
      return { ...form, schemaVersion: versionOf(form) }
    },
  }),

  saveForm: defineFn({
    input: {
      id: 'id',
      siteId: 'id',
      name: 'text',
      schema: 'json',
      consentText: 'text?',
      summaryFields: 'json?',
      retentionDays: 'int?',
      successMessage: 'text',
      notifyTo: 'text?',
      active: 'bool?',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:website.Site',
      'read:website.SiteMember',
      'read:website_form.Form',
      'write:website_form.Form',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const site = (await ctx.db.select('website.Site', { id: args.siteId }))[0]
      if (!site) return invalid('siteId', 'website_form.error.siteNotFound')
      if (!(await canManageStructure(ctx, args.siteId))) return invalid('siteId', 'website.error.forbidden')
      const schemaErrors = validateSchema(args.schema)
      if (schemaErrors.length) return { ok: false, errors: schemaErrors }
      const existing = await formById(ctx, args.id)
      if (existing && existing.siteId !== args.siteId)
        return invalid('id', 'website.error.immutableOwnership')
      // The notice that will actually be stored, computed once so the hash and
      // the row can never disagree: absent means "leave it alone", an explicit
      // null clears it. Comparing the raw argument instead made every save that
      // simply omitted the field look like a contract change.
      const notice =
        args.consentText === undefined
          ? normalisedNotice(existing?.consentText)
          : normalisedNotice(args.consentText)

      // Absent leaves both alone, the rule the notice already follows. Neither
      // appears on the screen that edits a form's fields, so a save from that
      // screen must not clear a retention period or a preview list that someone
      // set deliberately somewhere else.
      const summary = parseSummaryFields(
        args.summaryFields === undefined ? (existing?.summaryFields ?? null) : args.summaryFields,
      )
      if (!summary.ok) return invalid('summaryFields', 'website_form.error.invalidSummaryFields')
      const declared = new Set(schemaFieldNames(args.schema))
      const stranger = (summary.value ?? []).find((name) => !declared.has(name))
      // Refused rather than dropped: an editor who mistypes a field name and is
      // shown an empty preview column concludes the feature is broken.
      if (stranger) return invalid('summaryFields', 'website_form.error.unknownSummaryField')
      const retention = parseRetentionDays(
        args.retentionDays === undefined ? (existing?.retentionDays ?? null) : args.retentionDays,
      )
      if (!retention.ok) return invalid('retentionDays', 'website_form.error.invalidRetention')

      // A save that leaves the field contract alone keeps its version, so an
      // editor fixing a typo in the success message does not invalidate every
      // form page a visitor currently has open.
      const contractChanged =
        !existing || contractOf(existing.schema, existing.consentText) !== contractOf(args.schema, notice)
      const row = {
        id: args.id,
        siteId: args.siteId,
        name: String(args.name).trim(),
        schema: args.schema,
        schemaVersion: contractChanged ? versionOf(existing) + (existing ? 1 : 0) : versionOf(existing),
        consentText: notice,
        summaryFields: summary.value,
        retentionDays: retention.value,
        successMessage: String(args.successMessage).trim(),
        notifyTo: args.notifyTo ? String(args.notifyTo).trim() : null,
        active: args.active !== false,
      }
      if (!row.name || row.name.length > 200) return invalid('name', 'website_form.error.invalidName')
      if (!row.successMessage || row.successMessage.length > 1_000)
        return invalid('successMessage', 'website_form.error.invalidMessage')
      if (row.notifyTo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.notifyTo))
        return invalid('notifyTo', 'website_form.error.invalidEmail')
      const duplicate = (await ctx.db.select('website_form.Form', { siteId: args.siteId })).find(
        (form) => form.id !== args.id && String(form.name).toLowerCase() === row.name.toLowerCase(),
      )
      if (duplicate) return invalid('name', 'website_form.error.duplicateName')
      if (existing) {
        // The version is the concurrency token, so the write has to race on it.
        // Two saves that both read version 1 and both computed 2 would publish
        // two different contracts under one number, and the staleness check
        // below would then certify a stale payload as current — the exact
        // outcome this feature exists to prevent. `null` compares as IS NULL,
        // so a row written before versioning is guarded the same way.
        const swapped = await ctx.db.compareAndSet(
          'website_form.Form',
          { id: args.id },
          { schemaVersion: (existing.schemaVersion ?? null) as number | null },
          row,
        )
        if (!('dryRun' in swapped) && !swapped.matched)
          return invalid('schema', 'website_form.error.saveConflict')
      } else await ctx.db.insert('website_form.Form', row)
      return { ok: true, id: args.id }
    },
  }),

  /**
   * The queue, without the answers in it.
   *
   * A worklist used to hand every editor the full payload of every submission,
   * so triaging a contact form meant reading everyone's phone number whether
   * or not that was the job. What it carries now is when something arrived and
   * what state it is in, plus whichever answers the form itself declares safe
   * to preview — nothing, unless someone chose otherwise. Opening one record is
   * a separate call, at a higher bar, and it is written down.
   */
  listSubmissions: defineFn({
    input: { formId: 'id', status: 'text?', limit: 'int?', offset: 'int?' },
    output: {
      id: 'id',
      formId: 'id',
      summary: 'json',
      schemaVersion: 'int?',
      consent: 'bool',
      consentText: 'text?',
      status: 'text',
      createdAt: 'datetime',
      purgedAt: 'datetime?',
      held: 'bool',
      holdReason: 'text?',
    },
    effects: ['read:website_form.Form', 'read:website_form.FormSubmission', 'read:website.SiteMember'],
    handler: async (ctx: Ctx, args) => {
      const form = await formById(ctx, args.formId)
      if (!form || !(await canManageStructure(ctx, form.siteId))) return []
      const Submission = ctx.table('website_form.FormSubmission')
      const paging = page(args.limit, args.offset)
      let query = from(Submission)
        .where(eq(Submission.formId, args.formId))
        .orderBy(desc(Submission.createdAt))
      if (args.status) query = query.where(eq(Submission.status, args.status))
      query = query.limit(paging.limit).offset(paging.offset)
      const previewable = summaryFieldsOf(form)
      return (await ctx.db.all(query)).map((row) => ({
        ...row,
        summary: isPurged(row) ? {} : summaryOf(row.payload, previewable),
        held: isHeld(row),
      }))
    },
  }),

  /**
   * How many rows the queue has, so a screen can page it honestly.
   *
   * Separate from the list for the same reason `countSearchPublished` is: the
   * list's output is a projection of submission rows, and a total is not one
   * of them.
   */
  countSubmissions: defineFn({
    input: { formId: 'id', status: 'text?' },
    output: { count: 'int' },
    effects: ['read:website_form.Form', 'read:website_form.FormSubmission', 'read:website.SiteMember'],
    handler: async (ctx: Ctx, args) => {
      const form = await formById(ctx, args.formId)
      if (!form || !(await canManageStructure(ctx, form.siteId))) return { count: 0 }
      const Submission = ctx.table('website_form.FormSubmission')
      let query = from(Submission).where(eq(Submission.formId, args.formId))
      if (args.status) query = query.where(eq(Submission.status, args.status))
      return { count: await ctx.db.count(query) }
    },
  }),

  submitForm: defineFn({
    anonymous: true,
    input: {
      formId: 'id',
      payload: 'json',
      consent: 'bool?',
      honeypot: 'text?',
      source: 'text?',
      rateKey: 'text?',
      submissionKey: 'text?',
      /** The contract the page was rendered against, echoed back on submit. */
      schemaVersion: 'int?',
    },
    output: { ok: 'bool', id: 'id?', message: 'text?', errors: 'json?' },
    effects: [
      'read:website.Site',
      'read:website_form.Form',
      'read:website_form.FormRateLimit',
      'read:website_form.FormSubmission',
      'write:website_form.FormRateLimit',
      'write:website_form.FormSubmission',
    ],
    exposure: 'internal',
    idempotent: true,
    handler: async (ctx: Ctx, args) => {
      if (String(args.honeypot ?? '').trim()) return { ok: true, message: '' }
      const form = await formById(ctx, args.formId)
      if (!form || !(await servesPublicly(ctx, form)))
        return invalid('formId', 'website_form.error.unavailable')
      // A page rendered against an older contract is told so once, plainly.
      // Validating it against the current schema instead would report a field
      // the visitor was never shown as missing, and blame them for it.
      const current = versionOf(form)
      if (args.schemaVersion != null && Number(args.schemaVersion) !== current)
        return invalid('formId', 'website_form.error.staleForm')
      // A form that shows a notice is asking for agreement to it. Storing
      // consent: false against such a form would record a submission nobody
      // agreed to.
      if (form.consentText && args.consent !== true)
        return invalid('consent', 'website_form.error.consentRequired')
      // And a page that will not say which notice it showed cannot be recorded
      // as agreeing to the current one. The version check above is opt-in,
      // which is harmless for fields — but stamping an unversioned submission
      // with the version in force would manufacture agreement to a notice the
      // visitor may never have seen. No version, no truthful record, no write.
      if (form.consentText && args.schemaVersion == null)
        return invalid('schemaVersion', 'website_form.error.consentVersionRequired')
      const errors = validatePayload(form.schema, args.payload)
      if (errors.length) return { ok: false, errors }

      const now = new Date()
      const key = fingerprint(args.formId, String(args.rateKey ?? 'anonymous').slice(0, 500))
      const dedupeKey = args.submissionKey
        ? createHash('sha256')
            .update(`${String(args.formId)}:${String(args.submissionKey).slice(0, 500)}`)
            .digest('hex')
        : null
      if (dedupeKey) {
        const replay = (
          await ctx.db.select('website_form.FormSubmission', { formId: args.formId, dedupeKey })
        )[0]
        if (replay) return { ok: true, id: replay.id, message: form.successMessage }
      }

      const id = dedupeKey ? digestId(args.formId, dedupeKey) : randomUUID()
      const accepted = await ctx.tx(async (tx) => {
        if (!(await claimRateSlot(tx, key, now))) return false
        const inserted = await tx.db.insertIfAbsent('website_form.FormSubmission', {
          id,
          formId: args.formId,
          payload: args.payload,
          schemaVersion: current,
          consent: args.consent === true,
          consentText: form.consentText ? String(form.consentText) : null,
          status: 'new',
          source: args.source ? String(args.source).slice(0, 2_048) : null,
          fingerprint: key,
          dedupeKey,
          createdAt: now.toISOString(),
        })
        return 'dryRun' in inserted || inserted.inserted
      })
      if (!accepted) {
        if (dedupeKey) {
          const replay = (
            await ctx.db.select('website_form.FormSubmission', { formId: args.formId, dedupeKey })
          )[0]
          if (replay) return { ok: true, id: replay.id, message: form.successMessage }
        }
        return invalid('formId', 'website_form.error.rateLimit')
      }
      return { ok: true, id, message: form.successMessage }
    },
  }),

  /**
   * One submission, in full, and a line in the record saying who opened it.
   *
   * The audit row is written on the same adapter as the read, so a read that
   * commits cannot leave its record behind — and a caller who is refused gets
   * the answer a caller naming a missing row gets, so the refusal never
   * confirms that the row exists.
   */
  readSubmission: defineFn({
    input: { id: 'id', reason: 'text?' },
    output: {
      id: 'id',
      formId: 'id',
      payload: 'json',
      schemaVersion: 'int?',
      consent: 'bool',
      consentText: 'text?',
      status: 'text',
      source: 'text?',
      createdAt: 'datetime',
      purgedAt: 'datetime?',
      holdReason: 'text?',
    },
    effects: [
      'read:website_form.Form',
      'read:website_form.FormSubmission',
      'read:website.SiteMember',
      'write:website_form.FormSubmissionAudit',
    ],
    handler: async (ctx: Ctx, args) => {
      const found = await readableSubmission(ctx, args.id)
      if (!found) return null
      await recordAccess(ctx, {
        formId: found.form.id,
        action: 'read',
        submissionId: String(found.row.id),
        reason: args.reason == null ? null : String(args.reason),
      })
      return found.row
    },
  }),

  /**
   * Answers leaving the system, named field by field.
   *
   * There is no "export everything": the caller lists the fields it wants, the
   * list is checked against the form's own schema, and exactly that list goes
   * into the record beside the number of rows. An export is the one operation
   * that puts personal data somewhere this system can no longer reach, so what
   * it took has to be answerable later without guessing.
   */
  exportSubmissions: defineFn({
    input: { formId: 'id', fields: 'json', status: 'text?', limit: 'int?', reason: 'text?' },
    output: { ok: 'bool', fields: 'json?', rows: 'json?', count: 'int?', capped: 'bool?', errors: 'json?' },
    effects: [
      'read:website_form.Form',
      'read:website_form.FormSubmission',
      'read:website.SiteMember',
      'write:website_form.FormSubmissionAudit',
    ],
    handler: async (ctx: Ctx, args) => {
      const form = await formById(ctx, args.formId)
      if (!form || !(await canAdministerSite(ctx, form.siteId)))
        return invalid('formId', 'website.error.forbidden')
      const requested = parseSummaryFields(args.fields)
      if (!requested.ok || !requested.value?.length)
        return invalid('fields', 'website_form.error.exportFieldsRequired')
      const declared = new Set(schemaFieldNames(form.schema))
      const stranger = requested.value.find((name) => !declared.has(name))
      if (stranger) return invalid('fields', 'website_form.error.unknownField')

      const ceiling = Number.isInteger(args.limit)
        ? Math.min(Math.max(Number(args.limit), 1), MAX_EXPORT_ROWS)
        : MAX_EXPORT_ROWS
      const Submission = ctx.table('website_form.FormSubmission')
      let query = from(Submission)
        .where(eq(Submission.formId, args.formId), isNull(Submission.purgedAt))
        .orderBy(desc(Submission.createdAt))
      if (args.status) query = query.where(eq(Submission.status, args.status))
      // One row past the ceiling, so the answer can say it was cut short rather
      // than present a truncated file as the whole set.
      const found = await ctx.db.all(query.limit(ceiling + 1))
      // Underscored, for the same reason the submit route reserves
      // `_schemaVersion`: a form field name must start with a letter, so a
      // leading underscore is a key no form can ask for. Spelling these `id`,
      // `createdAt` and `status` would let a form with a question named
      // "status" overwrite the row's real state with the visitor's answer.
      const rows = found.slice(0, ceiling).map((row) => ({
        _id: row.id,
        _createdAt: row.createdAt,
        _status: row.status,
        ...exportRow(row.payload, requested.value as string[]),
      }))
      await recordAccess(ctx, {
        formId: form.id,
        action: 'export',
        fields: requested.value,
        rowCount: rows.length,
        reason: args.reason == null ? null : String(args.reason),
      })
      return {
        ok: true,
        fields: requested.value,
        rows,
        count: rows.length,
        capped: found.length > rows.length,
      }
    },
  }),

  /**
   * Keep one submission past its retention date, and say why.
   *
   * A reason rather than a flag, because the row has to say who is relying on
   * it — a hold with no reason is indistinguishable from one nobody remembers
   * setting, and those get cleared. Clearing the reason returns the row to the
   * ordinary queue rather than erasing it on the spot: releasing a hold is not
   * a request to delete, and a sweep will reach it in its own time.
   */
  holdSubmission: defineFn({
    input: { id: 'id', reason: 'text?' },
    output: { ok: 'bool', held: 'bool?', errors: 'json?' },
    effects: [
      'read:website_form.Form',
      'read:website_form.FormSubmission',
      'write:website_form.FormSubmission',
      'read:website.SiteMember',
      'write:website_form.FormSubmissionAudit',
    ],
    idempotent: true,
    handler: async (ctx: Ctx, args) => {
      const found = await readableSubmission(ctx, args.id)
      if (!found) return invalid('id', 'website_form.error.submissionNotFound')
      const reason = args.reason == null ? null : String(args.reason).trim().slice(0, 500) || null
      // Nothing left to preserve. Saying so is kinder than accepting a hold that
      // holds an empty row and letting someone believe the answers are safe.
      if (reason && isPurged(found.row)) return invalid('id', 'website_form.error.submissionPurged')
      await ctx.db.update(
        'website_form.FormSubmission',
        { id: found.row.id },
        {
          holdReason: reason,
          heldBy: reason ? actorKeyOf(ctx) : null,
          heldAt: reason ? new Date().toISOString() : null,
        },
      )
      await recordAccess(ctx, {
        formId: found.form.id,
        action: reason ? 'hold' : 'release',
        submissionId: String(found.row.id),
        reason,
      })
      return { ok: true, held: !!reason }
    },
  }),

  /**
   * Run one form's retention window now, instead of waiting for the sweep.
   *
   * The same bounded pass the scheduled job uses, so pressing the button and
   * letting it run overnight cannot produce different results — and so the two
   * racing over the same rows count each erasure once.
   */
  purgeSubmissions: defineFn({
    input: { formId: 'id' },
    output: { ok: 'bool', erased: 'int?', more: 'bool?', errors: 'json?' },
    effects: [
      'read:website_form.Form',
      'read:website_form.FormSubmission',
      'write:website_form.FormSubmission',
      'read:website.SiteMember',
      'write:website_form.FormSubmissionAudit',
    ],
    idempotent: true,
    handler: async (ctx: Ctx, args) => {
      const form = await formById(ctx, args.formId)
      if (!form || !(await canAdministerSite(ctx, form.siteId)))
        return invalid('formId', 'website.error.forbidden')
      if (form.retentionDays == null) return invalid('retentionDays', 'website_form.error.noRetention')
      const outcome = await purgeFormOnce(ctx, form, new Date())
      return { ok: true, erased: outcome.erased, more: outcome.more }
    },
  }),

  /** Who read, exported, held or erased — newest first. */
  listSubmissionAudit: defineFn({
    input: { formId: 'id', limit: 'int?', offset: 'int?' },
    output: {
      id: 'id',
      formId: 'id',
      submissionId: 'text?',
      action: 'text',
      actorKey: 'text',
      fields: 'json?',
      rowCount: 'int?',
      reason: 'text?',
      occurredAt: 'datetime',
    },
    effects: ['read:website_form.Form', 'read:website_form.FormSubmissionAudit', 'read:website.SiteMember'],
    handler: async (ctx: Ctx, args) => {
      const form = await formById(ctx, args.formId)
      if (!form || !(await canAdministerSite(ctx, form.siteId))) return []
      const Audit = ctx.table('website_form.FormSubmissionAudit')
      const paging = page(args.limit, args.offset)
      return ctx.db.all(
        from(Audit)
          .where(eq(Audit.formId, args.formId))
          .orderBy(desc(Audit.occurredAt))
          .limit(paging.limit)
          .offset(paging.offset),
      )
    },
  }),
}
