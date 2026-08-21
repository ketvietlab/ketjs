import { createHash, randomUUID } from 'node:crypto'
import { asc, defineFn, desc, eq, from } from 'ketjs'
import type { Ctx, FnSpec, Row } from 'ketjs'
import { canAccessSite, canManageStructure } from '../website/access.ts'

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
      return ctx.db.all(query)
    },
  }),

  getForm: defineFn({
    anonymous: true,
    input: { id: 'id' },
    output: { id: 'id', siteId: 'id', name: 'text', schema: 'json', successMessage: 'text', active: 'bool' },
    effects: ['read:website_form.Form'],
    handler: async (ctx: Ctx, args) => {
      const form = await formById(ctx, args.id)
      return form?.active === true ? form : null
    },
  }),

  saveForm: defineFn({
    input: {
      id: 'id',
      siteId: 'id',
      name: 'text',
      schema: 'json',
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
      const row = {
        id: args.id,
        siteId: args.siteId,
        name: String(args.name).trim(),
        schema: args.schema,
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
      if (existing) await ctx.db.update('website_form.Form', { id: args.id }, row)
      else await ctx.db.insert('website_form.Form', row)
      return { ok: true, id: args.id }
    },
  }),

  listSubmissions: defineFn({
    input: { formId: 'id', status: 'text?', limit: 'int?', offset: 'int?' },
    output: {
      id: 'id',
      formId: 'id',
      payload: 'json',
      consent: 'bool',
      status: 'text',
      source: 'text?',
      createdAt: 'datetime',
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
      return ctx.db.all(query)
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
    },
    output: { ok: 'bool', id: 'id?', message: 'text?', errors: 'json?' },
    effects: [
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
      if (form?.active !== true) return invalid('formId', 'website_form.error.unavailable')
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
          consent: args.consent === true,
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
}
