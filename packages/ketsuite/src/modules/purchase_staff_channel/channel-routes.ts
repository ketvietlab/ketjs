// Staff-facing purchasing vendor lookup routes.
//
// Partner remains the source of truth for vendor eligibility and scope. The
// channel projection deliberately excludes raw contact and address fields.

import type { Route, ServeContext } from '@ketvietlab/ketjs'
import { channelError, defineChannelRoute, routesOf } from '../channel_api/core.ts'

type Req = Parameters<Route>[1]
type Vendor = { id: string; name: string; kind: string }

const string = { type: 'string' }
const vendor = {
  type: 'object',
  additionalProperties: false,
  properties: { id: string, name: string, kind: { type: 'string', enum: ['company', 'person'] } },
  required: ['id', 'name', 'kind'],
}
const page = {
  type: 'object',
  additionalProperties: false,
  properties: {
    items: { type: 'array', items: vendor },
    nextCursor: { type: ['string', 'null'] },
  },
  required: ['items', 'nextCursor'],
}
const detail = {
  ...vendor,
  properties: { ...vendor.properties, readOnly: { type: 'boolean', const: true } },
  required: [...vendor.required, 'readOnly'],
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

const project = (row: Record<string, unknown>): Vendor => ({
  id: String(row.id),
  name: String(row.name),
  kind: String(row.kind),
})

const notFound = (ctx: ServeContext, url: URL, req: Req) => ({
  status: 404,
  error: channelError(ctx, url, req, 'purchase_staff_channel.vendorNotFound', {
    messageKey: 'purchase_staff_channel.error.vendorNotFound',
  }),
})

export const channelRoutes = routesOf(
  defineChannelRoute({
    profile: 'staff',
    method: 'GET',
    path: 'purchasing/vendors',
    operationId: 'staff.purchasing.vendors.list',
    summary: 'List or search active vendors available to the signed-in purchaser.',
    auth: 'required',
    capability: { key: 'purchasing.vendors', action: 'read' },
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
          role: 'supplier',
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
    path: 'purchasing/vendors/{id}',
    operationId: 'staff.purchasing.vendors.get',
    summary: 'Read one active vendor available to the signed-in purchaser.',
    auth: 'required',
    capability: { key: 'purchasing.vendors', action: 'read' },
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
      if (!row || row.active === false || !roles.some((role) => role?.role === 'supplier'))
        return notFound(ctx, url, req)
      return { data: { ...project(row), readOnly: true } }
    },
  }),
)
