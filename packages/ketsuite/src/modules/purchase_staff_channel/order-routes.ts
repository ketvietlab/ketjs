// Read-only staff purchase-order projections.

import type { Route, ServeContext } from '@ketvietlab/ketjs'
import { channelError, defineChannelRoute, routesOf } from '../channel_api/core.ts'
// The domain owns the state machine; see the note in the sales channel. A
// published enum that drifts from it now refuses a legitimate filter.
import { PURCHASE_STATES } from '../purchase/functions.ts'

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
    state: { type: 'string', enum: [...PURCHASE_STATES] },
    orderedAt: string,
    expectedAt: string,
    vendor: party,
    billingState: string,
    total: money,
  },
  required: ['id', 'reference', 'state', 'orderedAt', 'expectedAt', 'vendor', 'billingState', 'total'],
}
const line = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: string,
    productId: string,
    name: string,
    quantity: string,
    receivedQuantity: string,
    billedQuantity: string,
    uomId: string,
    unitPrice: string,
    discount: string,
    subtotal: string,
  },
  required: [
    'id',
    'productId',
    'name',
    'quantity',
    'receivedQuantity',
    'billedQuantity',
    'uomId',
    'unitPrice',
    'discount',
    'subtotal',
  ],
}
const detail = {
  ...summary,
  properties: {
    ...summary.properties,
    vendorReference: nullableString,
    notes: nullableString,
    lines: { type: 'array', items: line },
    receiptMoveCount: { type: 'integer', minimum: 0 },
    vendorBillCount: { type: 'integer', minimum: 0 },
    readOnly: { type: 'boolean', const: true },
  },
  required: [
    ...summary.required,
    'vendorReference',
    'notes',
    'lines',
    'receiptMoveCount',
    'vendorBillCount',
    'readOnly',
  ],
}
const page = {
  type: 'object',
  additionalProperties: false,
  properties: { items: { type: 'array', items: summary }, nextCursor: nullableString },
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

// One page points at a handful of vendors, and asking for each name on its own
// turns fifty rows into two hundred queries: getPartner also loads the addresses
// and roles this projection never reads. listPartners takes the ids together.
// Archived partners stay in, or a document whose vendor was later retired would
// lose its label.
const namesOf = async (ctx: ServeContext, rows: Row[], url: URL, req: Req) => {
  const ids = [...new Set(rows.map((row) => String(row.partnerId)))]
  if (!ids.length) return new Map<string, string>()
  const partners = (await ctx.call('partner.listPartners', { ids, includeArchived: true }, url, req)) as Row[]
  return new Map(partners.map((partner) => [String(partner.id), String(partner.name)]))
}
const vendorOf = (row: Row, names: Map<string, string>) => {
  const id = String(row.partnerId)
  return { id, name: names.get(id) ?? id }
}
const projectSummary = (row: Row, names: Map<string, string>) => ({
  id: String(row.id),
  reference: String(row.name),
  state: String(row.state),
  orderedAt: String(row.dateOrder),
  expectedAt: String(row.datePlanned),
  vendor: vendorOf(row, names),
  billingState: String(row.invoiceStatus),
  total: { currency: String(row.currency), amount: String(row.amountTotal) },
})

const notFound = (ctx: ServeContext, url: URL, req: Req) => ({
  status: 404,
  error: channelError(ctx, url, req, 'purchase_staff_channel.orderNotFound', {
    messageKey: 'purchase_staff_channel.error.orderNotFound',
  }),
})

export const orderRoutes = routesOf(
  defineChannelRoute({
    profile: 'staff',
    method: 'GET',
    path: 'purchasing/orders',
    operationId: 'staff.purchasing.orders.list',
    summary: 'List or search purchase orders available to the signed-in purchaser.',
    auth: 'required',
    capability: { key: 'purchasing.orders', action: 'read' },
    request: {
      query: {
        type: 'object',
        properties: {
          query: string,
          state: { type: 'string', enum: [...PURCHASE_STATES] },
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
        'purchase.listOrders',
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
    path: 'purchasing/orders/{id}',
    operationId: 'staff.purchasing.orders.detail',
    summary: 'Read one purchase order without exposing a mutation contract.',
    auth: 'required',
    capability: { key: 'purchasing.orders', action: 'read' },
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
      const row = (await ctx.call('purchase.getOrder', { id: params.id }, url, req)) as Row | null
      if (!row) return notFound(ctx, url, req)
      const lines = Array.isArray(row.lines) ? (row.lines as Row[]) : []
      const moves = Array.isArray(row.moves) ? row.moves : []
      const bills = Array.isArray(row.bills) ? row.bills : []
      return {
        data: {
          ...projectSummary(row, await namesOf(ctx, [row], url, req)),
          vendorReference: row.partnerRef == null ? null : String(row.partnerRef),
          notes: row.notes == null ? null : String(row.notes),
          lines: lines.map((item) => ({
            id: String(item.id),
            productId: String(item.productId),
            name: String(item.name),
            quantity: String(item.productQty),
            receivedQuantity: String(item.qtyReceived),
            billedQuantity: String(item.qtyInvoiced),
            uomId: String(item.productUomId),
            unitPrice: String(item.priceUnit),
            discount: String(item.discount),
            subtotal: String(item.priceSubtotal),
          })),
          receiptMoveCount: moves.length,
          vendorBillCount: bills.length,
          readOnly: true,
        },
      }
    },
  }),
)
