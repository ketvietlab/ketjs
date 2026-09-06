// Staff-facing sales customer lookup routes.
//
// The partner module remains the source of truth for customer eligibility and
// company scope. This facade projects a narrow staff shape and never returns
// raw contact PII; create/update commands retain it only with explicit consent.

import { createHash } from 'node:crypto'
import type { Route, ServeContext } from '@ketvietlab/ketjs'
import { channelError, defineChannelRoute, idempotencyKey, routesOf } from '../channel_api/core.ts'

type Req = Parameters<Route>[1]
type Customer = {
  id: string
  name: string
  kind: string
  emailHint: string | null
  phoneHint: string | null
  contactConsent: boolean
}

const string = { type: 'string' }
const customer = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: string,
    name: string,
    kind: { type: 'string', enum: ['company', 'person'] },
    emailHint: { type: ['string', 'null'] },
    phoneHint: { type: ['string', 'null'] },
    contactConsent: { type: 'boolean' },
  },
  required: ['id', 'name', 'kind', 'emailHint', 'phoneHint', 'contactConsent'],
}
const page = {
  type: 'object',
  additionalProperties: false,
  properties: {
    items: { type: 'array', items: customer },
    nextCursor: { type: ['string', 'null'] },
  },
  required: ['items', 'nextCursor'],
}
const detail = {
  ...customer,
  properties: { ...customer.properties, readOnly: { type: 'boolean', const: false } },
  required: [...customer.required, 'readOnly'],
}
const mutation = {
  type: 'object',
  additionalProperties: false,
  properties: {
    outcome: { type: 'string', enum: ['created', 'updated'] },
    customer: detail,
  },
  required: ['outcome', 'customer'],
}
const customerBody = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 200 },
    kind: { type: 'string', enum: ['company', 'person'] },
    email: { type: ['string', 'null'], maxLength: 320 },
    phone: { type: ['string', 'null'], minLength: 7, maxLength: 40 },
    contactConsent: { type: 'boolean' },
  },
  required: ['name', 'kind', 'contactConsent'],
}
const envelope = (data: unknown) => ({
  type: 'object',
  properties: { data, error: {}, meta: { type: 'object' } },
})

const positive = (value: string | null, fallback: number, maximum: number): number => {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? Math.min(number, maximum) : fallback
}
const offsetOf = (cursor: string | null): number => {
  if (!cursor) return 0
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      offset?: unknown
    }
    return Number.isInteger(parsed.offset) && Number(parsed.offset) >= 0 ? Number(parsed.offset) : 0
  } catch {
    return 0
  }
}
const cursorOf = (offset: number): string => Buffer.from(JSON.stringify({ offset })).toString('base64url')

const maskEmail = (value: unknown): string | null => {
  const email = String(value ?? '').trim()
  if (!email) return null
  const separator = email.lastIndexOf('@')
  if (separator < 1) return '***'
  return `${email[0]}***${email.slice(separator)}`
}
const maskPhone = (value: unknown): string | null => {
  const phone = String(value ?? '').replace(/\D/g, '')
  return phone ? `•••• ${phone.slice(-4)}` : null
}
const project = (row: Record<string, unknown>): Customer => ({
  id: String(row.id),
  name: String(row.name),
  kind: String(row.kind),
  emailHint: row.contactConsent === true ? maskEmail(row.email) : null,
  phoneHint: row.contactConsent === true ? maskPhone(row.phone) : null,
  contactConsent: row.contactConsent === true,
})

const commandId = (namespace: string, key: string): string => {
  const hex = createHash('sha256').update(`${namespace}\n${key}`).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}
