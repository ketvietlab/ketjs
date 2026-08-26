// Staff customer-invoice projections and guarded commands.
//
// Account owns the ledger aggregate. This facade exposes document totals and
// residuals, but never posting lines. Mutations are explicit, versioned and
// durably reconcilable. Electronic-invoice provider actions remain outside this
// public standard module.

import type { Route, ServeContext } from '@ketvietlab/ketjs'
import { channelError, defineChannelRoute, routesOf, sha256, stableHash } from '../channel_api/core.ts'

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
    availableActions: {
      type: 'array',
      items: { type: 'string', enum: ['collect_payment', 'post', 'cancel_draft'] },
      maxItems: 3,
    },
    readOnly: { type: 'boolean' },
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
const paymentJournal = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: string,
    name: string,
    type: { type: 'string', enum: ['bank', 'cash'] },
  },
  required: ['id', 'name', 'type'],
}
const paymentEligibility = {
  type: 'object',
  additionalProperties: false,
  properties: {
    eligible: { type: 'boolean' },
    reason: {
      type: 'string',
      enum: [
        'available',
        'unsupported_invoice_type',
        'invoice_not_posted',
        'nothing_due',
        'no_payment_journal',
      ],
    },
    invoiceId: string,
    expectedVersion: string,
    amount: money,
    paymentDate: { type: 'string', format: 'date' },
    journals: { type: 'array', items: paymentJournal },
  },
  required: ['eligible', 'reason', 'invoiceId', 'expectedVersion', 'amount', 'paymentDate', 'journals'],
}
const lifecycleAction = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: { type: 'string', enum: ['post', 'cancel_draft'] },
    destructive: { type: 'boolean' },
  },
  required: ['action', 'destructive'],
}
const lifecycleEligibility = {
  type: 'object',
  additionalProperties: false,
  properties: {
    invoiceId: string,
    expectedVersion: string,
    actions: { type: 'array', items: lifecycleAction },
  },
  required: ['invoiceId', 'expectedVersion', 'actions'],
}
const paymentResult = {
  type: 'object',
  additionalProperties: false,
  properties: {
    outcome: { type: 'string', const: 'payment_registered' },
    invoice: detail,
    journal: paymentJournal,
  },
  required: ['outcome', 'invoice', 'journal'],
}
const lifecycleResult = {
  type: 'object',
  additionalProperties: false,
  properties: {
    outcome: { type: 'string', enum: ['post', 'cancel_draft'] },
    invoice: detail,
  },
  required: ['outcome', 'invoice'],
}
const version = { type: 'string', pattern: '^aiv_[0-9a-f]{64}$' }
const paymentBody = {
  type: 'object',
  additionalProperties: false,
  properties: { journalId: string, expectedVersion: version },
  required: ['journalId', 'expectedVersion'],
}
const lifecycleBody = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: { type: 'string', enum: ['post', 'cancel_draft'] },
    expectedVersion: version,
  },
  required: ['action', 'expectedVersion'],
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

