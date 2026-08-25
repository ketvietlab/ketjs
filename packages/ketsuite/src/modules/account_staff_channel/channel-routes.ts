// Read-only staff customer-invoice projections.
//
// Account owns the ledger aggregate. This facade exposes document totals and
// residuals, but never posting lines. Electronic invoicing is deployment-owned,
// and lifecycle or payment actions stay absent until their workflows have a
// proven capability, idempotency, and concurrency contract.

import type { Route, ServeContext } from '@ketvietlab/ketjs'
import { channelError, defineChannelRoute, routesOf, sha256 } from '../channel_api/core.ts'

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
const nullableParty = { anyOf: [party, { type: 'null' }] }
const summary = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: string,
    reference: string,
    kind: { type: 'string', enum: ['invoice', 'credit_note'] },
    state: { type: 'string', enum: ['draft', 'posted', 'cancelled'] },
    paymentStatus: { type: 'string', enum: ['unpaid', 'partial', 'paid', 'reversed'] },
    customer: nullableParty,
    invoiceDate: nullableString,
    dueAt: nullableString,
    total: money,
    amountDue: money,
  },
  required: [
    'id',
    'reference',
    'kind',
    'state',
    'paymentStatus',
    'customer',
    'invoiceDate',
    'dueAt',
    'total',
    'amountDue',
  ],
}
const totals = {
  type: 'object',
  additionalProperties: false,
  properties: { untaxed: money, tax: money, total: money, amountDue: money },
  required: ['untaxed', 'tax', 'total', 'amountDue'],
}
const detail = {
  ...summary,
  properties: {
    ...summary.properties,
    sourceReference: nullableString,
    totals,
    postingLineCount: { type: 'integer', minimum: 0 },
    version: string,
    availableActions: { type: 'array', items: string, maxItems: 0 },
    readOnly: { type: 'boolean', const: true },
  },
  required: [
    ...summary.required,
    'sourceReference',
    'totals',
    'postingLineCount',
    'version',
    'availableActions',
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
const atStartOfDay = (date: string | null): string | undefined => (date ? `${date}T00:00:00.000Z` : undefined)
const atEndOfDay = (date: string | null): string | undefined => (date ? `${date}T23:59:59.999Z` : undefined)

const customerInvoice = (row: Row): boolean => ['out_invoice', 'out_refund'].includes(String(row.moveType))
const stateOf = (row: Row): string => (row.state === 'cancel' ? 'cancelled' : String(row.state))
const paymentStatusOf = (row: Row): string =>
  row.paymentState === 'not_paid' ? 'unpaid' : String(row.paymentState)
const namesOf = async (ctx: ServeContext, rows: Row[], url: URL, req: Req) => {
  const ids = [...new Set(rows.flatMap((row) => (row.partnerId == null ? [] : [String(row.partnerId)])))]
  if (!ids.length) return new Map<string, string>()
  const partners = (await ctx.call('partner.listPartners', { ids, includeArchived: true }, url, req)) as Row[]
  return new Map(partners.map((partner) => [String(partner.id), String(partner.name)]))
}
const residualsOf = async (ctx: ServeContext, rows: Row[], url: URL, req: Req) => {
  const residuals = (await ctx.call(
    'account.listMoveResiduals',
    { moveIds: rows.map((row) => String(row.id)) },
    url,
    req,
  )) as Row[]
  return new Map(residuals.map((row) => [String(row.moveId), String(row.amountResidual)]))
}
const customerOf = (row: Row, names: Map<string, string>) =>
  row.partnerId == null
    ? null
    : { id: String(row.partnerId), name: names.get(String(row.partnerId)) ?? String(row.partnerId) }
const project = (row: Row, names: Map<string, string>, residuals: Map<string, string>) => {
  const currency = String(row.currency)
  return {
    id: String(row.id),
    reference: String(row.name),
    kind: row.moveType === 'out_refund' ? 'credit_note' : 'invoice',
    state: stateOf(row),
    paymentStatus: paymentStatusOf(row),
    customer: customerOf(row, names),
    invoiceDate: row.invoiceDate == null ? null : String(row.invoiceDate),
    dueAt: row.invoiceDateDue == null ? null : String(row.invoiceDateDue),
    total: { currency, amount: String(row.amountTotal) },
    amountDue: { currency, amount: residuals.get(String(row.id)) ?? '0' },
  }
}

const notFound = (ctx: ServeContext, url: URL, req: Req) => ({
  status: 404,
  error: channelError(ctx, url, req, 'account_staff_channel.invoiceNotFound', {
    messageKey: 'account_staff_channel.error.invoiceNotFound',
  }),
})

export const channelRoutes = routesOf(
  defineChannelRoute({
    profile: 'staff',
    method: 'GET',
    path: 'accounting/invoices',
    operationId: 'staff.accounting.invoices.list',
    summary: 'List or search customer invoices and credit notes.',
    auth: 'required',
    capability: { key: 'accounting.invoices', action: 'read' },
    request: {
      query: {
        type: 'object',
        properties: {
          query: { type: 'string', minLength: 2 },
          status: { type: 'string', enum: ['all', 'draft', 'posted', 'unpaid', 'paid', 'credit_note'] },
          dateFrom: { type: 'string', format: 'date' },
          dateTo: { type: 'string', format: 'date' },
          cursor: string,
          limit: { type: 'integer', minimum: 1, maximum: 50 },
        },
      },
    },
    responses: { '200': envelope(page) },
    handler: async (ctx, url, req) => {
      const limit = positive(url.searchParams.get('limit'), 20, 50)
      const offset = offsetOf(url.searchParams.get('cursor'))
      const status = url.searchParams.get('status') ?? 'all'
      const rows = (await ctx.call(
        'account.listMoves',
        {
          moveTypes: status === 'credit_note' ? ['out_refund'] : ['out_invoice', 'out_refund'],
          search: url.searchParams.get('query') || undefined,
          state: ['draft', 'posted'].includes(status) ? status : undefined,
          paymentStates: ['unpaid', 'paid'].includes(status)
            ? status === 'unpaid'
              ? ['not_paid', 'partial']
              : ['paid']
            : undefined,
          dateFrom: atStartOfDay(url.searchParams.get('dateFrom')),
          dateTo: atEndOfDay(url.searchParams.get('dateTo')),
          order: 'desc',
          limit: limit + 1,
          offset,
        },
        url,
        req,
      )) as Row[]
      const hasMore = rows.length > limit
      const pageRows = rows.slice(0, limit)
      const [names, residuals] = await Promise.all([
        namesOf(ctx, pageRows, url, req),
        residualsOf(ctx, pageRows, url, req),
      ])
      return {
        data: {
          items: pageRows.map((row) => project(row, names, residuals)),
          nextCursor: hasMore ? cursorOf(offset + limit) : null,
        },
      }
    },
  }),
  defineChannelRoute({
    profile: 'staff',
    method: 'GET',
    path: 'accounting/invoices/{id}',
    operationId: 'staff.accounting.invoices.get',
    summary: 'Read one customer invoice without exposing ledger posting lines.',
    auth: 'required',
    capability: { key: 'accounting.invoices', action: 'read' },
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
      if (!row || !customerInvoice(row)) return notFound(ctx, url, req)
      const lines = Array.isArray(row.lines) ? row.lines : []
      const [names, residuals] = await Promise.all([
        namesOf(ctx, [row], url, req),
        residualsOf(ctx, [row], url, req),
      ])
      // The customer name and the residual are resolved from partner and payment
      // rows this move never mentions, so hashing the move alone answered "not
      // modified" after a rename. Hash what was actually built.
      const base = project(row, names, residuals)
      const content = {
        ...base,
        sourceReference: row.ref == null ? null : String(row.ref),
        totals: {
          untaxed: { currency: String(row.currency), amount: String(row.amountUntaxed) },
          tax: { currency: String(row.currency), amount: String(row.amountTax) },
          total: base.total,
          amountDue: base.amountDue,
        },
        postingLineCount: lines.length,
      }
      const version = `aiv_${sha256(JSON.stringify(content))}`
      return {
        data: {
          ...content,
          version,
          availableActions: [],
          readOnly: true,
        },
        headers: { etag: `"${version}"` },
      }
    },
  }),
)