const invalidCustomer = (ctx: ServeContext, url: URL, req: Req, field: string) => ({
  status: 422,
  error: channelError(ctx, url, req, 'sale_staff_channel.invalidCustomer', {
    messageKey: 'sale_staff_channel.error.invalidRequest',
    fieldErrors: {
      [field]: {
        code: 'sale_staff_channel.invalidCustomer',
        messageKey: 'sale_staff_channel.error.invalidRequest',
        params: {},
      },
    },
  }),
})
const contactInput = (ctx: ServeContext, url: URL, req: Req, body: Record<string, unknown>) => {
  const email = String(body.email ?? '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
  const rawPhone = String(body.phone ?? '')
    .normalize('NFKC')
    .trim()
  const phoneDigits = rawPhone.replace(/\D/g, '')
  if ((email || rawPhone) && body.contactConsent !== true)
    return { error: invalidCustomer(ctx, url, req, 'contactConsent') }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return { error: invalidCustomer(ctx, url, req, 'email') }
  if (rawPhone && (phoneDigits.length < 7 || phoneDigits.length > 15))
    return { error: invalidCustomer(ctx, url, req, 'phone') }
  const international = rawPhone.startsWith('+') || rawPhone.startsWith('00')
  return {
    value: {
      email: email || null,
      phone: rawPhone ? (international ? `+${phoneDigits.replace(/^00/, '')}` : phoneDigits) : null,
      contactConsent: body.contactConsent === true,
    },
  }
}

const notFound = (ctx: ServeContext, url: URL, req: Req) => ({
  status: 404,
  error: channelError(ctx, url, req, 'sale_staff_channel.customerNotFound', {
    messageKey: 'sale_staff_channel.error.customerNotFound',
  }),
})

export const channelRoutes = routesOf(
  defineChannelRoute({
    profile: 'staff',
    method: 'GET',
    path: 'sales/customers',
    operationId: 'staff.sales.customers.list',
    summary: 'List or search active customers available to the signed-in salesperson.',
    auth: 'required',
    capability: { key: 'sales.customers', action: 'read' },
    request: {
      query: {
        type: 'object',
        properties: {
          query: string,
          cursor: string,
          limit: { type: 'integer', minimum: 1, maximum: 50 },
        },
      },
    },
    responses: { '200': envelope(page) },
    handler: async (ctx, url, req) => {
      const limit = positive(url.searchParams.get('limit'), 20, 50)
      const offset = offsetOf(url.searchParams.get('cursor'))
      const rows = (await ctx.call(
        'partner.listPartners',
        {
          role: 'customer',
          search: url.searchParams.get('query') || undefined,
          limit: limit + 1,
          offset,
        },
        url,
        req,
      )) as Array<Record<string, unknown>>
      const hasMore = rows.length > limit
      return {
        data: {
          items: rows.slice(0, limit).map(project),
          nextCursor: hasMore ? cursorOf(offset + limit) : null,
        },
      }
    },
  }),
  defineChannelRoute({
    profile: 'staff',
    method: 'GET',
    path: 'sales/customers/{id}',
    operationId: 'staff.sales.customers.get',
    summary: 'Read one active customer available to the signed-in salesperson.',
    auth: 'required',
    capability: { key: 'sales.customers', action: 'read' },
    request: {
      params: {
        type: 'object',
        additionalProperties: false,
        properties: { id: string },
        required: ['id'],
      },
    },
    responses: { '200': envelope(detail), '404': envelope({ type: 'null' }) },
    handler: async (ctx, url, req, params) => {
      const row = (await ctx.call('partner.getPartner', { id: params.id }, url, req)) as Record<
        string,
        unknown
      > | null
      const roles = Array.isArray(row?.roles) ? row.roles : []
      if (!row || row.active === false || !roles.some((role) => role?.role === 'customer'))
        return notFound(ctx, url, req)
      return { data: { ...project(row), readOnly: false } }
    },
  }),
  defineChannelRoute({
    profile: 'staff',
    method: 'POST',
    path: 'sales/customers/create',
    operationId: 'staff.sales.customers.create',
    summary: 'Create a customer with normalized optional contact PII and explicit consent.',
    auth: 'required',
    capability: { key: 'sales.customers', action: 'create' },
    request: { body: customerBody },
    responses: { '200': envelope(mutation), '422': envelope({ type: 'null' }) },
    idempotent: true,
    handler: async (ctx, url, req, _params, request) => {
      const key = idempotencyKey(ctx, url, req)
      if (typeof key !== 'string') return key
      const contact = contactInput(ctx, url, req, request.body)
      if (contact.error) return contact.error
      const identity = request.identity!
      const namespace = `staff:${String(identity.companyId)}:${identity.userId}:partner.customer.create`
      const id = commandId(namespace, key)
      const saved = (await ctx.call(
        'partner.savePartner',
        { id, kind: request.body.kind, name: request.body.name, ...contact.value },
        url,
        req,
        { idempotencyKey: key, idempotencyNamespace: `${namespace}:save` },
      )) as Record<string, unknown>
      if (saved.ok !== true) return invalidCustomer(ctx, url, req, 'name')
      await ctx.call(
        'partner.grantRole',
        { id: `${id}:customer`, partnerId: id, role: 'customer' },
        url,
        req,
        { idempotencyKey: key, idempotencyNamespace: `${namespace}:role` },
      )
      const row = (await ctx.call('partner.getPartner', { id }, url, req)) as Record<string, unknown>
      return { data: { outcome: 'created', customer: { ...project(row), readOnly: false } } }
    },
  }),
  defineChannelRoute({
    profile: 'staff',
    method: 'PUT',
    path: 'sales/customers/{id}/update',
    operationId: 'staff.sales.customers.update',
    summary: 'Update a customer while keeping raw contact PII out of every response.',
    auth: 'required',
    capability: { key: 'sales.customers', action: 'update' },
    request: {
      params: {
        type: 'object',
        additionalProperties: false,
        properties: { id: string },
        required: ['id'],
      },
      body: customerBody,
    },
    responses: {
      '200': envelope(mutation),
      '404': envelope({ type: 'null' }),
      '422': envelope({ type: 'null' }),
    },
    idempotent: true,
    handler: async (ctx, url, req, params, request) => {
      const key = idempotencyKey(ctx, url, req)
      if (typeof key !== 'string') return key
      const row = (await ctx.call('partner.getPartner', { id: params.id }, url, req)) as Record<
        string,
        unknown
      > | null
      const roles = Array.isArray(row?.roles) ? row.roles : []
      if (!row || row.active === false || !roles.some((role) => role?.role === 'customer'))
        return notFound(ctx, url, req)
      const contact = contactInput(ctx, url, req, request.body)
      if (contact.error) return contact.error
      const identity = request.identity!
      const namespace = `staff:${String(identity.companyId)}:${identity.userId}:partner.customer.update`
      const saved = (await ctx.call(
        'partner.savePartner',
        {
          id: params.id,
          kind: request.body.kind,
          name: request.body.name,
          parentId: row.parentId,
          vat: row.vat,
          ref: row.ref,
          lang: row.lang,
          ...contact.value,
        },
        url,
        req,
        { idempotencyKey: key, idempotencyNamespace: namespace },
      )) as Record<string, unknown>
      if (saved.ok !== true) return invalidCustomer(ctx, url, req, 'name')
      const refreshed = (await ctx.call('partner.getPartner', { id: params.id }, url, req)) as Record<
        string,
        unknown
      >
      return { data: { outcome: 'updated', customer: { ...project(refreshed), readOnly: false } } }
    },
  }),
)
