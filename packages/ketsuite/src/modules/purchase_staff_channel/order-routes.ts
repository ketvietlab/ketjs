// Versioned staff purchase-order lifecycle.

import type { Route, ServeContext } from '@ketvietlab/ketjs'
import { channelError, defineChannelRoute, routesOf, stableHash } from '../channel_api/core.ts'
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
    itemCount: { type: 'integer', minimum: 0 },
    receiptState: { type: 'string', enum: ['none', 'pending', 'partial', 'received', 'cancelled'] },
    billingState: string,
    total: money,
  },
  required: [
    'id',
    'reference',
    'state',
    'orderedAt',
    'expectedAt',
    'vendor',
    'itemCount',
    'receiptState',
    'billingState',
    'total',
  ],
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
    uomName: string,
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
    'uomName',
    'unitPrice',
    'discount',
    'subtotal',
  ],
}
const receipt = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: string,
    reference: string,
    state: string,
    scheduledAt: string,
    receivedAt: nullableString,
    lineCount: { type: 'integer', minimum: 0 },
    availableActions: { type: 'array', items: string },
  },
  required: ['id', 'reference', 'state', 'scheduledAt', 'receivedAt', 'lineCount', 'availableActions'],
}
const bill = {
  type: 'object',
  additionalProperties: false,
  properties: { id: string, reference: string, state: string, paymentState: string, total: money },
  required: ['id', 'reference', 'state', 'paymentState', 'total'],
}
const detail = {
  ...summary,
  properties: {
    ...summary.properties,
    vendorReference: nullableString,
    notes: nullableString,
    pickingTypeId: string,
    lines: { type: 'array', items: line },
    untaxed: money,
    tax: money,
    receipts: { type: 'array', items: receipt },
    vendorBills: { type: 'array', items: bill },
    receiptMoveCount: { type: 'integer', minimum: 0 },
    vendorBillCount: { type: 'integer', minimum: 0 },
    version: { type: 'string', pattern: '^pov_[0-9a-f]{64}$' },
    availableActions: { type: 'array', items: string },
    readOnly: { type: 'boolean' },
  },
  required: [
    ...summary.required,
    'vendorReference',
    'notes',
    'pickingTypeId',
    'lines',
    'untaxed',
    'tax',
    'receipts',
    'vendorBills',
    'receiptMoveCount',
    'vendorBillCount',
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

const decimal = { type: 'string', pattern: '^(?:0|[1-9]\\d*)(?:\\.\\d+)?$' }
const draftLine = {
  type: 'object',
  additionalProperties: false,
  properties: { productId: string, quantity: decimal },
  required: ['productId', 'quantity'],
}
const draftBody = (withVersion: boolean) => ({
  type: 'object',
  additionalProperties: false,
  properties: {
    vendorId: string,
    lines: { type: 'array', minItems: 1, maxItems: 100, items: draftLine },
    ...(withVersion ? { expectedVersion: { type: 'string', pattern: '^pov_[0-9a-f]{64}$' } } : {}),
  },
  required: ['vendorId', 'lines', ...(withVersion ? ['expectedVersion'] : [])],
})
const versionBody = {
  type: 'object',
  additionalProperties: false,
  properties: { expectedVersion: { type: 'string', pattern: '^pov_[0-9a-f]{64}$' } },
  required: ['expectedVersion'],
}
const replayHeaders = {
  type: 'object',
  additionalProperties: true,
  properties: { 'Idempotency-Key': { type: 'string', minLength: 8, maxLength: 200 } },
  required: ['Idempotency-Key'],
}
const versionHeaders = {
  type: 'object',
  additionalProperties: true,
  properties: {
    ...replayHeaders.properties,
    'If-Match': { type: 'string', minLength: 1, maxLength: 200 },
  },
  required: ['Idempotency-Key', 'If-Match'],
}
const receiptResult = {
  type: 'object',
  additionalProperties: false,
  properties: {
    outcome: { type: 'string', const: 'received' },
    receiptId: string,
    receivedAt: string,
    lineCount: { type: 'integer', minimum: 1 },
    order: detail,
  },
  required: ['outcome', 'receiptId', 'receivedAt', 'lineCount', 'order'],
}

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
const receiptStateOf = (
  row: Row,
  metric?: Row,
): 'none' | 'pending' | 'partial' | 'received' | 'cancelled' => {
  const states = metric
    ? Array.isArray(metric.pickingStates)
      ? metric.pickingStates.map(String)
      : []
    : (Array.isArray(row.pickings) ? (row.pickings as Row[]) : []).map((picking) => String(picking.state))
  if (!states.length) return String(row.state) === 'cancel' ? 'cancelled' : 'none'
  if (states.every((state) => state === 'cancel')) return 'cancelled'
  if (states.every((state) => state === 'done')) return 'received'
  if (states.some((state) => state === 'done')) return 'partial'
  return 'pending'
}
const projectSummary = (row: Row, names: Map<string, string>, metric?: Row) => ({
  id: String(row.id),
  reference: String(row.name),
  state: String(row.state),
  orderedAt: String(row.dateOrder),
  expectedAt: String(row.datePlanned),
  vendor: vendorOf(row, names),
  itemCount: metric ? Number(metric.itemCount ?? 0) : Array.isArray(row.lines) ? row.lines.length : 0,
  receiptState: receiptStateOf(row, metric),
  billingState: String(row.invoiceStatus),
  total: { currency: String(row.currency), amount: String(row.amountTotal) },
})

const projectedLines = (row: Row, uomNames = new Map<string, string>()) =>
  (Array.isArray(row.lines) ? (row.lines as Row[]) : [])
    .sort(
      (left, right) =>
        Number(left.sequence ?? 0) - Number(right.sequence ?? 0) ||
        String(left.id).localeCompare(String(right.id)),
    )
    .map((item) => ({
      id: String(item.id),
      productId: String(item.productId),
      name: String(item.name),
      quantity: String(item.productQty),
      receivedQuantity: String(item.qtyReceived),
      billedQuantity: String(item.qtyInvoiced),
      uomId: String(item.productUomId),
      uomName: uomNames.get(String(item.productUomId)) ?? String(item.productUomId),
      unitPrice: String(item.priceUnit),
      discount: String(item.discount),
      subtotal: String(item.priceSubtotal),
    }))

const uomNamesOf = async (ctx: ServeContext, row: Row, url: URL, req: Req) => {
  const ids = [...new Set(projectedLines(row).map((item) => item.uomId))]
  if (!ids.length) return new Map<string, string>()
  const units = (await ctx.call('uom.listUnits', { ids }, url, req)) as Row[]
  return new Map(units.map((unit) => [String(unit.id), String(unit.name)]))
}

const readyReceipt = (picking: Row): boolean => {
  if (['done', 'cancel'].includes(String(picking.state))) return false
  const moves = Array.isArray(picking.moves) ? (picking.moves as Row[]) : []
  return (
    moves.length > 0 &&
    moves.every((move) => {
      const lines = Array.isArray(move.lines) ? (move.lines as Row[]) : []
      const prepared = lines.reduce((sum, item) => sum + Number(item.quantity ?? 0), 0)
      const tracking = String(move.tracking ?? 'none')
      return (
        lines.length > 0 &&
        Math.abs(prepared - Number(move.productUomQty ?? 0)) <= 0.000001 &&
        (tracking === 'none' || lines.every((item) => item.lotId != null))
      )
    })
  )
}

const projectedReceipts = (row: Row) =>
  (Array.isArray(row.pickings) ? (row.pickings as Row[]) : [])
    .sort((left, right) => String(left.id).localeCompare(String(right.id)))
    .map((picking) => ({
      id: String(picking.id),
      reference: String(picking.name ?? picking.id),
      state: String(picking.state),
      scheduledAt: String(picking.scheduledDate),
      receivedAt: picking.dateDone == null ? null : String(picking.dateDone),
      lineCount: (Array.isArray(picking.moves) ? (picking.moves as Row[]) : []).reduce(
        (count, move) => count + (Array.isArray(move.lines) ? move.lines.length : 0),
        0,
      ),
      availableActions: readyReceipt(picking) ? ['receive'] : [],
    }))

const projectedBills = (row: Row) =>
  (Array.isArray(row.bills) ? (row.bills as Row[]) : [])
    .sort((left, right) => String(left.id).localeCompare(String(right.id)))
    .map((item) => ({
      id: String(item.id),
      reference: String(item.name ?? item.id),
      state: String(item.state),
      paymentState: String(item.paymentState ?? 'not_paid'),
      total: {
        currency: String(item.currency ?? row.currency),
        amount: String(item.amountTotal ?? '0'),
      },
    }))

const orderActions = (state: string): string[] => {
  if (state === 'draft') return ['update', 'cancel', 'confirm']
  if (state === 'sent') return ['confirm']
  if (state === 'to approve') return ['approve']
  return []
}

const projectDetail = async (ctx: ServeContext, row: Row, url: URL, req: Req) => {
  const lines = projectedLines(row, await uomNamesOf(ctx, row, url, req))
  const receipts = projectedReceipts(row)
  const vendorBills = projectedBills(row)
  const content = {
    ...projectSummary(row, await namesOf(ctx, [row], url, req)),
    vendorReference: row.partnerRef == null ? null : String(row.partnerRef),
    notes: row.notes == null ? null : String(row.notes),
    pickingTypeId: String(row.pickingTypeId),
    lines,
    untaxed: { currency: String(row.currency), amount: String(row.amountUntaxed) },
    tax: { currency: String(row.currency), amount: String(row.amountTax) },
    receipts,
    vendorBills,
    receiptMoveCount: Array.isArray(row.moves) ? row.moves.length : 0,
    vendorBillCount: vendorBills.length,
  }
  const availableActions = orderActions(String(row.state))
  const version = `pov_${stableHash({ ...content, revision: Number(row.revision ?? 0) })}`
  return {
    ...content,
    version,
    availableActions,
    readOnly: availableActions.length === 0 && receipts.every((item) => item.availableActions.length === 0),
  }
}

const notFound = (ctx: ServeContext, url: URL, req: Req) => ({
  status: 404,
  error: channelError(ctx, url, req, 'purchase_staff_channel.orderNotFound', {
    messageKey: 'purchase_staff_channel.error.orderNotFound',
  }),
})

const domainFailure = (ctx: ServeContext, url: URL, req: Req, result: unknown) => {
  const issues = Array.isArray((result as { errors?: unknown })?.errors)
    ? ((result as { errors: Row[] }).errors ?? [])
    : []
  const conflict = issues.some((issue) =>
    ['expectedRevision', 'state', 'receiptId'].includes(String(issue.field)),
  )
  return {
    status: conflict ? 409 : 422,
    error: channelError(
      ctx,
      url,
      req,
      conflict ? 'purchase_staff_channel.conflict' : 'purchase_staff_channel.invalidRequest',
      {
        messageKey: conflict
          ? 'purchase_staff_channel.error.conflict'
          : 'purchase_staff_channel.error.invalidRequest',
        fieldErrors: Object.fromEntries(
          issues
            .filter((issue) => issue.field)
            .map((issue) => [
              String(issue.field),
              {
                code: 'purchase_staff_channel.invalidField',
                messageKey: 'purchase_staff_channel.error.invalidField',
                params: {},
              },
            ]),
        ),
      },
    ),
  }
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
  if (!header) return null
  return header === expected || header === `"${expected}"` ? expected : null
}

const versionFailure = (ctx: ServeContext, url: URL, req: Req) => ({
  status: 409,
  error: channelError(ctx, url, req, 'purchase_staff_channel.versionConflict', {
    messageKey: 'purchase_staff_channel.error.versionConflict',
    retryable: true,
  }),
})

const invalidResult = (field: string, message: string) => ({
  ok: false,
  errors: [{ field, message }],
})

const currentOrder = async (ctx: ServeContext, id: string, url: URL, req: Req) =>
  (await ctx.call('purchase.getOrder', { id }, url, req)) as Row | null

const mutationResult = async (ctx: ServeContext, id: string, url: URL, req: Req) => {
  const row = await currentOrder(ctx, id, url, req)
  if (!row) return notFound(ctx, url, req)
  const data = await projectDetail(ctx, row, url, req)
  return { data, headers: { etag: `"${data.version}"` } }
}

const commandId = (namespace: string, key: string, suffix = ''): string =>
  `staff_po_${stableHash(`${namespace}\n${key}\n${suffix}`).slice(0, 32)}`

const idParams = {
  type: 'object',
  additionalProperties: false,
  properties: { id: string },
  required: ['id'],
}

const lineValues = async (ctx: ServeContext, body: Row, namespace: string, url: URL, req: Req) => {
  const requested = body.lines as Row[]
  const ids = [...new Set(requested.map((item) => String(item.productId)))]
  const products = (await ctx.call(
    'product.listVariants',
    { ids, purchaseOk: true, requireUom: true },
    url,
    req,
  )) as Row[]
  const byId = new Map(products.map((product) => [String(product.id), product]))
  if (ids.some((id) => !byId.has(id))) return null
  return requested.map((item, index) => ({
    id: `${namespace}:line:${index + 1}`,
    productId: item.productId,
    productQty: item.quantity,
    productUomId: (byId.get(String(item.productId))!.template as Row).uomId,
  }))
}

const incomingPickingType = async (ctx: ServeContext, url: URL, req: Req): Promise<string | null> => {
  const rows = (await ctx.call('stock.listPickingTypes', {}, url, req)) as Row[]
  const eligible = rows
    .filter((row) => row.active !== false && row.code === 'incoming')
    .sort((left, right) => String(left.id).localeCompare(String(right.id)))
  return eligible.length === 1 ? String(eligible[0]!.id) : null
}

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
      const [names, metricRows] = await Promise.all([
        namesOf(ctx, pageRows, url, req),
        pageRows.length
          ? ((await ctx.call(
              'purchase.listOrderMetrics',
              { orderIds: pageRows.map((row) => String(row.id)) },
              url,
              req,
            )) as Row[])
          : [],
      ])
      const metrics = new Map(metricRows.map((metric) => [String(metric.orderId), metric]))
      return {
        data: {
          items: pageRows.map((row) => projectSummary(row, names, metrics.get(String(row.id)))),
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
      const row = await currentOrder(ctx, params.id, url, req)
      if (!row) return notFound(ctx, url, req)
      const data = await projectDetail(ctx, row, url, req)
      return {
        data,
        headers: { etag: `"${data.version}"` },
      }
    },
  }),
  defineChannelRoute({
    profile: 'staff',
    method: 'POST',
    path: 'purchasing/orders/create',
    operationId: 'staff.purchasing.orders.create',
    summary: 'Create or replay one canonical RFQ and its complete line set.',
    auth: 'required',
    capability: { key: 'purchasing.orders', action: 'create' },
    request: { headers: replayHeaders, body: draftBody(false) },
    responses: {
      '200': envelope(detail),
      '409': envelope({ type: 'null' }),
      '422': envelope({ type: 'null' }),
    },
    idempotent: true,
    rateLimit: { action: 'staff.purchasing.orders.create', limit: 60, windowMs: 60_000 },
    handler: async (ctx, url, req, _params, request) => {
      const key = idempotencyKey(ctx, url, req)
      if (typeof key !== 'string') return key
      const namespace = `staff:${String(request.identity!.companyId)}:${request.identity!.userId}:purchase.saveDraft.create`
      const id = commandId(namespace, key)
      const [lines, pickingTypeId] = await Promise.all([
        lineValues(ctx, request.body, id, url, req),
        incomingPickingType(ctx, url, req),
      ])
      if (!lines) return domainFailure(ctx, url, req, invalidResult('lines', 'product is not purchasable'))
      if (!pickingTypeId)
        return domainFailure(ctx, url, req, invalidResult('pickingTypeId', 'incoming operation is missing'))
      const result = (await ctx.call(
        'purchase.saveDraft',
        { id, partnerId: request.body.vendorId, pickingTypeId, lines, create: true },
        url,
        req,
        { idempotencyKey: key, idempotencyNamespace: namespace },
      )) as Row
      if (result.ok !== true) return domainFailure(ctx, url, req, result)
      return mutationResult(ctx, id, url, req)
    },
  }),
  defineChannelRoute({
    profile: 'staff',
    method: 'PUT',
    path: 'purchasing/orders/{id}/update',
    operationId: 'staff.purchasing.orders.update',
    summary: 'Replace one RFQ vendor and complete line set under a strong version.',
    auth: 'required',
    capability: { key: 'purchasing.orders', action: 'update' },
    request: { params: idParams, headers: versionHeaders, body: draftBody(true) },
    responses: {
      '200': envelope(detail),
      '404': envelope({ type: 'null' }),
      '409': envelope({ type: 'null' }),
      '422': envelope({ type: 'null' }),
    },
    idempotent: true,
    rateLimit: { action: 'staff.purchasing.orders.update', limit: 120, windowMs: 60_000 },
    handler: async (ctx, url, req, params, request) => {
      const key = idempotencyKey(ctx, url, req)
      if (typeof key !== 'string') return key
      const row = await currentOrder(ctx, params.id, url, req)
      if (!row) return notFound(ctx, url, req)
      const current = await projectDetail(ctx, row, url, req)
      const expected = requestVersion(req, request.body)
      if (!expected || expected !== current.version) return versionFailure(ctx, url, req)
      const namespace = `staff:${String(request.identity!.companyId)}:${request.identity!.userId}:purchase.saveDraft.update`
      const lines = await lineValues(ctx, request.body, commandId(namespace, key, params.id), url, req)
      if (!lines) return domainFailure(ctx, url, req, invalidResult('lines', 'product is not purchasable'))
      const result = (await ctx.call(
        'purchase.saveDraft',
        {
          id: params.id,
          partnerId: request.body.vendorId,
          lines,
          expectedRevision: Number(row.revision ?? 0),
        },
        url,
        req,
        { idempotencyKey: key, idempotencyNamespace: namespace },
      )) as Row
      if (result.ok !== true) return domainFailure(ctx, url, req, result)
      return mutationResult(ctx, params.id, url, req)
    },
  }),
  defineChannelRoute({
    profile: 'staff',
    method: 'POST',
    path: 'purchasing/orders/{id}/confirm',
    operationId: 'staff.purchasing.orders.confirm',
    summary: 'Submit one reviewed RFQ for explicit approval under a strong version.',
    auth: 'required',
    capability: { key: 'purchasing.orders', action: 'confirm' },
    request: { params: idParams, headers: versionHeaders, body: versionBody },
    responses: {
      '200': envelope(detail),
      '404': envelope({ type: 'null' }),
      '409': envelope({ type: 'null' }),
    },
    idempotent: true,
    rateLimit: { action: 'staff.purchasing.orders.confirm', limit: 60, windowMs: 60_000 },
    handler: async (ctx, url, req, params, request) => {
      const key = idempotencyKey(ctx, url, req)
      if (typeof key !== 'string') return key
      const row = await currentOrder(ctx, params.id, url, req)
      if (!row) return notFound(ctx, url, req)
      const current = await projectDetail(ctx, row, url, req)
      const expected = requestVersion(req, request.body)
      if (!expected || expected !== current.version) return versionFailure(ctx, url, req)
      const namespace = `staff:${String(request.identity!.companyId)}:${request.identity!.userId}:purchase.confirmOrder`
      const result = (await ctx.call(
        'purchase.confirmOrder',
        { id: params.id, requiresApproval: true, expectedRevision: Number(row.revision ?? 0) },
        url,
        req,
        { idempotencyKey: key, idempotencyNamespace: namespace },
      )) as Row
      if (result.ok !== true) return domainFailure(ctx, url, req, result)
      return mutationResult(ctx, params.id, url, req)
    },
  }),
  defineChannelRoute({
    profile: 'staff',
    method: 'POST',
    path: 'purchasing/orders/{id}/approve',
    operationId: 'staff.purchasing.orders.approve',
    summary: 'Approve one submitted RFQ and create its receipt under a strong version.',
    auth: 'required',
    capability: { key: 'purchasing.orders', action: 'approve' },
    request: { params: idParams, headers: versionHeaders, body: versionBody },
    responses: {
      '200': envelope(detail),
      '404': envelope({ type: 'null' }),
      '409': envelope({ type: 'null' }),
    },
    idempotent: true,
    rateLimit: { action: 'staff.purchasing.orders.approve', limit: 60, windowMs: 60_000 },
    handler: async (ctx, url, req, params, request) => {
      const key = idempotencyKey(ctx, url, req)
      if (typeof key !== 'string') return key
      const row = await currentOrder(ctx, params.id, url, req)
      if (!row) return notFound(ctx, url, req)
      const current = await projectDetail(ctx, row, url, req)
      const expected = requestVersion(req, request.body)
      if (!expected || expected !== current.version) return versionFailure(ctx, url, req)
      const namespace = `staff:${String(request.identity!.companyId)}:${request.identity!.userId}:purchase.approveOrder`
      const result = (await ctx.call(
        'purchase.approveOrder',
        { id: params.id, expectedRevision: Number(row.revision ?? 0) },
        url,
        req,
        { idempotencyKey: key, idempotencyNamespace: namespace },
      )) as Row
      if (result.ok !== true) return domainFailure(ctx, url, req, result)
      return mutationResult(ctx, params.id, url, req)
    },
  }),
  defineChannelRoute({
    profile: 'staff',
    method: 'POST',
    path: 'purchasing/orders/{id}/cancel',
    operationId: 'staff.purchasing.orders.cancel',
    summary: 'Cancel one unreceived and unbilled RFQ under a strong version.',
    auth: 'required',
    capability: { key: 'purchasing.orders', action: 'cancel' },
    request: { params: idParams, headers: versionHeaders, body: versionBody },
    responses: {
      '200': envelope(detail),
      '404': envelope({ type: 'null' }),
      '409': envelope({ type: 'null' }),
    },
    idempotent: true,
    rateLimit: { action: 'staff.purchasing.orders.cancel', limit: 60, windowMs: 60_000 },
    handler: async (ctx, url, req, params, request) => {
      const key = idempotencyKey(ctx, url, req)
      if (typeof key !== 'string') return key
      const row = await currentOrder(ctx, params.id, url, req)
      if (!row) return notFound(ctx, url, req)
      const current = await projectDetail(ctx, row, url, req)
      const expected = requestVersion(req, request.body)
      if (!expected || expected !== current.version) return versionFailure(ctx, url, req)
      const namespace = `staff:${String(request.identity!.companyId)}:${request.identity!.userId}:purchase.cancelOrder`
      const result = (await ctx.call(
        'purchase.cancelOrder',
        { id: params.id, expectedRevision: Number(row.revision ?? 0) },
        url,
        req,
        { idempotencyKey: key, idempotencyNamespace: namespace },
      )) as Row
      if (result.ok !== true) return domainFailure(ctx, url, req, result)
      return mutationResult(ctx, params.id, url, req)
    },
  }),
  defineChannelRoute({
    profile: 'staff',
    method: 'POST',
    path: 'purchasing/orders/{id}/receipts/{receiptId}/receive',
    operationId: 'staff.purchasing.orders.receive',
    summary: 'Receive one fully prepared receipt under the current purchase-order version.',
    auth: 'required',
    capability: { key: 'purchasing.orders', action: 'receive' },
    request: {
      params: {
        type: 'object',
        additionalProperties: false,
        properties: { id: string, receiptId: string },
        required: ['id', 'receiptId'],
      },
      headers: versionHeaders,
      body: versionBody,
    },
    responses: {
      '200': envelope(receiptResult),
      '404': envelope({ type: 'null' }),
      '409': envelope({ type: 'null' }),
    },
    idempotent: true,
    rateLimit: { action: 'staff.purchasing.orders.receive', limit: 60, windowMs: 60_000 },
    handler: async (ctx, url, req, params, request) => {
      const key = idempotencyKey(ctx, url, req)
      if (typeof key !== 'string') return key
      const row = await currentOrder(ctx, params.id, url, req)
      if (!row) return notFound(ctx, url, req)
      const current = await projectDetail(ctx, row, url, req)
      const expected = requestVersion(req, request.body)
      if (!expected || expected !== current.version) return versionFailure(ctx, url, req)
      const receipt = (Array.isArray(row.pickings) ? (row.pickings as Row[]) : []).find(
        (item) => String(item.id) === params.receiptId,
      )
      if (!receipt)
        return domainFailure(ctx, url, req, invalidResult('receiptId', 'receipt does not belong to order'))
      if (!readyReceipt(receipt))
        return domainFailure(ctx, url, req, invalidResult('receiptId', 'receipt needs warehouse review'))
      const namespace = `staff:${String(request.identity!.companyId)}:${request.identity!.userId}:purchase.receiveOrderReceipt`
      const result = (await ctx.call(
        'purchase.receiveOrderReceipt',
        {
          id: params.id,
          receiptId: params.receiptId,
          expectedRevision: Number(row.revision ?? 0),
        },
        url,
        req,
        { idempotencyKey: key, idempotencyNamespace: namespace },
      )) as Row
      if (result.ok !== true) return domainFailure(ctx, url, req, result)
      const order = await mutationResult(ctx, params.id, url, req)
      if (!('data' in order)) return order
      return {
        data: {
          outcome: 'received',
          receiptId: String(result.receiptId),
          receivedAt: String(result.receivedAt),
          lineCount: Number(result.lineCount),
          order: order.data,
        },
      }
    },
  }),
)
