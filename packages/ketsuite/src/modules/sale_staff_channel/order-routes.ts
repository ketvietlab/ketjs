// Read-only staff sales-order projections.
//
// Sale remains authoritative for totals, lines, deliveries, and invoices. The
// channel joins only the bounded customer label needed by a native list and
// never invents an aggregate version or a write action.

import type { Route, ServeContext } from '@ketvietlab/ketjs'
import { channelError, defineChannelRoute, routesOf } from '../channel_api/core.ts'
// The domain owns the state machine. Copying its values into the contract by
// hand meant the published enum could fall behind it, and now that the facade
// refuses anything the enum omits, falling behind would turn a legitimate
// filter into a 422.
import { SALE_STATES } from '../sale/functions.ts'

type Req = Parameters<Route>[1]
type Row = Record<string, unknown>

const string = { type: 'string' }
const nullableString = { type: ['string', 'null'] }
const money = {
  type: 'object',
  additionalProperties: false,
  properties: { currency: string, amount: string },
  required: ['currency', 'amount'],
}
const party = {
  type: 'object',
  additionalProperties: false,
  properties: { id: string, name: string },
  required: ['id', 'name'],
}
const summary = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: string,
    reference: string,
    state: { type: 'string', enum: [...SALE_STATES] },
    orderedAt: string,
    customer: party,
    total: money,
  },
  required: ['id', 'reference', 'state', 'orderedAt', 'customer', 'total'],
}
const line = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: string,
    productId: string,
    name: string,
    quantity: string,
    uomId: string,
    unitPrice: string,
    discount: string,
    subtotal: string,
  },
  required: ['id', 'productId', 'name', 'quantity', 'uomId', 'unitPrice', 'discount', 'subtotal'],
}
const detail = {
  ...summary,
  properties: {
    ...summary.properties,
    customerReference: nullableString,
    notes: nullableString,
    lines: { type: 'array', items: line },
    deliveryMoveCount: { type: 'integer', minimum: 0 },
    invoiceCount: { type: 'integer', minimum: 0 },
    readOnly: { type: 'boolean', const: true },
  },
  required: [
    ...summary.required,
    'customerReference',
    'notes',
    'lines',
    'deliveryMoveCount',
    'invoiceCount',
    'readOnly',
  ],
}
const page = {
  type: 'object',
  additionalProperties: false,
  properties: {
    items: { type: 'array', items: summary },
    nextCursor: nullableString,
  },
  required: ['items', 'nextCursor'],
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

// A page of orders points at a handful of partners, and asking for each name on
// its own turns fifty rows into two hundred queries: getPartner also loads the
// addresses and roles this projection never reads. listPartners takes the ids
// together. Archived partners stay in, or an order whose customer was later
// retired would lose its label.
const namesOf = async (ctx: ServeContext, rows: Row[], url: URL, req: Req) => {
  const ids = [...new Set(rows.map((row) => String(row.partnerId)))]
  if (!ids.length) return new Map<string, string>()
  const partners = (await ctx.call('partner.listPartners', { ids, includeArchived: true }, url, req)) as Row[]
  return new Map(partners.map((partner) => [String(partner.id), String(partner.name)]))
}
const customerOf = (row: Row, names: Map<string, string>) => {
  const id = String(row.partnerId)
  return { id, name: names.get(id) ?? id }
}
const projectSummary = (row: Row, names: Map<string, string>) => ({
  id: String(row.id),
  reference: String(row.name),
  state: String(row.state),
  orderedAt: String(row.dateOrder),
  customer: customerOf(row, names),
  total: { currency: String(row.currency), amount: String(row.amountTotal) },
})

const notFound = (ctx: ServeContext, url: URL, req: Req) => ({
  status: 404,
  error: channelError(ctx, url, req, 'sale_staff_channel.orderNotFound', {
    messageKey: 'sale_staff_channel.error.orderNotFound',
  }),
})

export const orderRoutes = routesOf(
  defineChannelRoute({
    profile: 'staff',
    method: 'GET',
    path: 'sales/orders',
    operationId: 'staff.sales.orders.list',
    summary: 'List or search sales orders available to the signed-in salesperson.',
    auth: 'required',
    capability: { key: 'sales.orders', action: 'read' },
    request: {
      query: {
        type: 'object',
        properties: {
          query: string,
          state: { type: 'string', enum: [...SALE_STATES] },
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
        'sale.listOrders',
        {
          search: url.searchParams.get('query') || undefined,
          state: url.searchParams.get('state') || undefined,
          limit: limit + 1,
          offset,
        },
        url,
        req,
      )) as Row[]
      const hasMore = rows.length > limit
      const pageRows = rows.slice(0, limit)
      const names = await namesOf(ctx, pageRows, url, req)
      return {
        data: {
          items: pageRows.map((row) => projectSummary(row, names)),
          nextCursor: hasMore ? cursorOf(offset + limit) : null,
        },
      }
    },
  }),
  defineChannelRoute({
    profile: 'staff',
    method: 'GET',
    path: 'sales/orders/{id}/detail',
    operationId: 'staff.sales.orders.detail',
    summary: 'Read one sales order without exposing a mutation contract.',
    auth: 'required',
    capability: { key: 'sales.orders', action: 'read' },
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
      const row = (await ctx.call('sale.getOrder', { id: params.id }, url, req)) as Row | null
      if (!row) return notFound(ctx, url, req)
      const lines = Array.isArray(row.lines) ? (row.lines as Row[]) : []
      const moves = Array.isArray(row.moves) ? row.moves : []
      const invoices = Array.isArray(row.invoices) ? row.invoices : []
      return {
        data: {
          ...projectSummary(row, await namesOf(ctx, [row], url, req)),
          customerReference: row.clientOrderRef == null ? null : String(row.clientOrderRef),
          notes: row.notes == null ? null : String(row.notes),
          lines: lines.map((item) => ({
            id: String(item.id),
            productId: String(item.productId),
            name: String(item.name),
            quantity: String(item.productUomQty),
            uomId: String(item.productUomId),
            unitPrice: String(item.priceUnit),
            discount: String(item.discount),
            subtotal: String(item.priceSubtotal),
          })),
          deliveryMoveCount: moves.length,
          invoiceCount: invoices.length,
          readOnly: true,
        },
      }
    },
  }),
)
