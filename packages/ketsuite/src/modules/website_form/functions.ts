import { createHash, randomUUID } from 'node:crypto'
import { asc, defineFn, desc, eq, from } from 'ketjs'
import type { Ctx, FnSpec, Row } from 'ketjs'

type FormField = {
  name: string
  type?: 'text' | 'email' | 'tel' | 'number' | 'textarea' | 'checkbox'
  required?: boolean
}

const invalid = (field: string, message: string) => ({ ok: false, errors: [{ field, message }] })

const fieldsOf = (schema: unknown): FormField[] => {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return []
  const fields = (schema as { fields?: unknown }).fields
  if (!Array.isArray(fields)) return []
  return fields.filter(
    (field): field is FormField =>
      !!field && typeof field === 'object' && typeof (field as { name?: unknown }).name === 'string',
  )
}

const validatePayload = (schema: unknown, payload: unknown): Array<{ field: string; message: string }> => {
  const fields = fieldsOf(schema)
  const value =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {}
  const allowed = new Set(fields.map((field) => field.name))
  const errors: Array<{ field: string; message: string }> = []
  for (const key of Object.keys(value))
    if (!allowed.has(key)) errors.push({ field: key, message: 'unknown field' })
  for (const field of fields) {
    const current = value[field.name]
    if (field.required && (current == null || current === '' || current === false)) {
      errors.push({ field: field.name, message: 'required' })
      continue
    }
    if (current == null || current === '') continue
    if (field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(current)))
      errors.push({ field: field.name, message: 'invalid email' })
    if (field.type === 'number' && !Number.isFinite(Number(current)))
      errors.push({ field: field.name, message: 'invalid number' })
    if (field.type === 'checkbox' && typeof current !== 'boolean')
      errors.push({ field: field.name, message: 'expects boolean' })
  }
  return errors
}

const fingerprint = (formId: unknown, rateKey: unknown): string =>
  createHash('sha256')
    .update(`${String(formId)}:${String(rateKey ?? 'anonymous')}`)
    .digest('hex')

const formById = (ctx: Ctx, id: unknown): Promise<Row | null> => {
  const Form = ctx.table('website_form.Form')
  return ctx.db.one(from(Form).where(eq(Form.id, id)))
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
    effects: ['read:website_form.Form'],
    agent: true,
    handler: async (ctx: Ctx, args) => {
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
    handler: async (ctx: Ctx, args) => formById(ctx, args.id),
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
    effects: ['read:website.Site', 'read:website_form.Form', 'write:website_form.Form'],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const site = (await ctx.db.select('website.Site', { id: args.siteId }))[0]
      if (!site) return invalid('siteId', 'site does not exist')
      if (fieldsOf(args.schema).length === 0) return invalid('schema', 'at least one field is required')
      const existing = await formById(ctx, args.id)
      const row = {
        id: args.id,
        siteId: args.siteId,
        name: String(args.name).trim(),
        schema: args.schema,
        successMessage: String(args.successMessage).trim(),
        notifyTo: args.notifyTo ? String(args.notifyTo).trim() : null,
        active: args.active !== false,
      }
      if (!row.name) return invalid('name', 'required')
      if (!row.successMessage) return invalid('successMessage', 'required')
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
    effects: ['read:website_form.FormSubmission'],
    handler: async (ctx: Ctx, args) => {
      const Submission = ctx.table('website_form.FormSubmission')
      let query = from(Submission)
        .where(eq(Submission.formId, args.formId))
        .orderBy(desc(Submission.createdAt))
      if (args.status) query = query.where(eq(Submission.status, args.status))
      if (args.limit != null) query = query.limit(Number(args.limit))
      if (args.offset != null) query = query.offset(Number(args.offset))
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
    },
    output: { ok: 'bool', id: 'id?', message: 'text?', errors: 'json?' },
    effects: [
      'read:website_form.Form',
      'read:website_form.FormRateLimit',
      'write:website_form.FormRateLimit',
      'write:website_form.FormSubmission',
    ],
    handler: async (ctx: Ctx, args) => {
      if (String(args.honeypot ?? '').trim()) return { ok: true, message: '' }
      const form = await formById(ctx, args.formId)
      if (form?.active !== true) return invalid('formId', 'form is not available')
      const errors = validatePayload(form.schema, args.payload)
      if (errors.length) return { ok: false, errors }

      const now = new Date()
      const key = fingerprint(args.formId, args.rateKey)
      const Limit = ctx.table('website_form.FormRateLimit')
      const held = await ctx.db.one(from(Limit).where(eq(Limit.key, key)))
      const windowStart = held ? new Date(String(held.windowStartedAt)) : null
      const inWindow = !!windowStart && now.getTime() - windowStart.getTime() < 15 * 60 * 1000
      if (inWindow && Number(held?.count ?? 0) >= 5) return invalid('formId', 'rate limit exceeded')

      await ctx.tx(async (tx) => {
        if (held)
          await tx.db.update(
            'website_form.FormRateLimit',
            { id: held.id },
            {
              windowStartedAt: inWindow ? held.windowStartedAt : now.toISOString(),
              count: inWindow ? Number(held.count) + 1 : 1,
            },
          )
        else
          await tx.db.insert('website_form.FormRateLimit', {
            id: randomUUID(),
            key,
            windowStartedAt: now.toISOString(),
            count: 1,
          })
        await tx.db.insert('website_form.FormSubmission', {
          id: randomUUID(),
          formId: args.formId,
          payload: args.payload,
          consent: args.consent === true,
          status: 'new',
          source: args.source ?? null,
          fingerprint: key,
          createdAt: now.toISOString(),
        })
      })
      return { ok: true, message: form.successMessage }
    },
  }),
}
