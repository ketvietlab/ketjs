// Read-only staff vendor-bill projections.
//
// The account module owns the ledger rows. This facade deliberately withholds
// journal accounts and posting lines; posting, matching, payment, and e-invoice
// maintenance remain back-office operations.

import type { Route, ServeContext } from '@ketvietlab/ketjs'
import { channelError, defineChannelRoute, routesOf } from '../channel_api/core.ts'

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
    kind: { type: 'string', enum: ['bill', 'credit_note'] },
    state: { type: 'string', enum: ['draft', 'posted', 'cancel'] },
    paymentState: { type: 'string', enum: ['not_paid', 'partial', 'paid', 'reversed'] },
    vendor: party,
    invoiceDate: nullableString,
    dueAt: nullableString,
    total: money,
  },
  required: ['id', 'reference', 'kind', 'state', 'paymentState', 'vendor', 'invoiceDate', 'dueAt', 'total'],
}
const detail = {
  ...summary,
  properties: {
    ...summary.properties,
    sourceReference: nullableString,
    lineCount: { type: 'integer', minimum: 0 },
    readOnly: { type: 'boolean', const: true },
  },
  required: [...summary.required, 'sourceReference', 'lineCount', 'readOnly'],
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

const isVendorBill = (row: Row): boolean => ['in_invoice', 'in_refund'].includes(String(row.moveType))
const vendorOf = async (ctx: ServeContext, row: Row, url: URL, req: Req) => {
  const id = String(row.partnerId)
  const partner = (await ctx.call('partner.getPartner', { id }, url, req)) as Row | null
  return { id, name: String(partner?.name ?? id) }
}
const projectSummary = async (ctx: ServeContext, row: Row, url: URL, req: Req) => ({
  id: String(row.id),
  reference: String(row.name),
  kind: row.moveType === 'in_refund' ? 'credit_note' : 'bill',
  state: String(row.state),
  paymentState: String(row.paymentState),
  vendor: await vendorOf(ctx, row, url, req),
  invoiceDate: row.invoiceDate == null ? null : String(row.invoiceDate),
  dueAt: row.invoiceDateDue == null ? null : String(row.invoiceDateDue),
  total: { currency: String(row.currency), amount: String(row.amountTotal) },
})

const notFound = (ctx: ServeContext, url: URL, req: Req) => ({
  status: 404,
  error: channelError(ctx, url, req, 'purchase_staff_channel.vendorBillNotFound', {
    messageKey: 'purchase_staff_channel.error.vendorBillNotFound',
  }),
})

export const vendorBillRoutes = routesOf(
  defineChannelRoute({
    profile: 'staff',
    method: 'GET',
    path: 'purchasing/vendor-bills',
    operationId: 'staff.purchasing.vendorBills.list',
    summary: 'List or search read-only vendor bills and credit notes.',
    auth: 'required',
    capability: { key: 'purchasing.vendor_bills', action: 'read' },
    request: {
      query: {
        type: 'object',
        properties: {
          query: string,
          kind: { type: 'string', enum: ['bill', 'credit_note'] },
          state: { type: 'string', enum: ['draft', 'posted', 'cancel'] },
          paymentState: { type: 'string', enum: ['not_paid', 'partial', 'paid', 'reversed'] },
          cursor: string,
          limit: { type: 'integer', minimum: 1, maximum: 50 },
        },
      },
    },
    responses: { '200': envelope(page) },
    handler: async (ctx, url, req) => {
      const limit = positive(url.searchParams.get('limit'), 20, 50)
      const offset = offsetOf(url.searchParams.get('cursor'))
      const kind = url.searchParams.get('kind')
      const rows = (await ctx.call(
        'account.listMoves',
        {
          moveTypes:
            kind === 'bill'
              ? ['in_invoice']
              : kind === 'credit_note'
                ? ['in_refund']
                : ['in_invoice', 'in_refund'],
          search: url.searchParams.get('query') || undefined,
          state: url.searchParams.get('state') || undefined,
          paymentState: url.searchParams.get('paymentState') || undefined,
          order: 'desc',
          limit: limit + 1,
          offset,
        },
        url,
        req,
      )) as Row[]
      const hasMore = rows.length > limit
      return {
        data: {
          items: await Promise.all(rows.slice(0, limit).map((row) => projectSummary(ctx, row, url, req))),
          nextCursor: hasMore ? cursorOf(offset + limit) : null,
        },
      }
    },
  }),
  defineChannelRoute({
    profile: 'staff',
    method: 'GET',
    path: 'purchasing/vendor-bills/{id}',
    operationId: 'staff.purchasing.vendorBills.detail',
    summary: 'Read one vendor bill without exposing ledger posting lines.',
    auth: 'required',
    capability: { key: 'purchasing.vendor_bills', action: 'read' },
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
      const row = (await ctx.call('account.getMove', { id: params.id }, url, req)) as Row | null
      if (!row || !isVendorBill(row)) return notFound(ctx, url, req)
      const lines = Array.isArray(row.lines) ? row.lines : []
      return {
        data: {
          ...(await projectSummary(ctx, row, url, req)),
          sourceReference: row.ref == null ? null : String(row.ref),
          lineCount: lines.length,
          readOnly: true,
        },
      }
    },
  }),
)