const contentOf = async (ctx: ServeContext, row: Row, url: URL, req: Req) => {
  const lines = Array.isArray(row.lines) ? row.lines : []
  const [names, residuals] = await Promise.all([
    namesOf(ctx, [row], url, req),
    residualsOf(ctx, [row], url, req),
  ])
  const base = project(row, names, residuals)
  return {
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
}
const versionOf = (content: Row, row: Row): string =>
  `aiv_${sha256(JSON.stringify({ ...content, revision: Number(row.revision ?? 0) }))}`

const actionsOf = (row: Row, content: Row): string[] => {
  const actions = lifecycleActionsOf(row).map((item) => item.action)
  const amount = Number((content.amountDue as { amount?: unknown })?.amount ?? 0)
  if (row.moveType === 'out_invoice' && row.state === 'posted' && amount > 1e-12)
    actions.push('collect_payment')
  return actions
}

const detailOf = async (ctx: ServeContext, row: Row, url: URL, req: Req) => {
  const content = await contentOf(ctx, row, url, req)
  const availableActions = actionsOf(row, content)
  return {
    ...content,
    version: versionOf(content, row),
    availableActions,
    readOnly: availableActions.length === 0,
  }
}

/**
 * Payment eligibility answers with more than the invoice.
 *
 * `expectedVersion` is the invoice's version and stays that way: it is the token
 * a later payment command checks against, so it has to mean the invoice. The
 * ETag is a different promise — it says this body has not changed — and this
 * body also carries the tenant's usable journals and the date the caller asked
 * about. Renaming a journal, or asking about a different day, changed the answer
 * while the invoice version did not move.
 *
 * Lifecycle eligibility keeps the shared invoice ETag, because its actions are
 * read from the invoice row and nowhere else.
 */
const bodyEtag = (prefix: string, data: Row): string => `${prefix}_${sha256(JSON.stringify(data))}`
const eligibilityEtag = (data: Row): string => bodyEtag('aipe', data)
const lifecycleActionsOf = (row: Row): Array<{ action: string; destructive: boolean }> =>
  row.state === 'draft'
    ? [
        { action: 'post', destructive: false },
        { action: 'cancel_draft', destructive: true },
      ]
    : []
const paymentJournals = async (ctx: ServeContext, url: URL, req: Req) => {
  const rows = (await ctx.call('account.listJournals', {}, url, req)) as Row[]
  return rows
    .filter((row) => ['bank', 'cash'].includes(String(row.type)))
    .filter((row) => row.defaultAccountId != null)
    .map((row) => ({ id: String(row.id), name: String(row.name), type: String(row.type) }))
    .sort((left, right) => left.id.localeCompare(right.id))
}

const notFound = (ctx: ServeContext, url: URL, req: Req) => ({
  status: 404,
  error: channelError(ctx, url, req, 'account_staff_channel.invoiceNotFound', {
    messageKey: 'account_staff_channel.error.invoiceNotFound',
  }),
})

const invoiceParams = {
  type: 'object',
  additionalProperties: false,
  properties: { id: string },
  required: ['id'],
}
const commandParams = {
  type: 'object',
  additionalProperties: false,
  properties: { id: string, idempotencyKey: string },
  required: ['id', 'idempotencyKey'],
}

const idempotencyKey = (ctx: ServeContext, url: URL, req: Req) => {
  const key = String(req.headers['idempotency-key'] ?? '').trim()
  if (key.length >= 8 && key.length <= 200) return key
  return {
    status: 400,
    error: channelError(ctx, url, req, 'channel_api.idempotencyRequired', {
      messageKey: 'channel_api.error.idempotencyRequired',
    }),
  }
}

const requestVersion = (req: Req, body: Row): string | null => {
  const expected = String(body.expectedVersion ?? '')
  const header = String(req.headers['if-match'] ?? '').trim()
  if (!header) return expected || null
  return header === expected || header === `"${expected}"` ? expected : null
}

const versionFailure = (ctx: ServeContext, url: URL, req: Req) => ({
  status: 409,
  error: channelError(ctx, url, req, 'account_staff_channel.versionConflict', {
    messageKey: 'account_staff_channel.error.versionConflict',
    retryable: true,
  }),
})

const commandFailure = (
  ctx: ServeContext,
  url: URL,
  req: Req,
  kind: 'commandNotFound' | 'commandInProgress' | 'commandConflict',
) => ({
  status: kind === 'commandNotFound' ? 404 : 409,
  error: channelError(ctx, url, req, `account_staff_channel.${kind}`, {
    messageKey: `account_staff_channel.error.${kind}`,
    retryable: kind === 'commandInProgress',
  }),
})

const domainFailure = (ctx: ServeContext, url: URL, req: Req, result: unknown) => {
  const issues = Array.isArray((result as { errors?: unknown })?.errors)
    ? ((result as { errors: Row[] }).errors ?? [])
    : []
  const conflict = issues.some((issue) =>
    ['expectedRevision', 'state', 'invoiceId'].includes(String(issue.field)),
  )
  return {
    status: conflict ? 409 : 422,
    error: channelError(
      ctx,
      url,
      req,
      conflict ? 'account_staff_channel.versionConflict' : 'account_staff_channel.invalidRequest',
      {
        messageKey: conflict
          ? 'account_staff_channel.error.versionConflict'
          : 'account_staff_channel.error.invalidRequest',
        fieldErrors: Object.fromEntries(
          issues
            .filter((issue) => issue.field)
            .map((issue) => [
              String(issue.field),
              {
                code: String(issue.code ?? 'account_staff_channel.invalidField'),
                messageKey: 'account_staff_channel.error.invalidRequest',
                params: {},
              },
            ]),
        ),
      },
    ),
  }
}

const invoiceOf = async (ctx: ServeContext, id: string, url: URL, req: Req) => {
  const row = (await ctx.call('account.getMove', { id }, url, req)) as Row | null
  return row && customerInvoice(row) ? row : null
}

const commandIdentity = (
  identity: { companyId: string | null; userId: string },
  invoiceId: string,
  operation: string,
  key: string,
) =>
  `staff_aic_${stableHash(`${String(identity.companyId)}\n${identity.userId}\n${invoiceId}\n${operation}\n${key}`).slice(0, 32)}`

const commandInput = (
  request: { identity?: { companyId: string | null; userId: string } | null },
  invoiceId: string,
  operation: string,
  key: string,
  expectedVersion: string,
  journalId?: string,
) => {
  const identity = request.identity!
  return {
    id: commandIdentity(identity, invoiceId, operation, key),
    actorId: identity.userId,
    invoiceId,
    operation,
    requestHash: stableHash({ invoiceId, operation, expectedVersion, journalId: journalId ?? null }),
    expectedVersion,
    ...(journalId ? { journalId } : {}),
  }
}

const lookupCommand = async (ctx: ServeContext, input: Row, url: URL, req: Req): Promise<Row> =>
  (await ctx.call('account_staff_channel.getInvoiceCommand', input, url, req)) as Row

const beginCommand = async (
  ctx: ServeContext,
  input: Row,
  expectedRevision: number,
  url: URL,
  req: Req,
): Promise<Row> =>
  (await ctx.call(
    'account_staff_channel.beginInvoiceCommand',
    { ...input, expectedRevision },
    url,
    req,
  )) as Row

const completeCommand = async (
  ctx: ServeContext,
  input: Row,
  expectedRevision: number,
  outcome: string,
  url: URL,
  req: Req,
): Promise<Row> =>
  (await ctx.call(
    'account_staff_channel.completeInvoiceCommand',
    { ...input, expectedRevision, outcome },
    url,
    req,
  )) as Row

const journalOf = async (ctx: ServeContext, id: string, url: URL, req: Req) =>
  (await paymentJournals(ctx, url, req)).find((journal) => journal.id === id) ?? null

const paymentResponse = async (
  ctx: ServeContext,
  invoiceId: string,
  journalId: string,
  url: URL,
  req: Req,
) => {
  const [row, journal] = await Promise.all([
    invoiceOf(ctx, invoiceId, url, req),
    journalOf(ctx, journalId, url, req),
  ])
  if (!row) return notFound(ctx, url, req)
  if (!journal) return domainFailure(ctx, url, req, { errors: [{ field: 'journalId' }] })
  const invoice = await detailOf(ctx, row, url, req)
  // The journal is read from the tenant, not from the invoice, so an ETag that
  // only tracks the invoice answers "not modified" after a journal is renamed —
  // and this body is served from a GET, where a caller acts on that answer.
  // `invoice.version` stays inside it, so the invoice changing still moves it.
  const data = { outcome: 'payment_registered', invoice, journal }
  return { data, headers: { etag: `"${bodyEtag('aipr', data)}"` } }
}

const lifecycleResponse = async (
  ctx: ServeContext,
  invoiceId: string,
  outcome: string,
  url: URL,
  req: Req,
) => {
  const row = await invoiceOf(ctx, invoiceId, url, req)
  if (!row) return notFound(ctx, url, req)
  const invoice = await detailOf(ctx, row, url, req)
  return {
    data: { outcome, invoice },
    headers: { etag: `"${invoice.version}"` },
  }
}

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
      // The customer name and the residual are resolved from partner and payment
      // rows this move never mentions, so hashing the move alone answered "not
      // modified" after a rename. Hash what was actually built.
      const data = await detailOf(ctx, row, url, req)
      return {
        data,
        headers: { etag: `"${data.version}"` },
      }
    },
  }),
  defineChannelRoute({
    profile: 'staff',
    method: 'GET',
    path: 'accounting/invoices/{id}/payment-eligibility',
    operationId: 'staff.accounting.invoices.paymentEligibility',
    summary: 'Review the canonical residual and journals for a full customer-invoice payment.',
    auth: 'required',
    capability: { key: 'accounting.invoices', action: 'read' },
    request: {
      params: {
        type: 'object',
        additionalProperties: false,
        properties: { id: string },
        required: ['id'],
      },
      query: {
        type: 'object',
        additionalProperties: false,
        properties: { today: { type: 'string', format: 'date' } },
        required: ['today'],
      },
    },
    responses: { '200': envelope(paymentEligibility), '404': envelope({ type: 'null' }) },
    handler: async (ctx, url, req, params) => {
      const row = (await ctx.call('account.getMove', { id: params.id }, url, req)) as Row | null
      if (!row || !customerInvoice(row)) return notFound(ctx, url, req)
      const content = await contentOf(ctx, row, url, req)
      const expectedVersion = versionOf(content, row)
      const amount = content.amountDue as { currency: string; amount: string }
      let reason = 'available'
      if (row.moveType !== 'out_invoice') reason = 'unsupported_invoice_type'
      else if (row.state !== 'posted') reason = 'invoice_not_posted'
      else if (Number(amount.amount) <= 1e-12) reason = 'nothing_due'
      const journals = reason === 'available' ? await paymentJournals(ctx, url, req) : []
      if (reason === 'available' && journals.length === 0) reason = 'no_payment_journal'
      const eligible = reason === 'available'
      const data = {
        eligible,
        reason,
        invoiceId: String(row.id),
        expectedVersion,
        amount,
        paymentDate: String(url.searchParams.get('today')),
        journals: eligible ? journals : [],
      }
      return { data, headers: { etag: `"${eligibilityEtag(data)}"` } }
    },
  }),
  defineChannelRoute({
    profile: 'staff',
    method: 'GET',
    path: 'accounting/invoices/{id}/lifecycle-eligibility',
    operationId: 'staff.accounting.invoices.lifecycleEligibility',
    summary: 'Review generic workflow actions supported by the current customer-invoice state.',
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
    responses: { '200': envelope(lifecycleEligibility), '404': envelope({ type: 'null' }) },
    handler: async (ctx, url, req, params) => {
      const row = (await ctx.call('account.getMove', { id: params.id }, url, req)) as Row | null
      if (!row || !customerInvoice(row)) return notFound(ctx, url, req)
      const expectedVersion = versionOf(await contentOf(ctx, row, url, req), row)
      return {
        data: {
          invoiceId: String(row.id),
          expectedVersion,
          actions: lifecycleActionsOf(row),
        },
        headers: { etag: `"${expectedVersion}"` },
      }
    },
  }),
  defineChannelRoute({
    profile: 'staff',
    method: 'POST',
    path: 'accounting/invoices/{id}/payments',
    operationId: 'staff.accounting.invoices.collectPayment',
    summary: 'Collect the complete reviewed residual through one allowed journal.',
    auth: 'required',
    capability: { key: 'accounting.invoices', action: 'collect_payment' },
    request: { params: invoiceParams, body: paymentBody },
    responses: {
      '200': envelope(paymentResult),
      '404': envelope({ type: 'null' }),
      '409': envelope({ type: 'null' }),
      '422': envelope({ type: 'null' }),
    },
    idempotent: true,
    rateLimit: { action: 'staff.accounting.invoices.collectPayment', limit: 60, windowMs: 60_000 },
    handler: async (ctx, url, req, params, request) => {
      const key = idempotencyKey(ctx, url, req)
      if (typeof key !== 'string') return key
      const row = await invoiceOf(ctx, params.id, url, req)
      if (!row) return notFound(ctx, url, req)
      const current = await detailOf(ctx, row, url, req)
      const expectedVersion = requestVersion(req, request.body)
      if (!expectedVersion) return versionFailure(ctx, url, req)
      const journalId = String(request.body.journalId)
      if (!(await journalOf(ctx, journalId, url, req)))
        return domainFailure(ctx, url, req, { errors: [{ field: 'journalId' }] })
      const input = commandInput(request, params.id, 'collect_payment', key, expectedVersion, journalId)
      const existing = await lookupCommand(ctx, input, url, req)
      if (existing.conflict === true) return commandFailure(ctx, url, req, 'commandConflict')
      if (existing.found === true && existing.state === 'completed')
        return paymentResponse(ctx, params.id, journalId, url, req)
      let expectedRevision: number
      if (existing.found === true) expectedRevision = Number(existing.expectedRevision)
      else {
        if (current.version !== expectedVersion) return versionFailure(ctx, url, req)
        expectedRevision = Number(row.revision ?? 0)
        const begun = await beginCommand(ctx, input, expectedRevision, url, req)
        if (begun.ok !== true) return commandFailure(ctx, url, req, 'commandConflict')
      }
      const namespace = `staff:${String(request.identity!.companyId)}:${request.identity!.userId}:account.registerInvoicePayment:${params.id}`
      const result = (await ctx.call(
        'account.registerInvoicePayment',
        {
          id: `${String(input.id)}:payment`,
          invoiceId: params.id,
          journalId,
          expectedRevision,
        },
        url,
        req,
        { idempotencyKey: key, idempotencyNamespace: namespace },
      )) as Row
      if (result.ok !== true) return domainFailure(ctx, url, req, result)
      const completed = await completeCommand(ctx, input, expectedRevision, 'payment_registered', url, req)
      if (completed.ok !== true) return commandFailure(ctx, url, req, 'commandConflict')
      return paymentResponse(ctx, params.id, journalId, url, req)
    },
  }),
  defineChannelRoute({
    profile: 'staff',
    method: 'GET',
    path: 'accounting/invoices/{id}/payment-commands/{idempotencyKey}',
    operationId: 'staff.accounting.invoices.paymentCommand',
    summary: 'Reconcile one completed payment command without collecting again.',
    auth: 'required',
    capability: { key: 'accounting.invoices', action: 'collect_payment' },
    request: {
      params: commandParams,
      query: {
        type: 'object',
        additionalProperties: false,
        properties: { journalId: string, expectedVersion: version },
        required: ['journalId', 'expectedVersion'],
      },
    },
    responses: {
      '200': envelope(paymentResult),
      '404': envelope({ type: 'null' }),
      '409': envelope({ type: 'null' }),
    },
    rateLimit: { action: 'staff.accounting.invoices.paymentCommand', limit: 120, windowMs: 60_000 },
    handler: async (ctx, url, req, params, request) => {
      if (params.idempotencyKey.length < 8 || params.idempotencyKey.length > 200)
        return commandFailure(ctx, url, req, 'commandNotFound')
      const expectedVersion = String(url.searchParams.get('expectedVersion'))
      const journalId = String(url.searchParams.get('journalId'))
      const input = commandInput(
        request,
        params.id,
        'collect_payment',
        params.idempotencyKey,
        expectedVersion,
        journalId,
      )
      const command = await lookupCommand(ctx, input, url, req)
      if (command.conflict === true) return commandFailure(ctx, url, req, 'commandConflict')
      if (command.found !== true) return commandFailure(ctx, url, req, 'commandNotFound')
      if (command.state !== 'completed') return commandFailure(ctx, url, req, 'commandInProgress')
      return paymentResponse(ctx, params.id, journalId, url, req)
    },
  }),
  defineChannelRoute({
    profile: 'staff',
    method: 'POST',
    path: 'accounting/invoices/{id}/lifecycle',
    operationId: 'staff.accounting.invoices.lifecycle',
    summary: 'Execute one supported invoice lifecycle action under a strong version.',
    auth: 'required',
    capability: { key: 'accounting.invoices', action: 'lifecycle' },
    request: { params: invoiceParams, body: lifecycleBody },
    responses: {
      '200': envelope(lifecycleResult),
      '404': envelope({ type: 'null' }),
      '409': envelope({ type: 'null' }),
      '422': envelope({ type: 'null' }),
    },
    idempotent: true,
    rateLimit: { action: 'staff.accounting.invoices.lifecycle', limit: 60, windowMs: 60_000 },
    handler: async (ctx, url, req, params, request) => {
      const key = idempotencyKey(ctx, url, req)
      if (typeof key !== 'string') return key
      const row = await invoiceOf(ctx, params.id, url, req)
      if (!row) return notFound(ctx, url, req)
      const current = await detailOf(ctx, row, url, req)
      const expectedVersion = requestVersion(req, request.body)
      if (!expectedVersion) return versionFailure(ctx, url, req)
      const action = String(request.body.action)
      const input = commandInput(request, params.id, action, key, expectedVersion)
      const existing = await lookupCommand(ctx, input, url, req)
      if (existing.conflict === true) return commandFailure(ctx, url, req, 'commandConflict')
      if (existing.found === true && existing.state === 'completed')
        return lifecycleResponse(ctx, params.id, action, url, req)
      let expectedRevision: number
      if (existing.found === true) expectedRevision = Number(existing.expectedRevision)
      else {
        if (current.version !== expectedVersion) return versionFailure(ctx, url, req)
        if (!lifecycleActionsOf(row).some((item) => item.action === action))
          return domainFailure(ctx, url, req, { errors: [{ field: 'state' }] })
        expectedRevision = Number(row.revision ?? 0)
        const begun = await beginCommand(ctx, input, expectedRevision, url, req)
        if (begun.ok !== true) return commandFailure(ctx, url, req, 'commandConflict')
      }
      const fn = action === 'post' ? 'account.postMove' : 'account.cancelMove'
      const namespace = `staff:${String(request.identity!.companyId)}:${request.identity!.userId}:${fn}:${params.id}`
      const result = (await ctx.call(fn, { id: params.id, expectedRevision }, url, req, {
        idempotencyKey: key,
        idempotencyNamespace: namespace,
      })) as Row
      if (result.ok !== true) return domainFailure(ctx, url, req, result)
      const completed = await completeCommand(ctx, input, expectedRevision, action, url, req)
      if (completed.ok !== true) return commandFailure(ctx, url, req, 'commandConflict')
      return lifecycleResponse(ctx, params.id, action, url, req)
    },
  }),
  defineChannelRoute({
    profile: 'staff',
    method: 'GET',
    path: 'accounting/invoices/{id}/lifecycle-commands/{idempotencyKey}',
    operationId: 'staff.accounting.invoices.lifecycleCommand',
    summary: 'Reconcile one completed invoice lifecycle command without executing it again.',
    auth: 'required',
    capability: { key: 'accounting.invoices', action: 'lifecycle' },
    request: {
      params: commandParams,
      query: {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: { type: 'string', enum: ['post', 'cancel_draft'] },
          expectedVersion: version,
        },
        required: ['action', 'expectedVersion'],
      },
    },
    responses: {
      '200': envelope(lifecycleResult),
      '404': envelope({ type: 'null' }),
      '409': envelope({ type: 'null' }),
    },
    rateLimit: { action: 'staff.accounting.invoices.lifecycleCommand', limit: 120, windowMs: 60_000 },
    handler: async (ctx, url, req, params, request) => {
      if (params.idempotencyKey.length < 8 || params.idempotencyKey.length > 200)
        return commandFailure(ctx, url, req, 'commandNotFound')
      const action = String(url.searchParams.get('action'))
      const expectedVersion = String(url.searchParams.get('expectedVersion'))
      const input = commandInput(request, params.id, action, params.idempotencyKey, expectedVersion)
      const command = await lookupCommand(ctx, input, url, req)
      if (command.conflict === true) return commandFailure(ctx, url, req, 'commandConflict')
      if (command.found !== true) return commandFailure(ctx, url, req, 'commandNotFound')
      if (command.state !== 'completed') return commandFailure(ctx, url, req, 'commandInProgress')
      return lifecycleResponse(ctx, params.id, action, url, req)
    },
  }),
)
